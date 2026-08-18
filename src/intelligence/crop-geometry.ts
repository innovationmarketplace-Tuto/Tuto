import type { NormalizedBounds, NormalizedPoint, PageRegion } from "../domain/regions";

export type CropLocalGeometry = {
  polygon: NormalizedPoint[];
  bounds: NormalizedBounds;
};

export type CropVerification = {
  valid: boolean;
  pageGeometry?: CropLocalGeometry;
  issues: string[];
};

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function validBounds(bounds: NormalizedBounds): boolean {
  return [bounds.x, bounds.y, bounds.width, bounds.height].every(finite)
    && bounds.width > 0
    && bounds.height > 0
    && bounds.x >= 0
    && bounds.y >= 0
    && bounds.x + bounds.width <= 1
    && bounds.y + bounds.height <= 1;
}

function boundsFromPolygon(polygon: readonly NormalizedPoint[]): NormalizedBounds {
  const x = Math.min(...polygon.map((point) => point.x));
  const y = Math.min(...polygon.map((point) => point.y));
  const right = Math.max(...polygon.map((point) => point.x));
  const bottom = Math.max(...polygon.map((point) => point.y));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

function mapPoint(point: NormalizedPoint, crop: NormalizedBounds): NormalizedPoint {
  return {
    x: clamp(crop.x + point.x * crop.width),
    y: clamp(crop.y + point.y * crop.height),
  };
}

/** Convert a geometry returned in crop-local 0–1 coordinates to page space. */
export function cropLocalToPage(
  local: CropLocalGeometry,
  crop: NormalizedBounds,
): CropLocalGeometry {
  if (!validBounds(crop)) throw new Error("Crop bounds must be a non-empty normalized rectangle inside the page.");
  if (local.polygon.length < 3 || local.polygon.some((point) => !finite(point.x) || !finite(point.y))) {
    throw new Error("Crop-local geometry must contain at least three finite points.");
  }
  const polygon = local.polygon.map((point) => mapPoint(point, crop));
  return { polygon, bounds: boundsFromPolygon(polygon) };
}

export function pageToCropLocal(
  page: CropLocalGeometry,
  crop: NormalizedBounds,
): CropLocalGeometry {
  if (!validBounds(crop)) throw new Error("Crop bounds must be a non-empty normalized rectangle inside the page.");
  const polygon = page.polygon.map((point) => ({
    x: clamp((point.x - crop.x) / crop.width),
    y: clamp((point.y - crop.y) / crop.height),
  }));
  return { polygon, bounds: boundsFromPolygon(polygon) };
}

export function cropLocalToPageRegion(
  local: CropLocalGeometry,
  crop: NormalizedBounds,
  input: { id: string; pageId: string; revision: number; kind?: PageRegion["kind"]; transcription?: string; latex?: string; confidence?: number },
): PageRegion {
  const geometry = cropLocalToPage(local, crop);
  return {
    id: input.id,
    pageId: input.pageId,
    revision: input.revision,
    kind: input.kind ?? "term",
    polygon: geometry.polygon,
    bounds: geometry.bounds,
    transcription: input.transcription,
    latex: input.latex,
    confidence: input.confidence,
    source: "derived",
  };
}

/**
 * Verify that a crop-local result maps inside its declared crop and remains a
 * visible, non-empty target. The caller can safely fall back to the parent
 * equation/step when this check fails.
 */
export function verifyCropMapping(
  local: CropLocalGeometry,
  crop: NormalizedBounds,
  tolerance = 0.002,
): CropVerification {
  const issues: string[] = [];
  if (!validBounds(crop)) issues.push("crop bounds are not a normalized non-empty rectangle");
  if (local.polygon.length < 3) issues.push("crop-local polygon has fewer than three points");
  if (local.polygon.some((point) => !finite(point.x) || !finite(point.y))) issues.push("crop-local polygon contains non-finite coordinates");
  if (issues.length > 0) return { valid: false, issues };
  if (local.polygon.some((point) => point.x < -tolerance || point.x > 1 + tolerance || point.y < -tolerance || point.y > 1 + tolerance)) {
    issues.push("crop-local polygon escapes the crop coordinate space");
  }
  let pageGeometry: CropLocalGeometry | undefined;
  try {
    pageGeometry = cropLocalToPage(local, crop);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "unable to map crop-local geometry");
  }
  if (pageGeometry && (pageGeometry.bounds.width <= 0 || pageGeometry.bounds.height <= 0)) {
    issues.push("mapped geometry is empty");
  }
  if (pageGeometry && pageGeometry.polygon.some((point) => point.x < crop.x - tolerance
    || point.x > crop.x + crop.width + tolerance
    || point.y < crop.y - tolerance
    || point.y > crop.y + crop.height + tolerance)) {
    issues.push("mapped geometry escapes the declared crop");
  }
  return { valid: issues.length === 0, pageGeometry, issues };
}

export const convertCropLocalToPage = cropLocalToPage;
export const verifyMappedRegion = verifyCropMapping;

