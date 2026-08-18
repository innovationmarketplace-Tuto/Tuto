import type { ArtifactPage } from "../domain/artifacts";
import type { PageRegion } from "../domain/regions";
import type { AnalyzedPage, DocumentAnalysisInput, DocumentAnalyzer } from "./contracts";
import { DOCUMENT_ANALYZER_ADAPTER_VERSION } from "./contracts";

export const GOLDEN_PAGE: ArtifactPage = {
  id: "golden-page-001",
  artifactId: "golden-fraction-artifact",
  pageNumber: 1,
  imageUrl: "fixture://tuto/fraction-addition-page.jpg",
  naturalWidth: 1_600,
  naturalHeight: 2_200,
  revision: 1,
};

function region(
  input: Pick<PageRegion, "id" | "kind" | "bounds"> & Partial<Pick<PageRegion, "parentRegionId" | "transcription" | "latex" | "confidence" | "source">>,
  pageId: string,
  revision: number,
): PageRegion {
  const { x, y, width, height } = input.bounds;
  return {
    id: input.id,
    pageId,
    revision,
    parentRegionId: input.parentRegionId,
    kind: input.kind,
    polygon: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }],
    bounds: input.bounds,
    transcription: input.transcription,
    latex: input.latex,
    confidence: input.confidence,
    source: input.source ?? "combined",
  };
}

export function goldenPageRegions(pageId = GOLDEN_PAGE.id, revision = GOLDEN_PAGE.revision): PageRegion[] {
  return [
    region({
      id: "problem-001",
      kind: "problem",
      bounds: { x: 0.08, y: 0.08, width: 0.84, height: 0.13 },
      transcription: "Add 1/2 + 1/3",
      latex: "\\frac{1}{2} + \\frac{1}{3}",
      confidence: 0.99,
      source: "derived",
    }, pageId, revision),
    region({
      id: "step-001",
      kind: "solution_step",
      bounds: { x: 0.12, y: 0.30, width: 0.66, height: 0.11 },
      transcription: "1/2 + 1/3 = 2/5",
      latex: "\\frac{1}{2} + \\frac{1}{3} = \\frac{2}{5}",
      confidence: 0.98,
      source: "combined",
    }, pageId, revision),
    region({
      id: "equation-001",
      kind: "equation",
      parentRegionId: "step-001",
      bounds: { x: 0.16, y: 0.32, width: 0.56, height: 0.07 },
      transcription: "1/2 + 1/3 = 2/5",
      latex: "\\frac{1}{2} + \\frac{1}{3} = \\frac{2}{5}",
      confidence: 0.96,
      source: "text_detector",
    }, pageId, revision),
    region({
      id: "step-002",
      kind: "solution_step",
      bounds: { x: 0.12, y: 0.48, width: 0.60, height: 0.10 },
      transcription: "Check: 2/5 is not equivalent to 5/6",
      latex: "\\frac{2}{5} \\ne \\frac{5}{6}",
      confidence: 0.93,
      source: "combined",
    }, pageId, revision),
  ];
}

export function goldenPageAnalysis(pageId = GOLDEN_PAGE.id, revision = GOLDEN_PAGE.revision): AnalyzedPage {
  const regions = goldenPageRegions(pageId, revision);
  return {
    pageId,
    revision,
    regions,
    transcription: regions.filter((item) => item.transcription).map((item) => item.transcription).join("\n"),
    latex: regions.filter((item) => item.latex).map((item) => item.latex).join("\n"),
    annotations: [],
    warnings: [],
    metadata: {
      provider: "fake",
      adapterVersion: DOCUMENT_ANALYZER_ADAPTER_VERSION,
      latencyMs: 0,
      regionCount: regions.length,
      bdaLineCount: 2,
      bdaWordCount: 0,
      semanticPass: "none",
    },
  };
}

function cloneAnalysis(input: DocumentAnalysisInput): AnalyzedPage {
  const fixture = goldenPageAnalysis(input.page.id, input.page.revision);
  return {
    ...fixture,
    regions: fixture.regions.map((item) => ({ ...item, polygon: item.polygon.map((point) => ({ ...point })), bounds: { ...item.bounds } })),
  };
}

/** Deterministic analyzer for local development, tests, and demo kill-switch mode. */
export class FakeDocumentAnalyzer implements DocumentAnalyzer {
  async analyze(input: DocumentAnalysisInput): Promise<AnalyzedPage[]> {
    if (input.page.revision < 1 || !input.page.id) throw new Error("A canonical page revision is required.");
    return [cloneAnalysis(input)];
  }
}

export const fakeDocumentAnalyzer: DocumentAnalyzer = new FakeDocumentAnalyzer();

export function createFakeDocumentAnalyzer(): DocumentAnalyzer {
  return new FakeDocumentAnalyzer();
}

export { FakeDocumentAnalyzer as DeterministicFakeDocumentAnalyzer };

export function createGoldenDocumentAnalysisInput(
  page: ArtifactPage = GOLDEN_PAGE,
): DocumentAnalysisInput {
  return {
    artifactId: page.artifactId,
    page,
    image: { mimeType: "image/jpeg", dataUrl: page.imageUrl, naturalWidth: page.naturalWidth, naturalHeight: page.naturalHeight },
    question: "Check the fraction-addition steps.",
  };
}
