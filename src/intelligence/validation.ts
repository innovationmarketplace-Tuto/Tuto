import type {
  CandidateLearningEvidence,
} from "../domain/evidence";
import type { NewSkillProposal, SkillResolution } from "../domain/skills";
import type { TutorAnnotation } from "../domain/annotations";
import type { TutorTurnResult } from "../domain/tutoring";
import type {
  TutorModelInput,
  TutorModelOutput,
  TutorCallMetadata,
} from "./contracts";

const VALID_OUTCOMES = new Set<CandidateLearningEvidence["outcome"]>([
  "correct",
  "partial",
  "incorrect",
  "unclear",
]);
const VALID_INDEPENDENCE = new Set<CandidateLearningEvidence["independence"]>([
  "independent",
  "hinted",
  "demonstrated",
]);
const VALID_ANNOTATIONS = new Set<TutorAnnotation["kind"]>([
  "highlight",
  "circle",
  "underline",
  "arrow",
  "focus",
  "label",
]);

export class StructuredOutputError extends Error {
  readonly code = "INVALID_STRUCTURED_OUTPUT" as const;

  constructor(message: string) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertOnlyKeys(value: JsonObject, allowed: readonly string[], field: string): void {
  const allowedSet = new Set(allowed);
  const extras = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (extras.length > 0) throw new StructuredOutputError(`${field} contains unsupported fields: ${extras.join(", ")}.`);
}

function requiredString(value: unknown, field: string, maxLength = 8_000): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new StructuredOutputError(`${field} must be a non-empty string.`);
  }
  const result = value.trim();
  if (result.length > maxLength) {
    throw new StructuredOutputError(`${field} exceeds the ${maxLength}-character limit.`);
  }
  return result;
}

function optionalString(value: unknown, field: string, maxLength = 8_000): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, field, maxLength);
}

function confidence(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new StructuredOutputError(`${field} must be a finite number between 0 and 1.`);
  }
  return value;
}

function stringArray(value: unknown, field: string, max = 32): string[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new StructuredOutputError(`${field} must be an array with at most ${max} items.`);
  }
  return value.map((item, index) => requiredString(item, `${field}[${index}]`, 2_000));
}

function proposal(value: unknown, field: string): NewSkillProposal {
  if (!isObject(value)) throw new StructuredOutputError(`${field} must be an object.`);
  assertOnlyKeys(value, ["suggestedName", "objective", "whyExistingSkillsDoNotFit", "prerequisiteCandidateIds", "aliases", "positiveExamples", "sourceMessageIds"], field);
  return {
    suggestedName: requiredString(value.suggestedName, `${field}.suggestedName`, 200),
    objective: requiredString(value.objective, `${field}.objective`, 1_000),
    whyExistingSkillsDoNotFit: requiredString(
      value.whyExistingSkillsDoNotFit,
      `${field}.whyExistingSkillsDoNotFit`,
      2_000,
    ),
    prerequisiteCandidateIds: stringArray(
      value.prerequisiteCandidateIds,
      `${field}.prerequisiteCandidateIds`,
    ),
    aliases: stringArray(value.aliases, `${field}.aliases`),
    positiveExamples: stringArray(value.positiveExamples, `${field}.positiveExamples`),
    sourceMessageIds: stringArray(value.sourceMessageIds, `${field}.sourceMessageIds`),
  };
}

function resolution(value: unknown, index: number): SkillResolution {
  const field = `skillResolutions[${index}]`;
  if (!isObject(value)) throw new StructuredOutputError(`${field} must be an object.`);
  const decision = value.decision;
  if (decision === "existing") {
    assertOnlyKeys(value, ["decision", "skillId", "confidence"], field);
    return {
      decision,
      skillId: requiredString(value.skillId, `${field}.skillId`, 200),
      confidence: confidence(value.confidence, `${field}.confidence`),
    };
  }
  if (decision === "ambiguous") {
    assertOnlyKeys(value, ["decision", "candidateIds", "reason"], field);
    const candidateIds = stringArray(value.candidateIds, `${field}.candidateIds`);
    if (candidateIds.length === 0) {
      throw new StructuredOutputError(`${field}.candidateIds must not be empty.`);
    }
    return {
      decision,
      candidateIds,
      reason: requiredString(value.reason, `${field}.reason`, 2_000),
    };
  }
  if (decision === "proposed") {
    assertOnlyKeys(value, ["decision", "proposal"], field);
    return { decision, proposal: proposal(value.proposal, `${field}.proposal`) };
  }
  throw new StructuredOutputError(`${field}.decision must be existing, ambiguous, or proposed.`);
}

function evidence(value: unknown, index: number): CandidateLearningEvidence {
  const field = `candidateEvidence[${index}]`;
  if (!isObject(value)) throw new StructuredOutputError(`${field} must be an object.`);
  assertOnlyKeys(value, ["skillId", "outcome", "independence", "confidence", "rationale"], field);
  const outcome = value.outcome;
  const independence = value.independence;
  if (!VALID_OUTCOMES.has(outcome as CandidateLearningEvidence["outcome"])) {
    throw new StructuredOutputError(`${field}.outcome is not supported.`);
  }
  if (!VALID_INDEPENDENCE.has(independence as CandidateLearningEvidence["independence"])) {
    throw new StructuredOutputError(`${field}.independence is not supported.`);
  }
  return {
    skillId: requiredString(value.skillId, `${field}.skillId`, 200),
    outcome: outcome as CandidateLearningEvidence["outcome"],
    independence: independence as CandidateLearningEvidence["independence"],
    confidence: confidence(value.confidence, `${field}.confidence`),
    rationale: requiredString(value.rationale, `${field}.rationale`, 2_000),
  };
}

function annotation(value: unknown, index: number, input: TutorModelInput): TutorAnnotation {
  const field = `annotations[${index}]`;
  if (!isObject(value)) throw new StructuredOutputError(`${field} must be an object.`);
  assertOnlyKeys(value, ["id", "pageId", "targetRegionId", "messageId", "kind", "label"], field);
  const kind = value.kind;
  if (!VALID_ANNOTATIONS.has(kind as TutorAnnotation["kind"])) {
    throw new StructuredOutputError(`${field}.kind is not supported.`);
  }
  const pageId = requiredString(value.pageId ?? input.artifactContext?.pageId, `${field}.pageId`, 200);
  const targetRegionId = requiredString(value.targetRegionId, `${field}.targetRegionId`, 200);
  const knownRegionIds = new Set((input.pageRegions ?? []).map((region) => region.id));
  if (knownRegionIds.size > 0 && !knownRegionIds.has(targetRegionId)) {
    throw new StructuredOutputError(`${field}.targetRegionId is not present in the supplied page regions.`);
  }
  if (knownRegionIds.size === 0) {
    console.warn(
      `[tutor:annotation] ${field} targets "${targetRegionId}" but no pageRegions were supplied for this turn; ` +
      "the existence check was skipped and this annotation may be dropped at persist time.",
    );
  }
  return {
    id: requiredString(value.id, `${field}.id`, 200),
    pageId,
    targetRegionId,
    messageId: requiredString(value.messageId, `${field}.messageId`, 200),
    kind: kind as TutorAnnotation["kind"],
    label: optionalString(value.label, `${field}.label`, 500),
  };
}

/**
 * Validate and normalize model output before it is persisted. This is strict
 * by design: a malformed provider response should trigger the configured
 * deterministic fallback rather than become learner memory.
 */
export function validateTutorResult(value: unknown, input: TutorModelInput): TutorTurnResult {
  if (!isObject(value)) throw new StructuredOutputError("Tutor output must be a JSON object.");
  assertOnlyKeys(value, ["reply", "skillResolutions", "candidateEvidence", "annotations"], "Tutor output");
  const skillResolutionsValue = value.skillResolutions;
  const candidateEvidenceValue = value.candidateEvidence;
  const annotationsValue = value.annotations;
  if (!Array.isArray(skillResolutionsValue) || skillResolutionsValue.length > 16) {
    throw new StructuredOutputError("skillResolutions must be an array with at most 16 items.");
  }
  if (!Array.isArray(candidateEvidenceValue) || candidateEvidenceValue.length > 16) {
    throw new StructuredOutputError("candidateEvidence must be an array with at most 16 items.");
  }
  if (!Array.isArray(annotationsValue) || annotationsValue.length > 16) {
    throw new StructuredOutputError("annotations must be an array with at most 16 items.");
  }
  return {
    reply: requiredString(value.reply, "reply", 8_000),
    skillResolutions: skillResolutionsValue.map(resolution),
    candidateEvidence: candidateEvidenceValue.map(evidence),
    annotations: annotationsValue.map((item, index) => annotation(item, index, input)),
  };
}

export function withTutorMetadata(
  result: TutorTurnResult,
  metadata: TutorCallMetadata,
): TutorModelOutput {
  return { ...result, metadata };
}

/** Parse a JSON object returned as plain text, fenced JSON, or a prefilled `{`. */
export function parseStructuredJson(value: unknown): JsonObject | undefined {
  if (isObject(value)) return value;
  if (typeof value !== "string") return undefined;
  const withoutFence = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? value;
  const candidates = [withoutFence.trim()];
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(withoutFence.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isObject(parsed)) return parsed;
    } catch {
      // Try the next safe candidate.
    }
  }
  return undefined;
}

export function estimateUsage(text: string): { inputTokens: number; outputTokens: number; totalTokens: number } {
  // A deterministic, provider-neutral estimate for fake calls and logs.
  const outputTokens = Math.max(1, Math.ceil(text.trim().length / 4));
  return { inputTokens: 0, outputTokens, totalTokens: outputTokens };
}
