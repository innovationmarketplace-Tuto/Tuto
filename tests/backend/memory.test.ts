import { projectStudentSkillState } from "../../src/domain/memory";
import type { LearningEvidence } from "../../src/domain/evidence";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const evidence = (overrides: Partial<LearningEvidence> = {}): LearningEvidence => ({
  id: "e1",
  studentId: "student-a",
  skillId: "skill-a",
  outcome: "correct",
  independence: "independent",
  confidence: 1,
  rationale: "worked independently",
  source: "manual_review",
  observedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  misconceptionIds: [],
  ...overrides,
});

export function noEvidenceIsUnknown(): void {
  const state = projectStudentSkillState("student-a", "skill-a", [], {
    now: "2026-01-02T00:00:00.000Z",
  });
  assert(state.mastery === null, "no evidence should be unknown");
  assert(state.evidenceCount === 0, "no evidence should have count zero");
}

export function projectionIsDeterministic(): void {
  const input = [
    evidence(),
    evidence({ id: "e2", outcome: "incorrect", confidence: 1, observedAt: "2026-01-02T00:00:00.000Z" }),
  ];
  const first = projectStudentSkillState("student-a", "skill-a", input, {
    now: "2026-01-03T00:00:00.000Z",
  });
  const second = projectStudentSkillState("student-a", "skill-a", input, {
    now: "2026-01-03T00:00:00.000Z",
  });
  assert(JSON.stringify(first) === JSON.stringify(second), "projection should be deterministic");
  assert(first.explanation.length === 2, "projection should explain both observations");
  assert((first.mastery ?? 0) > 0 && (first.mastery ?? 1) < 1, "mixed evidence should be between 0 and 1");
}

noEvidenceIsUnknown();
projectionIsDeterministic();
