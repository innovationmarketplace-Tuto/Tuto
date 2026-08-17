import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { BedrockDataAutomationRuntimeClient, InvokeDataAutomationCommand, type DataAutomationStage, type InvokeDataAutomationResponse } from "@aws-sdk/client-bedrock-data-automation-runtime";
import { randomUUID } from "node:crypto";
import { canonicalizeImage } from "./image.js";
import { regionsFromBda } from "./geometry.js";
import { analyzeWithNova } from "./nova.js";
import { detectedTranscription, documentOutput, fallbackLatex } from "./page-output.js";
import type { AnalyzeRequest, Annotation, AnalysisResult, Region, SemanticArtifact } from "./types.js";

const bda = new BedrockDataAutomationRuntimeClient({ region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION });

function response(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

function parseBody(event: APIGatewayProxyEventV2): AnalyzeRequest {
  if (!event.body) throw new Error("Request body is required.");
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  const parsed = JSON.parse(raw) as AnalyzeRequest;
  if (!parsed || typeof parsed !== "object") throw new Error("Request body must be a JSON object.");
  return parsed;
}

function decodeImage(request: AnalyzeRequest): { bytes: Buffer; mimeType: string } {
  if (request.imageDataUrl) {
    const match = request.imageDataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) throw new Error("imageDataUrl must be a base64 JPEG, PNG, WebP, or GIF data URL.");
    return { mimeType: match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase(), bytes: Buffer.from(match[2], "base64") };
  }
  if (request.imageBase64) {
    return { mimeType: request.mimeType ?? "image/jpeg", bytes: Buffer.from(request.imageBase64, "base64") };
  }
  throw new Error("Provide imageDataUrl or imageBase64.");
}

function mockNova(regions: Region[], question: string): { transcription: string; latex: string; artifacts: SemanticArtifact[]; annotations: Annotation[] } {
  const line = regions.find((region) => region.kind === "line") ?? regions.find((region) => region.kind === "page");
  const transcription = detectedTranscription(regions);
  const artifacts = regions
    .filter((region) => region.kind === "line" || region.kind === "word" || region.kind === "page")
    .map((region) => ({ regionId: region.id, transcription: region.ocrText, latex: fallbackLatex(region.ocrText ?? "") }))
    .filter((artifact) => artifact.latex);
  return {
    transcription: transcription || (question ? `Mock mode: page content for “${question}” is represented by the highlighted region.` : "Mock mode: no BDA transcription was available."),
    latex: fallbackLatex(transcription),
    artifacts,
    annotations: line ? [{ type: "highlight", regionId: line.id, reason: "Deterministic mock selection." }] : [],
  };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method === "OPTIONS") return response(204, null);
  if (event.requestContext.http.method !== "POST") return response(405, { error: "Use POST /analyze." });

  const requestId = randomUUID();
  try {
    const request = parseBody(event);
    const uploaded = decodeImage(request);
    if (uploaded.bytes.byteLength > 7_000_000) throw new Error("Request image is too large. Keep the upload under 7 MB.");
    const canonical = await canonicalizeImage(uploaded.bytes);
    let bdaResponse: InvokeDataAutomationResponse | undefined;
    let bdaError: string | undefined;
    try {
      const projectArn = process.env.BDA_PROJECT_ARN;
      const profileArn = process.env.BDA_PROFILE_ARN;
      if (!projectArn || !profileArn) throw new Error("BDA_PROJECT_ARN and BDA_PROFILE_ARN must be configured.");
      bdaResponse = await bda.send(new InvokeDataAutomationCommand({
        dataAutomationConfiguration: {
          dataAutomationProjectArn: projectArn,
          stage: (process.env.BDA_PROJECT_STAGE === "DEVELOPMENT" ? "DEVELOPMENT" : "LIVE") as DataAutomationStage,
        },
        dataAutomationProfileArn: profileArn,
        inputConfiguration: { bytes: canonical.bytes },
      }));
    } catch (error) {
      bdaError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }

    const standardOutput = bdaResponse?.outputSegments?.[0]?.standardOutput;
    const regions = regionsFromBda(standardOutput);

    const warnings: string[] = [];
    if (bdaError) warnings.push(`BDA unavailable; no text artifacts were returned. ${bdaError}`);
    const detectedPageText = detectedTranscription(regions);
    const question = request.question?.trim() ?? "";
    const provider = process.env.ANALYSIS_PROVIDER ?? "aws";
    let nova: AnalysisResult["providers"]["nova"];
    let transcription: string;
    let latex: string;
    let semanticArtifacts: SemanticArtifact[];
    let annotations: Annotation[];

    if (provider === "mock") {
      const mock = mockNova(regions, question);
      transcription = mock.transcription;
      latex = mock.latex;
      semanticArtifacts = mock.artifacts;
      annotations = mock.annotations;
      nova = { status: "mock", modelId: process.env.NOVA_MODEL_ID, artifactCount: mock.artifacts.length, latexAvailable: Boolean(mock.latex) };
    } else {
      const novaResult = await analyzeWithNova({ image: canonical.bytes, question, regions });
      transcription = novaResult.transcription || detectedPageText || "No readable page content was returned.";
      latex = novaResult.latex || fallbackLatex(transcription);
      semanticArtifacts = novaResult.artifacts;
      annotations = novaResult.annotations;
      warnings.push(...novaResult.warnings);
      if (novaResult.status === "unavailable") warnings.push("LaTeX is an emergency fallback because Nova was unavailable; BDA text is not authoritative.");
      if (novaResult.status === "used" && !novaResult.latex) warnings.push("Nova returned no page-level LaTeX; the API exposed a fallback string for debugging.");
      nova = { status: novaResult.status, modelId: novaResult.modelId, rawText: novaResult.rawText, stopReason: novaResult.stopReason, artifactCount: novaResult.artifacts.length, latexAvailable: Boolean(novaResult.latex) };

    }

    const lineCount = regions.filter((region) => region.kind === "line" && region.source === "bda").length;
    const wordCount = regions.filter((region) => region.kind === "word" && region.source === "bda").length;
    const artifactCount = regions.filter((region) => region.kind === "line" || region.kind === "word").length;
    const finalAnnotations = annotations.slice(0, Number(process.env.MAX_ANNOTATIONS ?? 12));
    const result: AnalysisResult = {
      requestId,
      message: transcription,
      annotations: finalAnnotations,
      regions,
      image: { width: canonical.width, height: canonical.height, mimeType: "image/jpeg" },
      document: documentOutput({ requestId, canonical, regions, transcription, latex, semanticArtifacts, annotations: finalAnnotations }),
      providers: {
        bda: { status: bdaError ? "unavailable" : "used", error: bdaError, segmentCount: bdaResponse?.outputSegments?.length ?? 0, artifactCount, lineCount, wordCount },
        nova,
      },
      warnings,
    };
    return response(200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error({ requestId, error: message });
    return response(400, { requestId, error: message });
  }
}
