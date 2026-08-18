"use node";

/** Server-only document provider seam; never import this from a client module. */
export {
  createDocumentAnalyzer,
  selectDocumentAnalyzer,
} from "../../src/intelligence/providers";
export type {
  DocumentAnalyzer,
  DocumentAnalysisInput,
  AnalyzedPage,
} from "../../src/intelligence/contracts";
