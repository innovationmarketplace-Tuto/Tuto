import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireUserId } from "./lib/auth";
import { requireOwnedLearnerIncludingArchived } from "./lib/db";

const query = queryGeneric;

/** Stable, provider-neutral export for one student's inspectable memory. */
export const learner = query({
  args: { studentId: v.string() },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUserId(ctx);
    await requireOwnedLearnerIncludingArchived(ctx, args.studentId, ownerUserId);
    const [learner, states, evidence, sessions, facts, episodes] = await Promise.all([
      (ctx.db as any).query("learners").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).unique(),
      (ctx.db as any).query("studentSkillStates").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).collect(),
      (ctx.db as any).query("learningEvidence").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).collect(),
      (ctx.db as any).query("learnerSessions").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).collect(),
      (ctx.db as any).query("learnerFacts").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).collect(),
      (ctx.db as any).query("episodicSummaries").withIndex("by_student", (q: any) => q.eq("studentId", args.studentId)).collect(),
    ]);
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), learner, states, evidence, sessions, facts, episodes };
  },
});

/** Curriculum export kept separate from learner data for review/versioning. */
export const skillGraph = query({
  args: { namespace: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Skill definitions are synthetic/public curriculum objects and contain no
    // learner or provider data; callers can safely export active graph state.
    const skills = await (ctx.db as any).query("skills").withIndex("by_status", (q: any) => q.eq("status", "active")).collect();
    const skillIds = new Set(skills.map((skill: any) => String(skill._id)));
    const edges = (await (ctx.db as any).query("skillEdges").collect()).filter((edge: any) => skillIds.has(String(edge.fromSkillId)) && skillIds.has(String(edge.toSkillId)));
    const filtered = args.namespace ? skills.filter((skill: any) => skill.namespace === args.namespace) : skills;
    const filteredIds = new Set(filtered.map((skill: any) => String(skill._id)));
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), skills: filtered, edges: edges.filter((edge: any) => filteredIds.has(String(edge.fromSkillId)) && filteredIds.has(String(edge.toSkillId))) };
  },
});

export const demo = query({
  args: {},
  handler: async (ctx) => {
    const ownerUserId = await requireUserId(ctx);
    const run = await (ctx.db as any).query("seedRuns").withIndex("by_key_and_owner", (q: any) => q.eq("key", "fractions-demo-v1").eq("ownerUserId", ownerUserId)).unique();
    if (!run) return null;
    const learners = await (ctx.db as any).query("learners").withIndex("by_owner", (q: any) => q.eq("ownerUserId", ownerUserId)).collect();
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), seed: run, learners: learners.filter((learner: any) => run.studentIds.includes(learner.studentId)) };
  },
});
