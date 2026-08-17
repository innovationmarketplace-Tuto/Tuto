import type { CanonicalImage } from "./image.js";
import type {
  Annotation,
  ArtifactPage,
  DocumentOutput,
  PageRegion,
  Region,
  SemanticArtifact,
  TutorAnnotation,
  TutorMessage,
} from "./types.js";

function bounds(region: Region) {
  const [x, y, right, bottom] = region.bbox;
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

function source(region: Region, hasSemanticArtifact: boolean): PageRegion["source"] {
  if (hasSemanticArtifact) return "combined";
  if (region.source === "bda") return "text_detector";
  return "derived";
}

function kind(region: Region): PageRegion["kind"] {
  if (region.kind === "word") return "term";
  if (region.kind === "page") return "prose";
  if (/[0-9=+\-*/^<>()[\]{}]|\\frac|\\sqrt/.test(region.ocrText ?? "")) return "equation";
  return "prose";
}

function confidence(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.max(0, Math.min(1, value / 100));
}

/** BDA's stable line text is the deterministic fallback transcription. */
export function detectedTranscription(regions: Region[]): string {
  const lines = regions
    .filter((region) => region.kind === "line" && region.source === "bda" && region.ocrText)
    .map((region) => region.ocrText!.trim())
    .filter(Boolean);
  if (lines.length > 0) return lines.join("\n");
  return regions
    .filter((region) => region.kind === "word" && region.source === "bda" && region.ocrText)
    .map((region) => region.ocrText!.trim())
    .filter(Boolean)
    .join(" ");
}

/** Keep the emergency fallback syntactically useful without pretending BDA understood the math. */
export function fallbackLatex(text: string): string {
  return text
    .replace(/×/g, "\\times ")
    .replace(/·/g, "\\cdot ")
    .replace(/÷/g, "\\div ")
    .replace(/≤/g, "\\le ")
    .replace(/≥/g, "\\ge ")
    .replace(/≠/g, "\\ne ")
    .trim();
}

export function documentOutput(input: {
  requestId: string;
  canonical: CanonicalImage;
  regions: Region[];
  transcription: string;
  latex: string;
  semanticArtifacts?: SemanticArtifact[];
  annotations: Annotation[];
}): DocumentOutput {
  const pageId = "page-001";
  const messageId = "message-001";
  const page: ArtifactPage = {
    id: pageId,
    artifactId: input.requestId,
    pageNumber: 1,
    imageUrl: input.canonical.dataUrl,
    naturalWidth: input.canonical.width,
    naturalHeight: input.canonical.height,
    revision: 1,
  };
  const semanticByRegion = new Map((input.semanticArtifacts ?? []).map((artifact) => [artifact.regionId, artifact]));
  const pageRegions: PageRegion[] = input.regions.map((region) => {
    const semantic = semanticByRegion.get(region.id);
    return {
      id: region.id,
      pageId,
      parentRegionId: region.parentId,
      revision: 1,
      kind: kind(region),
      polygon: region.polygon.map(([x, y]) => ({ x, y })),
      bounds: bounds(region),
      transcription: semantic?.transcription ?? region.ocrText,
      latex: semantic?.latex,
      confidence: confidence(semantic?.confidence !== undefined ? semantic.confidence * 100 : region.confidence),
      source: source(region, Boolean(semantic)),
    };
  });
  const annotations: TutorAnnotation[] = input.annotations.map((annotation, index) => ({
    id: `annotation-${String(index + 1).padStart(3, "0")}`,
    pageId,
    targetRegionId: annotation.regionId,
    messageId,
    kind: annotation.type,
    label: annotation.label,
  }));
  const messages: TutorMessage[] = [{
    id: messageId,
    text: input.transcription,
    annotationIds: annotations.map((annotation) => annotation.id),
  }];

  return {
    transcription: input.transcription,
    latex: input.latex,
    pages: [page],
    regions: pageRegions,
    annotations,
    messages,
  };
}
