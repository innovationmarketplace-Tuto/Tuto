/**
 * Learner-memory model. See "Learner-memory model" in PROJECT_PLAN.md.
 *
 * StudentSkillState is a derived estimate for one student and one skill,
 * projected deterministically from evidence (never written directly by AI).
 * `mastery: null` means unknown; a student with no evidence must not be
 * treated as having zero mastery.
 *
 * Session memory, durable learner facts/preferences, and episodic summaries
 * are also part of this model but PROJECT_PLAN.md describes them only in
 * prose (with examples), not as typed shapes yet — define them here when
 * their concrete fields are agreed, rather than guessing at them now.
 */

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
