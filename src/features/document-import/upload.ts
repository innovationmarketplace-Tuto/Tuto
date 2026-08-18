import type { Id } from "../../../convex/_generated/dataModel";

/**
 * The smallest shape needed to upload a picked or scanned page.  Keeping this
 * independent of expo-image-picker/document-picker lets the same workflow be
 * used by native pickers, the web File API, and a future native scanner.
 *
 * `file` is populated by web pickers when available.  Native callers should
 * pass the local `uri`; the service reads that URI as a Blob and never turns
 * it into a base64 public-action argument.
 */
export type LocalDocumentAsset = {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
  width: number;
  height: number;
  file?: Blob | null;
};

export type SupportedDocumentMime = "image/jpeg" | "image/png";

export const MAX_DOCUMENT_BYTES = 5_000_000;
export const MAX_DOCUMENT_DIMENSION = 8_000;
export const DEFAULT_UPLOAD_RETRIES = 3;

export type UploadFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type DocumentUploadErrorCode =
  | "invalid_asset"
  | "unsupported_type"
  | "too_large"
  | "read_failed"
  | "upload_failed"
  | "invalid_storage_response"
  | "workflow_failed";

export class DocumentUploadError extends Error {
  readonly code: DocumentUploadErrorCode;
  readonly retryable: boolean;

  constructor(
    code: DocumentUploadErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DocumentUploadError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function mimeFromName(name: string | null | undefined): SupportedDocumentMime | undefined {
  const extension = nonEmpty(name)?.toLowerCase().split(".").at(-1);
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  return undefined;
}

/** Resolve picker metadata without trusting an arbitrary client MIME value. */
export function normalizeDocumentMime(asset: Pick<LocalDocumentAsset, "mimeType" | "name">): SupportedDocumentMime {
  const mime = nonEmpty(asset.mimeType)?.toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg") return "image/jpeg";
  if (mime === "image/png") return "image/png";
  const inferred = mimeFromName(asset.name);
  if (inferred) return inferred;
  throw new DocumentUploadError(
    "unsupported_type",
    "Choose a JPEG or PNG page image.",
  );
}

export function validateDocumentDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 1
    || height < 1
    || width > MAX_DOCUMENT_DIMENSION
    || height > MAX_DOCUMENT_DIMENSION
  ) {
    throw new DocumentUploadError(
      "invalid_asset",
      `Page dimensions must be integers between 1 and ${MAX_DOCUMENT_DIMENSION}px.`,
    );
  }
}

export function validateDocumentSize(byteLength: number): void {
  if (!Number.isFinite(byteLength) || byteLength < 1) {
    throw new DocumentUploadError("invalid_asset", "The selected page is empty.");
  }
  if (byteLength > MAX_DOCUMENT_BYTES) {
    throw new DocumentUploadError(
      "too_large",
      "The page is larger than the 5 MB analysis limit. Choose a smaller scan.",
    );
  }
}

function isDataUri(uri: string): boolean {
  return /^data:/i.test(uri.trim());
}

/** Read exactly the local asset bytes needed by the Convex Storage upload. */
export async function readDocumentBlob(
  asset: LocalDocumentAsset,
  fetchImpl: UploadFetch = fetch,
): Promise<Blob> {
  if (asset.file) {
    validateDocumentSize(asset.file.size);
    return asset.file;
  }
  const uri = nonEmpty(asset.uri);
  if (!uri) throw new DocumentUploadError("invalid_asset", "The selected page has no local URI.");
  // A data URI is a base64 payload.  Rejecting it here makes it impossible for
  // callers to accidentally route the old public demo path back into this
  // durable upload workflow.
  if (isDataUri(uri)) {
    throw new DocumentUploadError(
      "invalid_asset",
      "A local file URI is required; base64 page payloads are not accepted.",
    );
  }
  let response: Response;
  try {
    response = await fetchImpl(uri);
  } catch (error) {
    throw new DocumentUploadError(
      "read_failed",
      "The selected page could not be read from the device.",
      { retryable: true, cause: error },
    );
  }
  if (!response.ok) {
    throw new DocumentUploadError(
      "read_failed",
      `The selected page could not be read (${response.status}).`,
      { retryable: response.status >= 500 || response.status === 408, },
    );
  }
  let blob: Blob;
  try {
    blob = await response.blob();
  } catch (error) {
    throw new DocumentUploadError(
      "read_failed",
      "The selected page could not be decoded.",
      { retryable: true, cause: error },
    );
  }
  validateDocumentSize(blob.size);
  return blob;
}

function retryDelay(attempt: number): number {
  return Math.min(8_000, 400 * 2 ** Math.max(0, attempt - 1));
}

function canRetryStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function storageIdFromResponse(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const storageId = (value as { storageId?: unknown }).storageId;
  return typeof storageId === "string" && storageId.trim() ? storageId : undefined;
}

/**
 * POST a Blob to a Convex-generated upload URL.  Convex Storage owns the bytes
 * after this request; the caller only persists the returned storage ID.
 */
export async function uploadBlobToConvex(
  uploadUrl: string,
  blob: Blob,
  mimeType: SupportedDocumentMime,
  options: {
    fetchImpl?: UploadFetch;
    maxRetries?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? DEFAULT_UPLOAD_RETRIES));
  const sleep = options.sleep ?? wait;
  if (!nonEmpty(uploadUrl)) throw new DocumentUploadError("upload_failed", "Convex did not return an upload URL.");
  validateDocumentSize(blob.size);

  let lastMessage = "The page upload failed.";
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": mimeType },
        body: blob,
      });
    } catch (error) {
      lastMessage = "The page upload could not reach Convex.";
      if (attempt > maxRetries) {
        throw new DocumentUploadError("upload_failed", lastMessage, { retryable: true, cause: error });
      }
      await sleep(retryDelay(attempt));
      continue;
    }

    if (response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new DocumentUploadError(
          "invalid_storage_response",
          "Convex returned an invalid storage response.",
          { cause: error },
        );
      }
      const storageId = storageIdFromResponse(payload);
      if (!storageId) {
        throw new DocumentUploadError(
          "invalid_storage_response",
          "Convex did not return a storage ID for the uploaded page.",
        );
      }
      return storageId;
    }

    lastMessage = `The page upload failed (${response.status}).`;
    if (!canRetryStatus(response.status) || attempt > maxRetries) {
      throw new DocumentUploadError("upload_failed", lastMessage, {
        retryable: canRetryStatus(response.status),
      });
    }
    await sleep(retryDelay(attempt));
  }
  throw new DocumentUploadError("upload_failed", lastMessage, { retryable: true });
}

export type CreateArtifactMutation = (args: {
  artifactId: string;
  studentId: string;
  kind: "scan" | "photo";
  title?: string;
}) => Promise<Id<"artifacts">>;

export type CreatePageMutation = (args: {
  artifactId: string;
  pageNumber: number;
  storageId: Id<"_storage">;
  mimeType: SupportedDocumentMime;
  naturalWidth: number;
  naturalHeight: number;
  byteLength: number;
}) => Promise<Id<"artifactPages">>;

export type SubmitScanMutation = (args: {
  pageId: Id<"artifactPages">;
  pageRevision: number;
  idempotencyKey: string;
}) => Promise<Id<"analysisJobs">>;

export type UploadCanonicalPageInput = {
  artifactId: string;
  studentId: string;
  pageNumber?: number;
  title?: string;
  kind?: "scan" | "photo";
  idempotencyKey: string;
  asset: LocalDocumentAsset;
  generateUploadUrl: () => Promise<string>;
  createArtifact: CreateArtifactMutation;
  createPage: CreatePageMutation;
  submitScan: SubmitScanMutation;
  fetchImpl?: UploadFetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

export type UploadedCanonicalPage = {
  artifactRecordId: Id<"artifacts">;
  pageId: Id<"artifactPages">;
  pageRevision: number;
  jobId: Id<"analysisJobs">;
  storageId: Id<"_storage">;
  artifactId: string;
  mimeType: SupportedDocumentMime;
  naturalWidth: number;
  naturalHeight: number;
  byteLength: number;
};

function asStorageId(value: string): Id<"_storage"> {
  return value as Id<"_storage">;
}

/** Complete durable upload -> page revision -> analysis job scheduling. */
export async function uploadCanonicalPage(input: UploadCanonicalPageInput): Promise<UploadedCanonicalPage> {
  const artifactId = nonEmpty(input.artifactId);
  const studentId = nonEmpty(input.studentId);
  const idempotencyKey = nonEmpty(input.idempotencyKey);
  if (!artifactId || !studentId || !idempotencyKey) {
    throw new DocumentUploadError("invalid_asset", "Artifact, student, and idempotency IDs are required.");
  }
  const pageNumber = input.pageNumber ?? 1;
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new DocumentUploadError("invalid_asset", "Page number must be a positive integer.");
  }
  validateDocumentDimensions(input.asset.width, input.asset.height);
  const mimeType = normalizeDocumentMime(input.asset);

  try {
    // Read and validate the local bytes before creating a server record. This
    // keeps malformed/cancelled picker results from leaving empty artifacts.
    const blob = await readDocumentBlob(input.asset, input.fetchImpl);
    // Create the owner-scoped record before the upload.  Every subsequent
    // mutation is authorized against this learner/artifact; no client-supplied
    // owner ID or provider configuration is accepted by the workflow.
    const artifactRecordId = await input.createArtifact({
      artifactId,
      studentId,
      kind: input.kind ?? "scan",
      ...(nonEmpty(input.title) ? { title: nonEmpty(input.title) } : {}),
    });
    const uploadUrl = await input.generateUploadUrl();
    const storageId = asStorageId(await uploadBlobToConvex(uploadUrl, blob, mimeType, {
      fetchImpl: input.fetchImpl,
      sleep: input.sleep,
    }));
    const pageId = await input.createPage({
      artifactId,
      pageNumber,
      storageId,
      mimeType,
      naturalWidth: input.asset.width,
      naturalHeight: input.asset.height,
      byteLength: blob.size,
    });
    const jobId = await input.submitScan({
      pageId,
      pageRevision: 1,
      idempotencyKey,
    });
    return {
      artifactRecordId,
      pageId,
      pageRevision: 1,
      jobId,
      storageId,
      artifactId,
      mimeType,
      naturalWidth: input.asset.width,
      naturalHeight: input.asset.height,
      byteLength: blob.size,
    };
  } catch (error) {
    if (error instanceof DocumentUploadError) throw error;
    const message = error instanceof Error ? error.message : "Document upload failed.";
    throw new DocumentUploadError("workflow_failed", message, {
      retryable: /network|timeout|temporar|try again|rate|503|502|504/i.test(message),
      cause: error,
    });
  }
}

export function createIdempotencyKey(prefix = "scan"): string {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`.slice(0, 300);
}

export function createArtifactId(prefix = "artifact"): string {
  return createIdempotencyKey(prefix);
}

export type PersistedRegion = {
  _id: string;
  pageId: string;
  parentRegionId?: string;
  revision: number;
  kind: "problem" | "solution_step" | "equation" | "term" | "prose" | "diagram";
  polygon: { x: number; y: number }[];
  bounds: { x: number; y: number; width: number; height: number };
  transcription?: string;
  latex?: string;
  confidence?: number;
  source: "document_analyzer" | "text_detector" | "combined" | "derived";
};

/** Convert Convex IDs into the normalized region IDs consumed by the renderer. */
export function normalizePersistedRegions(regions: readonly PersistedRegion[]) {
  return regions.map((region) => ({
    id: String(region._id),
    pageId: String(region.pageId),
    ...(region.parentRegionId ? { parentRegionId: String(region.parentRegionId) } : {}),
    revision: region.revision,
    kind: region.kind,
    polygon: region.polygon.map((point) => ({ x: point.x, y: point.y })),
    bounds: { ...region.bounds },
    ...(region.transcription !== undefined ? { transcription: region.transcription } : {}),
    ...(region.latex !== undefined ? { latex: region.latex } : {}),
    ...(region.confidence !== undefined ? { confidence: region.confidence } : {}),
    source: region.source,
  }));
}

export type PollableAnalysisJob = {
  status: "pending" | "scheduled" | "running" | "completed" | "failed" | "cancelled";
  errorMessage?: string;
  retryable?: boolean;
};

export type AnalysisJobReader<T extends PollableAnalysisJob> = () => Promise<T | null>;

/** Non-React fallback for callers that cannot keep a Convex subscription open. */
export async function waitForAnalysisJob<T extends PollableAnalysisJob>(
  readJob: AnalysisJobReader<T>,
  options: {
    timeoutMs?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const started = Date.now();
  const timeoutMs = Math.max(1, options.timeoutMs ?? 120_000);
  const maxDelayMs = Math.max(1, options.maxDelayMs ?? 5_000);
  const sleep = options.sleep ?? wait;
  let delayMs = Math.max(1, options.initialDelayMs ?? 500);

  while (Date.now() - started <= timeoutMs) {
    if (options.signal?.aborted) throw new DocumentUploadError("workflow_failed", "Document analysis was cancelled.");
    const job = await readJob();
    if (!job) throw new DocumentUploadError("workflow_failed", "The document-analysis job was not found.");
    if (job.status === "completed") return job;
    if (job.status === "failed") {
      throw new DocumentUploadError("workflow_failed", job.errorMessage ?? "Document analysis failed.", { retryable: job.retryable });
    }
    if (job.status === "cancelled") throw new DocumentUploadError("workflow_failed", "Document analysis was cancelled.");
    await sleep(delayMs);
    delayMs = Math.min(maxDelayMs, delayMs * 2);
  }
  throw new DocumentUploadError("workflow_failed", "Document analysis is taking longer than expected.", { retryable: true });
}
