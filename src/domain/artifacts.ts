/**
 * Canonical pages. See "Canonical pages and layers" in PROJECT_PLAN.md.
 * The imageUrl/revision pair is immutable once analyzed; a rescan or edit
 * creates a new revision rather than mutating this record.
 */

export type ArtifactPage = {
  id: string;
  artifactId: string;
  pageNumber: number;
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  revision: number;
};

export type Artifact = {
  id: string;
  artifactId: string;
  studentId: string;
  ownerUserId: string;
  kind: "scan" | "pdf" | "photo" | "other";
  title?: string;
  createdAt: string;
};

export type ArtifactPageRevision = ArtifactPage & {
  pageId: string;
  mimeType: "image/jpeg" | "image/png" | "application/pdf";
  storageId?: string;
  byteLength?: number;
  createdAt: string;
};

export type ScanJobStatus =
  | "pending"
  | "scheduled"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type DocumentAnalysisJob = {
  id: string;
  pageId: string;
  pageRevision: number;
  studentId: string;
  ownerUserId: string;
  idempotencyKey: string;
  status: ScanJobStatus;
  provider: "fake" | "aws_bda";
  adapterVersion: string;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
  latencyMs?: number;
  usage?: Record<string, string | number | boolean>;
};

/**
 * Student-safe history projection for selecting a previously uploaded page.
 * This is intentionally separate from the persisted artifact/job records so
 * UI code cannot accidentally depend on owner or provider implementation
 * fields.
 */
export type WorksheetHistoryStatus = ScanJobStatus;

export type WorksheetHistoryItem = {
  id: string;
  artifactId: string;
  artifactRecordId?: string;
  pageId: string;
  pageNumber: number;
  pageRevision: number;
  title: string;
  kind: Artifact['kind'];
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  mimeType?: ArtifactPageRevision['mimeType'];
  status: WorksheetHistoryStatus;
  jobId?: string;
  completedAt?: string;
};
