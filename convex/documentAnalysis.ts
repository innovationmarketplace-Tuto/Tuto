import {
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import { requireUserId } from "./lib/auth";
import { consumeInferenceBudget, requireOwnedLearner } from "./lib/db";
import { providerName } from "./lib/guards";
import { DOCUMENT_ANALYZER_ADAPTER_VERSION } from "./lib/documentAnalyzer";
import { assertImageMetadata, assertNormalizedBounds, assertNormalizedPolygon, assertPageRevision } from "./lib/validation";

const query = queryGeneric;
const mutation = mutationGeneric;
const internalQuery = internalQueryGeneric;
const internalMutation = internalMutationGeneric;

// Generic Convex references are path-only; the registered function remains
// internal even though the ungenerated helper type defaults to public.
const analyzeRef = makeFunctionReference<"action">("awsDocumentAnalysis:analyze") as any;

const regionValidator = v.object({
  id: v.string(),
  pageId: v.string(),
  parentRegionId: v.optional(v.string()),
  revision: v.number(),
  kind: v.union(v.literal("problem"), v.literal("solution_step"), v.literal("equation"), v.literal("term"), v.literal("prose"), v.literal("diagram")),
  polygon: v.array(v.object({ x: v.number(), y: v.number() })),
  bounds: v.object({ x: v.number(), y: v.number(), width: v.number(), height: v.number() }),
  transcription: v.optional(v.string()),
  latex: v.optional(v.string()),
  confidence: v.optional(v.number()),
  source: v.union(v.literal("document_analyzer"), v.literal("text_detector"), v.literal("combined"), v.literal("derived")),
  providerRegionId: v.optional(v.string()),
});

export const submitScan = mutation({
  args: {
    pageId: v.id("artifactPages"),
    pageRevision: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const page = await (ctx.db as any).get(args.pageId);
    if (!page || page.ownerUserId !== userId) throw new Error("Forbidden");
    assertPageRevision(page.revision, args.pageRevision);
    if (!args.idempotencyKey.trim() || args.idempotencyKey.length > 300) throw new Error("idempotency key is invalid");
    const existing = await (ctx.db as any).query("analysisJobs").withIndex("by_owner_and_idempotency", (q: any) => q.eq("ownerUserId", userId).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (existing) {
      if (existing.pageId !== page._id || existing.pageRevision !== args.pageRevision) throw new Error("idempotency key belongs to another page revision");
      return existing._id;
    }
    const completed = await (ctx.db as any).query("analysisJobs").withIndex("by_page_and_revision", (q: any) => q.eq("pageId", page._id).eq("pageRevision", args.pageRevision)).filter((q: any) => q.eq(q.field("status"), "completed")).first();
    if (completed) return completed._id;
    // The accepted synchronous BDA path is image-only. PDF storage remains
    // valid for future async fallback, but it must not enter this job path.
    if (page.mimeType !== "image/jpeg" && page.mimeType !== "image/png") throw new Error("document analysis currently accepts canonical JPEG/PNG pages only");
    assertImageMetadata(page);
    await requireOwnedLearner(ctx, page.studentId, userId);
    await consumeInferenceBudget(ctx, userId, "document_analysis");
    const now = new Date().toISOString();
    const jobId = await (ctx.db as any).insert("analysisJobs", {
      pageId: page._id,
      pageRevision: args.pageRevision,
      artifactId: page.artifactId,
      studentId: page.studentId,
      ownerUserId: userId,
      idempotencyKey: args.idempotencyKey,
      status: "scheduled",
      provider: providerName(),
      adapterVersion: DOCUMENT_ANALYZER_ADAPTER_VERSION,
      attempt: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
      scheduledAt: now,
    });
    await (ctx.scheduler as any).runAfter(0, analyzeRef, { jobId });
    return jobId;
  },
});

export const getJob = query({
  args: { jobId: v.id("analysisJobs") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const job = await (ctx.db as any).get(args.jobId);
    if (!job || job.ownerUserId !== userId) throw new Error("Forbidden");
    return job;
  },
});

export const listJobs = query({
  args: { studentId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, userId);
    return await (ctx.db as any).query("analysisJobs").withIndex("by_owner_and_status", (q: any) => q.eq("ownerUserId", userId)).filter((q: any) => q.eq(q.field("studentId"), args.studentId)).order("desc").take(Math.min(100, Math.max(1, Math.floor(args.limit ?? 50))));
  },
});

/**
 * Return the authenticated learner's uploaded worksheet pages with their
 * current analysis state.  This is deliberately a small student-facing read
 * model: owner keys, idempotency keys, provider details, storage IDs, and
 * provider usage never leave the server.
 *
 * Pages are the history unit rather than artifacts because a future
 * multi-page upload can have a different analysis state on each page.  The
 * current page pointer is joined to its current-revision job, while pages
 * without a job yet remain visible as pending uploads.
 */
export const listWorksheetHistory = query({
  args: { studentId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, userId);

    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 50)));
    const [artifacts, pages] = await Promise.all([
      (ctx.db as any)
        .query("artifacts")
        .withIndex("by_student", (q: any) => q.eq("studentId", args.studentId))
        .collect(),
      (ctx.db as any)
        .query("artifactPages")
        .withIndex("by_student", (q: any) => q.eq("studentId", args.studentId))
        .collect(),
    ]);

    const artifactsById = new Map<string, any>();
    for (const artifact of artifacts) {
      if (artifact.ownerUserId === userId && artifact.studentId === args.studentId) {
        artifactsById.set(artifact.artifactId, artifact);
      }
    }

    const rows = await Promise.all(pages.map(async (page: any) => {
      if (page.ownerUserId !== userId || page.studentId !== args.studentId) return null;
      const artifact = artifactsById.get(page.artifactId);
      if (!artifact) return null;

      const jobs = await (ctx.db as any)
        .query("analysisJobs")
        .withIndex("by_page_and_revision", (q: any) => q.eq("pageId", page._id).eq("pageRevision", page.revision))
        .order("desc")
        .take(1);
      const job = jobs.find((candidate: any) => (
        candidate.ownerUserId === userId
        && candidate.studentId === args.studentId
        && candidate.artifactId === artifact.artifactId
      ));

      // Keep the field set intentionally explicit.  In particular, do not
      // return ownerUserId, storageId, idempotencyKey, or provider metadata.
      return {
        id: String(page._id),
        artifactId: artifact.artifactId,
        artifactRecordId: artifact._id,
        pageId: page._id,
        pageNumber: page.pageNumber,
        pageRevision: page.revision,
        title: typeof artifact.title === "string" && artifact.title.trim()
          ? artifact.title.trim()
          : "Worksheet",
        kind: artifact.kind,
        thumbnailUrl: typeof page.imageUrl === "string" && page.imageUrl.length > 0 ? page.imageUrl : null,
        createdAt: page.createdAt ?? artifact.createdAt,
        updatedAt: page.updatedAt ?? artifact.updatedAt ?? page.createdAt ?? artifact.createdAt,
        naturalWidth: page.naturalWidth,
        naturalHeight: page.naturalHeight,
        mimeType: page.mimeType,
        status: job?.status ?? "pending",
        ...(job ? { jobId: job._id } : {}),
        ...(job?.completedAt ? { completedAt: job.completedAt } : {}),
      };
    }));

    return rows
      .filter((row: any): row is any => row !== null)
      .sort((left: any, right: any) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  },
});

/** Restore the latest durable page-analysis workflow for an owned learner. */
export const latestWorkflow = query({
  args: { studentId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, userId);
    const jobs = await (ctx.db as any)
      .query("analysisJobs")
      .withIndex("by_owner_and_status", (q: any) => q.eq("ownerUserId", userId))
      .filter((q: any) => q.eq(q.field("studentId"), args.studentId))
      .order("desc")
      .take(1);
    const job = jobs[0];
    if (!job) return null;
    const page = await (ctx.db as any).get(job.pageId);
    if (!page || page.ownerUserId !== userId || page.studentId !== args.studentId || !page.storageId) return null;
    const artifact = await (ctx.db as any)
      .query("artifacts")
      .withIndex("by_artifact_id", (q: any) => q.eq("artifactId", page.artifactId))
      .unique();
    if (!artifact || artifact.ownerUserId !== userId) return null;
    return {
      artifactId: page.artifactId,
      artifactRecordId: artifact._id,
      pageId: page._id,
      pageRevision: job.pageRevision,
      jobId: job._id,
      storageId: page.storageId,
      naturalWidth: page.naturalWidth,
      naturalHeight: page.naturalHeight,
      mimeType: page.mimeType,
      byteLength: page.byteLength ?? 0,
    };
  },
});

export const getInput = internalQuery({
  args: { jobId: v.id("analysisJobs") },
  handler: async (ctx, args) => {
    const job = await (ctx.db as any).get(args.jobId);
    if (!job) return null;
    const page = await (ctx.db as any).get(job.pageId);
    const revision = await (ctx.db as any).query("artifactPageRevisions").withIndex("by_page_and_revision", (q: any) => q.eq("pageId", job.pageId).eq("revision", job.pageRevision)).unique();
    return { job, page, revision };
  },
});

export const markRunning = internalMutation({
  args: { jobId: v.id("analysisJobs") },
  handler: async (ctx, args) => {
    const job = await (ctx.db as any).get(args.jobId);
    if (!job) throw new Error("Analysis job not found");
    if (job.status === "completed" || job.status === "cancelled") return job;
    const now = new Date().toISOString();
    const next = { status: "running", attempt: job.attempt + 1, startedAt: now, updatedAt: now };
    await (ctx.db as any).patch(job._id, next);
    return { ...job, ...next };
  },
});

export const complete = internalMutation({
  args: {
    jobId: v.id("analysisJobs"),
    pageRevision: v.number(),
    regions: v.array(regionValidator),
    provider: v.union(v.literal("fake"), v.literal("aws_bda")),
    adapterVersion: v.string(),
    latencyMs: v.number(),
    usage: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const job = await (ctx.db as any).get(args.jobId);
    if (!job) throw new Error("Analysis job not found");
    if (job.status === "completed") return job._id;
    const page = await (ctx.db as any).get(job.pageId);
    if (!page) throw new Error("Page not found");
    assertPageRevision(page.revision, args.pageRevision);
    if (job.pageRevision !== args.pageRevision) throw new Error("Job/page revision mismatch");
    const now = new Date().toISOString();
    const inserted = new Map<string, any>();
    const pendingParents = new Map<any, string>();
    for (const region of args.regions) {
      if (region.pageId !== String(page._id) || region.revision !== args.pageRevision) throw new Error("Provider region revision mismatch");
      assertNormalizedBounds(region.bounds);
      assertNormalizedPolygon(region.polygon);
      if (region.confidence !== undefined && (region.confidence < 0 || region.confidence > 1 || !Number.isFinite(region.confidence))) throw new Error("Provider region confidence is invalid");
      if (inserted.has(region.id)) continue;
      const id = await (ctx.db as any).insert("pageRegions", {
        pageId: page._id,
        revision: args.pageRevision,
        kind: region.kind,
        polygon: region.polygon,
        bounds: region.bounds,
        ...(region.transcription !== undefined ? { transcription: region.transcription } : {}),
        ...(region.latex !== undefined ? { latex: region.latex } : {}),
        ...(region.confidence !== undefined ? { confidence: region.confidence } : {}),
        source: region.source,
        ...(region.id ? { providerRegionId: region.id } : {}),
        createdAt: now,
      });
      inserted.set(region.id, id);
      if (region.parentRegionId) pendingParents.set(id, region.parentRegionId);
    }
    // Provider parent IDs are stable adapter IDs, not Convex document IDs.
    // Resolve them only after every region has been inserted so child-first
    // provider output is valid and raw provider identifiers never leak into
    // the persisted `parentRegionId` field.
    for (const [regionId, providerParentId] of pendingParents) {
      const parentRegionId = inserted.get(providerParentId);
      if (!parentRegionId) throw new Error("Provider parent region is missing from the page result");
      await (ctx.db as any).patch(regionId, { parentRegionId });
    }
    await (ctx.db as any).patch(job._id, { status: "completed", provider: args.provider, adapterVersion: args.adapterVersion, completedAt: now, updatedAt: now, latencyMs: Math.max(0, args.latencyMs), ...(args.usage !== undefined ? { usage: args.usage } : {}) });
    return job._id;
  },
});

export const fail = internalMutation({
  args: { jobId: v.id("analysisJobs"), errorCode: v.string(), errorMessage: v.string(), retryable: v.boolean() },
  handler: async (ctx, args) => {
    const job = await (ctx.db as any).get(args.jobId);
    if (!job || job.status === "completed" || job.status === "cancelled") return job?._id ?? null;
    const now = new Date().toISOString();
    const willRetry = args.retryable && job.attempt < job.maxAttempts;
    await (ctx.db as any).patch(job._id, { status: willRetry ? "scheduled" : "failed", errorCode: args.errorCode.slice(0, 200), errorMessage: args.errorMessage.slice(0, 2_000), retryable: willRetry, ...(willRetry ? {} : { failedAt: now }), updatedAt: now });
    if (willRetry) await (ctx.scheduler as any).runAfter(Math.min(60_000, 1_000 * 2 ** Math.max(0, job.attempt - 1)), analyzeRef, { jobId: job._id });
    return job._id;
  },
});

export const cancel = mutation({
  args: { jobId: v.id("analysisJobs") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const job = await (ctx.db as any).get(args.jobId);
    if (!job || job.ownerUserId !== userId) throw new Error("Forbidden");
    if (job.status === "completed") throw new Error("Completed jobs cannot be cancelled");
    await (ctx.db as any).patch(job._id, { status: "cancelled", updatedAt: new Date().toISOString() });
    return job._id;
  },
});

/**
 * Requeue a terminal job without re-uploading its immutable page revision.
 * This is intentionally owner-scoped and schedules the same internal action;
 * the client never chooses a provider, prompt, or AWS resource.
 */
export const retryScan = mutation({
  args: { jobId: v.id("analysisJobs") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const job = await (ctx.db as any).get(args.jobId);
    if (!job || job.ownerUserId !== userId) throw new Error("Forbidden");
    if (job.status === "completed") throw new Error("Completed jobs cannot be retried");
    if (job.status === "cancelled") throw new Error("Cancelled jobs cannot be retried");
    if (job.status !== "failed") throw new Error("Only failed analysis jobs can be retried");
    const now = new Date().toISOString();
    await (ctx.db as any).patch(job._id, {
      status: "scheduled",
      attempt: 0,
      updatedAt: now,
      scheduledAt: now,
      startedAt: undefined,
      completedAt: undefined,
      failedAt: undefined,
      errorCode: undefined,
      errorMessage: undefined,
      retryable: undefined,
      latencyMs: undefined,
      usage: undefined,
    });
    await (ctx.scheduler as any).runAfter(0, analyzeRef, { jobId: job._id });
    return job._id;
  },
});

export const submit = submitScan;
export const schedule = submitScan;
export const completeScan = complete;
export const failScan = fail;
