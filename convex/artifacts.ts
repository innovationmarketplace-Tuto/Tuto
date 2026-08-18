import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireUserId } from "./lib/auth";
import { requireOwnedLearner } from "./lib/db";
import { assertImageMetadata, assertNonEmpty, assertNormalizedBounds, assertNormalizedPolygon, assertPageRevision } from "./lib/validation";

const query = queryGeneric;
const mutation = mutationGeneric;

const mimeType = v.union(v.literal("image/jpeg"), v.literal("image/png"), v.literal("application/pdf"));
const regionSource = v.union(v.literal("document_analyzer"), v.literal("text_detector"), v.literal("combined"), v.literal("derived"));
const regionKind = v.union(v.literal("problem"), v.literal("solution_step"), v.literal("equation"), v.literal("term"), v.literal("prose"), v.literal("diagram"));

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    return await (ctx.storage as any).generateUploadUrl();
  },
});

export const createArtifact = mutation({
  args: {
    artifactId: v.string(),
    studentId: v.string(),
    kind: v.union(v.literal("scan"), v.literal("pdf"), v.literal("photo"), v.literal("other")),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, userId);
    const artifactId = assertNonEmpty(args.artifactId, "artifact ID", 200);
    const duplicate = await (ctx.db as any).query("artifacts").withIndex("by_artifact_id", (q: any) => q.eq("artifactId", artifactId)).unique();
    if (duplicate) {
      if (duplicate.ownerUserId !== userId) throw new Error("Forbidden");
      return duplicate._id;
    }
    const now = new Date().toISOString();
    return await (ctx.db as any).insert("artifacts", { artifactId, studentId: args.studentId, ownerUserId: userId, kind: args.kind, ...(args.title ? { title: assertNonEmpty(args.title, "artifact title", 300) } : {}), createdAt: now, updatedAt: now });
  },
});

export const createPage = mutation({
  args: {
    artifactId: v.string(),
    pageNumber: v.number(),
    imageUrl: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    mimeType,
    naturalWidth: v.number(),
    naturalHeight: v.number(),
    byteLength: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const artifact = await (ctx.db as any).query("artifacts").withIndex("by_artifact_id", (q: any) => q.eq("artifactId", args.artifactId)).unique();
    if (!artifact || artifact.ownerUserId !== userId) throw new Error("Forbidden");
    if (!Number.isInteger(args.pageNumber) || args.pageNumber < 1) throw new Error("page number is invalid");
    if (!args.imageUrl && !args.storageId) throw new Error("imageUrl or storageId is required");
    assertImageMetadata(args);
    const duplicate = await (ctx.db as any).query("artifactPages").withIndex("by_artifact_and_page", (q: any) => q.eq("artifactId", args.artifactId).eq("pageNumber", args.pageNumber)).unique();
    if (duplicate) throw new Error("Page already exists; create a new revision");
    const now = new Date().toISOString();
    const imageUrl = args.imageUrl ?? ((await (ctx.storage as any).getUrl(args.storageId)) ?? "");
    if (imageUrl.length === 0) throw new Error("stored image URL is unavailable");
    const pageId = await (ctx.db as any).insert("artifactPages", { artifactId: args.artifactId, studentId: artifact.studentId, ownerUserId: userId, pageNumber: args.pageNumber, imageUrl, naturalWidth: args.naturalWidth, naturalHeight: args.naturalHeight, revision: 1, mimeType: args.mimeType, ...(args.storageId ? { storageId: args.storageId } : {}), ...(args.byteLength !== undefined ? { byteLength: args.byteLength } : {}), createdAt: now, updatedAt: now });
    await (ctx.db as any).insert("artifactPageRevisions", { pageId, artifactId: args.artifactId, studentId: artifact.studentId, ownerUserId: userId, pageNumber: args.pageNumber, imageUrl, naturalWidth: args.naturalWidth, naturalHeight: args.naturalHeight, revision: 1, mimeType: args.mimeType, ...(args.storageId ? { storageId: args.storageId } : {}), ...(args.byteLength !== undefined ? { byteLength: args.byteLength } : {}), createdAt: now });
    return pageId;
  },
});

export const createPageRevision = mutation({
  args: {
    pageId: v.id("artifactPages"),
    expectedRevision: v.number(),
    imageUrl: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    mimeType,
    naturalWidth: v.number(),
    naturalHeight: v.number(),
    byteLength: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const page = await (ctx.db as any).get(args.pageId);
    if (!page || page.ownerUserId !== userId) throw new Error("Forbidden");
    assertPageRevision(page.revision, args.expectedRevision);
    if (!args.imageUrl && !args.storageId) throw new Error("imageUrl or storageId is required");
    assertImageMetadata(args);
    const now = new Date().toISOString();
    const revision = page.revision + 1;
    const imageUrl = args.imageUrl ?? ((await (ctx.storage as any).getUrl(args.storageId)) ?? "");
    if (imageUrl.length === 0) throw new Error("stored image URL is unavailable");
    await (ctx.db as any).insert("artifactPageRevisions", { pageId: page._id, artifactId: page.artifactId, studentId: page.studentId, ownerUserId: userId, pageNumber: page.pageNumber, imageUrl, naturalWidth: args.naturalWidth, naturalHeight: args.naturalHeight, revision, mimeType: args.mimeType, ...(args.storageId ? { storageId: args.storageId } : {}), ...(args.byteLength !== undefined ? { byteLength: args.byteLength } : {}), createdAt: now });
    const currentPage: any = { artifactId: page.artifactId, studentId: page.studentId, ownerUserId: userId, pageNumber: page.pageNumber, imageUrl, naturalWidth: args.naturalWidth, naturalHeight: args.naturalHeight, revision, mimeType: args.mimeType, createdAt: page.createdAt, updatedAt: now };
    if (args.storageId) currentPage.storageId = args.storageId;
    if (args.byteLength !== undefined) currentPage.byteLength = args.byteLength;
    await (ctx.db as any).replace(page._id, currentPage);
    return { pageId: page._id, revision };
  },
});

export const getPage = query({
  args: { pageId: v.id("artifactPages") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const page = await (ctx.db as any).get(args.pageId);
    if (!page || page.ownerUserId !== userId) throw new Error("Forbidden");
    return page;
  },
});

export const listPages = query({
  args: { artifactId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const artifact = await (ctx.db as any).query("artifacts").withIndex("by_artifact_id", (q: any) => q.eq("artifactId", args.artifactId)).unique();
    if (!artifact || artifact.ownerUserId !== userId) throw new Error("Forbidden");
    return await (ctx.db as any).query("artifactPages").withIndex("by_artifact", (q: any) => q.eq("artifactId", args.artifactId)).collect();
  },
});

export const listPageRevisions = query({
  args: { pageId: v.id("artifactPages") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const page = await (ctx.db as any).get(args.pageId);
    if (!page || page.ownerUserId !== userId) throw new Error("Forbidden");
    return await (ctx.db as any).query("artifactPageRevisions").withIndex("by_page", (q: any) => q.eq("pageId", args.pageId)).order("desc").collect();
  },
});

export const createRegion = mutation({
  args: {
    pageId: v.id("artifactPages"),
    revision: v.number(),
    parentRegionId: v.optional(v.id("pageRegions")),
    kind: regionKind,
    polygon: v.array(v.object({ x: v.number(), y: v.number() })),
    bounds: v.object({ x: v.number(), y: v.number(), width: v.number(), height: v.number() }),
    transcription: v.optional(v.string()),
    latex: v.optional(v.string()),
    confidence: v.optional(v.number()),
    source: regionSource,
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const page = await (ctx.db as any).get(args.pageId);
    if (!page || page.ownerUserId !== userId) throw new Error("Forbidden");
    assertPageRevision(page.revision, args.revision);
    assertNormalizedBounds(args.bounds);
    assertNormalizedPolygon(args.polygon);
    if (args.confidence !== undefined && (args.confidence < 0 || args.confidence > 1 || !Number.isFinite(args.confidence))) throw new Error("region confidence is invalid");
    if (args.parentRegionId) {
      const parent = await (ctx.db as any).get(args.parentRegionId);
      if (!parent || parent.pageId !== page._id || parent.revision !== args.revision) throw new Error("parent region revision mismatch");
    }
    return await (ctx.db as any).insert("pageRegions", { ...args, createdAt: new Date().toISOString() });
  },
});

export const listRegions = query({
  args: { pageId: v.id("artifactPages"), revision: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const page = await (ctx.db as any).get(args.pageId);
    if (!page || page.ownerUserId !== userId) throw new Error("Forbidden");
    const revision = args.revision ?? page.revision;
    assertPageRevision(page.revision, revision);
    return await (ctx.db as any).query("pageRegions").withIndex("by_page_and_revision", (q: any) => q.eq("pageId", args.pageId).eq("revision", revision)).collect();
  },
});

export const createMessage = mutation({
  args: { studentId: v.string(), threadId: v.string(), text: v.string(), pageId: v.optional(v.id("artifactPages")), pageRevision: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, userId);
    if (args.pageId) {
      const page = await (ctx.db as any).get(args.pageId);
      if (!page || page.ownerUserId !== userId || page.studentId !== args.studentId) throw new Error("Forbidden");
      if (args.pageRevision === undefined) throw new Error("pageRevision is required for page messages");
      assertPageRevision(page.revision, args.pageRevision);
    } else if (args.pageRevision !== undefined) {
      throw new Error("pageId is required with pageRevision");
    }
    return await (ctx.db as any).insert("tutorMessages", { studentId: args.studentId, ownerUserId: userId, threadId: assertNonEmpty(args.threadId, "thread ID", 300), text: assertNonEmpty(args.text, "message text", 8_000), annotationIds: [], ...(args.pageId ? { pageId: args.pageId } : {}), ...(args.pageRevision !== undefined ? { pageRevision: args.pageRevision } : {}), createdAt: new Date().toISOString() });
  },
});

export const addAnnotation = mutation({
  args: { pageId: v.id("artifactPages"), pageRevision: v.number(), targetRegionId: v.id("pageRegions"), messageId: v.id("tutorMessages"), kind: v.union(v.literal("highlight"), v.literal("circle"), v.literal("underline"), v.literal("arrow"), v.literal("focus"), v.literal("label")), label: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const page = await (ctx.db as any).get(args.pageId);
    const message = await (ctx.db as any).get(args.messageId);
    const region = await (ctx.db as any).get(args.targetRegionId);
    if (!page || page.ownerUserId !== userId || !message || message.ownerUserId !== userId || !region) throw new Error("Forbidden");
    assertPageRevision(page.revision, args.pageRevision);
    if (region.pageId !== page._id || region.revision !== args.pageRevision) throw new Error("Region revision mismatch");
    // Spatial tutor annotations are linked to the page-scoped tutor message
    // that explains them. Requiring both fields prevents a valid message from
    // being reused across page revisions (or attached to an unrelated page).
    if (message.pageId !== page._id || message.pageRevision !== args.pageRevision) throw new Error("Message revision mismatch");
    const id = await (ctx.db as any).insert("tutorAnnotations", { ...args, ...(args.label ? { label: assertNonEmpty(args.label, "annotation label", 500) } : {}), createdAt: new Date().toISOString() });
    await (ctx.db as any).patch(message._id, { annotationIds: [...(message.annotationIds ?? []), id] });
    return id;
  },
});

export const listAnnotations = query({
  args: { pageId: v.id("artifactPages"), pageRevision: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const page = await (ctx.db as any).get(args.pageId);
    if (!page || page.ownerUserId !== userId) throw new Error("Forbidden");
    assertPageRevision(page.revision, args.pageRevision);
    const rows = await (ctx.db as any)
      .query("tutorAnnotations")
      .withIndex("by_page_and_revision", (q: any) => q.eq("pageId", args.pageId).eq("pageRevision", args.pageRevision))
      .collect();

    // The page owner check is the primary boundary. Re-check linked rows as
    // well so a malformed/legacy annotation can never expose another owner's
    // message or a region from a different page revision.
    const owned = await Promise.all(rows.map(async (row: any) => {
      const [message, region] = await Promise.all([
        (ctx.db as any).get(row.messageId),
        (ctx.db as any).get(row.targetRegionId),
      ]);
      if (
        !message
        || message.ownerUserId !== userId
        || message.pageId !== page._id
        || message.pageRevision !== args.pageRevision
        || !region
        || region.pageId !== page._id
        || region.revision !== args.pageRevision
      ) return null;
      return {
        _id: row._id,
        pageId: row.pageId,
        pageRevision: row.pageRevision,
        targetRegionId: row.targetRegionId,
        messageId: row.messageId,
        kind: row.kind,
        ...(row.label !== undefined ? { label: row.label } : {}),
        ...(row.createdAt !== undefined ? { createdAt: row.createdAt } : {}),
      };
    }));
    return owned.filter((row: any): row is any => row !== null);
  },
});
