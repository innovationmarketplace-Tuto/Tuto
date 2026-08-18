import { internalMutationGeneric, mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { projectStudentSkillState, type LearningEvidence } from "../src/domain";
import { requireUserId } from "./lib/auth";

const mutation = mutationGeneric;
const query = queryGeneric;
const internalMutation = internalMutationGeneric;

const DEMO_KEY = "fractions-demo-v1";

const SEED_SKILLS = [
  {
    key: "fraction-equivalence",
    name: "Recognize equivalent fractions",
    objective: "Represent the same fraction with an equivalent numerator and denominator.",
    aliases: ["equivalent fractions", "same value fractions", "common denominator preparation"],
  },
  {
    key: "fraction-common-denominator",
    name: "Find a common denominator",
    objective: "Choose a common denominator before adding fractions with unlike denominators.",
    aliases: ["common denominator", "least common denominator", "LCD"],
  },
  {
    key: "fraction-add-numerators",
    name: "Add numerators after rewriting fractions",
    objective: "Add the numerators while keeping the shared denominator unchanged.",
    aliases: ["fraction addition numerator", "add fractions"],
  },
  {
    key: "fraction-simplify",
    name: "Simplify a fraction",
    objective: "Reduce a fraction to an equivalent form in lowest terms.",
    aliases: ["reduce fractions", "lowest terms"],
  },
] as const;

function now(): string {
  return new Date().toISOString();
}

async function deleteWhere(ctx: any, table: string, predicate: (row: any) => boolean): Promise<void> {
  const rows = await ctx.db.query(table).collect();
  for (const row of rows) if (predicate(row)) await ctx.db.delete(row._id);
}

async function resetOwnedDemo(ctx: any, ownerUserId: string, run: any): Promise<void> {
  const studentIds = new Set<string>(run?.studentIds ?? ["demo-student-a", "demo-student-b"]);
  const skillIds = new Set<string>((run?.skillIds ?? []).map((id: any) => String(id)));
  const syntheticPages = await ctx.db.query("artifactPages").collect();
  const syntheticPageIds = new Set<string>(syntheticPages.filter((row: any) => studentIds.has(row.studentId) && row.ownerUserId === ownerUserId).map((row: any) => String(row._id)));
  await deleteWhere(ctx, "learningEvidence", (row) => studentIds.has(row.studentId) && row.ownerUserId === ownerUserId);
  await deleteWhere(ctx, "studentSkillStates", (row) => studentIds.has(row.studentId));
  await deleteWhere(ctx, "learnerSessions", (row) => studentIds.has(row.studentId) && row.ownerUserId === ownerUserId);
  await deleteWhere(ctx, "learnerFacts", (row) => studentIds.has(row.studentId) && row.ownerUserId === ownerUserId);
  await deleteWhere(ctx, "episodicSummaries", (row) => studentIds.has(row.studentId) && row.ownerUserId === ownerUserId);
  await deleteWhere(ctx, "analysisJobs", (row) => studentIds.has(row.studentId) && row.ownerUserId === ownerUserId);
  await deleteWhere(ctx, "tutorMessages", (row) => studentIds.has(row.studentId) && row.ownerUserId === ownerUserId);
  await deleteWhere(ctx, "tutorAnnotations", (row) => syntheticPageIds.has(String(row.pageId)));
  await deleteWhere(ctx, "pageRegions", (row) => syntheticPageIds.has(String(row.pageId)));
  await deleteWhere(ctx, "artifacts", (row) => studentIds.has(row.studentId) && row.ownerUserId === ownerUserId);
  await deleteWhere(ctx, "artifactPages", (row) => studentIds.has(row.studentId) && row.ownerUserId === ownerUserId);
  await deleteWhere(ctx, "artifactPageRevisions", (row) => studentIds.has(row.studentId) && row.ownerUserId === ownerUserId);
  await deleteWhere(ctx, "skillRedirects", (row) => skillIds.has(String(row.fromSkillId)) || skillIds.has(String(row.toSkillId)));
  await deleteWhere(ctx, "skillEdges", (row) => skillIds.has(String(row.fromSkillId)) || skillIds.has(String(row.toSkillId)));
  await deleteWhere(ctx, "skills", (row) => skillIds.has(String(row._id)));
  await deleteWhere(ctx, "learners", (row) => studentIds.has(row.studentId) && row.ownerUserId === ownerUserId && row.isSynthetic === true);
  if (run) await ctx.db.delete(run._id);
}

async function createDemo(ctx: any, ownerUserId: string, reset: boolean): Promise<any> {
  const existingRun = await ctx.db.query("seedRuns").withIndex("by_key_and_owner", (q: any) => q.eq("key", DEMO_KEY).eq("ownerUserId", ownerUserId)).unique();
  if (existingRun && !reset) return { seeded: false, reset: false, studentIds: existingRun.studentIds, skillIds: existingRun.skillIds, runId: existingRun._id };
  if (reset) await resetOwnedDemo(ctx, ownerUserId, existingRun);
  const createdAt = now();
  const skillIds: any[] = [];
  for (const skill of SEED_SKILLS) {
    const id = await ctx.db.insert("skills", {
      namespace: "tuto.demo.fractions",
      status: "active",
      name: skill.name,
      objective: skill.objective,
      subject: "fractions",
      aliases: [...skill.aliases],
      version: 1,
      createdBy: "human",
      sourceReference: `seed:${DEMO_KEY}:${skill.key}`,
      searchText: `${skill.name} ${skill.objective} ${skill.aliases.join(" ")}`.toLocaleLowerCase(),
      createdAt,
      updatedAt: createdAt,
    });
    skillIds.push(id);
  }
  const [equivalence, denominator, addNumerators, simplify] = skillIds;
  await ctx.db.insert("skillEdges", { fromSkillId: denominator, toSkillId: equivalence, kind: "requires", confidence: 0.99, rationale: "Rewriting equivalent fractions enables a common denominator.", createdAt, createdBy: "human" });
  await ctx.db.insert("skillEdges", { fromSkillId: addNumerators, toSkillId: denominator, kind: "requires", confidence: 0.99, rationale: "Numerators can only be added after denominators match.", createdAt, createdBy: "human" });
  await ctx.db.insert("skillEdges", { fromSkillId: simplify, toSkillId: addNumerators, kind: "requires", confidence: 0.85, rationale: "Simplification follows fraction addition in the demo path.", createdAt, createdBy: "human" });

  const studentIds = ["demo-student-a", "demo-student-b"];
  await ctx.db.insert("learners", { studentId: studentIds[0], ownerUserId, displayName: "Student A", isSynthetic: true, isSelfOwned: false, createdAt, updatedAt: createdAt });
  await ctx.db.insert("learners", { studentId: studentIds[1], ownerUserId, displayName: "Student B", isSynthetic: true, isSelfOwned: false, createdAt, updatedAt: createdAt });

  const evidence: { studentId: string; skillId: any; outcome: "correct" | "partial" | "incorrect" | "unclear"; independence: "independent" | "hinted" | "demonstrated"; confidence: number; rationale: string; misconceptionIds: string[] }[] = [
    { studentId: studentIds[0], skillId: denominator, outcome: "incorrect", independence: "independent", confidence: 0.96, rationale: "Added unlike denominators directly in 1/2 + 1/3.", misconceptionIds: ["adds-denominators-directly"] },
    { studentId: studentIds[0], skillId: equivalence, outcome: "unclear", independence: "demonstrated", confidence: 0.55, rationale: "Did not yet demonstrate rewriting an equivalent fraction.", misconceptionIds: ["adds-denominators-directly"] },
    { studentId: studentIds[1], skillId: equivalence, outcome: "correct", independence: "independent", confidence: 0.95, rationale: "Rewrote 1/2 as 3/6 without assistance.", misconceptionIds: [] },
    { studentId: studentIds[1], skillId: denominator, outcome: "correct", independence: "independent", confidence: 0.9, rationale: "Selected 6 as a common denominator.", misconceptionIds: [] },
    { studentId: studentIds[1], skillId: addNumerators, outcome: "partial", independence: "hinted", confidence: 0.78, rationale: "Needed one reminder to add only numerators.", misconceptionIds: ["arithmetic-slip"] },
  ];
  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index];
    await ctx.db.insert("learningEvidence", { studentId: item.studentId, ownerUserId, skillId: item.skillId, outcome: item.outcome, independence: item.independence, confidence: item.confidence, rationale: item.rationale, source: "import", observedAt: createdAt, misconceptionIds: item.misconceptionIds, idempotencyKey: `seed:${DEMO_KEY}:evidence:${index}` });
  }
  for (const studentId of studentIds) {
    const rows = await ctx.db.query("learningEvidence").withIndex("by_student", (q: any) => q.eq("studentId", studentId)).collect();
    const skillSubset = studentId === studentIds[0] ? [equivalence, denominator] : [equivalence, denominator, addNumerators];
    for (const skillId of skillSubset) {
      const projected = projectStudentSkillState(studentId, String(skillId), rows.filter((row: any) => String(row.skillId) === String(skillId)).map((row: any): LearningEvidence => ({ id: String(row._id), studentId: row.studentId, skillId: String(row.skillId), outcome: row.outcome, independence: row.independence, confidence: row.confidence, rationale: row.rationale, source: row.source, observedAt: row.observedAt, createdAt: row.observedAt, misconceptionIds: row.misconceptionIds })), { now: createdAt });
      await ctx.db.insert("studentSkillStates", { studentId, skillId, mastery: projected.mastery, confidence: projected.confidence, evidenceCount: projected.evidenceCount, ...(projected.lastPracticedAt ? { lastPracticedAt: projected.lastPracticedAt } : {}), misconceptionIds: projected.misconceptionIds, supportingEvidenceIds: projected.supportingEvidenceIds, modelVersion: projected.modelVersion, explanation: projected.explanation, updatedAt: createdAt });
    }
  }
  await ctx.db.insert("learnerFacts", { studentId: studentIds[0], ownerUserId, key: "preferred_support", value: "visual prerequisite explanation", source: "human_review", confidence: 0.9, editable: true, createdAt, updatedAt: createdAt });
  await ctx.db.insert("learnerFacts", { studentId: studentIds[1], ownerUserId, key: "preferred_support", value: "brief procedural reminder", source: "human_review", confidence: 0.9, editable: true, createdAt, updatedAt: createdAt });
  await ctx.db.insert("episodicSummaries", { studentId: studentIds[0], ownerUserId, summary: "Attempted 1/2 + 1/3 and added denominators directly; revisit equivalent fractions.", skillIds: [equivalence, denominator], evidenceIds: [], importance: 0.95, createdAt });
  await ctx.db.insert("episodicSummaries", { studentId: studentIds[1], ownerUserId, summary: "Can find a common denominator; watch for arithmetic slips when adding numerators.", skillIds: [equivalence, denominator, addNumerators], evidenceIds: [], importance: 0.8, createdAt });
  const runId = await ctx.db.insert("seedRuns", { key: DEMO_KEY, ownerUserId, createdAt, studentIds, skillIds });
  return { seeded: true, reset, studentIds, skillIds, runId };
}

export const seedDemo = mutation({
  args: { reset: v.optional(v.boolean()) },
  handler: async (ctx, args) => await createDemo(ctx, await requireUserId(ctx), args.reset ?? false),
});

export const resetDemo = mutation({
  args: {},
  handler: async (ctx) => await createDemo(ctx, await requireUserId(ctx), true),
});

/** Deployment-only equivalent for a controlled synthetic owner identity. */
export const seedSyntheticDemo = internalMutation({
  args: { ownerUserId: v.string(), reset: v.optional(v.boolean()) },
  handler: async (ctx, args) => await createDemo(ctx, args.ownerUserId, args.reset ?? false),
});

export const demoStatus = query({
  args: {},
  handler: async (ctx) => {
    const ownerUserId = await requireUserId(ctx);
    const run = await (ctx.db as any).query("seedRuns").withIndex("by_key_and_owner", (q: any) => q.eq("key", DEMO_KEY).eq("ownerUserId", ownerUserId)).unique();
    return run ? { key: DEMO_KEY, studentIds: run.studentIds, skillIds: run.skillIds, createdAt: run.createdAt } : null;
  },
});
