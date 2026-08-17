import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Starting skeleton, transcribed directly from the domain contracts in
 * src/domain/*.ts (see PROJECT_PLAN.md "Core contracts" and "Shared spatial
 * contracts"). Owned by the Memory owner (M-01, M-02, M-06) — extend with
 * indexes, the append-only evidence table, and demo-fixture tables as those
 * pieces are implemented; do not treat this as final.
 */
export default defineSchema({
  skills: defineTable({
    namespace: v.string(),
    status: v.union(
      v.literal("proposed"),
      v.literal("active"),
      v.literal("merged"),
      v.literal("deprecated"),
    ),
    name: v.string(),
    objective: v.string(),
    subject: v.string(),
    level: v.optional(v.string()),
    aliases: v.array(v.string()),
    version: v.number(),
    createdBy: v.union(v.literal("human"), v.literal("ai")),
    sourceReference: v.optional(v.string()),
  }),

  skillEdges: defineTable({
    fromSkillId: v.id("skills"),
    toSkillId: v.id("skills"),
    kind: v.union(
      v.literal("requires"),
      v.literal("part_of"),
      v.literal("related_to"),
    ),
    confidence: v.number(),
    rationale: v.optional(v.string()),
  }),

  studentSkillStates: defineTable({
    studentId: v.string(),
    skillId: v.id("skills"),
    mastery: v.union(v.number(), v.null()),
    confidence: v.number(),
    evidenceCount: v.number(),
    lastPracticedAt: v.optional(v.string()),
    misconceptionIds: v.array(v.string()),
    supportingEvidenceIds: v.array(v.string()),
    modelVersion: v.string(),
  }).index("by_student_and_skill", ["studentId", "skillId"]),

  artifactPages: defineTable({
    artifactId: v.string(),
    pageNumber: v.number(),
    imageUrl: v.string(),
    naturalWidth: v.number(),
    naturalHeight: v.number(),
    revision: v.number(),
  }),

  pageRegions: defineTable({
    pageId: v.id("artifactPages"),
    parentRegionId: v.optional(v.id("pageRegions")),
    revision: v.number(),
    kind: v.union(
      v.literal("problem"),
      v.literal("solution_step"),
      v.literal("equation"),
      v.literal("term"),
      v.literal("prose"),
      v.literal("diagram"),
    ),
    polygon: v.array(v.object({ x: v.number(), y: v.number() })),
    bounds: v.object({
      x: v.number(),
      y: v.number(),
      width: v.number(),
      height: v.number(),
    }),
    transcription: v.optional(v.string()),
    latex: v.optional(v.string()),
    confidence: v.optional(v.number()),
    source: v.union(
      v.literal("document_analyzer"),
      v.literal("text_detector"),
      v.literal("combined"),
      v.literal("derived"),
    ),
  }).index("by_page", ["pageId"]),

  tutorMessages: defineTable({
    threadId: v.string(),
    text: v.string(),
    annotationIds: v.array(v.id("tutorAnnotations")),
  }).index("by_thread", ["threadId"]),

  tutorAnnotations: defineTable({
    pageId: v.id("artifactPages"),
    targetRegionId: v.id("pageRegions"),
    messageId: v.id("tutorMessages"),
    kind: v.union(
      v.literal("highlight"),
      v.literal("circle"),
      v.literal("underline"),
      v.literal("arrow"),
      v.literal("focus"),
      v.literal("label"),
    ),
    label: v.optional(v.string()),
  }).index("by_page", ["pageId"]),
});
