import { mutationGeneric, queryGeneric, internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import { projectStudentSkillState, type LearningEvidence } from "../src/domain";
import { requireUserId } from "./lib/auth";
import { consumeInferenceBudget, requireOwnedLearner } from "./lib/db";
import { assertFiniteRange, assertNonEmpty, validateEvidenceCandidate } from "./lib/validation";

const query = queryGeneric;
const mutation = mutationGeneric;
const internalMutation = internalMutationGeneric;

const evidenceArgs = {
  studentId: v.string(),
  skillId: v.id("skills"),
  outcome: v.union(v.literal("correct"), v.literal("partial"), v.literal("incorrect"), v.literal("unclear")),
  independence: v.union(v.literal("independent"), v.literal("hinted"), v.literal("demonstrated")),
  confidence: v.number(),
  rationale: v.string(),
  source: v.union(v.literal("tutor"), v.literal("student_self_report"), v.literal("document_analysis"), v.literal("manual_review"), v.literal("import")),
  observedAt: v.optional(v.string()),
  threadId: v.optional(v.string()),
  messageId: v.optional(v.string()),
  activityId: v.optional(v.string()),
  misconceptionIds: v.optional(v.array(v.string())),
  provisionalSkillId: v.optional(v.id("skills")),
  idempotencyKey: v.optional(v.string()),
};

function asDomainEvidence(row: any, targetSkillId?: string): LearningEvidence {
  return {
    id: String(row._id),
    studentId: row.studentId,
    skillId: targetSkillId ?? String(row.resolvedSkillId ?? row.skillId),
    outcome: row.outcome,
    independence: row.independence,
    confidence: row.confidence,
    rationale: row.rationale,
    source: row.source,
    observedAt: row.observedAt,
    createdAt: row._creationTime ? new Date(row._creationTime).toISOString() : row.observedAt,
    threadId: row.threadId,
    messageId: row.messageId,
    activityId: row.activityId,
    misconceptionIds: row.misconceptionIds ?? [],
    provisionalSkillId: row.provisionalSkillId ? String(row.provisionalSkillId) : undefined,
    resolvedSkillId: row.resolvedSkillId ? String(row.resolvedSkillId) : undefined,
    idempotencyKey: row.idempotencyKey,
  };
}

export async function projectAndPersist(ctx: any, studentId: string, skillId: any, now: string): Promise<any> {
  const rows = await ctx.db.query("learningEvidence").withIndex("by_student", (q: any) => q.eq("studentId", studentId)).collect();
  const target = String(skillId);
  const evidence = rows
    .map((row: any) => asDomainEvidence(row))
    .filter((item: LearningEvidence) => item.skillId === target);
  const projection = projectStudentSkillState(studentId, target, evidence, { now, maxSupportingEvidence: 50 });
  const current = await ctx.db.query("studentSkillStates").withIndex("by_student_and_skill", (q: any) => q.eq("studentId", studentId).eq("skillId", skillId)).unique();
  const value = {
    studentId,
    skillId,
    mastery: projection.mastery,
    confidence: projection.confidence,
    evidenceCount: projection.evidenceCount,
    ...(projection.lastPracticedAt ? { lastPracticedAt: projection.lastPracticedAt } : {}),
    misconceptionIds: projection.misconceptionIds,
    supportingEvidenceIds: projection.supportingEvidenceIds,
    modelVersion: projection.modelVersion,
    explanation: projection.explanation,
    updatedAt: now,
  };
  if (current) await ctx.db.patch(current._id, value);
  else await ctx.db.insert("studentSkillStates", value);
  return value;
}

export const list = query({
  args: {
    studentId: v.string(),
    skillId: v.optional(v.id("skills")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, userId);
    const limit = Math.min(200, Math.max(1, Math.floor(args.limit ?? 50)));
    const allRows = await (ctx.db as any).query("learningEvidence").withIndex("by_student_and_observed_at", (q: any) => q.eq("studentId", args.studentId)).order("desc").take(500);
    return args.skillId
      ? allRows.filter((row: any) => String(row.resolvedSkillId ?? row.skillId) === String(args.skillId)).slice(0, limit)
      : allRows.slice(0, limit);
  },
});

export const record = mutation({
  args: evidenceArgs,
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, userId);
    assertFiniteRange(args.confidence, "evidence confidence");
    const rationale = assertNonEmpty(args.rationale, "evidence rationale", 4_000);
    const skill = await (ctx.db as any).get(args.skillId);
    if (!skill || (skill.status !== "active" && skill.status !== "proposed")) throw new Error("Skill not found or inactive");
    if (args.provisionalSkillId !== undefined) {
      const provisional = await (ctx.db as any).get(args.provisionalSkillId);
      if (!provisional || provisional.status !== "proposed") throw new Error("Provisional skill is invalid");
    }
    if (args.idempotencyKey) {
      const existing = await (ctx.db as any).query("learningEvidence").withIndex("by_owner_and_idempotency", (q: any) => q.eq("ownerUserId", userId).eq("idempotencyKey", args.idempotencyKey)).unique();
      if (existing) return existing._id;
    }
    const now = new Date().toISOString();
    const id = await (ctx.db as any).insert("learningEvidence", {
      studentId: args.studentId,
      ownerUserId: userId,
      skillId: args.skillId,
      outcome: args.outcome,
      independence: args.independence,
      confidence: args.confidence,
      rationale,
      source: args.source,
      observedAt: args.observedAt ?? now,
      ...(args.threadId ? { threadId: args.threadId } : {}),
      ...(args.messageId ? { messageId: args.messageId } : {}),
      ...(args.activityId ? { activityId: args.activityId } : {}),
      misconceptionIds: args.misconceptionIds ?? [],
      ...(args.provisionalSkillId ? { provisionalSkillId: args.provisionalSkillId } : {}),
      ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
    });
    if (skill.status === "active") await projectAndPersist(ctx, args.studentId, args.skillId, now);
    return id;
  },
});

/** Persist provider output only after validating each candidate and skill. */
export const recordCandidates = internalMutation({
  args: {
    studentId: v.string(),
    ownerUserId: v.string(),
    source: v.union(v.literal("tutor"), v.literal("student_self_report"), v.literal("document_analysis"), v.literal("manual_review"), v.literal("import")),
    candidates: v.array(v.any()),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    activityId: v.optional(v.string()),
    idempotencyPrefix: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const learner = await (ctx.db as any).query("learners").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).unique();
    if (!learner || learner.ownerUserId !== args.ownerUserId) throw new Error("Learner ownership check failed");
    const now = new Date().toISOString();
    const ids: any[] = [];
    for (let index = 0; index < args.candidates.length; index += 1) {
      const candidate = validateEvidenceCandidate(args.candidates[index]);
      const skillId = candidate.skillId as any;
      const skill = await (ctx.db as any).get(skillId);
      if (!skill || skill.status !== "active") continue;
      const idempotencyKey = args.idempotencyPrefix ? `${args.idempotencyPrefix}:${index}` : undefined;
      if (idempotencyKey) {
        const existing = await (ctx.db as any).query("learningEvidence").withIndex("by_owner_and_idempotency", (q: any) => q.eq("ownerUserId", args.ownerUserId).eq("idempotencyKey", idempotencyKey)).unique();
        if (existing) {
          ids.push(existing._id);
          continue;
        }
      }
      const id = await (ctx.db as any).insert("learningEvidence", {
        studentId: args.studentId,
        ownerUserId: args.ownerUserId,
        skillId,
        outcome: candidate.outcome,
        independence: candidate.independence,
        confidence: candidate.confidence,
        rationale: candidate.rationale,
        source: args.source,
        observedAt: now,
        ...(args.threadId ? { threadId: args.threadId } : {}),
        ...(args.messageId ? { messageId: args.messageId } : {}),
        ...(args.activityId ? { activityId: args.activityId } : {}),
        misconceptionIds: [],
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      ids.push(id);
      await projectAndPersist(ctx, args.studentId, skillId, now);
    }
    return ids;
  },
});

export const getState = query({
  args: { studentId: v.string(), skillId: v.id("skills") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, userId);
    return await (ctx.db as any).query("studentSkillStates").withIndex("by_student_and_skill", (q: any) => q.eq("studentId", args.studentId).eq("skillId", args.skillId)).unique();
  },
});

export const reproject = internalMutation({
  args: { studentId: v.string(), skillId: v.id("skills") },
  handler: async (ctx, args) => await projectAndPersist(ctx, args.studentId, args.skillId, new Date().toISOString()),
});

/** Called by a future tutor-turn mutation before an external model action. */
export const reserveTutorInference = mutation({
  args: { studentId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, userId);
    await consumeInferenceBudget(ctx, userId, "tutor");
    return { ok: true };
  },
});

export const recordEvidence = record;
export const listEvidence = list;
export const projectState = reproject;
