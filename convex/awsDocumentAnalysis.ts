"use node";

import { internalActionGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { DOCUMENT_ANALYZER_ADAPTER_VERSION, runConfiguredDocumentAnalyzer } from "./lib/documentAnalyzer";
import { runConfiguredDocumentAnalysis } from "./document_analysis/adapter";
import { selectDocumentAnalyzer } from "../src/intelligence/providers";

const internalAction = internalActionGeneric;
const getInputRef = makeFunctionReference<"query">("documentAnalysis:getInput") as any;
const markRunningRef = makeFunctionReference<"mutation">("documentAnalysis:markRunning") as any;
const completeRef = makeFunctionReference<"mutation">("documentAnalysis:complete") as any;
const failRef = makeFunctionReference<"mutation">("documentAnalysis:fail") as any;

/**
 * Internal-only Node action. Provider configuration is read from Convex's
 * server environment, never from public arguments. The action fetches the
 * exact canonical revision bytes and persists only normalized PageRegions.
 */
export const analyze = internalAction({
  args: { jobId: v.id("analysisJobs") },
  handler: async (ctx, args) => {
    const input = await (ctx as any).runQuery(getInputRef, { jobId: args.jobId });
    if (!input || !input.page || !input.revision) throw new Error("Analysis input is missing or stale");
    if (input.job.status === "completed" || input.job.status === "cancelled") return input.job._id;
    const started = Date.now();
    try {
      const running = await (ctx as any).runMutation(markRunningRef, { jobId: args.jobId });
      if (running?.status === "completed" || running?.status === "cancelled") return args.jobId;
      const revision = input.revision;
      const imageUrl = revision.imageUrl || input.page.imageUrl;
      let bytes: Uint8Array | undefined;
      if (revision.storageId) {
        const storageUrl = await (ctx as any).storage.getUrl(revision.storageId);
        if (!storageUrl) throw new Error("Canonical page bytes are unavailable");
        const response = await fetch(storageUrl);
        if (!response.ok) throw new Error(`Canonical page fetch failed (${response.status})`);
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > 5_000_000) throw new Error("Canonical page exceeds analysis limit");
        bytes = new Uint8Array(arrayBuffer);
      }
      const selection = selectDocumentAnalyzer(process.env);
      const regions = selection.provider === "fake"
        ? await runConfiguredDocumentAnalyzer({ pageId: String(input.page._id), pageRevision: revision.revision, imageUrl, naturalWidth: revision.naturalWidth, naturalHeight: revision.naturalHeight, mimeType: revision.mimeType, bytes })
        : await runConfiguredDocumentAnalysis({ artifactId: input.page.artifactId, pageId: String(input.page._id), pageRevision: revision.revision, imageUrl, naturalWidth: revision.naturalWidth, naturalHeight: revision.naturalHeight, mimeType: revision.mimeType, bytes });
      await (ctx as any).runMutation(completeRef, {
        jobId: args.jobId,
        pageRevision: revision.revision,
        regions: regions.map((region: any) => ({ ...region, id: region.id, pageId: String(input.page._id), revision: revision.revision })),
        provider: selection.provider === "aws_bda" ? "aws_bda" : "fake",
        adapterVersion: DOCUMENT_ANALYZER_ADAPTER_VERSION,
        latencyMs: Date.now() - started,
        usage: { regionCount: regions.length, pageRevision: revision.revision, providerEnabled: selection.enabled },
      });
      return args.jobId;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Document analysis failed";
      const retryable = !/stale|unsupported|exceeds|unavailable|not installed/i.test(message);
      await (ctx as any).runMutation(failRef, { jobId: args.jobId, errorCode: retryable ? "ANALYSIS_RETRYABLE" : "ANALYSIS_FAILED", errorMessage: message, retryable });
      return args.jobId;
    }
  },
});
