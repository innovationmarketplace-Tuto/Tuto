import assert from "node:assert/strict";
import test from "node:test";

import type { PageRegion } from "../src/domain/regions";
import type { TutorModelInput } from "../src/intelligence/contracts";
import { BedrockTutorModel } from "../src/intelligence/bedrock-tutor";
import { FakeTutorModel } from "../src/intelligence/fake-tutor";
import { buildTutorTurnPrompt } from "../src/intelligence/prompt";

const fractionBrief = {
  currentSkillIds: ["fraction-addition"],
  skillStates: [],
  prerequisiteGaps: [],
  activeMisconceptions: ["denominator misconception"],
  relevantEpisodes: ["The learner practiced adding fractions."],
};

function region(overrides: Partial<PageRegion> = {}): PageRegion {
  return {
    id: "wall-problem",
    pageId: "page-wall",
    revision: 1,
    kind: "prose",
    polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.2 }, { x: 0, y: 0.2 }],
    bounds: { x: 0, y: 0, width: 1, height: 0.2 },
    source: "text_detector",
    ...overrides,
  };
}

function worksheetInput(overrides: Partial<TutorModelInput> = {}): TutorModelInput {
  return {
    studentId: "student-wall",
    threadId: "thread-wall",
    message: "Begin this worksheet session.",
    teachingBrief: fractionBrief,
    artifactContext: {
      artifactId: "artifact-wall",
      pageId: "page-wall",
      activeRegionIds: ["wall-problem"],
    },
    pageRegions: [region()],
    ...overrides,
  };
}

test("fake tutor stays neutral when worksheet OCR has no transcription", async () => {
  const result = await new FakeTutorModel().generateTurn(worksheetInput());
  const prompt = buildTutorTurnPrompt(worksheetInput());

  assert.match(result.reply, /worksheet|problem|given values/i);
  assert.doesNotMatch(result.reply, /fraction|denominator|numerator/i);
  assert.deepEqual(result.skillResolutions, []);
  assert.deepEqual(result.candidateEvidence, []);
  assert.doesNotMatch(prompt, /fraction-addition|denominator misconception/i);
});

test("fake tutor grounds a wall-paint problem instead of the seeded fraction brief", async () => {
  const result = await new FakeTutorModel().generateTurn(worksheetInput({
    currentProblem: "A wall is 12 feet long and 8 feet high. One gallon of paint covers 350 square feet.",
    pageRegions: [region({ transcription: "A wall is 12 feet long and 8 feet high." })],
  }));

  assert.match(result.reply, /wall|paint|area|gallon/i);
  assert.doesNotMatch(result.reply, /fraction|denominator|numerator/i);
  assert.deepEqual(result.skillResolutions, []);
  assert.deepEqual(result.candidateEvidence, []);
});

test("tutor prompt makes worksheet text authoritative over learner history", () => {
  const prompt = buildTutorTurnPrompt(worksheetInput({
    currentProblem: "A wall is 12 feet long and 8 feet high.",
    pageRegions: [region({ transcription: "Find the area of the wall." })],
  }));

  assert.match(prompt, /worksheet\/page context is authoritative/i);
  assert.match(prompt, /A wall is 12 feet long and 8 feet high/i);
  assert.match(prompt, /Find the area of the wall/i);
  assert.match(prompt, /mismatched currentSkillId does not cover/i);
});

test("tutor prompt includes the turn focus and readable canonical skill brief", () => {
  const prompt = buildTutorTurnPrompt(worksheetInput({
    currentProblem: "Divide 30 square feet equally among 4 students.",
    pageRegions: [region({ transcription: "How many square feet will each student paint?" })],
    teachingBrief: {
      focus: {
        source: "worksheet",
        subject: "math",
        objective: "Divide 30 square feet equally among 4 students.",
        evidence: ["How many square feet will each student paint?"],
      },
      currentSkills: [{
        skillId: "equal-sharing",
        name: "Equal sharing",
        objective: "Partition a total into equal shares",
        subject: "math",
        mastery: 0.35,
        confidence: 0.5,
        evidenceCount: 1,
        misconceptionIds: ["unequal-share-units"],
      }],
      prerequisiteSkills: [],
      currentSkillIds: ["equal-sharing"],
      skillStates: [],
      prerequisiteGaps: [],
      activeMisconceptions: ["unequal-share-units"],
      relevantEpisodes: [],
    },
  }));

  assert.match(prompt, /"name":"Equal sharing"/);
  assert.match(prompt, /"objective":"Partition a total into equal shares"/);
  assert.match(prompt, /"mastery":0\.35/);
  assert.match(prompt, /"source":"worksheet"/);
});

test("Bedrock adapter replaces blank annotation IDs without discarding a valid reply", async () => {
  const model = new BedrockTutorModel({
    modelId: "test-model",
    converse: async () => ({
      output: {
        message: {
          content: [{
            text: JSON.stringify({
              reply: "Start by finding the wall area.",
              skillResolutions: [],
              candidateEvidence: [],
              annotations: [{ id: "", pageId: "page-wall", targetRegionId: "wall-problem", messageId: "", kind: "highlight" }],
              learnerFacts: [],
            }),
          }],
        },
      },
    }),
  });

  const result = await model.generateTurn(worksheetInput());
  assert.equal(result.metadata?.fallbackUsed, undefined);
  assert.equal(result.annotations[0]?.id, "bedrock-annotation-001");
  assert.equal(result.annotations[0]?.messageId, "bedrock-message-thread-wall");
});
