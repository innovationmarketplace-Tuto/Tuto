import assert from "node:assert/strict";
import test from "node:test";

import { buildTutorTurnPrompt } from "../src/intelligence/prompt";

test("tutor prompt carries bounded learner facts without persistence fields", () => {
  const prompt = buildTutorTurnPrompt({
    studentId: "student-a",
    threadId: "thread-a",
    message: "Can you help me with this?",
    currentProblem: "A current problem should remain in the prompt.",
    teachingBrief: {
      currentSkillIds: ["skill-a"],
      skillStates: [],
      prerequisiteGaps: [],
      activeMisconceptions: [],
      relevantEpisodes: [],
    },
    durableFacts: [
      {
        key: `preferred_${"k".repeat(140)}`,
        value: `Use visual checks. ${"v".repeat(1_100)}`,
        source: "human_review",
        confidence: 0.9,
        editable: true,
        ownerUserId: "must-not-escape",
        _id: "fact-secret",
      } as any,
    ],
  });

  assert.match(prompt, /Durable learner facts/);
  assert.match(prompt, /"source":"human_review"/);
  assert.match(prompt, /"confidence":0\.9/);
  assert.match(prompt, /A current problem should remain in the prompt/);
  assert.match(prompt, /"currentSkillIds":\["skill-a"\]/);
  assert.doesNotMatch(prompt, /must-not-escape|fact-secret|"editable"/);
  assert.ok((prompt.match(/"key":"/g) ?? []).length === 1);
  const valuePrefix = "Use visual checks. ";
  assert.ok(prompt.includes(`${valuePrefix}${"v".repeat(1_000 - valuePrefix.length)}`));
  assert.equal(prompt.includes(`${valuePrefix}${"v".repeat(1_001 - valuePrefix.length)}`), false);
});

test("tutor prompt bounds fact count and rejects malformed runtime facts", () => {
  const prompt = buildTutorTurnPrompt({
    studentId: "student-a",
    threadId: "thread-a",
    message: "Help",
    durableFacts: [
      ...Array.from({ length: 25 }, (_, index) => ({
        key: `fact-${index}`,
        value: `value-${index}`,
        source: "student" as const,
        confidence: 0.5,
      })),
      { key: "invalid-source", value: "drop", source: "secret", confidence: 1 },
      { key: "invalid-confidence", value: "drop", source: "student", confidence: 2 },
    ] as any,
  });

  assert.equal((prompt.match(/"key":"fact-/g) ?? []).length, 20);
  assert.doesNotMatch(prompt, /invalid-source|invalid-confidence|"key":"fact-20"/);
});
