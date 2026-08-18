import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireUserId } from "./lib/auth";
import { requireOwnedLearner, requireOwnedLearnerIncludingArchived } from "./lib/db";
import { assertFiniteRange, assertNonEmpty, normalizeTextArray } from "./lib/validation";

const query = queryGeneric;
const mutation = mutationGeneric;

type SessionScope = "chat" | "worksheet";

function normalizeScope(value: unknown): SessionScope {
  return value === "worksheet" ? "worksheet" : "chat";
}

function normalizeContextKey(scope: SessionScope, value: unknown): string | undefined {
  if (scope === "chat") return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("A worksheet context key is required");
  }
  return assertNonEmpty(value, "worksheet context key", 300);
}

function sessionMatchesScope(
  session: any,
  scope: SessionScope,
  contextKey: string | undefined,
): boolean {
  const sessionScope = normalizeScope(session?.scope);
  if (scope === "chat") return sessionScope === "chat";
  return sessionScope === "worksheet" && session?.contextKey === contextKey;
}

async function stateFor(ctx: any, studentId: string, skillId: any): Promise<any> {
  return await ctx.db.query("studentSkillStates").withIndex("by_student_and_skill", (q: any) => q.eq("studentId", studentId).eq("skillId", skillId)).unique();
}

async function stateOrUnknown(ctx: any, studentId: string, skillId: any): Promise<any> {
  const state = await stateFor(ctx, studentId, skillId);
  return state ?? {
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

export const teachingBrief = query({
  args: {
    studentId: v.string(),
    currentSkillIds: v.array(v.string()),
    maxEpisodes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, userId);
    const currentSkillIds = Array.from(new Set(args.currentSkillIds)).slice(0, 20);
    const currentStates: any[] = [];
    const prerequisiteIds = new Set<string>();
    for (const skillId of currentSkillIds) {
      currentStates.push(await stateOrUnknown(ctx, args.studentId, skillId));
      const edges = await (ctx.db as any).query("skillEdges").withIndex("by_from_and_kind", (q: any) => q.eq("fromSkillId", skillId).eq("kind", "requires")).collect();
      for (const edge of edges) prerequisiteIds.add(String(edge.toSkillId));
    }
    const prerequisiteGaps: any[] = [];
    for (const skillId of prerequisiteIds) {
      const state = await stateOrUnknown(ctx, args.studentId, skillId);
      if (state.mastery === null || state.mastery < 0.7 || state.confidence < 0.55) prerequisiteGaps.push(state);
    }
    const allStates = [...currentStates, ...prerequisiteGaps];
    const activeMisconceptions = Array.from(new Set(allStates.flatMap((state: any) => state.misconceptionIds ?? [])));
    const episodes = await (ctx.db as any).query("episodicSummaries").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).order("desc").take(Math.min(10, Math.max(0, Math.floor(args.maxEpisodes ?? 3))));
    return {
      currentSkillIds,
      skillStates: currentStates,
      prerequisiteGaps,
      activeMisconceptions,
      relevantEpisodes: episodes.map((episode: any) => episode.summary),
      relevantEpisodeIds: episodes.map((episode: any) => episode._id),
      durableFacts: await (ctx.db as any).query("learnerFacts").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).order("desc").take(20),
    };
  },
});

export const listStates = query({
  args: { studentId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, userId);
    return await (ctx.db as any).query("studentSkillStates").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).collect();
  },
});

export const upsertSession = mutation({
  args: {
    studentId: v.string(),
    threadId: v.string(),
    scope: v.optional(v.union(v.literal("chat"), v.literal("worksheet"))),
    contextKey: v.optional(v.string()),
    activityId: v.optional(v.string()),
    currentProblem: v.optional(v.string()),
    currentSkillIds: v.array(v.string()),
    hintsShown: v.optional(v.number()),
    hintSummaries: v.optional(v.array(v.string())),
    status: v.optional(v.union(v.literal("active"), v.literal("completed"), v.literal("archived"))),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, userId);
    const now = new Date().toISOString();
    const existing = await (ctx.db as any).query("learnerSessions").withIndex("by_student_and_thread", (q: any) => q.eq("studentId", args.studentId).eq("threadId", args.threadId)).unique();
    const scope = normalizeScope(args.scope ?? existing?.scope);
    const contextKey = normalizeContextKey(scope, args.contextKey ?? existing?.contextKey);
    if (existing && !sessionMatchesScope(existing, scope, contextKey)) {
      throw new Error("Thread belongs to another conversation scope");
    }
    const value = {
      studentId: args.studentId,
      ownerUserId: userId,
      threadId: assertNonEmpty(args.threadId, "thread ID", 300),
      scope,
      ...(contextKey ? { contextKey } : {}),
      ...(args.activityId ? { activityId: args.activityId } : {}),
      ...(args.currentProblem ? { currentProblem: assertNonEmpty(args.currentProblem, "current problem", 4_000) } : {}),
      currentSkillIds: normalizeTextArray(args.currentSkillIds, "current skill IDs"),
      hintsShown: Math.max(0, Math.floor(args.hintsShown ?? existing?.hintsShown ?? 0)),
      hintSummaries: args.hintSummaries ? normalizeTextArray(args.hintSummaries, "hint summaries") : (existing?.hintSummaries ?? []),
      status: args.status ?? existing?.status ?? "active",
      ...(existing?.createdAt ? { createdAt: existing.createdAt } : { createdAt: now }),
      updatedAt: now,
    };
    if (existing) {
      await (ctx.db as any).patch(existing._id, value);
      return existing._id;
    }
    return await (ctx.db as any).insert("learnerSessions", value);
  },
});

export const listSessions = query({
  args: {
    studentId: v.string(),
    scope: v.optional(v.union(v.literal("chat"), v.literal("worksheet"))),
    contextKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, userId);
    const scope = normalizeScope(args.scope);
    const contextKey = normalizeContextKey(scope, args.contextKey);
    const rows = await (ctx.db as any)
      .query("learnerSessions")
      .withIndex("by_student", (q: any) => q.eq("studentId", args.studentId))
      .order("desc")
      .take(500);
    return rows.filter((session: any) => sessionMatchesScope(session, scope, contextKey)).slice(0, 100);
  },
});

export const setFact = mutation({
  args: {
    studentId: v.string(),
    key: v.string(),
    value: v.string(),
    source: v.union(v.literal("student"), v.literal("tutor"), v.literal("human_review"), v.literal("import")),
    confidence: v.number(),
    editable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, userId);
    assertFiniteRange(args.confidence, "fact confidence");
    const now = new Date().toISOString();
    const existing = await (ctx.db as any).query("learnerFacts").withIndex("by_student_and_key", (q: any) => q.eq("studentId", args.studentId).eq("key", args.key)).unique();
    const value = { key: assertNonEmpty(args.key, "fact key", 200), value: assertNonEmpty(args.value, "fact value", 4_000), source: args.source, confidence: args.confidence, editable: args.editable ?? true, updatedAt: now };
    if (existing) {
      if (!existing.editable) throw new Error("Fact is not editable");
      await (ctx.db as any).patch(existing._id, value);
      return existing._id;
    }
    return await (ctx.db as any).insert("learnerFacts", { studentId: args.studentId, ownerUserId: userId, ...value, createdAt: now });
  },
});

export const listFacts = query({
  args: { studentId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, userId);
    return await (ctx.db as any).query("learnerFacts").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).order("desc").collect();
  },
});

export const addEpisode = mutation({
  args: {
    studentId: v.string(),
    summary: v.string(),
    skillIds: v.array(v.string()),
    evidenceIds: v.array(v.string()),
    importance: v.number(),
    sourceThreadId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, userId);
    assertFiniteRange(args.importance, "episode importance");
    return await (ctx.db as any).insert("episodicSummaries", {
      studentId: args.studentId,
      ownerUserId: userId,
      summary: assertNonEmpty(args.summary, "episode summary", 4_000),
      skillIds: normalizeTextArray(args.skillIds, "episode skills"),
      evidenceIds: normalizeTextArray(args.evidenceIds, "episode evidence"),
      importance: args.importance,
      ...(args.sourceThreadId ? { sourceThreadId: args.sourceThreadId } : {}),
      createdAt: new Date().toISOString(),
    });
  },
});

export const listEpisodes = query({
  args: { studentId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, userId);
    return await (ctx.db as any).query("episodicSummaries").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).order("desc").take(100);
  },
});

/** Export is intentionally explicit and bounded; raw provider payloads are not included. */
export const exportLearnerMemory = query({
  args: { studentId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearnerIncludingArchived(ctx, args.studentId, userId);
    const [learner, sessions, facts, episodes, evidence, states] = await Promise.all([
      (ctx.db as any).query("learners").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).unique(),
      (ctx.db as any).query("learnerSessions").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).collect(),
      (ctx.db as any).query("learnerFacts").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).collect(),
      (ctx.db as any).query("episodicSummaries").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).collect(),
      (ctx.db as any).query("learningEvidence").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).collect(),
      (ctx.db as any).query("studentSkillStates").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).collect(),
    ]);
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), learner, sessions, facts, episodes, evidence, states };
  },
});

export const getTeachingBrief = teachingBrief;
