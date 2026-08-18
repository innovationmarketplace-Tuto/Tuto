import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  MAX_TUTOR_LEARNER_FACTS,
  MAX_TUTOR_LEARNER_FACT_KEY_LENGTH,
  MAX_TUTOR_LEARNER_FACT_VALUE_LENGTH,
  type TutorLearnerFact,
} from "../src/domain/memory";
import type { PageRegion } from "../src/domain/regions";
import type { Skill } from "../src/domain/skills";
import type { TeachingBrief, TeachingBriefSkill } from "../src/domain/tutoring";
import { extractSubjectContext } from "../src/intelligence/context-extractor";
import { resolveSkillsFromContext } from "../src/intelligence/skill-resolver";
import { projectAndPersist } from "./evidence";
import { requireUserId } from "./lib/auth";
import { consumeInferenceBudget, requireOwnedLearner } from "./lib/db";
import { normalizeTutorMetadata } from "./lib/tutor";
import { assertNonEmpty, assertPageRevision, normalizeTextArray } from "./lib/validation";

const publicQuery = query;

const prepareRef = makeFunctionReference<"query">("tutor:prepare") as any;
const beginRef = makeFunctionReference<"mutation">("tutor:begin") as any;
const failRef = makeFunctionReference<"mutation">("tutor:fail") as any;
const providerRef = makeFunctionReference<"action">("tutorProvider:generate") as any;

const tutorRole = v.union(v.literal("student"), v.literal("tutor"));
const conversationScope = v.union(v.literal("chat"), v.literal("worksheet"));
type ConversationScope = "chat" | "worksheet";
const annotationKinds = new Set([
  "highlight",
  "circle",
  "underline",
  "arrow",
  "focus",
  "label",
] as const);
type AnnotationKind = "highlight" | "circle" | "underline" | "arrow" | "focus" | "label";

function asAnnotationKind(value: unknown): AnnotationKind | null {
  return typeof value === "string" && annotationKinds.has(value as AnnotationKind)
    ? value as AnnotationKind
    : null;
}

function timestamp(): string {
  return new Date().toISOString();
}

function cleanThreadId(value: string): string {
  return assertNonEmpty(value, "thread ID", 300);
}

function cleanMessage(value: string): string {
  return assertNonEmpty(value, "message text", 8_000);
}

const learnerFactSources = new Set<TutorLearnerFact["source"]>([
  "student",
  "tutor",
  "human_review",
  "import",
]);

/**
 * Project a persisted fact into the provider contract. This deliberately
 * drops owner/record/timestamp/editability fields and rejects malformed rows
 * rather than allowing arbitrary database data into a model prompt.
 */
function asTutorLearnerFact(row: any, ownerUserId: string): TutorLearnerFact | null {
  if (!row || row.ownerUserId !== ownerUserId) return null;
  const clean = (input: unknown): string => typeof input === "string"
    ? input
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    : "";
  const key = clean(row.key);
  const value = clean(row.value);
  const source = row.source as TutorLearnerFact["source"];
  const confidence = Number(row.confidence);
  if (!key || !value || !learnerFactSources.has(source)) return null;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return {
    key: key.slice(0, MAX_TUTOR_LEARNER_FACT_KEY_LENGTH),
    value: value.slice(0, MAX_TUTOR_LEARNER_FACT_VALUE_LENGTH),
    source,
    confidence,
  };
}

function normalizeScope(value: unknown, pageId?: unknown): ConversationScope {
  if (value === "worksheet" || (value === undefined && pageId)) return "worksheet";
  return "chat";
}

function normalizeContextKey(
  scope: ConversationScope,
  value: unknown,
  pageId?: unknown,
): string | undefined {
  if (scope === "chat") return undefined;
  const candidate = typeof value === "string" && value.trim().length > 0
    ? value
    : (pageId ? String(pageId) : "");
  return assertNonEmpty(candidate, "worksheet context key", 300);
}

function rowScopeMatches(row: any, scope: ConversationScope, contextKey?: string): boolean {
  const rowScope = row?.scope === "worksheet" ? "worksheet" : "chat";
  return scope === "chat"
    ? rowScope === "chat"
    : rowScope === "worksheet" && row?.contextKey === contextKey;
}

function sessionScopeMatches(session: any, scope: ConversationScope, contextKey?: string): boolean {
  const sessionScope = session?.scope === "worksheet" ? "worksheet" : "chat";
  return scope === "chat"
    ? sessionScope === "chat"
    : sessionScope === "worksheet" && session?.contextKey === contextKey;
}

async function safeGet(ctx: any, id: unknown): Promise<any | null> {
  if (typeof id !== "string" || id.length === 0) return null;
  try {
    return await ctx.db.get(id as any);
  } catch {
    return null;
  }
}

function asActiveSkill(row: any): Skill | null {
  if (!row || row.status !== "active") return null;
  const id = typeof row._id === "string" ? row._id : String(row._id ?? "");
  if (!id || typeof row.name !== "string" || typeof row.objective !== "string" || typeof row.subject !== "string") return null;
  return {
    id,
    namespace: typeof row.namespace === "string" ? row.namespace : "tuto",
    status: "active",
    name: row.name,
    objective: row.objective,
    subject: row.subject,
    ...(typeof row.level === "string" ? { level: row.level } : {}),
    aliases: Array.isArray(row.aliases) ? row.aliases.filter((alias: unknown): alias is string => typeof alias === "string") : [],
    version: typeof row.version === "number" ? row.version : 1,
    createdBy: row.createdBy === "ai" ? "ai" : "human",
    ...(typeof row.sourceReference === "string" ? { sourceReference: row.sourceReference } : {}),
  };
}

function unknownState(studentId: string, skillId: string): any {
  return {
    studentId,
    skillId,
    mastery: null,
    confidence: 0,
    evidenceCount: 0,
    misconceptionIds: [],
    supportingEvidenceIds: [],
    modelVersion: "weighted-evidence-v1",
  };
}

function asTeachingBriefSkill(skill: Skill, state: any): TeachingBriefSkill {
  return {
    skillId: skill.id,
    name: skill.name,
    objective: skill.objective,
    subject: skill.subject,
    ...(skill.level ? { level: skill.level } : {}),
    mastery: typeof state?.mastery === "number" ? state.mastery : null,
    confidence: typeof state?.confidence === "number" ? state.confidence : 0,
    evidenceCount: typeof state?.evidenceCount === "number" ? state.evidenceCount : 0,
    misconceptionIds: Array.isArray(state?.misconceptionIds)
      ? state.misconceptionIds.filter((value: unknown): value is string => typeof value === "string")
      : [],
  };
}

function asPageRegion(page: any, row: any): PageRegion {
  return {
    id: String(row._id),
    pageId: String(page._id),
    ...(row.parentRegionId ? { parentRegionId: String(row.parentRegionId) } : {}),
    revision: row.revision,
    kind: row.kind,
    polygon: row.polygon,
    bounds: row.bounds,
    ...(row.transcription !== undefined ? { transcription: row.transcription } : {}),
    ...(row.latex !== undefined ? { latex: row.latex } : {}),
    ...(row.confidence !== undefined ? { confidence: row.confidence } : {}),
    source: row.source,
  };
}

function publicTurn(turn: any): any {
  return {
    _id: turn._id,
    studentId: turn.studentId,
    threadId: turn.threadId,
    idempotencyKey: turn.idempotencyKey,
    ...(turn.scope ? { scope: turn.scope } : {}),
    ...(turn.contextKey ? { contextKey: turn.contextKey } : {}),
    ...(turn.systemInitiated ? { systemInitiated: true } : {}),
    status: turn.status,
    ...(turn.result !== undefined ? { result: turn.result } : {}),
    ...(turn.errorMessage ? { errorMessage: turn.errorMessage } : {}),
    createdAt: turn.createdAt,
    updatedAt: turn.updatedAt,
    ...(turn.completedAt ? { completedAt: turn.completedAt } : {}),
  };
}

/**
 * Internal read model for a production tutor turn. It is intentionally
 * internal: clients cannot inject a teaching brief or arbitrary chat history.
 */
export const prepare = internalQuery({
  args: {
    ownerUserId: v.string(),
    studentId: v.string(),
    threadId: v.string(),
    message: v.optional(v.string()),
    scope: v.optional(conversationScope),
    contextKey: v.optional(v.string()),
    currentSkillIds: v.optional(v.array(v.string())),
    currentProblem: v.optional(v.string()),
    pageId: v.optional(v.id("artifactPages")),
    pageRevision: v.optional(v.number()),
    activeRegionIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const learner = await (ctx.db as any)
      .query("learners")
      .withIndex("by_student", (q: any) => q.eq("studentId", args.studentId))
      .unique();
    if (!learner || learner.ownerUserId !== args.ownerUserId) throw new Error("Forbidden");
    if (learner.archivedAt) throw new Error("Learner is archived");
    const threadId = cleanThreadId(args.threadId);
    const requestedScope = normalizeScope(args.scope, args.pageId);
    const contextKey = normalizeContextKey(requestedScope, args.contextKey, args.pageId);
    const session = await (ctx.db as any)
      .query("learnerSessions")
      .withIndex("by_student_and_thread", (q: any) => q.eq("studentId", args.studentId).eq("threadId", threadId))
      .unique();
    if (session && session.ownerUserId !== args.ownerUserId) throw new Error("Forbidden");
    if (session?.status === "archived") throw new Error("Session is archived");
    if (session && !sessionScopeMatches(session, requestedScope, contextKey)) {
      throw new Error("Thread belongs to another conversation scope");
    }

    const requestedSkills = args.currentSkillIds && args.currentSkillIds.length > 0
      ? args.currentSkillIds
      : session?.currentSkillIds ?? [];
    const currentSkillIds: string[] = [];
    const currentStates: any[] = [];
    const prerequisiteIds = new Set<string>();
    const durableFacts = (await (ctx.db as any)
      .query("learnerFacts")
      .withIndex("by_owner_student_and_updated", (q: any) => q.eq("ownerUserId", args.ownerUserId).eq("studentId", args.studentId))
      .order("desc")
      .take(MAX_TUTOR_LEARNER_FACTS * 5))
      .map((row: any) => asTutorLearnerFact(row, args.ownerUserId))
      .filter((fact: TutorLearnerFact | null): fact is TutorLearnerFact => fact !== null)
      .slice(0, MAX_TUTOR_LEARNER_FACTS);
    const messages = await (ctx.db as any)
      .query("tutorMessages")
      .withIndex("by_owner_and_thread", (q: any) => q.eq("ownerUserId", args.ownerUserId).eq("threadId", threadId))
      .order("desc")
      .take(40);
    const recentMessages = messages
      .filter((row: any) => row.studentId === args.studentId
        && (row.role === "student" || row.role === "tutor")
        && row.isVisible !== false
        && row.isHidden !== true
        && rowScopeMatches(row, requestedScope, contextKey)
        && (!session || sessionScopeMatches(session, requestedScope, contextKey)))
      .slice(0, 12)
      .reverse()
      .map((row: any) => ({ role: row.role, text: String(row.text).slice(0, 2_000) }));

    let page: any = null;
    let pageRegions: PageRegion[] = [];
    if (args.pageId) {
      page = await (ctx.db as any).get(args.pageId);
      if (!page || page.ownerUserId !== args.ownerUserId || page.studentId !== args.studentId) throw new Error("Forbidden");
      const revision = args.pageRevision ?? page.revision;
      assertPageRevision(page.revision, revision);
      const rows = await (ctx.db as any)
        .query("pageRegions")
        .withIndex("by_page_and_revision", (q: any) => q.eq("pageId", page._id).eq("revision", revision))
        .collect();
      pageRegions = rows.map((row: any) => asPageRegion(page, row));
    }
    const active = new Set(args.activeRegionIds ?? []);
    const activeRegionIds = pageRegions
      .filter((region) => active.has(region.id))
      .map((region) => region.id);

    const currentProblem = typeof args.currentProblem === "string" && args.currentProblem.trim().length > 0
      ? args.currentProblem.trim().slice(0, 4_000)
      : typeof session?.currentProblem === "string" && session.currentProblem.trim().length > 0
        ? session.currentProblem.trim().slice(0, 4_000)
        : undefined;
    // Subject extraction remains scoped to the source for this turn. A page's
    // usable OCR/semantic text is authoritative; if it is absent, the
    // resolver can fall back to durable problem text and the current request.
    const subjectContext = extractSubjectContext({
      scope: requestedScope,
      ...(requestedScope === "chat" ? { message: args.message } : {
        pageRegions,
        activeRegionIds,
      }),
    });
    const activeSkillRows = await (ctx.db as any)
      .query("skills")
      .withIndex("by_status", (q: any) => q.eq("status", "active"))
      .collect();
    const activeSkills = activeSkillRows
      .map(asActiveSkill)
      .filter((skill: Skill | null): skill is Skill => skill !== null);
    const worksheetHasText = requestedScope === "worksheet" && subjectContext.text.length > 0;
    const resolvedFromContext = resolveSkillsFromContext({
      ...(requestedScope === "chat"
        ? { message: subjectContext.objective }
        : worksheetHasText
          ? { pageRegions, activeRegionIds }
          : { message: args.message, currentProblem }),
      skills: activeSkills,
      subject: subjectContext.subject,
    });
    // Worksheet text is authoritative for the current turn. A stale client or
    // session skill must not leak into a page-aware brief when the page has no
    // matching canonical skill. Chat turns retain the prior IDs as continuity
    // only when server-side text resolution found no stable match.
    const hasAuthoritativeSource = requestedScope === "worksheet"
      ? Boolean(args.pageId) || Boolean(subjectContext.text)
      : Boolean(subjectContext.text);
    const resolvedCurrentSkillIds = resolvedFromContext.currentSkillIds.length > 0
      ? resolvedFromContext.currentSkillIds
      : hasAuthoritativeSource
        ? []
        : Array.from(new Set(requestedSkills)).slice(0, 20);
    const currentSkills: TeachingBriefSkill[] = [];
    for (const candidate of resolvedCurrentSkillIds) {
      const skill = await safeGet(ctx, candidate);
      if (!skill || skill.status !== "active") continue;
      const skillId = String(skill._id);
      currentSkillIds.push(skillId);
      const state = await (ctx.db as any)
        .query("studentSkillStates")
        .withIndex("by_student_and_skill", (q: any) => q.eq("studentId", args.studentId).eq("skillId", skill._id))
        .unique();
      const normalizedState = state ?? unknownState(args.studentId, skillId);
      currentStates.push(normalizedState);
      const activeSkill = asActiveSkill(skill);
      if (activeSkill) currentSkills.push(asTeachingBriefSkill(activeSkill, normalizedState));
      const edges = await (ctx.db as any)
        .query("skillEdges")
        .withIndex("by_from_and_kind", (q: any) => q.eq("fromSkillId", skill._id).eq("kind", "requires"))
        .collect();
      for (const edge of edges) prerequisiteIds.add(String(edge.toSkillId));
    }
    const prerequisiteGaps: any[] = [];
    const prerequisiteSkills: TeachingBriefSkill[] = [];
    for (const skillId of prerequisiteIds) {
      const skill = await safeGet(ctx, skillId);
      if (!skill || skill.status !== "active") continue;
      const state = await (ctx.db as any)
        .query("studentSkillStates")
        .withIndex("by_student_and_skill", (q: any) => q.eq("studentId", args.studentId).eq("skillId", skill._id))
        .unique() ?? unknownState(args.studentId, skillId);
      if (state.mastery === null || state.mastery < 0.7 || state.confidence < 0.55) {
        prerequisiteGaps.push(state);
        const activeSkill = asActiveSkill(skill);
        if (activeSkill) prerequisiteSkills.push(asTeachingBriefSkill(activeSkill, state));
      }
    }
    const allStates = [...currentStates, ...prerequisiteGaps];
    const activeMisconceptions = Array.from(new Set(allStates.flatMap((state: any) => state.misconceptionIds ?? [])));
    const currentSkillIdSet = new Set(currentSkillIds);
    const episodes = currentSkillIdSet.size === 0
      ? []
      : (await (ctx.db as any)
        .query("episodicSummaries")
        .withIndex("by_student", (q: any) => q.eq("studentId", args.studentId))
        .order("desc")
        .take(30))
        .filter((episode: any) => Array.isArray(episode.skillIds)
          && episode.skillIds.some((skillId: unknown) => currentSkillIdSet.has(String(skillId))))
        .slice(0, 5);
    const teachingBrief: TeachingBrief = {
      ...(subjectContext.objective ? {
        focus: {
          source: subjectContext.source,
          ...(subjectContext.subject ? { subject: subjectContext.subject } : {}),
          objective: subjectContext.objective,
          evidence: subjectContext.evidence,
        },
      } : {}),
      currentSkills,
      prerequisiteSkills,
      currentSkillIds,
      skillStates: currentStates,
      prerequisiteGaps,
      activeMisconceptions,
      relevantEpisodes: episodes.map((episode: any) => episode.summary),
    };
    return {
      session,
      currentProblem,
      subjectContext,
      resolvedCurrentSkillIds: currentSkillIds,
      skillResolutions: resolvedFromContext.resolutions,
      recentMessages,
      teachingBrief,
      durableFacts,
      page: page
          ? {
            artifactId: page.artifactId,
            pageId: String(page._id),
            pageRevision: page.revision,
            storageId: page.storageId,
            mimeType: page.mimeType,
            naturalWidth: page.naturalWidth,
            naturalHeight: page.naturalHeight,
            activeRegionIds,
          }
        : undefined,
      pageRegions,
    };
  },
});

/** Atomically create the student message, session, and idempotent turn record. */
export const begin = internalMutation({
  args: {
    ownerUserId: v.string(),
    studentId: v.string(),
    threadId: v.string(),
    message: v.string(),
    idempotencyKey: v.string(),
    scope: v.optional(conversationScope),
    contextKey: v.optional(v.string()),
    systemInitiated: v.optional(v.boolean()),
    isSystemInitiated: v.optional(v.boolean()),
    activityId: v.optional(v.string()),
    currentProblem: v.optional(v.string()),
    currentSkillIds: v.optional(v.array(v.string())),
    pageId: v.optional(v.id("artifactPages")),
    pageRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const learner = await requireOwnedLearner(ctx, args.studentId, args.ownerUserId);
    if (learner.archivedAt) throw new Error("Learner is archived");
    const threadId = cleanThreadId(args.threadId);
    const message = cleanMessage(args.message);
    const requestedScope = normalizeScope(args.scope, args.pageId);
    const contextKey = normalizeContextKey(requestedScope, args.contextKey);
    const systemInitiated = args.systemInitiated === true || args.isSystemInitiated === true;
    const inferredChatTopic = requestedScope === "chat" && !systemInitiated
      ? message.slice(0, 4_000)
      : undefined;
    const idempotencyKey = assertNonEmpty(args.idempotencyKey, "idempotency key", 300);
    const existingTurn = await (ctx.db as any)
      .query("tutorTurns")
      .withIndex("by_owner_and_idempotency", (q: any) => q.eq("ownerUserId", args.ownerUserId).eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existingTurn) {
      if (existingTurn.studentId !== args.studentId || existingTurn.threadId !== threadId) throw new Error("Idempotency key belongs to another thread");
      if (!rowScopeMatches(existingTurn, requestedScope, contextKey)) throw new Error("Idempotency key belongs to another conversation scope");
      return { ...publicTurn(existingTurn), turnId: existingTurn._id, studentMessageId: existingTurn.studentMessageId };
    }
    if (args.pageId) {
      const page = await (ctx.db as any).get(args.pageId);
      if (!page || page.ownerUserId !== args.ownerUserId || page.studentId !== args.studentId) throw new Error("Forbidden");
      if (args.pageRevision === undefined) throw new Error("pageRevision is required for page turns");
      assertPageRevision(page.revision, args.pageRevision);
    } else if (args.pageRevision !== undefined) {
      throw new Error("pageId is required with pageRevision");
    }
    const session = await (ctx.db as any)
      .query("learnerSessions")
      .withIndex("by_student_and_thread", (q: any) => q.eq("studentId", args.studentId).eq("threadId", threadId))
      .unique();
    if (session && session.ownerUserId !== args.ownerUserId) throw new Error("Forbidden");
    if (session?.status === "archived") throw new Error("Session is archived");
    if (session && !sessionScopeMatches(session, requestedScope, contextKey)) {
      throw new Error("Thread belongs to another conversation scope");
    }
    const createdAt = timestamp();
    let sessionId = session?._id;
    if (!sessionId) {
      sessionId = await (ctx.db as any).insert("learnerSessions", {
        studentId: args.studentId,
        ownerUserId: args.ownerUserId,
        threadId,
        scope: requestedScope,
        ...(contextKey ? { contextKey } : {}),
        ...(args.activityId ? { activityId: assertNonEmpty(args.activityId, "activity ID", 300) } : {}),
        ...(args.currentProblem
          ? { currentProblem: assertNonEmpty(args.currentProblem, "current problem", 4_000) }
          : inferredChatTopic
            ? { currentProblem: inferredChatTopic }
            : {}),
        currentSkillIds: normalizeTextArray(args.currentSkillIds ?? [], "current skill IDs"),
        hintsShown: 0,
        hintSummaries: [],
        status: "active",
        createdAt,
        updatedAt: createdAt,
      });
    } else {
      const sessionPatch: any = { updatedAt: createdAt };
      if (args.activityId !== undefined) sessionPatch.activityId = assertNonEmpty(args.activityId, "activity ID", 300);
      if (args.currentProblem !== undefined) sessionPatch.currentProblem = assertNonEmpty(args.currentProblem, "current problem", 4_000);
      else if (inferredChatTopic) sessionPatch.currentProblem = inferredChatTopic;
      if (args.currentSkillIds !== undefined) sessionPatch.currentSkillIds = normalizeTextArray(args.currentSkillIds, "current skill IDs");
      await (ctx.db as any).patch(sessionId, sessionPatch);
    }
    const studentMessageId = await (ctx.db as any).insert("tutorMessages", {
      studentId: args.studentId,
      ownerUserId: args.ownerUserId,
      threadId,
      role: "student",
      text: message,
      annotationIds: [],
      isVisible: !systemInitiated,
      isHidden: systemInitiated,
      scope: requestedScope,
      ...(contextKey ? { contextKey } : {}),
      idempotencyKey,
      ...(args.pageId ? { pageId: args.pageId } : {}),
      ...(args.pageRevision !== undefined ? { pageRevision: args.pageRevision } : {}),
      createdAt,
    });
    const turnId = await (ctx.db as any).insert("tutorTurns", {
      studentId: args.studentId,
      ownerUserId: args.ownerUserId,
      threadId,
      idempotencyKey,
      scope: requestedScope,
      ...(contextKey ? { contextKey } : {}),
      ...(systemInitiated ? { systemInitiated: true } : {}),
      studentMessageId,
      status: "pending",
      createdAt,
      updatedAt: createdAt,
    });
    await consumeInferenceBudget(ctx, args.ownerUserId, "tutor");
    return { turnId, studentMessageId, status: "pending", sessionId };
  },
});

function proposalPayload(resolution: any, sourceMessageId: string, ownerUserId: string, now: string): any | null {
  if (!resolution || resolution.decision !== "proposed" || !resolution.proposal) return null;
  const proposal = resolution.proposal;
  if (typeof proposal !== "object") return null;
  try {
    const suggestedName = assertNonEmpty(String(proposal.suggestedName ?? ""), "suggested skill name", 200);
    const objective = assertNonEmpty(String(proposal.objective ?? ""), "proposal objective", 2_000);
    const why = assertNonEmpty(String(proposal.whyExistingSkillsDoNotFit ?? ""), "proposal rationale", 4_000);
    const aliases = normalizeTextArray(Array.isArray(proposal.aliases) ? proposal.aliases : [], "proposal aliases");
    const prerequisites = normalizeTextArray(Array.isArray(proposal.prerequisiteCandidateIds) ? proposal.prerequisiteCandidateIds : [], "prerequisite candidates");
    const positiveExamples = normalizeTextArray(Array.isArray(proposal.positiveExamples) ? proposal.positiveExamples : [], "positive examples");
    return {
      suggestedName,
      objective,
      whyExistingSkillsDoNotFit: why,
      prerequisiteCandidateIds: prerequisites,
      aliases,
      positiveExamples,
      sourceMessageIds: [sourceMessageId],
      namespace: "tuto",
      subject: "general",
      status: "pending",
      createdBy: "ai",
      createdByUserId: ownerUserId,
      version: 1,
      createdAt: now,
    };
  } catch {
    return null;
  }
}

/** Persist the normalized provider result and update durable learner memory. */
export const complete = internalMutation({
  args: {
    ownerUserId: v.string(),
    turnId: v.id("tutorTurns"),
    result: v.any(),
  },
  handler: async (ctx, args) => {
    const turn = await (ctx.db as any).get(args.turnId);
    if (!turn || turn.ownerUserId !== args.ownerUserId) throw new Error("Forbidden");
    if (turn.status === "completed") return turn.result;
    const studentMessage = await (ctx.db as any).get(turn.studentMessageId);
    if (!studentMessage || studentMessage.ownerUserId !== args.ownerUserId) throw new Error("Turn message is missing");
    const raw = args.result as any;
    const reply = assertNonEmpty(String(raw?.reply ?? ""), "tutor reply", 8_000);
    const skillResolutions = Array.isArray(raw?.skillResolutions) ? raw.skillResolutions.slice(0, 16) : [];
    const candidateEvidence = Array.isArray(raw?.candidateEvidence) ? raw.candidateEvidence.slice(0, 16) : [];
    const requestedAnnotations = Array.isArray(raw?.annotations) ? raw.annotations.slice(0, 16) : [];
    const completedAt = timestamp();
    const proposalIds: string[] = [];
    for (const resolution of skillResolutions) {
      const payload = proposalPayload(resolution, String(studentMessage._id), args.ownerUserId, completedAt);
      if (!payload) continue;
      const proposalId = await (ctx.db as any).insert("skillProposals", payload);
      const provisionalSkillId = await (ctx.db as any).insert("skills", {
        namespace: payload.namespace,
        status: "proposed",
        name: payload.suggestedName,
        objective: payload.objective,
        subject: payload.subject,
        aliases: payload.aliases,
        version: 1,
        createdBy: "ai",
        sourceReference: `proposal:${String(proposalId)}`,
        searchText: `${payload.suggestedName} ${payload.objective} ${payload.aliases.join(" ")}`.toLocaleLowerCase(),
        createdAt: completedAt,
        updatedAt: completedAt,
      });
      await (ctx.db as any).patch(proposalId, { provisionalSkillId });
      proposalIds.push(String(proposalId));
    }

    const tutorMessageId = await (ctx.db as any).insert("tutorMessages", {
      studentId: turn.studentId,
      ownerUserId: args.ownerUserId,
      threadId: turn.threadId,
      role: "tutor",
      text: reply,
      annotationIds: [],
      isVisible: true,
      ...(turn.scope ? { scope: turn.scope } : {}),
      ...(turn.contextKey ? { contextKey: turn.contextKey } : {}),
      idempotencyKey: `${turn.idempotencyKey}:tutor`,
      ...(studentMessage.pageId ? { pageId: studentMessage.pageId } : {}),
      ...(studentMessage.pageRevision !== undefined ? { pageRevision: studentMessage.pageRevision } : {}),
      createdAt: completedAt,
    });

    const persistedEvidence: any[] = [];
    for (let index = 0; index < candidateEvidence.length; index += 1) {
      const candidate = candidateEvidence[index];
      if (!candidate || typeof candidate !== "object") continue;
      const skill = await safeGet(ctx, candidate.skillId);
      if (!skill || skill.status !== "active") continue;
      const confidence = Number(candidate.confidence);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) continue;
      const key = `${String(turn._id)}:evidence:${index}`;
      const existing = await (ctx.db as any)
        .query("learningEvidence")
        .withIndex("by_owner_and_idempotency", (q: any) => q.eq("ownerUserId", args.ownerUserId).eq("idempotencyKey", key))
        .unique();
      if (existing) {
        persistedEvidence.push(existing);
        continue;
      }
      const evidenceId = await (ctx.db as any).insert("learningEvidence", {
        studentId: turn.studentId,
        ownerUserId: args.ownerUserId,
        skillId: skill._id,
        outcome: candidate.outcome,
        independence: candidate.independence,
        confidence,
        rationale: assertNonEmpty(String(candidate.rationale ?? ""), "evidence rationale", 2_000),
        source: "tutor",
        observedAt: completedAt,
        threadId: turn.threadId,
        messageId: String(tutorMessageId),
        misconceptionIds: [],
        idempotencyKey: key,
      });
      persistedEvidence.push({ _id: evidenceId, skillId: skill._id });
      await projectAndPersist(ctx, turn.studentId, skill._id, completedAt);
    }

    const persistedAnnotations: any[] = [];
    if (studentMessage.pageId && studentMessage.pageRevision !== undefined) {
      const page = await (ctx.db as any).get(studentMessage.pageId);
      if (page && page.ownerUserId === args.ownerUserId && page.studentId === turn.studentId) {
        assertPageRevision(page.revision, studentMessage.pageRevision);
        const regions = await (ctx.db as any)
          .query("pageRegions")
          .withIndex("by_page_and_revision", (q: any) => q.eq("pageId", page._id).eq("revision", studentMessage.pageRevision))
          .collect();
        for (const annotation of requestedAnnotations) {
          if (!annotation || typeof annotation !== "object") continue;
          if (annotation.pageId && String(annotation.pageId) !== String(page._id)) continue;
          const target = regions.find((region: any) => String(region._id) === String(annotation.targetRegionId));
          if (!target) continue;
          const kind = asAnnotationKind(annotation.kind);
          if (!kind) continue;
          const id = await (ctx.db as any).insert("tutorAnnotations", {
            pageId: page._id,
            pageRevision: studentMessage.pageRevision,
            targetRegionId: target._id,
            messageId: tutorMessageId,
            kind,
            ...(annotation.label ? { label: assertNonEmpty(String(annotation.label), "annotation label", 500) } : {}),
            createdAt: completedAt,
          });
          persistedAnnotations.push({
            id: String(id),
            pageId: String(page._id),
            targetRegionId: String(target._id),
            messageId: String(tutorMessageId),
            kind,
            ...(annotation.label ? { label: String(annotation.label).slice(0, 500) } : {}),
          });
        }
      }
    }
    if (persistedAnnotations.length > 0) {
      await (ctx.db as any).patch(tutorMessageId, {
        annotationIds: persistedAnnotations.map((annotation) => annotation.id),
      });
    }
    const result = {
      reply,
      skillResolutions,
      candidateEvidence,
      annotations: persistedAnnotations,
      ...(proposalIds.length > 0 ? { proposalIds } : {}),
      ...(normalizeTutorMetadata(raw?.metadata) ? { metadata: normalizeTutorMetadata(raw.metadata) } : {}),
    };
    await (ctx.db as any).patch(turn._id, {
      status: "completed",
      tutorMessageId,
      result,
      completedAt,
      updatedAt: completedAt,
      errorMessage: undefined,
    });
    return result;
  },
});

export const fail = internalMutation({
  args: { ownerUserId: v.string(), turnId: v.id("tutorTurns"), errorMessage: v.string() },
  handler: async (ctx, args) => {
    const turn = await (ctx.db as any).get(args.turnId);
    if (!turn || turn.ownerUserId !== args.ownerUserId) throw new Error("Forbidden");
    if (turn.status === "completed") return publicTurn(turn);
    const updatedAt = timestamp();
    await (ctx.db as any).patch(turn._id, {
      status: "failed",
      errorMessage: args.errorMessage.slice(0, 2_000),
      updatedAt,
    });
    return publicTurn({ ...turn, status: "failed", errorMessage: args.errorMessage.slice(0, 2_000), updatedAt });
  },
});

/** Authenticated production tutor orchestration; no fixture student IDs or client-supplied memory. */
export const turn = action({
  args: {
    studentId: v.string(),
    threadId: v.string(),
    message: v.string(),
    idempotencyKey: v.optional(v.string()),
    scope: v.optional(conversationScope),
    contextKey: v.optional(v.string()),
    systemInitiated: v.optional(v.boolean()),
    isSystemInitiated: v.optional(v.boolean()),
    activityId: v.optional(v.string()),
    currentProblem: v.optional(v.string()),
    currentSkillIds: v.optional(v.array(v.string())),
    pageId: v.optional(v.id("artifactPages")),
    pageRevision: v.optional(v.number()),
    activeRegionIds: v.optional(v.array(v.string())),
    /** Accepted for backward-compatible clients but never trusted for context. */
    recentMessages: v.optional(v.array(v.object({ role: tutorRole, text: v.string() }))),
    activeRegionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUserId(ctx);
    const threadId = cleanThreadId(args.threadId);
    const message = cleanMessage(args.message);
    const requestedScope = normalizeScope(args.scope, args.pageId);
    const contextKey = normalizeContextKey(requestedScope, args.contextKey, args.pageId);
    const systemInitiated = args.systemInitiated === true || args.isSystemInitiated === true;
    const idempotencyKey = assertNonEmpty(
      args.idempotencyKey ?? `turn-${Date.now().toString(36)}-${message.length.toString(36)}`,
      "idempotency key",
      300,
    );
    const activeRegionIds = [
      ...(args.activeRegionIds ?? []),
      ...(args.activeRegionId ? [args.activeRegionId] : []),
    ].slice(0, 20);
    const prepared = await (ctx as any).runQuery(prepareRef, {
      ownerUserId,
      studentId: args.studentId,
      threadId,
      message,
      scope: requestedScope,
      ...(contextKey ? { contextKey } : {}),
      currentSkillIds: args.currentSkillIds,
      currentProblem: args.currentProblem,
      pageId: args.pageId,
      pageRevision: args.pageRevision,
      activeRegionIds,
    });
    const begun = await (ctx as any).runMutation(beginRef, {
      ownerUserId,
      studentId: args.studentId,
      threadId,
      message,
      idempotencyKey,
      scope: requestedScope,
      ...(contextKey ? { contextKey } : {}),
      ...(systemInitiated ? { systemInitiated: true } : {}),
      activityId: args.activityId,
      currentProblem: args.currentProblem,
      // Persist the server-resolved IDs so the next turn has continuity even
      // when the client supplied no skill context (the normal worksheet path).
      currentSkillIds: prepared.resolvedCurrentSkillIds ?? prepared.teachingBrief.currentSkillIds,
      pageId: args.pageId,
      pageRevision: args.pageRevision,
    });
    if (begun.status === "completed" && begun.result) return begun.result;
    try {
      const input: any = {
        studentId: args.studentId,
        threadId,
        message,
        activityId: args.activityId,
        // Keep the provider's compact problem field aligned with the same
        // source that produced the brief. This prevents a prior chat topic or
        // stale client worksheet label from competing with the current turn.
        currentProblem: requestedScope === "chat"
          ? message
          : prepared.subjectContext?.objective
            || args.currentProblem
            || prepared.currentProblem,
        subjectContext: prepared.subjectContext,
        teachingBrief: prepared.teachingBrief,
        durableFacts: prepared.durableFacts,
        recentMessages: prepared.recentMessages,
        ...(prepared.page ? {
            artifactContext: {
              artifactId: prepared.page.artifactId,
              pageId: prepared.page.pageId,
              pageRevision: prepared.page.pageRevision,
              activeRegionIds: prepared.page.activeRegionIds,
          },
          pageRegions: prepared.pageRegions,
        } : {}),
      };
      return await (ctx as any).runAction(providerRef, {
        ownerUserId,
        turnId: begun.turnId,
        input,
        ...(prepared.page?.storageId ? {
          pageStorageId: prepared.page.storageId,
          pageMimeType: prepared.page.mimeType,
          pageNaturalWidth: prepared.page.naturalWidth,
          pageNaturalHeight: prepared.page.naturalHeight,
        } : {}),
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Tutor turn failed";
      await (ctx as any).runMutation(failRef, {
        ownerUserId,
        turnId: begun.turnId,
        errorMessage: messageText,
      });
      throw error;
    }
  },
});

export const getTurn = publicQuery({
  args: { turnId: v.id("tutorTurns") },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUserId(ctx);
    const turn = await (ctx.db as any).get(args.turnId);
    if (!turn || turn.ownerUserId !== ownerUserId) throw new Error("Forbidden");
    return publicTurn(turn);
  },
});

export const listTurns = publicQuery({
  args: {
    studentId: v.string(),
    threadId: v.optional(v.string()),
    limit: v.optional(v.number()),
    scope: v.optional(conversationScope),
    contextKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, ownerUserId);
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 50)));
    const requestedScope = normalizeScope(args.scope);
    const contextKey = normalizeContextKey(requestedScope, args.contextKey);
    // The owner/thread index is efficient when a thread is supplied. For an
    // owner-wide history, use the student index and filter by owner.
    if (args.threadId) {
      const rows = await (ctx.db as any)
        .query("tutorTurns")
        .withIndex("by_owner_and_thread", (q: any) => q.eq("ownerUserId", ownerUserId).eq("threadId", cleanThreadId(args.threadId!)))
        .order("desc")
        .take(limit);
      return rows
        .filter((row: any) => row.studentId === args.studentId && rowScopeMatches(row, requestedScope, contextKey))
        .map(publicTurn);
    }
    const all = await (ctx.db as any)
      .query("tutorTurns")
      .withIndex("by_student_and_thread", (q: any) => q.eq("studentId", args.studentId))
      .order("desc")
      .take(limit * 2);
    return all
      .filter((row: any) => row.ownerUserId === ownerUserId && rowScopeMatches(row, requestedScope, contextKey))
      .slice(0, limit)
      .map(publicTurn);
  },
});

export const tutorTurn = turn;
export const sendTurn = turn;
