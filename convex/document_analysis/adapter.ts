"use node";

import type { ArtifactPage } from "../../src/domain/artifacts";
import type { PageRegion } from "../../src/domain/regions";
import { createDocumentAnalyzer } from "../../src/intelligence/providers";

export type ConvexDocumentAnalysisInput = {
  artifactId: string;
  pageId: string;
  pageRevision: number;
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  mimeType: "image/jpeg" | "image/png";
  bytes?: Uint8Array;
  question?: string;
};

/**
 * Bridge the existing Convex job shape to the provider-neutral adapter. The
 * raw BDA/Nova response is consumed below `createDocumentAnalyzer` and only
 * normalized regions are returned to the job mutation.
 */
export async function runConfiguredDocumentAnalysis(input: ConvexDocumentAnalysisInput): Promise<PageRegion[]> {
  const page: ArtifactPage = {
    id: input.pageId,
    artifactId: input.artifactId,
    pageNumber: 1,
    imageUrl: input.imageUrl,
    naturalWidth: input.naturalWidth,
    naturalHeight: input.naturalHeight,
    revision: input.pageRevision,
  };
  const analyzer = createDocumentAnalyzer(process.env);
  const pages = await analyzer.analyze({
    artifactId: input.artifactId,
    page,
    image: { mimeType: input.mimeType, bytes: input.bytes, dataUrl: input.bytes ? undefined : input.imageUrl, naturalWidth: input.naturalWidth, naturalHeight: input.naturalHeight },
    question: input.question,
  });
  const analyzed = pages.find((item) => item.pageId === input.pageId && item.revision === input.pageRevision) ?? pages[0];
  if (!analyzed) throw new Error("Document analyzer returned no page for the requested revision.");
  return analyzed.regions.map((region) => ({ ...region, pageId: input.pageId, revision: input.pageRevision }));
}
