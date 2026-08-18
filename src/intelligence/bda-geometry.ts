import type { NormalizedBounds, NormalizedPoint, PageRegion } from "../domain/regions";

type JsonObject = Record<string, unknown>;

export type DetectedRegion = {
  id: string;
  kind: "line" | "word";
  polygon: NormalizedPoint[];
  bounds: NormalizedBounds;
  transcription?: string;
  confidence?: number;
  parentDetectedId?: string;
};

export type BdaGeometryResult = {
  regions: PageRegion[];
  lineCount: number;
  wordCount: number;
};

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function array(value: unknown, ...keys: string[]): unknown[] {
  const source = object(value);
  for (const key of keys) if (Array.isArray(source?.[key])) return source[key] as unknown[];
  return [];
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function dimensions(payload: JsonObject): { width?: number; height?: number } {
  const metadata = object(payload.metadata) ?? object(object(payload.image)?.metadata);
  return {
    width: number(metadata?.image_width_pixels ?? metadata?.imageWidthPixels ?? metadata?.width),
    height: number(metadata?.image_height_pixels ?? metadata?.imageHeightPixels ?? metadata?.height),
  };
}

function coordinate(value: number, size?: number): number {
  return Math.abs(value) <= 1 || !size ? clamp(value) : clamp(value / size);
}

function normalizePolygon(value: unknown, sizes: { width?: number; height?: number }): NormalizedPoint[] {
  return array({ polygon: value }, "polygon")
    .map((point) => object(point))
    .flatMap((point) => {
      const x = number(point?.x);
      const y = number(point?.y);
      return x === undefined || y === undefined
        ? []
        : [{ x: coordinate(x, sizes.width), y: coordinate(y, sizes.height) }];
    });
}

function boundsFromPolygon(polygon: readonly NormalizedPoint[]): NormalizedBounds | undefined {
  if (polygon.length < 3) return undefined;
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  if (!(right > x && bottom > y)) return undefined;
  return { x, y, width: right - x, height: bottom - y };
}

function polygonFromItem(item: JsonObject, sizes: { width?: number; height?: number }): NormalizedPoint[] {
  const locations = array(item, "locations", "location");
  const location = object(locations[0]);
  const polygon = normalizePolygon(location?.polygon, sizes);
  if (polygon.length >= 3) return polygon;
  const box = object(location?.bounding_box ?? location?.boundingBox);
  const left = number(box?.left);
  const top = number(box?.top);
  const width = number(box?.width);
  const height = number(box?.height);
  if (left === undefined || top === undefined || width === undefined || height === undefined || width <= 0 || height <= 0) {
    return [];
  }
  const x = coordinate(left, sizes.width);
  const y = coordinate(top, sizes.height);
  const right = coordinate(left + width, sizes.width);
  const bottom = coordinate(top + height, sizes.height);
  return [
    { x, y },
    { x: right, y },
    { x: right, y: bottom },
    { x, y: bottom },
  ];
}

function confidence(value: unknown): number | undefined {
  const result = number(value);
  if (result === undefined) return undefined;
  return clamp(result > 1 ? result / 100 : result);
}

function parseStandardOutput(value: unknown): JsonObject | undefined {
  if (typeof value === "string") {
    try {
      return object(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (value instanceof Uint8Array) {
    try {
      return object(JSON.parse(new TextDecoder().decode(value)));
    } catch {
      return undefined;
    }
  }
  return object(value);
}

function standardPayload(raw: unknown): JsonObject | undefined {
  const response = object(raw);
  const segment = array(response, "outputSegments", "output_segments")[0];
  const segmentObject = object(segment);
  const standard = segmentObject?.standardOutput ?? segmentObject?.standard_output
    ?? response?.standardOutput ?? response?.standard_output;
  const parsed = parseStandardOutput(standard ?? raw);
  if (!parsed) return undefined;
  const image = object(parsed.image) ?? object(parsed.document);
  return image ? { ...parsed, image } : parsed;
}

function stableSort(items: JsonObject[], sizes: { width?: number; height?: number }): JsonObject[] {
  return [...items].sort((left, right) => {
    const leftBox = boundsFromPolygon(polygonFromItem(left, sizes));
    const rightBox = boundsFromPolygon(polygonFromItem(right, sizes));
    return (leftBox?.y ?? 1) - (rightBox?.y ?? 1)
      || (leftBox?.x ?? 1) - (rightBox?.x ?? 1)
      || (string(left.id) ?? "").localeCompare(string(right.id) ?? "");
  });
}

function isMath(text: string | undefined): boolean {
  return /(?:=|\+|−|-|×|÷|\*|\/|\^|frac|sqrt|\d)/i.test(text ?? "");
}

function fullPage(pageId: string, revision: number): PageRegion {
  return {
    id: "page-001",
    pageId,
    revision,
    kind: "prose",
    polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    source: "derived",
  };
}

/**
 * Convert BDA standard output into normalized application regions. BDA's
 * response is accepted as `unknown` and is not returned, making this the
 * explicit raw-provider boundary.
 */
export function regionsFromBda(
  raw: unknown,
  options: { pageId?: string; revision?: number } = {},
): BdaGeometryResult {
  const pageId = options.pageId ?? "page-001";
  const revision = options.revision ?? 1;
  const payload = standardPayload(raw);
  const image = object(payload?.image) ?? payload;
  const sizes = payload ? dimensions(payload) : {};
  const lineItems = stableSort(array(image, "text_lines", "textLines").map(object).filter((item): item is JsonObject => Boolean(item)), sizes);
  const wordItems = stableSort(array(image, "text_words", "textWords").map(object).filter((item): item is JsonObject => Boolean(item)), sizes);
  const detected: DetectedRegion[] = [];
  const lineIds = new Map<string, string>();
  lineItems.forEach((item, index) => {
    const polygon = polygonFromItem(item, sizes);
    const bounds = boundsFromPolygon(polygon);
    if (!bounds) return;
    const id = `line-${String(index + 1).padStart(3, "0")}`;
    const providerId = string(item.id);
    if (providerId) lineIds.set(providerId, id);
    detected.push({ id, kind: "line", polygon, bounds, transcription: string(item.text), confidence: confidence(item.confidence) });
  });
  wordItems.forEach((item, index) => {
    const polygon = polygonFromItem(item, sizes);
    const bounds = boundsFromPolygon(polygon);
    if (!bounds) return;
    const providerLineId = string(item.line_id ?? item.lineId);
    const parentDetectedId = providerLineId ? lineIds.get(providerLineId) : undefined;
    const parent = parentDetectedId ? detected.find((region) => region.id === parentDetectedId) : undefined;
    const sequence = parent
      ? detected.filter((region) => region.parentDetectedId === parent.id).length + 1
      : index + 1;
    const id = `${parent?.id ?? `line-${String(index + 1).padStart(3, "0")}`}-word-${String(sequence).padStart(2, "0")}`;
    detected.push({ id, kind: "word", polygon, bounds, transcription: string(item.text), confidence: confidence(item.confidence), parentDetectedId: parent?.id });
  });

  if (detected.length === 0) return { regions: [fullPage(pageId, revision)], lineCount: 0, wordCount: 0 };
  const regions: PageRegion[] = detected.map((region) => ({
    // Region IDs are stable within a page revision. The pageId/revision pair
    // supplies the namespace; retaining line-001/word IDs also keeps the
    // coordinateTest fixture and workspace links compatible.
    id: region.id,
    pageId,
    parentRegionId: region.parentDetectedId,
    revision,
    kind: region.kind === "word" ? "term" : isMath(region.transcription) ? "equation" : "prose",
    polygon: region.polygon,
    bounds: region.bounds,
    transcription: region.transcription,
    confidence: region.confidence,
    source: "text_detector",
  }));
  return {
    regions,
    lineCount: detected.filter((region) => region.kind === "line").length,
    wordCount: detected.filter((region) => region.kind === "word").length,
  };
}

export function novaBoxFromBounds(bounds: NormalizedBounds): number[] {
  return [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height]
    .map((value) => Math.round(clamp(value) * 1_000));
}

export function novaBoxFromRegion(region: PageRegion): number[] {
  return novaBoxFromBounds(region.bounds);
}

/** Convenience array-only form for callers that do not need provider counts. */
export function normalizeBdaRegions(
  raw: unknown,
  options: { pageId?: string; revision?: number } = {},
): PageRegion[] {
  return regionsFromBda(raw, options).regions;
}

export const bdaRegions = normalizeBdaRegions;

export function detectedTranscription(regions: readonly PageRegion[]): string {
  return regions
    .filter((region) => region.source === "text_detector" && region.kind !== "term" && region.transcription)
    .sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x || left.id.localeCompare(right.id))
    .map((region) => region.transcription!.trim())
    .filter(Boolean)
    .join("\n");
}
