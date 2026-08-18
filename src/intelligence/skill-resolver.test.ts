import assert from "node:assert/strict";
import test from "node:test";

import { GOLDEN_SKILLS } from "./eval-fixtures";
import { resolveSkillsFromContext } from "./skill-resolver";

test("context skill resolution uses worksheet text when the message is generic", () => {
  const result = resolveSkillsFromContext({
    message: "What should I check in this step?",
    pageRegions: [{
      id: "problem-1",
      kind: "problem",
      transcription: "Find a common denominator before adding fractions.",
    }],
    activeRegionIds: ["problem-1"],
    skills: GOLDEN_SKILLS,
  });

  assert.deepEqual(result.currentSkillIds, ["fraction-common-denominator"]);
  assert.ok(result.resolutions.some((resolution) => (
    resolution.decision === "existing" && resolution.skillId === "fraction-common-denominator"
  )));
});

test("context skill resolution does not promote ambiguous candidates", () => {
  const result = resolveSkillsFromContext({
    message: "fraction denominator",
    skills: GOLDEN_SKILLS,
  });

  assert.deepEqual(result.currentSkillIds, []);
  assert.ok(result.resolutions.some((resolution) => resolution.decision === "ambiguous"));
});
