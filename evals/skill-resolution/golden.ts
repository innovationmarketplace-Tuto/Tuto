import type { SkillResolution } from "../../src/domain/skills";
import { GOLDEN_SKILLS } from "../../src/intelligence/eval-fixtures";
import { resolveSkill } from "../../src/intelligence/skill-resolver";

export const GOLDEN_SKILL_RESOLUTION_CASES = [
  { id: "exact-alias", objective: "common denominator", expected: "existing" as const, skillId: "fraction-common-denominator" },
  { id: "ambiguous-text", objective: "fraction denominator", expected: "ambiguous" as const },
  { id: "proposed-objective", objective: "choose the operation from a fraction word problem", expected: "proposed" as const },
];

export type SkillResolutionEvalResult = {
  id: string;
  passed: boolean;
  resolution: SkillResolution;
  failure?: string;
};

export function runGoldenSkillResolutionEvals(): SkillResolutionEvalResult[] {
  return GOLDEN_SKILL_RESOLUTION_CASES.map((testCase) => {
    const resolution = resolveSkill({ objective: testCase.objective, skills: GOLDEN_SKILLS, subject: "fractions" });
    const passed = resolution.decision === testCase.expected
      && (testCase.skillId === undefined || (resolution.decision === "existing" && resolution.skillId === testCase.skillId));
    return {
      id: testCase.id,
      passed,
      resolution,
      failure: passed ? undefined : `expected ${testCase.expected}${testCase.skillId ? `:${testCase.skillId}` : ""}, got ${resolution.decision}`,
    };
  });
}

