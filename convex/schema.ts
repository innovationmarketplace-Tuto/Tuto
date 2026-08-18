import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const status = v.union(
  v.literal("proposed"),
  v.literal("active"),
  v.literal("merged"),
  v.literal("deprecated"),
);

const regionKind = v.union(
  v.literal("problem"),
  v.literal("solution_step"),
  v.literal("equation"),
  v.literal("term"),
  v.literal("prose"),
  v.literal("diagram"),
);

const polygonPoint = v.object({ x: v.number(), y: v.number() });
const normalizedBounds = v.object({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});

/**
 * Convex persistence for Tuto's inspectable learner memory.  Evidence and
 * page revisions are append-only at their domain boundary.  Projection rows,
 * job status, and proposal resolution metadata are mutable derived/workflow
 * records and are kept separate from those immutable records.
 */
export default defineSchema({
  // Convex Auth owns account, session, verification, and rate-limit records.
  // Keeping these tables in the application schema makes the auth boundary
  // deployable without an external identity service.
  ...authTables,

  learners: defineTable({
    studentId: v.string(),
    ownerUserId: v.string(),
    displayName: v.string(),
    isSynthetic: v.boolean(),
    /** The self-profile API maintains at most one true row per account. */
    isSelfOwned: v.boolean(),
    archivedAt: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_student", ["studentId"])
    .index("by_owner", ["ownerUserId"])
    .index("by_owner_and_self", ["ownerUserId", "isSelfOwned"])
    .index("by_owner_and_student", ["ownerUserId", "studentId"]),

  learnerSessions: defineTable({
    studentId: v.string(),
    ownerUserId: v.string(),
    threadId: v.string(),
    /** Omitted on legacy rows; those rows belong to general chat. */
    scope: v.optional(v.union(v.literal("chat"), v.literal("worksheet"))),
    /** Required for worksheet rows and stable page-level thread restoration. */
    contextKey: v.optional(v.string()),
    activityId: v.optional(v.string()),
    currentProblem: v.optional(v.string()),
    currentSkillIds: v.array(v.string()),
    hintsShown: v.number(),
    hintSummaries: v.array(v.string()),
    status: v.union(v.literal("active"), v.literal("completed"), v.literal("archived")),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_student", ["studentId"])
    .index("by_student_and_thread", ["studentId", "threadId"])
    .index("by_owner_and_thread", ["ownerUserId", "threadId"]),

  learnerFacts: defineTable({
    studentId: v.string(),
    ownerUserId: v.string(),
    key: v.string(),
    value: v.string(),
    source: v.union(
      v.literal("student"),
      v.literal("tutor"),
      v.literal("human_review"),
      v.literal("import"),
    ),
    confidence: v.number(),
    editable: v.boolean(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_student", ["studentId"])
    .index("by_owner_and_student", ["ownerUserId", "studentId"])
    .index("by_owner_student_and_updated", ["ownerUserId", "studentId", "updatedAt"])
    .index("by_student_and_key", ["studentId", "key"]),

  episodicSummaries: defineTable({
    studentId: v.string(),
    ownerUserId: v.string(),
    summary: v.string(),
    skillIds: v.array(v.string()),
    evidenceIds: v.array(v.string()),
    importance: v.number(),
    sourceThreadId: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index("by_student", ["studentId"])
    .index("by_student_and_importance", ["studentId", "importance"]),

  skills: defineTable({
    namespace: v.string(),
    status,
    name: v.string(),
    objective: v.string(),
    subject: v.string(),
    level: v.optional(v.string()),
    aliases: v.array(v.string()),
    version: v.number(),
    createdBy: v.union(v.literal("human"), v.literal("ai")),
    sourceReference: v.optional(v.string()),
    /** Present for a merged/deprecated skill; history remains explainable. */
    redirectToSkillId: v.optional(v.id("skills")),
    searchText: v.optional(v.string()),
    createdAt: v.optional(v.string()),
    updatedAt: v.optional(v.string()),
  })
    .index("by_namespace_and_status", ["namespace", "status"])
    .index("by_subject_and_status", ["subject", "status"])
    .index("by_status", ["status"]),

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
    createdAt: v.optional(v.string()),
    createdBy: v.optional(v.union(v.literal("human"), v.literal("ai"))),
  })
    .index("by_from", ["fromSkillId"])
    .index("by_to", ["toSkillId"])
    .index("by_from_and_kind", ["fromSkillId", "kind"])
    .index("by_to_and_kind", ["toSkillId", "kind"]),

  skillProposals: defineTable({
    suggestedName: v.string(),
    objective: v.string(),
    whyExistingSkillsDoNotFit: v.string(),
    prerequisiteCandidateIds: v.array(v.string()),
    aliases: v.array(v.string()),
    positiveExamples: v.array(v.string()),
    sourceMessageIds: v.array(v.string()),
    namespace: v.string(),
    subject: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("edited"),
      v.literal("approved"),
      v.literal("merged"),
      v.literal("rejected"),
    ),
    createdBy: v.union(v.literal("ai"), v.literal("human")),
    createdByUserId: v.optional(v.string()),
    version: v.number(),
    createdAt: v.string(),
    editedAt: v.optional(v.string()),
    reviewedAt: v.optional(v.string()),
    reviewedBy: v.optional(v.string()),
    canonicalSkillId: v.optional(v.id("skills")),
    mergedIntoSkillId: v.optional(v.id("skills")),
    provisionalSkillId: v.optional(v.id("skills")),
    rejectionReason: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_subject_and_status", ["subject", "status"])
    .index("by_created_by_user", ["createdByUserId"]),

  skillRedirects: defineTable({
    fromSkillId: v.id("skills"),
    toSkillId: v.id("skills"),
    reason: v.union(v.literal("merged"), v.literal("deprecated"), v.literal("alias")),
    proposalId: v.optional(v.id("skillProposals")),
    createdAt: v.string(),
  })
    .index("by_from", ["fromSkillId"])
    .index("by_to", ["toSkillId"]),

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
    explanation: v.optional(
      v.array(
        v.object({
          evidenceId: v.string(),
          score: v.number(),
          weight: v.number(),
          contribution: v.number(),
        }),
      ),
    ),
    updatedAt: v.optional(v.string()),
  })
    .index("by_student_and_skill", ["studentId", "skillId"])
    .index("by_student", ["studentId"]),

  /** Immutable observations. Resolution fields are workflow metadata only. */
  learningEvidence: defineTable({
    studentId: v.string(),
    ownerUserId: v.string(),
    skillId: v.id("skills"),
    outcome: v.union(
      v.literal("correct"),
      v.literal("partial"),
      v.literal("incorrect"),
      v.literal("unclear"),
    ),
    independence: v.union(
      v.literal("independent"),
      v.literal("hinted"),
      v.literal("demonstrated"),
    ),
    confidence: v.number(),
    rationale: v.string(),
    source: v.union(
      v.literal("tutor"),
      v.literal("student_self_report"),
      v.literal("document_analysis"),
      v.literal("manual_review"),
      v.literal("import"),
    ),
    observedAt: v.string(),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    activityId: v.optional(v.string()),
    misconceptionIds: v.array(v.string()),
    provisionalSkillId: v.optional(v.id("skills")),
    resolvedSkillId: v.optional(v.id("skills")),
    idempotencyKey: v.optional(v.string()),
    /** Hash of immutable input fields, useful when exporting/auditing. */
    contentHash: v.optional(v.string()),
  })
    .index("by_student_and_skill", ["studentId", "skillId"])
    .index("by_student_and_observed_at", ["studentId", "observedAt"])
    .index("by_student", ["studentId"])
    .index("by_owner_and_idempotency", ["ownerUserId", "idempotencyKey"])
    .index("by_provisional_skill", ["provisionalSkillId"]),

  artifacts: defineTable({
    artifactId: v.string(),
    studentId: v.string(),
    ownerUserId: v.string(),
    kind: v.union(v.literal("scan"), v.literal("pdf"), v.literal("photo"), v.literal("other")),
    title: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_artifact_id", ["artifactId"])
    .index("by_owner", ["ownerUserId"])
    .index("by_student", ["studentId"]),

  /** Current page pointer; immutable bytes live in artifactPageRevisions. */
  artifactPages: defineTable({
    artifactId: v.string(),
    studentId: v.string(),
    ownerUserId: v.string(),
    pageNumber: v.number(),
    imageUrl: v.string(),
    naturalWidth: v.number(),
    naturalHeight: v.number(),
    revision: v.number(),
    mimeType: v.union(v.literal("image/jpeg"), v.literal("image/png"), v.literal("application/pdf")),
    storageId: v.optional(v.id("_storage")),
    byteLength: v.optional(v.number()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_artifact", ["artifactId"])
    .index("by_owner", ["ownerUserId"])
    .index("by_student", ["studentId"])
    .index("by_artifact_and_page", ["artifactId", "pageNumber"]),

  artifactPageRevisions: defineTable({
    pageId: v.id("artifactPages"),
    artifactId: v.string(),
    studentId: v.string(),
    ownerUserId: v.string(),
    pageNumber: v.number(),
    imageUrl: v.string(),
    naturalWidth: v.number(),
    naturalHeight: v.number(),
    revision: v.number(),
    mimeType: v.union(v.literal("image/jpeg"), v.literal("image/png"), v.literal("application/pdf")),
    storageId: v.optional(v.id("_storage")),
    byteLength: v.optional(v.number()),
    createdAt: v.string(),
  })
    .index("by_page", ["pageId"])
    .index("by_page_and_revision", ["pageId", "revision"])
    .index("by_artifact", ["artifactId"]),

  pageRegions: defineTable({
    pageId: v.id("artifactPages"),
    parentRegionId: v.optional(v.id("pageRegions")),
    revision: v.number(),
    kind: regionKind,
    polygon: v.array(polygonPoint),
    bounds: normalizedBounds,
    transcription: v.optional(v.string()),
    latex: v.optional(v.string()),
    confidence: v.optional(v.number()),
    source: v.union(
      v.literal("document_analyzer"),
      v.literal("text_detector"),
      v.literal("combined"),
      v.literal("derived"),
    ),
    providerRegionId: v.optional(v.string()),
    createdAt: v.optional(v.string()),
  })
    .index("by_page", ["pageId"])
    .index("by_page_and_revision", ["pageId", "revision"])
    .index("by_parent", ["parentRegionId"]),

  analysisJobs: defineTable({
    pageId: v.id("artifactPages"),
    pageRevision: v.number(),
    artifactId: v.string(),
    studentId: v.string(),
    ownerUserId: v.string(),
    idempotencyKey: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("scheduled"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    provider: v.union(v.literal("fake"), v.literal("aws_bda")),
    adapterVersion: v.string(),
    attempt: v.number(),
    maxAttempts: v.number(),
    createdAt: v.string(),
    updatedAt: v.string(),
    scheduledAt: v.optional(v.string()),
    startedAt: v.optional(v.string()),
    completedAt: v.optional(v.string()),
    failedAt: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
    latencyMs: v.optional(v.number()),
    usage: v.optional(v.any()),
  })
    .index("by_page_and_revision", ["pageId", "pageRevision"])
    .index("by_owner_and_idempotency", ["ownerUserId", "idempotencyKey"])
    .index("by_owner_and_status", ["ownerUserId", "status"])
    .index("by_status", ["status"]),

  tutorMessages: defineTable({
    studentId: v.string(),
    ownerUserId: v.optional(v.string()),
    threadId: v.string(),
    /** Present on all production messages; optional for pre-auth fixture rows. */
    role: v.optional(v.union(v.literal("student"), v.literal("tutor"))),
    text: v.string(),
    annotationIds: v.array(v.id("tutorAnnotations")),
    /** Hidden system kickoff rows remain auditable but are excluded from list. */
    isVisible: v.optional(v.boolean()),
    isHidden: v.optional(v.boolean()),
    scope: v.optional(v.union(v.literal("chat"), v.literal("worksheet"))),
    contextKey: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    pageId: v.optional(v.id("artifactPages")),
    pageRevision: v.optional(v.number()),
    createdAt: v.optional(v.string()),
  })
    .index("by_thread", ["threadId"])
    .index("by_student", ["studentId"])
    .index("by_owner_and_thread", ["ownerUserId", "threadId"])
    .index("by_owner_and_idempotency", ["ownerUserId", "idempotencyKey"]),

  /**
   * One durable orchestration record per client turn. The result contains only
   * normalized tutor-contract data, never a raw provider response. It makes
   * action retries idempotent and gives the client a stable status to observe.
   */
  tutorTurns: defineTable({
    studentId: v.string(),
    ownerUserId: v.string(),
    threadId: v.string(),
    scope: v.optional(v.union(v.literal("chat"), v.literal("worksheet"))),
    contextKey: v.optional(v.string()),
    systemInitiated: v.optional(v.boolean()),
    idempotencyKey: v.string(),
    studentMessageId: v.id("tutorMessages"),
    tutorMessageId: v.optional(v.id("tutorMessages")),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
    result: v.optional(v.any()),
    errorMessage: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
    completedAt: v.optional(v.string()),
  })
    .index("by_owner_and_idempotency", ["ownerUserId", "idempotencyKey"])
    .index("by_owner_and_thread", ["ownerUserId", "threadId"])
    .index("by_student_and_thread", ["studentId", "threadId"]),

  tutorAnnotations: defineTable({
    pageId: v.id("artifactPages"),
    pageRevision: v.number(),
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
    createdAt: v.optional(v.string()),
  })
    .index("by_page", ["pageId"])
    .index("by_page_and_revision", ["pageId", "pageRevision"])
    .index("by_message", ["messageId"]),

  inferenceUsage: defineTable({
    kind: v.union(v.literal("tutor"), v.literal("document_analysis")),
    bucketStart: v.number(),
    scope: v.union(v.literal("user"), v.literal("global")),
    userId: v.string(),
    count: v.number(),
    updatedAt: v.string(),
  })
    .index("by_kind_bucket_scope_user", ["kind", "bucketStart", "scope", "userId"])
    .index("by_kind_bucket_scope", ["kind", "bucketStart", "scope"]),

  inferenceSettings: defineTable({
    key: v.string(),
    globalEnabled: v.boolean(),
    maxTutorPerUserPerDay: v.number(),
    maxTutorGlobalPerDay: v.number(),
    maxDocumentPerUserPerDay: v.number(),
    maxDocumentGlobalPerDay: v.number(),
    allowFakeFallback: v.boolean(),
    updatedAt: v.string(),
    updatedBy: v.optional(v.string()),
  }).index("by_key", ["key"]),

  seedRuns: defineTable({
    key: v.string(),
    ownerUserId: v.string(),
    createdAt: v.string(),
    resetAt: v.optional(v.string()),
    studentIds: v.array(v.string()),
    skillIds: v.array(v.id("skills")),
  }).index("by_key_and_owner", ["key", "ownerUserId"]),
});
