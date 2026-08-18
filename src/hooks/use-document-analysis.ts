import { useMutation, useQuery_experimental } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { PageRegion } from "../domain/regions";
import type { WorksheetHistoryItem } from "../domain/artifacts";
import {
  createArtifactId,
  createIdempotencyKey,
  type CreateArtifactMutation,
  type CreatePageMutation,
  DocumentUploadError,
  normalizePersistedRegions,
  type SubmitScanMutation,
  uploadCanonicalPage,
  type LocalDocumentAsset,
  type UploadedCanonicalPage,
} from "../features/document-import/upload";

export type DocumentAnalysisPhase =
  | "idle"
  | "uploading"
  | "submitting"
  | "scheduled"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type DocumentAnalysisWorkflow = {
  artifactId: string;
  artifactRecordId: Id<"artifacts">;
  pageId: Id<"artifactPages">;
  pageRevision: number;
  jobId: Id<"analysisJobs">;
  storageId?: Id<"_storage">;
  naturalWidth: number;
  naturalHeight: number;
  mimeType: "image/jpeg" | "image/png";
  byteLength: number;
};

export type StartDocumentAnalysisInput = {
  asset: LocalDocumentAsset;
  title?: string;
  kind?: "scan" | "photo";
  pageNumber?: number;
  artifactId?: string;
  idempotencyKey?: string;
};

export type DocumentAnalysisResult = {
  workflow: DocumentAnalysisWorkflow;
  job: Doc<"analysisJobs"> | null;
  page: Doc<"artifactPages"> | null;
  regions: PageRegion[];
};

function statusToPhase(status: Doc<"analysisJobs">["status"] | undefined): DocumentAnalysisPhase {
  switch (status) {
    case "scheduled":
      return "scheduled";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "pending":
      return "submitting";
    default:
      return "idle";
  }
}

function humanizeError(error: unknown): string {
  if (error instanceof DocumentUploadError) return error.message;
  const message = error instanceof Error ? error.message : "Document upload failed.";
  if (/unauthenticated|authentication|identity/i.test(message)) {
    return "Sign in before uploading a page. The document workflow requires an authenticated Convex identity.";
  }
  if (/forbidden|not authorized/i.test(message)) {
    return "You do not have access to this work.";
  }
  if (/limit reached|temporarily disabled/i.test(message)) {
    return "Document analysis is temporarily unavailable. Please try again later.";
  }
  return message || "Document upload failed.";
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof DocumentUploadError) return error.retryable;
  return /network|timeout|temporar|try again|rate|503|502|504/i.test(humanizeError(error));
}

/**
 * Durable client workflow for canonical page uploads and Convex analysis jobs.
 * Job and region queries are Convex subscriptions, so this hook updates when
 * the scheduled internal AWS BDA/Nova action changes state without polling a
 * public action or shipping any provider credential to the client.
 */
export function useDocumentAnalysis(studentId: string) {
  const generateUploadUrl = useMutation(api.artifacts.generateUploadUrl);
  const createArtifact = useMutation(api.artifacts.createArtifact);
  const createPage = useMutation(api.artifacts.createPage);
  const submitScan = useMutation(api.documentAnalysis.submitScan);
  const retryScan = useMutation(api.documentAnalysis.retryScan);
  const cancelScan = useMutation(api.documentAnalysis.cancel);

  const [workflow, setWorkflow] = useState<DocumentAnalysisWorkflow | null>(null);
  const [phase, setPhase] = useState<DocumentAnalysisPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);

  const latestWorkflowQuery = useQuery_experimental({
    query: api.documentAnalysis.latestWorkflow,
    args: studentId.trim() ? { studentId } : "skip",
  });

  const jobQuery = useQuery_experimental({
    query: api.documentAnalysis.getJob,
    args: workflow ? { jobId: workflow.jobId } : "skip",
  });
  const pageQuery = useQuery_experimental({
    query: api.artifacts.getPage,
    args: workflow ? { pageId: workflow.pageId } : "skip",
  });
  const regionsQuery = useQuery_experimental({
    query: api.artifacts.listRegions,
    args: workflow && jobQuery.status === "success" && jobQuery.data.status === "completed"
      ? { pageId: workflow.pageId, revision: workflow.pageRevision }
      : "skip",
  });

  const job = jobQuery.status === "success" ? jobQuery.data : null;
  const page = pageQuery.status === "success" ? pageQuery.data : null;
  const persistedRegions = regionsQuery.status === "success" ? regionsQuery.data : undefined;
  const regions = useMemo(
    () => persistedRegions ? normalizePersistedRegions(persistedRegions) : [],
    [persistedRegions],
  );
  const queryError = jobQuery.status === "error"
    ? jobQuery.error
    : pageQuery.status === "error"
      ? pageQuery.error
        : regionsQuery.status === "error"
          ? regionsQuery.error
          : null;
  const restoredWorkflow = latestWorkflowQuery.status === "success"
    ? latestWorkflowQuery.data
    : null;

  useEffect(() => {
    if (workflow || !restoredWorkflow) return;
    setWorkflow(restoredWorkflow as DocumentAnalysisWorkflow);
  }, [restoredWorkflow, workflow]);

  useEffect(() => {
    if (!job) return;
    setPhase(statusToPhase(job.status));
    if (job.status === "failed") {
      setError(job.errorMessage ?? "Document analysis failed.");
      setRetryable(Boolean(job.retryable));
    } else if (job.status === "completed" || job.status === "cancelled") {
      setError(null);
      setRetryable(false);
    }
  }, [job]);

  useEffect(() => {
    if (queryError) {
      setError(humanizeError(queryError));
      setRetryable(isRetryableError(queryError));
    }
  }, [queryError]);

  const start = useCallback(async (input: StartDocumentAnalysisInput): Promise<DocumentAnalysisWorkflow | null> => {
    if (!studentId.trim()) {
      setError("Your learning space is still getting ready. Try again in a moment.");
      setRetryable(false);
      return null;
    }
    setError(null);
    setRetryable(false);
    setPhase("uploading");
    try {
      const uploaded = await uploadCanonicalPage({
        artifactId: input.artifactId ?? createArtifactId(),
        studentId,
        pageNumber: input.pageNumber,
        title: input.title,
        kind: input.kind,
        idempotencyKey: input.idempotencyKey ?? createIdempotencyKey(),
        asset: input.asset,
        generateUploadUrl,
        createArtifact: createArtifact as unknown as CreateArtifactMutation,
        createPage: createPage as unknown as CreatePageMutation,
        submitScan: submitScan as unknown as SubmitScanMutation,
      });
      const next = uploadedToWorkflow(uploaded);
      setWorkflow(next);
      setPhase("scheduled");
      return next;
    } catch (caught) {
      setPhase("failed");
      setError(humanizeError(caught));
      setRetryable(isRetryableError(caught));
      return null;
    }
  }, [createArtifact, createPage, generateUploadUrl, studentId, submitScan]);

  const retry = useCallback(async () => {
    if (!workflow) return;
    setError(null);
    setRetryable(false);
    setPhase("submitting");
    try {
      await retryScan({ jobId: workflow.jobId });
      setPhase("scheduled");
    } catch (caught) {
      setPhase("failed");
      setError(humanizeError(caught));
      setRetryable(isRetryableError(caught));
    }
  }, [retryScan, workflow]);

  const cancel = useCallback(async () => {
    if (!workflow) return;
    try {
      await cancelScan({ jobId: workflow.jobId });
      setPhase("cancelled");
    } catch (caught) {
      setError(humanizeError(caught));
      setRetryable(isRetryableError(caught));
    }
  }, [cancelScan, workflow]);

  const reset = useCallback(() => {
    setWorkflow(null);
    setPhase("idle");
    setError(null);
    setRetryable(false);
  }, []);

  const openWorksheet = useCallback((item: WorksheetHistoryItem): boolean => {
    if (
      !item.artifactRecordId
      || !item.jobId
      || !item.naturalWidth
      || !item.naturalHeight
      || (item.mimeType !== "image/jpeg" && item.mimeType !== "image/png")
    ) {
      setError("That worksheet is not ready to reopen yet.");
      setRetryable(false);
      return false;
    }
    setWorkflow({
      artifactId: item.artifactId,
      artifactRecordId: item.artifactRecordId as Id<"artifacts">,
      pageId: item.pageId as Id<"artifactPages">,
      pageRevision: item.pageRevision,
      jobId: item.jobId as Id<"analysisJobs">,
      naturalWidth: item.naturalWidth,
      naturalHeight: item.naturalHeight,
      mimeType: item.mimeType,
      byteLength: 0,
    });
    setPhase(statusToPhase(item.status));
    setError(null);
    setRetryable(false);
    return true;
  }, []);

  const result = useMemo<DocumentAnalysisResult | null>(() => workflow ? {
    workflow,
    job,
    page,
    regions,
  } : null, [job, page, regions, workflow]);

  return {
    start,
    retry,
    cancel,
    reset,
    openWorksheet,
    workflow,
    result,
    job,
    page,
    regions,
    phase,
    isUploading: phase === "uploading" || phase === "submitting",
    isProcessing: phase === "scheduled" || phase === "running",
    isComplete: phase === "completed" && Boolean(job),
    error,
    retryable,
    isLoadingJob: Boolean(workflow) && jobQuery.status === "pending",
    isLoadingPage: Boolean(workflow) && pageQuery.status === "pending",
    isLoadingRegions: Boolean(workflow) && regionsQuery.status === "pending",
  };
}

function uploadedToWorkflow(uploaded: UploadedCanonicalPage): DocumentAnalysisWorkflow {
  return {
    artifactId: uploaded.artifactId,
    artifactRecordId: uploaded.artifactRecordId,
    pageId: uploaded.pageId,
    pageRevision: uploaded.pageRevision,
    jobId: uploaded.jobId,
    storageId: uploaded.storageId,
    naturalWidth: uploaded.naturalWidth,
    naturalHeight: uploaded.naturalHeight,
    mimeType: uploaded.mimeType,
    byteLength: uploaded.byteLength,
  };
}
