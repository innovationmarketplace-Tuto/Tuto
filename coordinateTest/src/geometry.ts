import type { BBox, Point, Region } from "./types.js";

type JsonObject = Record<string, unknown>;

interface BdaLocation {
  bounding_box?: {
    left?: number;
    top?: number;
    width?: number;
    height?: number;
  };
  polygon?: Array<{ x?: number; y?: number }>;
}

interface BdaTextItem {
  id?: string;
  line_id?: string;
  text?: string;
  confidence?: number;
  locations?: BdaLocation[];
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function bboxFromPolygon(polygon: Point[]): BBox {
  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function textType(): Region["textType"] {
  // BDA's standard text-detection output gives us text and confidence, but does
  // not promise a printed/handwritten label for each returned item.
  return "UNKNOWN";
}

function getObject(value: unknown, key: string): JsonObject | undefined {
  const candidate = isObject(value) ? value[key] : undefined;
  return isObject(candidate) ? candidate : undefined;
}

function getArray(value: unknown, key: string): unknown[] {
  const candidate = isObject(value) ? value[key] : undefined;
  return Array.isArray(candidate) ? candidate : [];
}

function imageDimensions(payload: JsonObject): { width?: number; height?: number } {
  const metadata = getObject(payload, "metadata") ?? getObject(getObject(payload, "image"), "metadata");
  return {
    width: numberValue(metadata?.image_width_pixels),
    height: numberValue(metadata?.image_height_pixels),
  };
}

function normalizedCoordinate(value: number, axisSize: number | undefined): number {
  if (Math.abs(value) <= 1 || !axisSize) return clamp(value);
  return clamp(value / axisSize);
}

function polygonFromLocation(location: BdaLocation, dimensions: { width?: number; height?: number }): Point[] {
  if (location.polygon && location.polygon.length >= 3) {
    const polygon = location.polygon
      .map((point) => {
        const x = numberValue(point.x);
        const y = numberValue(point.y);
        return x === undefined || y === undefined
          ? undefined
          : [normalizedCoordinate(x, dimensions.width), normalizedCoordinate(y, dimensions.height)] as Point;
      })
      .filter((point): point is Point => Boolean(point));
    if (polygon.length >= 3) return polygon;
  }

  const box = location.bounding_box;
  if (!box) return [];
  const left = numberValue(box.left);
  const top = numberValue(box.top);
  const width = numberValue(box.width);
  const height = numberValue(box.height);
  if (left === undefined || top === undefined || width === undefined || height === undefined) return [];
  const normalizedLeft = normalizedCoordinate(left, dimensions.width);
  const normalizedTop = normalizedCoordinate(top, dimensions.height);
  const normalizedRight = normalizedCoordinate(left + width, dimensions.width);
  const normalizedBottom = normalizedCoordinate(top + height, dimensions.height);
  return [
    [normalizedLeft, normalizedTop],
    [normalizedRight, normalizedTop],
    [normalizedRight, normalizedBottom],
    [normalizedLeft, normalizedBottom],
  ];
}

function polygonFromItem(item: BdaTextItem, dimensions: { width?: number; height?: number }): Point[] {
  const location = item.locations?.[0];
  return location ? polygonFromLocation(location, dimensions) : [];
}

function stableSort<T extends BdaTextItem>(items: T[], dimensions: { width?: number; height?: number }): T[] {
  return [...items].sort((a, b) => {
    const aPolygon = polygonFromItem(a, dimensions);
    const bPolygon = polygonFromItem(b, dimensions);
    const aBox = aPolygon.length >= 3 ? bboxFromPolygon(aPolygon) : [0, 0, 0, 0];
    const bBox = bPolygon.length >= 3 ? bboxFromPolygon(bPolygon) : [0, 0, 0, 0];
    return aBox[1] - bBox[1] || aBox[0] - bBox[0] || (a.id ?? "").localeCompare(b.id ?? "");
  });
}

function confidence(value: unknown): number | undefined {
  const numeric = numberValue(value);
  if (numeric === undefined) return undefined;
  return numeric <= 1 ? numeric * 100 : numeric;
}

function textItems(value: unknown, key: string): BdaTextItem[] {
  return getArray(value, key).filter(isObject).map((item) => ({
    id: typeof item.id === "string" ? item.id : undefined,
    line_id: typeof item.line_id === "string" ? item.line_id : undefined,
    text: typeof item.text === "string" ? item.text : undefined,
    confidence: confidence(item.confidence),
    locations: getArray(item, "locations").filter(isObject).map((location) => ({
      bounding_box: getObject(location, "bounding_box") as BdaLocation["bounding_box"],
      polygon: getArray(location, "polygon").filter(isObject).map((point) => ({
        x: numberValue(point.x),
        y: numberValue(point.y),
      })),
    })),
  }));
}

function parseStandardOutput(value: string | undefined): JsonObject | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function emptyPage(): Region {
  return {
    id: "page-001",
    kind: "page",
    polygon: [[0, 0], [1, 0], [1, 1], [0, 1]],
    bbox: [0, 0, 1, 1],
    source: "fallback",
  };
}

/** Convert BDA standard-output text geometry into stable, normalized regions. */
export function regionsFromBda(standardOutput: string | undefined): Region[] {
  const parsed = parseStandardOutput(standardOutput);
  if (!parsed) return [emptyPage()];

  const dimensions = imageDimensions(parsed);
  const image = getObject(parsed, "image") ?? getObject(parsed, "document") ?? parsed;
  const lines = stableSort(textItems(image, "text_lines"), dimensions);
  const words = stableSort(textItems(image, "text_words"), dimensions);
  const regions: Region[] = [];
  const lineIds = new Map<string, string>();

  lines.forEach((line, lineIndex) => {
    const polygon = polygonFromItem(line, dimensions);
    if (polygon.length < 3) return;
    const lineId = `line-${String(lineIndex + 1).padStart(3, "0")}`;
    if (line.id) lineIds.set(line.id, lineId);
    regions.push({
      id: lineId,
      kind: "line",
      polygon,
      bbox: bboxFromPolygon(polygon),
      ocrText: line.text,
      confidence: line.confidence,
      textType: textType(),
      source: "bda",
      children: [],
    });
  });

  words.forEach((word, wordIndex) => {
    const polygon = polygonFromItem(word, dimensions);
    if (polygon.length < 3) return;
    const wordBox = bboxFromPolygon(polygon);
    const parentId = word.line_id ? lineIds.get(word.line_id) : undefined;
    const fallbackParent = parentId ?? regions.find((region) => region.kind === "line" &&
      wordBox[1] >= region.bbox[1] && wordBox[1] <= region.bbox[3])?.id;
    const lineId = fallbackParent ?? `line-${String(wordIndex + 1).padStart(3, "0")}`;
    const existingLine = regions.find((region) => region.id === lineId && region.kind === "line");
    const id = `${lineId}-word-${String((existingLine?.children?.length ?? 0) + 1).padStart(2, "0")}`;
    regions.push({
      id,
      kind: "word",
      polygon,
      bbox: bboxFromPolygon(polygon),
      ocrText: word.text,
      confidence: word.confidence,
      textType: textType(),
      source: "bda",
      parentId: existingLine ? lineId : undefined,
    });
    if (existingLine) existingLine.children?.push(id);
  });

  return regions.length > 0 ? regions : [emptyPage()];
}

export function novaBoxFromRegion(region: Region): number[] {
  return region.bbox.map((value) => Math.round(clamp(value) * 1000));
}

export function regionCatalog(regions: Region[]): string {
  return regions
    .filter((region) => region.kind === "line" || region.kind === "word" || region.kind === "page")
    .slice(0, 360)
    .map((region) => {
      const box = novaBoxFromRegion(region).join(", ");
      const text = region.ocrText ? ` text=${JSON.stringify(region.ocrText)}` : "";
      const confidence = region.confidence === undefined ? "" : ` confidence=${region.confidence.toFixed(1)}`;
      return `${region.id} kind=${region.kind} box=[${box}]${confidence}${text}`;
    })
    .join("\n");
}

export function getRegion(regions: Region[], id: string): Region | undefined {
  return regions.find((region) => region.id === id);
}
