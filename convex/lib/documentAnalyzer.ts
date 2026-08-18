import type { PageRegion } from "../../src/domain/regions";

export const DOCUMENT_ANALYZER_ADAPTER_VERSION = "document-analysis.v1";

export type DocumentAnalyzerInput = {
  pageId: string;
  pageRevision: number;
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  mimeType: string;
  /** Exact bytes are fetched only inside the action when an external adapter needs them. */
  bytes?: Uint8Array;
};

export interface DocumentAnalyzerAdapter {
  provider: "fake" | "aws_bda";
  analyze(input: DocumentAnalyzerInput): Promise<PageRegion[]>;
}

/**
 * Deterministic fallback used by local/demo deployments.  The real BDA/Nova
 * adapter can implement this interface without changing jobs, storage, or
 * client contracts.
 */
export const fakeDocumentAnalyzer: DocumentAnalyzerAdapter = {
  provider: "fake",
  async analyze(input) {
    const pageId = input.pageId;
    const revision = input.pageRevision;
    return [
      {
        id: `${pageId}:r${revision}:problem`,
        pageId,
        revision,
        kind: "problem",
        polygon: [
          { x: 0.08, y: 0.1 },
          { x: 0.92, y: 0.1 },
          { x: 0.92, y: 0.32 },
          { x: 0.08, y: 0.32 },
        ],
        bounds: { x: 0.08, y: 0.1, width: 0.84, height: 0.22 },
        transcription: "1/2 + 1/3",
        confidence: 0.99,
        source: "document_analyzer",
      },
      {
        id: `${pageId}:r${revision}:step-1`,
        pageId,
        revision,
        kind: "solution_step",
        polygon: [
          { x: 0.1, y: 0.4 },
          { x: 0.9, y: 0.4 },
          { x: 0.9, y: 0.58 },
          { x: 0.1, y: 0.58 },
        ],
        bounds: { x: 0.1, y: 0.4, width: 0.8, height: 0.18 },
        transcription: "1 + 1 / 2 + 3",
        latex: "\\frac{1+1}{2+3}",
        confidence: 0.97,
        source: "combined",
      },
    ];
  },
};

/**
 * Explicit seam for the intelligence owner.  This deliberately does not
 * accept provider names, ARNs, prompts, or credentials from a client.  Until
 * the AWS adapter is installed in the deployment, `aws_bda` fails closed and
 * the job is recorded as a retryable/terminal backend error.
 */
export async function runConfiguredDocumentAnalyzer(input: DocumentAnalyzerInput): Promise<PageRegion[]> {
  const provider = typeof process !== "undefined" ? process.env.DOCUMENT_ANALYSIS_PROVIDER : undefined;
  if (!provider || provider === "fake") return fakeDocumentAnalyzer.analyze(input);
  if (provider === "aws_bda") {
    throw new Error("AWS BDA adapter is not installed; configure the intelligence adapter for this deployment");
  }
  throw new Error("Unsupported document analysis provider");
}
