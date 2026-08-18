/**
 * Learning evidence is an append-only observation.  A candidate returned by
 * an intelligence provider is deliberately a smaller, untrusted shape.  It
 * only becomes LearningEvidence after `validateCandidateLearningEvidence`
 * succeeds in application code.
 */

export type CandidateLearningEvidence = {
  skillId: string;
  outcome: "correct" | "partial" | "incorrect" | "unclear";
  independence: "independent" | "hinted" | "demonstrated";
  confidence: number;
  rationale: string;
};

export type EvidenceOutcome = CandidateLearningEvidence["outcome"];
export type EvidenceIndependence = CandidateLearningEvidence["independence"];

export type EvidenceSource =
  | "tutor"
  | "student_self_report"
  | "document_analysis"
  | "manual_review"
  | "import";

/** A persisted, immutable observation about one learner/skill pair. */
export type LearningEvidence = {
  id: string;
  studentId: string;
  skillId: string;
  outcome: EvidenceOutcome;
  independence: EvidenceIndependence;
  confidence: number;
  rationale: string;
  source: EvidenceSource;
  observedAt: string;
  createdAt: string;
  threadId?: string;
  messageId?: string;
  activityId?: string;
  misconceptionIds: string[];
  /** Set while an AI proposal is waiting for human review. */
  provisionalSkillId?: string;
  /** Set by the proposal resolver; the original observation is retained. */
  resolvedSkillId?: string;
  idempotencyKey?: string;
};

export type CandidateEvidenceValidation =
  | { ok: true; value: CandidateLearningEvidence }
  | { ok: false; errors: string[] };

const OUTCOMES = new Set<EvidenceOutcome>([
  "correct",
  "partial",
  "incorrect",
  "unclear",
]);
const INDEPENDENCE = new Set<EvidenceIndependence>([
  "independent",
  "hinted",
  "demonstrated",
]);

/**
 * Validate and normalize model-produced evidence without throwing.  Convex
 * mutations call this before writing; keeping it pure also makes the
 * provider boundary straightforward to test.
 */
export function validateCandidateLearningEvidence(
  value: unknown,
): CandidateEvidenceValidation {
  if (typeof value !== "object" || value === null) {
    return { ok: false, errors: ["evidence must be an object"] };
  }

  const candidate = value as Partial<CandidateLearningEvidence>;
  const errors: string[] = [];
  if (typeof candidate.skillId !== "string" || candidate.skillId.trim() === "") {
    errors.push("skillId is required");
  }
  if (typeof candidate.outcome !== "string" || !OUTCOMES.has(candidate.outcome as EvidenceOutcome)) {
    errors.push("outcome is invalid");
  }
  if (
    typeof candidate.independence !== "string" ||
    !INDEPENDENCE.has(candidate.independence as EvidenceIndependence)
  ) {
    errors.push("independence is invalid");
  }
  if (
    typeof candidate.confidence !== "number" ||
    !Number.isFinite(candidate.confidence) ||
    candidate.confidence < 0 ||
    candidate.confidence > 1
  ) {
    errors.push("confidence must be a number between 0 and 1");
  }
  if (typeof candidate.rationale !== "string" || candidate.rationale.trim() === "") {
    errors.push("rationale is required");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      skillId: candidate.skillId!.trim(),
      outcome: candidate.outcome!,
      independence: candidate.independence!,
      confidence: candidate.confidence!,
      rationale: candidate.rationale!.trim(),
    },
  };
}

/** Stable score components shared by the projection and its explanation UI. */
export const EVIDENCE_OUTCOME_WEIGHTS: Record<EvidenceOutcome, number> = {
  correct: 1,
  partial: 0.55,
  incorrect: 0,
  unclear: 0.5,
};

export const EVIDENCE_INDEPENDENCE_WEIGHTS: Record<EvidenceIndependence, number> = {
  independent: 1,
  hinted: 0.75,
  demonstrated: 0.5,
};
