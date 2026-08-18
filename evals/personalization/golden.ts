import type { TutorModelInput, TutorModelOutput } from "../../src/intelligence/contracts";
import { FakeTutorModel } from "../../src/intelligence/fake-tutor";
import { GOLDEN_TEACHING_BRIEFS } from "../../src/intelligence/eval-fixtures";
import { DEMO_PAGE, DEMO_REGIONS } from "../../src/constants/demo-fixtures";

export type PersonalizationEvalCase = {
  id: "maya-denominator-bridge" | "jonah-concise-check";
  input: TutorModelInput;
  replyMustInclude: readonly string[];
  replyMustNotInclude?: readonly string[];
  annotationTarget?: string;
};

const shared = {
  threadId: "golden-fractions",
  message: "How should I add 1/2 + 1/3?",
  artifactContext: {
    artifactId: DEMO_PAGE.artifactId,
    pageId: DEMO_PAGE.id,
    activeRegionIds: ["region-denominator-step"],
  },
  pageRegions: DEMO_REGIONS,
};

export const GOLDEN_PERSONALIZATION_CASES: PersonalizationEvalCase[] = [
  {
    id: "maya-denominator-bridge",
    input: { ...shared, studentId: "maya", teachingBrief: GOLDEN_TEACHING_BRIEFS.maya },
    replyMustInclude: ["denominator", "common denominator"],
    annotationTarget: "region-denominator-step",
  },
  {
    id: "jonah-concise-check",
    input: { ...shared, studentId: "jonah", teachingBrief: GOLDEN_TEACHING_BRIEFS.jonah },
    replyMustInclude: ["common denominator", "check"],
    replyMustNotInclude: ["Let’s slow down at the denominator step"],
  },
];

export type PersonalizationEvalResult = {
  id: PersonalizationEvalCase["id"];
  passed: boolean;
  output: TutorModelOutput;
  failures: string[];
};

export async function runGoldenPersonalizationEvals(
  model = new FakeTutorModel(),
): Promise<PersonalizationEvalResult[]> {
  const results: PersonalizationEvalResult[] = [];
  for (const testCase of GOLDEN_PERSONALIZATION_CASES) {
    const output = await model.generateTurn(testCase.input);
    const reply = output.reply.toLocaleLowerCase();
    const failures = testCase.replyMustInclude
      .filter((phrase) => !reply.includes(phrase.toLocaleLowerCase()))
      .map((phrase) => `reply must include “${phrase}”`);
    for (const phrase of testCase.replyMustNotInclude ?? []) {
      if (reply.includes(phrase.toLocaleLowerCase())) failures.push(`reply must not include “${phrase}”`);
    }
    if (testCase.annotationTarget && !output.annotations.some((annotation) => annotation.targetRegionId === testCase.annotationTarget)) {
      failures.push(`an annotation must target ${testCase.annotationTarget}`);
    }
    results.push({ id: testCase.id, passed: failures.length === 0, output, failures });
  }
  return results;
}

export async function assertGoldenPersonalization(model = new FakeTutorModel()): Promise<void> {
  const results = await runGoldenPersonalizationEvals(model);
  const failures = results.flatMap((result) => result.failures.map((failure) => `${result.id}: ${failure}`));
  if (failures.length > 0) throw new Error(`Golden personalization eval failed:\n${failures.join("\n")}`);
}

