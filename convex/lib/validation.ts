import type { CandidateLearningEvidence } from "../../src/domain/evidence";
import { validateCandidateLearningEvidence } from "../../src/domain/evidence";

export const MAX_TEXT_LENGTH = 8_000;
export const MAX_ALIAS_LENGTH = 120;
export const MAX_ARRAY_LENGTH = 100;

export function assertNonEmpty(value: string, label: string, max = MAX_TEXT_LENGTH): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${label} is required`);
  if (normalized.length > max) throw new Error(`${label} is too long`);
  return normalized;
}

export function assertFiniteRange(
  value: number,
  label: string,
  min = 0,
  max = 1,
): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return value;
}

export function assertNormalizedBounds(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): void {
  assertFiniteRange(bounds.x, "bounds.x");
  assertFiniteRange(bounds.y, "bounds.y");
  assertFiniteRange(bounds.width, "bounds.width");
  assertFiniteRange(bounds.height, "bounds.height");
  if (bounds.width <= 0 || bounds.height <= 0) throw new Error("region bounds must be non-empty");
  if (bounds.x + bounds.width > 1.000001 || bounds.y + bounds.height > 1.000001) {
    throw new Error("region bounds must fit inside the page");
  }
}

export function assertNormalizedPolygon(points: readonly { x: number; y: number }[]): void {
  if (points.length < 3 || points.length > 100) throw new Error("region polygon is invalid");
  for (const point of points) {
    assertFiniteRange(point.x, "polygon.x");
    assertFiniteRange(point.y, "polygon.y");
  }
}

export function validateEvidenceCandidate(value: unknown): CandidateLearningEvidence {
  const result = validateCandidateLearningEvidence(value);
  if (!result.ok) throw new Error(`Invalid candidate evidence: ${result.errors.join(", ")}`);
  return result.value;
}

export function normalizeTextArray(values: readonly string[], label: string): string[] {
  if (values.length > MAX_ARRAY_LENGTH) throw new Error(`${label} has too many entries`);
  return values.map((value, index) => assertNonEmpty(value, `${label}[${index}]`, MAX_ALIAS_LENGTH));
}

export function assertPageRevision(actual: number, expected: number): void {
  if (!Number.isInteger(expected) || expected < 1) throw new Error("page revision is invalid");
  if (actual !== expected) throw new Error("Page revision is stale");
}

export function assertImageMetadata(input: {
  mimeType: string;
  naturalWidth: number;
  naturalHeight: number;
  byteLength?: number;
}): void {
  if (!(["image/jpeg", "image/png", "application/pdf"] as string[]).includes(input.mimeType)) {
    throw new Error("unsupported document MIME type");
  }
  if (
    !Number.isInteger(input.naturalWidth) ||
    !Number.isInteger(input.naturalHeight) ||
    input.naturalWidth < 1 ||
    input.naturalHeight < 1 ||
    input.naturalWidth > 8_000 ||
    input.naturalHeight > 8_000
  ) {
    throw new Error("document dimensions exceed supported limits");
  }
  if (input.byteLength !== undefined && (!Number.isInteger(input.byteLength) || input.byteLength < 1 || input.byteLength > 5_000_000)) {
    throw new Error("document exceeds the 5 MB analysis limit");
  }
}
