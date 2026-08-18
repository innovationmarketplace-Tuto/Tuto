import { mutationGeneric, queryGeneric, internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import { projectAndPersist } from "./evidence";
import { requireUserId } from "./lib/auth";
import { assertFiniteRange, assertNonEmpty, normalizeTextArray } from "./lib/validation";

const query = queryGeneric;
const mutation = mutationGeneric;
const internalMutation = internalMutationGeneric;

function normalizedSearchText(name: string, objective: string, aliases: string[]): string {
  return [name, objective, ...aliases].join(" ").toLocaleLowerCase().replace(/\s+/g, " ");
}

export const listActive = query({
  args: {
    subject: v.optional(v.string()),
    namespace: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = args.subject
      ? await (ctx.db as any).query("skills").withIndex("by_subject_and_status", (q: any) => q.eq("subject", args.subject).eq("status", "active")).collect()
      : args.namespace
        ? await (ctx.db as any).query("skills").withIndex("by_namespace_and_status", (q: any) => q.eq("namespace", args.namespace).eq("status", "active")).collect()
        : await (ctx.db as any).query("skills").withIndex("by_status", (q: any) => q.eq("status", "active")).collect();
    return rows.sort((a: any, b: any) => a.name.localeCompare(b.name));
  },
});

export const get = query({
  args: { skillId: v.id("skills") },
  handler: async (ctx, args) => (ctx.db as any).get(args.skillId),
});

export const search = query({
  args: {
    text: v.string(),
    subject: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const needle = args.text.trim().toLocaleLowerCase();
    if (needle.length === 0) return [];
    const limit = Math.min(50, Math.max(1, Math.floor(args.limit ?? 20)));
    const rows = args.subject
      ? await (ctx.db as any).query("skills").withIndex("by_subject_and_status", (q: any) => q.eq("subject", args.subject).eq("status", "active")).collect()
      : await (ctx.db as any).query("skills").withIndex("by_status", (q: any) => q.eq("status", "active")).collect();
    return rows
      .filter((skill: any) => normalizedSearchText(skill.name, skill.objective, skill.aliases).includes(needle))
      .sort((a: any, b: any) => a.name.localeCompare(b.name))
      .slice(0, limit);
  },
});

export const edgesFor = query({
  args: { skillId: v.id("skills"), direction: v.optional(v.union(v.literal("from"), v.literal("to"))) },
  handler: async (ctx, args) => {
    const direction = args.direction ?? "from";
    return direction === "from"
      ? await (ctx.db as any).query("skillEdges").withIndex("by_from", (q: any) => q.eq("fromSkillId", args.skillId)).collect()
      : await (ctx.db as any).query("skillEdges").withIndex("by_to", (q: any) => q.eq("toSkillId", args.skillId)).collect();
  },
});

export const create = mutation({
  args: {
    namespace: v.string(),
    name: v.string(),
    objective: v.string(),
    subject: v.string(),
    level: v.optional(v.string()),
    aliases: v.array(v.string()),
    sourceReference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    const now = new Date().toISOString();
    const name = assertNonEmpty(args.name, "skill name", 200);
    const objective = assertNonEmpty(args.objective, "skill objective", 2_000);
    const aliases = normalizeTextArray(args.aliases, "aliases");
    return await (ctx.db as any).insert("skills", {
      namespace: assertNonEmpty(args.namespace, "namespace", 120),
      status: "active",
      name,
      objective,
      subject: assertNonEmpty(args.subject, "subject", 120),
      ...(args.level ? { level: assertNonEmpty(args.level, "level", 120) } : {}),
      aliases,
      version: 1,
      createdBy: "human",
      ...(args.sourceReference ? { sourceReference: args.sourceReference } : {}),
      searchText: normalizedSearchText(name, objective, aliases),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const addEdge = mutation({
  args: {
    fromSkillId: v.id("skills"),
    toSkillId: v.id("skills"),
    kind: v.union(v.literal("requires"), v.literal("part_of"), v.literal("related_to")),
    confidence: v.number(),
    rationale: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    if (args.fromSkillId === args.toSkillId) throw new Error("A skill cannot edge to itself");
    assertFiniteRange(args.confidence, "edge confidence");
    if ((await (ctx.db as any).get(args.fromSkillId)) === null || (await (ctx.db as any).get(args.toSkillId)) === null) throw new Error("Skill not found");
    const duplicate = await (ctx.db as any).query("skillEdges").withIndex("by_from_and_kind", (q: any) => q.eq("fromSkillId", args.fromSkillId).eq("kind", args.kind)).filter((q: any) => q.eq(q.field("toSkillId"), args.toSkillId)).first();
    if (duplicate) return duplicate._id;
    return await (ctx.db as any).insert("skillEdges", {
      ...args,
      ...(args.rationale ? { rationale: assertNonEmpty(args.rationale, "edge rationale", 2_000) } : {}),
      createdAt: new Date().toISOString(),
      createdBy: "human",
    });
  },
});

export const listProposals = query({
  args: { status: v.optional(v.union(v.literal("pending"), v.literal("edited"), v.literal("approved"), v.literal("merged"), v.literal("rejected"))) },
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    return args.status
      ? await (ctx.db as any).query("skillProposals").withIndex("by_status", (q: any) => q.eq("status", args.status)).take(100)
      : await (ctx.db as any).query("skillProposals").order("desc").take(100);
  },
});

export const getProposal = query({
  args: { proposalId: v.id("skillProposals") },
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    return await (ctx.db as any).get(args.proposalId);
  },
});

export const createProposal = mutation({
  args: {
    suggestedName: v.string(),
    objective: v.string(),
    whyExistingSkillsDoNotFit: v.string(),
    prerequisiteCandidateIds: v.array(v.string()),
    aliases: v.array(v.string()),
    positiveExamples: v.array(v.string()),
    sourceMessageIds: v.array(v.string()),
    namespace: v.optional(v.string()),
    subject: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const now = new Date().toISOString();
    const proposalId = await (ctx.db as any).insert("skillProposals", {
      suggestedName: assertNonEmpty(args.suggestedName, "suggested skill name", 200),
      objective: assertNonEmpty(args.objective, "proposal objective", 2_000),
      whyExistingSkillsDoNotFit: assertNonEmpty(args.whyExistingSkillsDoNotFit, "proposal rationale", 4_000),
      prerequisiteCandidateIds: normalizeTextArray(args.prerequisiteCandidateIds, "prerequisite candidates"),
      aliases: normalizeTextArray(args.aliases, "proposal aliases"),
      positiveExamples: normalizeTextArray(args.positiveExamples, "positive examples"),
      sourceMessageIds: normalizeTextArray(args.sourceMessageIds, "source messages"),
      namespace: args.namespace?.trim() || "tuto",
      subject: args.subject?.trim() || "fractions",
      status: "pending",
      createdBy: "human",
      createdByUserId: userId,
      version: 1,
      createdAt: now,
    });
    const provisionalSkillId = await (ctx.db as any).insert("skills", {
      namespace: args.namespace?.trim() || "tuto",
      status: "proposed",
      name: assertNonEmpty(args.suggestedName, "suggested skill name", 200),
      objective: assertNonEmpty(args.objective, "proposal objective", 2_000),
      subject: args.subject?.trim() || "fractions",
      aliases: normalizeTextArray(args.aliases, "proposal aliases"),
      version: 1,
      createdBy: "human",
      sourceReference: `proposal:${String(proposalId)}`,
      searchText: normalizedSearchText(args.suggestedName, args.objective, args.aliases),
      createdAt: now,
      updatedAt: now,
    });
    await (ctx.db as any).patch(proposalId, { provisionalSkillId });
    return proposalId;
  },
});

export const createAiProposal = internalMutation({
  args: {
    suggestedName: v.string(),
    objective: v.string(),
    whyExistingSkillsDoNotFit: v.string(),
    prerequisiteCandidateIds: v.array(v.string()),
    aliases: v.array(v.string()),
    positiveExamples: v.array(v.string()),
    sourceMessageIds: v.array(v.string()),
    namespace: v.string(),
    subject: v.string(),
    createdByUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const proposalId = await (ctx.db as any).insert("skillProposals", {
      suggestedName: args.suggestedName,
      objective: args.objective,
      whyExistingSkillsDoNotFit: args.whyExistingSkillsDoNotFit,
      prerequisiteCandidateIds: args.prerequisiteCandidateIds,
      aliases: args.aliases,
      positiveExamples: args.positiveExamples,
      sourceMessageIds: args.sourceMessageIds,
      namespace: args.namespace,
      subject: args.subject,
      ...(args.createdByUserId ? { createdByUserId: args.createdByUserId } : {}),
      status: "pending",
      createdBy: "ai",
      version: 1,
      createdAt: now,
    });
    const provisionalSkillId = await (ctx.db as any).insert("skills", {
      namespace: args.namespace,
      status: "proposed",
      name: assertNonEmpty(args.suggestedName, "suggested skill name", 200),
      objective: assertNonEmpty(args.objective, "proposal objective", 2_000),
      subject: args.subject,
      aliases: normalizeTextArray(args.aliases, "proposal aliases"),
      version: 1,
      createdBy: "ai",
      sourceReference: `proposal:${String(proposalId)}`,
      searchText: normalizedSearchText(args.suggestedName, args.objective, args.aliases),
      createdAt: now,
      updatedAt: now,
    });
    await (ctx.db as any).patch(proposalId, { provisionalSkillId });
    return proposalId;
  },
});

export const editProposal = mutation({
  args: {
    proposalId: v.id("skillProposals"),
    suggestedName: v.optional(v.string()),
    objective: v.optional(v.string()),
    whyExistingSkillsDoNotFit: v.optional(v.string()),
    prerequisiteCandidateIds: v.optional(v.array(v.string())),
    aliases: v.optional(v.array(v.string())),
    positiveExamples: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const proposal = await (ctx.db as any).get(args.proposalId);
    if (!proposal) throw new Error("Proposal not found");
    if (proposal.status === "merged" || proposal.status === "rejected") throw new Error("Proposal is closed");
    const now = new Date().toISOString();
    const patch: any = {
      status: "edited",
      version: proposal.version + 1,
      editedAt: now,
      reviewedBy: userId,
    };
    if (args.suggestedName !== undefined) patch.suggestedName = assertNonEmpty(args.suggestedName, "suggested skill name", 200);
    if (args.objective !== undefined) patch.objective = assertNonEmpty(args.objective, "proposal objective", 2_000);
    if (args.whyExistingSkillsDoNotFit !== undefined) patch.whyExistingSkillsDoNotFit = assertNonEmpty(args.whyExistingSkillsDoNotFit, "proposal rationale", 4_000);
    if (args.prerequisiteCandidateIds !== undefined) patch.prerequisiteCandidateIds = normalizeTextArray(args.prerequisiteCandidateIds, "prerequisite candidates");
    if (args.aliases !== undefined) patch.aliases = normalizeTextArray(args.aliases, "proposal aliases");
    if (args.positiveExamples !== undefined) patch.positiveExamples = normalizeTextArray(args.positiveExamples, "positive examples");
    await (ctx.db as any).patch(proposal._id, patch);
    if (proposal.provisionalSkillId) {
      const skillPatch: any = { updatedAt: now, version: proposal.version + 1 };
      if (patch.suggestedName !== undefined) skillPatch.name = patch.suggestedName;
      if (patch.objective !== undefined) skillPatch.objective = patch.objective;
      if (patch.aliases !== undefined) skillPatch.aliases = patch.aliases;
      if (skillPatch.name || skillPatch.objective || skillPatch.aliases) {
        const currentSkill = await (ctx.db as any).get(proposal.provisionalSkillId);
        if (currentSkill) skillPatch.searchText = normalizedSearchText(skillPatch.name ?? currentSkill.name, skillPatch.objective ?? currentSkill.objective, skillPatch.aliases ?? currentSkill.aliases);
        await (ctx.db as any).patch(proposal.provisionalSkillId, skillPatch);
      }
    }
    return proposal._id;
  },
});

export const approveProposal = mutation({
  args: { proposalId: v.id("skillProposals"), canonicalSkillId: v.optional(v.id("skills")) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const proposal = await (ctx.db as any).get(args.proposalId);
    if (!proposal) throw new Error("Proposal not found");
    if (proposal.status === "rejected" || proposal.status === "merged") throw new Error("Proposal is closed");
    let canonicalSkillId = args.canonicalSkillId;
    const now = new Date().toISOString();
    if (canonicalSkillId !== undefined) {
      const existing = await (ctx.db as any).get(canonicalSkillId);
      if (!existing || existing.status !== "active") throw new Error("Canonical skill is not active");
    } else {
      const provisional = proposal.provisionalSkillId ? await (ctx.db as any).get(proposal.provisionalSkillId) : null;
      if (provisional) {
        canonicalSkillId = provisional._id;
        await (ctx.db as any).patch(provisional._id, { status: "active", updatedAt: now });
      } else {
        canonicalSkillId = await (ctx.db as any).insert("skills", {
          namespace: proposal.namespace,
          status: "active",
          name: proposal.suggestedName,
          objective: proposal.objective,
          subject: proposal.subject,
          aliases: proposal.aliases,
          version: 1,
          createdBy: "human",
          sourceReference: `proposal:${String(args.proposalId)}`,
          searchText: normalizedSearchText(proposal.suggestedName, proposal.objective, proposal.aliases),
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    if (proposal.provisionalSkillId && canonicalSkillId !== proposal.provisionalSkillId) {
      await (ctx.db as any).patch(proposal.provisionalSkillId, { status: "merged", redirectToSkillId: canonicalSkillId, updatedAt: now });
      await (ctx.db as any).insert("skillRedirects", { fromSkillId: proposal.provisionalSkillId, toSkillId: canonicalSkillId, reason: "merged", proposalId: args.proposalId, createdAt: now });
      const provisionalEvidence = await (ctx.db as any).query("learningEvidence").withIndex("by_provisional_skill", (q: any) => q.eq("provisionalSkillId", proposal.provisionalSkillId)).collect();
      const affectedStudents = new Set<string>();
      for (const evidence of provisionalEvidence) {
        affectedStudents.add(evidence.studentId);
        await (ctx.db as any).patch(evidence._id, { resolvedSkillId: canonicalSkillId });
      }
      for (const studentId of affectedStudents) {
        await projectAndPersist(ctx, studentId, canonicalSkillId, now);
      }
    }
    await (ctx.db as any).patch(proposal._id, {
      status: "approved",
      canonicalSkillId,
      reviewedAt: now,
      reviewedBy: userId,
      version: proposal.version + 1,
    });
    return canonicalSkillId;
  },
});

export const rejectProposal = mutation({
  args: { proposalId: v.id("skillProposals"), reason: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const proposal = await (ctx.db as any).get(args.proposalId);
    if (!proposal) throw new Error("Proposal not found");
    if (proposal.status === "merged" || proposal.status === "rejected") throw new Error("Proposal is closed");
    await (ctx.db as any).patch(proposal._id, {
      status: "rejected",
      rejectionReason: assertNonEmpty(args.reason, "rejection reason", 2_000),
      reviewedAt: new Date().toISOString(),
      reviewedBy: userId,
      version: proposal.version + 1,
    });
    if (proposal.provisionalSkillId) {
      await (ctx.db as any).patch(proposal.provisionalSkillId, { status: "deprecated", updatedAt: new Date().toISOString() });
    }
    return proposal._id;
  },
});

export const mergeProposal = mutation({
  args: { proposalId: v.id("skillProposals"), targetSkillId: v.id("skills") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const proposal = await (ctx.db as any).get(args.proposalId);
    const target = await (ctx.db as any).get(args.targetSkillId);
    if (!proposal || !target) throw new Error("Proposal or target skill not found");
    if (target.status !== "active") throw new Error("Target skill is not active");
    if (proposal.status === "rejected" || proposal.status === "merged") throw new Error("Proposal is closed");
    const now = new Date().toISOString();
    await (ctx.db as any).patch(proposal._id, {
      status: "merged",
      mergedIntoSkillId: args.targetSkillId,
      canonicalSkillId: args.targetSkillId,
      reviewedAt: now,
      reviewedBy: userId,
      version: proposal.version + 1,
    });
    // Redirects make old proposal/provisional references explainable forever.
    const proposalSkill = proposal.provisionalSkillId
      ? await (ctx.db as any).get(proposal.provisionalSkillId)
      : await (ctx.db as any).query("skills").withIndex("by_status", (q: any) => q.eq("status", "proposed")).filter((q: any) => q.eq(q.field("sourceReference"), `proposal:${String(args.proposalId)}`)).first();
    if (proposalSkill) {
      await (ctx.db as any).patch(proposalSkill._id, { status: "merged", redirectToSkillId: args.targetSkillId, updatedAt: now });
      await (ctx.db as any).insert("skillRedirects", { fromSkillId: proposalSkill._id, toSkillId: args.targetSkillId, reason: "merged", proposalId: args.proposalId, createdAt: now });
      const provisionalEvidence = await (ctx.db as any).query("learningEvidence").withIndex("by_provisional_skill", (q: any) => q.eq("provisionalSkillId", proposalSkill._id)).collect();
      for (const evidence of provisionalEvidence) {
        await (ctx.db as any).patch(evidence._id, { resolvedSkillId: args.targetSkillId });
      }
      // Rebuild the canonical target state after provisional observations are
      // redirected. The evidence row itself remains append-only.
      const affectedStudents = new Set<string>(provisionalEvidence.map((row: any) => row.studentId));
      for (const studentId of affectedStudents) {
        await projectAndPersist(ctx, studentId, args.targetSkillId, now);
      }
    }
    return args.targetSkillId;
  },
});

export const resolveRedirect = query({
  args: { skillId: v.id("skills") },
  handler: async (ctx, args) => {
    let skill = await (ctx.db as any).get(args.skillId);
    const seen = new Set<string>();
    while (skill?.redirectToSkillId && !seen.has(String(skill._id))) {
      seen.add(String(skill._id));
      skill = await (ctx.db as any).get(skill.redirectToSkillId);
    }
    return skill;
  },
});

// Descriptive aliases keep the backend boundary discoverable for clients and
// future adapters without duplicating persistence logic.
export const createSkill = create;
export const createSkillEdge = addEdge;
export const listSkills = listActive;
export const proposeSkill = createProposal;
export const editSkillProposal = editProposal;
export const approveSkillProposal = approveProposal;
export const mergeSkillProposal = mergeProposal;
export const rejectSkillProposal = rejectProposal;
