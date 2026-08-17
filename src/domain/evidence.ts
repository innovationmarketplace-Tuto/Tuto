/**
 * Learning evidence. See "Learning evidence" in PROJECT_PLAN.md: append-only
 * observations from student interactions (e.g. correct answer without
 * assistance, correct answer after hints, a revealed misconception, a
 * clearly marked self-report).
 *
 * CandidateLearningEvidence is AI-produced and unvalidated. Application code
 * validates it before persistence; only then does it become an append-only
 * evidence record. The persisted evidence-event shape itself is not yet
 * specified in PROJECT_PLAN.md and belongs to the Memory owner (M-02).
 */

export type CandidateLearningEvidence = {
  skillId: string;
  outcome: "correct" | "partial" | "incorrect" | "unclear";
  independence: "independent" | "hinted" | "demonstrated";
  confidence: number;
  rationale: string;
};
