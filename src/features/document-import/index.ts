/** Document import/analyzer adapters. UI capture remains owned by Product. */
export * from "../../intelligence/contracts";
export * from "../../intelligence/fake-document-analyzer";
export * from "../../intelligence/bda-adapter";
export * from "../../intelligence/bda-geometry";
export * from "../../intelligence/nova-mapper";
export * from "../../intelligence/providers";

// Durable client upload workflow. This module intentionally exposes only
// Convex Storage IDs and normalized page contracts; it does not expose raw
// BDA/Nova responses or accept base64 action payloads.
export {
  createArtifactId,
  createIdempotencyKey,
  DocumentUploadError,
  normalizeDocumentMime,
  normalizePersistedRegions,
  readDocumentBlob,
  uploadBlobToConvex,
  uploadCanonicalPage,
  validateDocumentDimensions,
  validateDocumentSize,
  waitForAnalysisJob,
} from "./upload";
export type {
  CreateArtifactMutation,
  CreatePageMutation,
  LocalDocumentAsset,
  PersistedRegion,
  SubmitScanMutation,
  SupportedDocumentMime,
  UploadCanonicalPageInput,
  UploadedCanonicalPage,
  UploadFetch,
} from "./upload";
