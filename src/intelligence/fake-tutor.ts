import type { TutorAnnotation } from "../domain/annotations";
import type { CandidateLearningEvidence } from "../domain/evidence";
import type { SkillResolution } from "../domain/skills";
import type { TutorTurnResult } from "../domain/tutoring";
import type { TutorModel, TutorModelInput, TutorModelOutput } from "./contracts";
import { emptyTeachingBrief } from "./contracts";
import { TUTOR_PROMPT_VERSION, worksheetTextForPrompt } from "./prompt";
import { estimateUsage, validateTutorResult, withTutorMetadata } from "./validation";

export const FAKE_TUTOR_MODEL_ID = "deterministic-tutor-v1" as const;

function normalizedMessage(input: TutorModelInput): string {
  return input.message.trim().toLocaleLowerCase();
}

function worksheetText(input: TutorModelInput): string {
  return worksheetTextForPrompt(input).trim().toLocaleLowerCase();
}

function worksheetDecisionText(input: TutorModelInput): string {
  // A persisted problem is the strongest context. Do not let stale OCR from
  // an earlier revision override it (for example, a fraction fixture row on
  // a newly uploaded wall-paint page).
  const currentProblem = input.currentProblem?.trim();
  return (currentProblem || worksheetTextForPrompt(input)).trim().toLocaleLowerCase();
}

function hasFractionSignal(value: string): boolean {
  return /\b(?:fraction|fractions|numerator|denominator|mixed number|common denominator|equivalent fraction)\b|\\frac|\d+\s*\/\s*\d+/i.test(value);
}

function hasWorksheetContext(input: TutorModelInput): boolean {
  // An artifact context identifies a worksheet turn even when OCR returned no
  // transcription. In that case the safe fallback is neutral coaching, not a
  // response copied from the seeded fraction demo.
  return Boolean(input.artifactContext) || worksheetText(input).length > 0;
}

function isWallPaintProblem(value: string): boolean {
  return /\b(?:wall|paint|gallon|coverage|square\s*(?:feet|foot|meters?|metres?)|area)\b/i.test(value);
}

/**
 * The fake is also the production-safe fallback when Bedrock is unavailable.
 * It must never turn an unrelated worksheet into the fraction demo response.
 * Prefer explicit worksheet/session context over learner history, then fall
 * back to a deliberately generic coaching response when OCR is absent.
 */
function worksheetReply(input: TutorModelInput, context: string): string {
  if (isWallPaintProblem(context)) {
    if (/\b(?:share|split|divide|divided|equally|each student|among)\b/i.test(context)) {
      return "This is an equal-sharing problem: divide the total wall area by the number of students. Write the total square feet ÷ number of students first; what quotient do you get?";
    }
    return "Let’s use the wall-paint information on your worksheet. First find the wall’s area (length × height), then compare it with the coverage for one gallon and keep the units consistent. Which dimensions or coverage number should we start with?";
  }
  return "Let’s start with the problem shown on your worksheet. Name the quantity it asks for, list the given values with their units, and choose the operation that connects them. Which number or step would you like me to check?";
}

function fakeReply(input: TutorModelInput): string {
  const brief = input.teachingBrief ?? emptyTeachingBrief();
  const message = normalizedMessage(input);
  const context = worksheetDecisionText(input) || message;
  const groundedWorksheet = hasWorksheetContext(input);
  const fractionContext = hasFractionSignal(context);
  const denominatorMisconception = brief.activeMisconceptions.some((item) =>
    /denominator|add(ed|ing)? the denominator|different denominators/i.test(item),
  );
  const highestMastery = Math.max(
    0,
    ...brief.skillStates.map((state) => state.mastery ?? 0),
  );

  // A visible worksheet problem takes precedence over the seeded fraction
  // learner brief. This branch also makes the fallback useful for real pages
  // when the configured Bedrock provider is unavailable.
  if (groundedWorksheet && !fractionContext) return worksheetReply(input, context);
  if (denominatorMisconception) {
    return "Let’s slow down at the denominator step. Find a common denominator first, rewrite each fraction as an equivalent fraction, and only then add the numerators. What common denominator do 2 and 3 share?";
  }
  if (highestMastery >= 0.8) {
    return "You already have the fraction-equivalence idea. Use the least common denominator, rewrite both numerators, add, and then check whether the result can be simplified. Show me the step you want me to check.";
  }
  if (brief.prerequisiteGaps.length > 0) {
    return "Let’s build this one step at a time. First make the denominators match by multiplying each fraction by an equivalent form. Then add only the numerators and keep the denominator. Which factor will make the first denominator match?";
  }
  if (/why|how|help|stuck|don't|dont|confus/i.test(message)) {
    return "I can help you check the idea without skipping the reasoning. Identify the operation, name the matching denominator you need, and write the equivalent fractions before combining them.";
  }
  return "Nice start. Write the equivalent fractions with a common denominator, combine the numerators, and keep the denominator unchanged. Tell me which step you have so far.";
}

function fakeResolutions(input: TutorModelInput): SkillResolution[] {
  const brief = input.teachingBrief ?? emptyTeachingBrief();
  const context = worksheetDecisionText(input);
  // Do not persist fraction skill observations for a non-fraction worksheet.
  // The fake provider cannot infer a new skill reliably, so an empty list is
  // safer than attaching unrelated learner evidence to this turn.
  if (hasWorksheetContext(input) && !hasFractionSignal(context)) return [];
  const statesBySkill = new Map(brief.skillStates.map((state) => [state.skillId, state]));
  return brief.currentSkillIds.slice(0, 4).map((skillId) => ({
    decision: "existing" as const,
    skillId,
    confidence: Math.max(0.55, Math.min(0.98, statesBySkill.get(skillId)?.confidence ?? 0.72)),
  }));
}

function fakeEvidence(input: TutorModelInput): CandidateLearningEvidence[] {
  const brief = input.teachingBrief ?? emptyTeachingBrief();
  const context = worksheetDecisionText(input);
  if (hasWorksheetContext(input) && !hasFractionSignal(context)) return [];
  const message = normalizedMessage(input);
  const denominatorMisconception = brief.activeMisconceptions.some((item) => /denominator/i.test(item));
  const outcome: CandidateLearningEvidence["outcome"] = denominatorMisconception
    ? "partial"
    : /i understand|got it|correct|yes|done/i.test(message)
      ? "correct"
      : "unclear";
  const independence: CandidateLearningEvidence["independence"] = /hint|help|stuck|why|how/i.test(message)
    ? "hinted"
    : "independent";
  return brief.currentSkillIds.slice(0, 4).map((skillId) => ({
    skillId,
    outcome,
    independence,
    confidence: denominatorMisconception ? 0.82 : 0.67,
    rationale: denominatorMisconception
      ? "The seeded learner history contains a denominator misconception; this turn is a partial observation until the student demonstrates a common-denominator step."
      : "Deterministic fixture observation; the fake provider never promotes this candidate directly to durable mastery.",
  }));
}

function fakeAnnotations(input: TutorModelInput): TutorAnnotation[] {
  const pageId = input.artifactContext?.pageId;
  const regions = input.pageRegions ?? [];
  if (!pageId || regions.length === 0) return [];
  const activeRegionIds = new Set(input.artifactContext?.activeRegionIds ?? []);
  const target = regions.find((region) => activeRegionIds.has(region.id))
    ?? regions.find((region) => region.kind === "solution_step")
    ?? regions.find((region) => region.kind === "equation")
    ?? regions[0];
  if (!target) return [];
  return [{
    id: "fake-annotation-001",
    pageId,
    targetRegionId: target.id,
    messageId: `fake-message-${input.threadId}`,
    kind: "highlight",
    label: "Check this step",
  }];
}

export class FakeTutorModel implements TutorModel {
  async generateTurn(input: TutorModelInput): Promise<TutorModelOutput> {
    const result: TutorTurnResult = {
      reply: fakeReply(input),
      skillResolutions: fakeResolutions(input),
      candidateEvidence: fakeEvidence(input),
      annotations: fakeAnnotations(input),
    };
    // Validate the fake too: it is the executable contract fixture for every
    // other provider and must never teach callers to accept malformed output.
    const validated = validateTutorResult(result, input);
    return withTutorMetadata(validated, {
      provider: "fake",
      model: FAKE_TUTOR_MODEL_ID,
      latencyMs: 0,
      usage: estimateUsage(validated.reply),
      promptVersion: TUTOR_PROMPT_VERSION,
    });
  }
}

export const fakeTutorModel: TutorModel = new FakeTutorModel();

export function createFakeTutorModel(): TutorModel {
  return new FakeTutorModel();
}

export { FakeTutorModel as DeterministicFakeTutor };
