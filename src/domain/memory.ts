/**
 * Learner-memory model. Facts and summaries are explicit records; skill state
 * is always a deterministic projection over append-only evidence.
 */

import {
  EVIDENCE_INDEPENDENCE_WEIGHTS,
  EVIDENCE_OUTCOME_WEIGHTS,
  type LearningEvidence,
} from "./evidence";

export type StudentSkillState = {
  studentId: string;
  skillId: string;
  mastery: number | null;
  confidence: number;
  evidenceCount: number;
  lastPracticedAt?: string;
  misconceptionIds: string[];
  supportingEvidenceIds: string[];
  modelVersion: string;
};

export type SessionMemory = {
  id: string;
  studentId: string;
  threadId: string;
  activityId?: string;
  currentProblem?: string;
  currentSkillIds: string[];
  hintsShown: number;
  hintSummaries: string[];
  status: "active" | "completed" | "archived";
  updatedAt: string;
};

export type LearnerFact = {
  id: string;
  studentId: string;
  key: string;
  value: string;
  source: "student" | "tutor" | "human_review" | "import";
  confidence: number;
  editable: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * The intentionally smaller learner-fact contract that may cross into a
 * tutor provider. Ownership, record identity, editability, and timestamps are
 * persistence concerns and must not become model context.
 */
export type TutorLearnerFact = Pick<LearnerFact, "key" | "value" | "source" | "confidence">;

/** Bounds for the server-owned fact context included in one tutor turn. */
export const MAX_TUTOR_LEARNER_FACTS = 20 as const;
export const MAX_TUTOR_LEARNER_FACT_KEY_LENGTH = 120 as const;
export const MAX_TUTOR_LEARNER_FACT_VALUE_LENGTH = 1_000 as const;

/**
 * A durable fact the tutor model proposes about the learner (background,
 * preferences, goals) from a single turn. Distinct from `candidateEvidence`,
 * which is skill-mastery observation, not learner-identity context.
 */
export type CandidateLearnerFact = Pick<LearnerFact, "key" | "value" | "confidence">;

/** Bounds for the facts a single tutor turn may propose. */
export const MAX_TUTOR_CANDIDATE_FACTS = 8 as const;

export type EpisodicSummary = {
  id: string;
  studentId: string;
  summary: string;
  skillIds: string[];
  evidenceIds: string[];
  importance: number;
  sourceThreadId?: string;
  createdAt: string;
};

export type ProjectionOptions = {
  modelVersion?: string;
  now?: string;
  /** Recent observations receive a bounded, deterministic recency weight. */
  recencyHalfLifeDays?: number;
  maxSupportingEvidence?: number;
};

export type ProjectionExplanation = {
  evidenceId: string;
  score: number;
  weight: number;
  contribution: number;
};

export type ProjectedSkillState = StudentSkillState & {
  explanation: ProjectionExplanation[];
};

const DEFAULT_MODEL_VERSION = "weighted-evidence-v1";
const DEFAULT_HALF_LIFE_DAYS = 30;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function recencyWeight(observedAt: string, now: string, halfLifeDays: number): number {
  const observed = Date.parse(observedAt);
  const current = Date.parse(now);
  if (!Number.isFinite(observed) || !Number.isFinite(current) || halfLifeDays <= 0) return 1;
  const ageDays = Math.max(0, (current - observed) / 86_400_000);
  // Avoid an arbitrary hard cut-off: old evidence remains useful but fades.
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * Project one student/skill state.  No evidence produces `mastery: null`.
 * Every other number is the weighted average of transparent components:
 * outcome × independence × confidence × recency.
 */
export function projectStudentSkillState(
  studentId: string,
  skillId: string,
  evidence: readonly LearningEvidence[],
  options: ProjectionOptions = {},
): ProjectedSkillState {
  const modelVersion = options.modelVersion ?? DEFAULT_MODEL_VERSION;
  const selected = evidence
    .filter((item) => item.studentId === studentId && item.skillId === skillId)
    .slice()
    .sort((a, b) => {
      const aTime = Date.parse(a.observedAt);
      const bTime = Date.parse(b.observedAt);
      return bTime - aTime || a.id.localeCompare(b.id);
    });
  const supportingEvidenceIds = selected.map((item) => item.id);
  const misconceptions = Array.from(
    new Set(selected.flatMap((item) => item.misconceptionIds ?? [])),
  );
  // A pure projection must not drift merely because wall-clock time passed.
  // Callers may provide an explicit evaluation time; otherwise anchor
  // recency to the latest observation in this evidence set.
  const now = options.now ?? selected[0]?.observedAt ?? "1970-01-01T00:00:00.000Z";
  const halfLife = options.recencyHalfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;

  if (selected.length === 0) {
    return {
      studentId,
      skillId,
      mastery: null,
      confidence: 0,
      evidenceCount: 0,
      misconceptionIds: misconceptions,
      supportingEvidenceIds: [],
      modelVersion,
      explanation: [],
    };
  }

  const explanation = selected.map((item) => {
    const score =
      EVIDENCE_OUTCOME_WEIGHTS[item.outcome] *
      EVIDENCE_INDEPENDENCE_WEIGHTS[item.independence];
    const weight = clamp(item.confidence) * recencyWeight(item.observedAt, now, halfLife);
    return {
      evidenceId: item.id,
      score,
      weight,
      contribution: score * weight,
    };
  });
  const denominator = explanation.reduce((sum, item) => sum + item.weight, 0);
  const numerator = explanation.reduce((sum, item) => sum + item.contribution, 0);
  const mastery = denominator === 0 ? 0.5 : clamp(numerator / denominator);
  const averageConfidence =
    selected.reduce((sum, item) => sum + clamp(item.confidence), 0) / selected.length;
  // Confidence reflects amount and quality of evidence, not the mastery score.
  const confidence = clamp(
    (1 - Math.pow(0.65, selected.length)) * (0.35 + 0.65 * averageConfidence),
  );
  const maxSupporting = options.maxSupportingEvidence ?? selected.length;

  return {
    studentId,
    skillId,
    mastery,
    confidence,
    evidenceCount: selected.length,
    lastPracticedAt: selected[0]?.observedAt,
    misconceptionIds: misconceptions,
    supportingEvidenceIds: supportingEvidenceIds.slice(0, Math.max(0, maxSupporting)),
    modelVersion,
    explanation,
  };
}

export function projectSkillStates(
  studentId: string,
  skillIds: readonly string[],
  evidence: readonly LearningEvidence[],
  options: ProjectionOptions = {},
): ProjectedSkillState[] {
  return skillIds.map((skillId) => projectStudentSkillState(studentId, skillId, evidence, options));
}
