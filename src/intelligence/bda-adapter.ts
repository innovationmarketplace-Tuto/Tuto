import type { DocumentAnalysisInput, DocumentAnalyzer, AnalyzedPage } from "./contracts";
import { DOCUMENT_ANALYZER_ADAPTER_VERSION } from "./contracts";
import { describeBdaPayloadShape, detectedTranscription, regionsFromBda } from "./bda-geometry";
import { fallbackLatex, NovaSemanticMapper, type NovaSemanticMapperConfig, type NovaSemanticMapperLike } from "./nova-mapper";
import { groupPageRegions } from "./region-grouping";

const MAX_SYNC_IMAGE_BYTES = 5_000_000;

export type BdaInvokeRequest = {
  projectArn: string;
  profileArn: string;
  stage: "LIVE" | "DEVELOPMENT";
  bytes: Uint8Array;
};

export type BdaInvoker = (request: BdaInvokeRequest) => Promise<unknown>;

export type AwsBdaDocumentAnalyzerConfig = {
  projectArn: string;
  profileArn: string;
  stage?: "LIVE" | "DEVELOPMENT";
  region?: string;
  invoke?: BdaInvoker;
  semanticMapper?: NovaSemanticMapperLike;
  nova?: NovaSemanticMapperConfig;
};

function bytesFromBase64(value: string): Uint8Array {
  const decode = (globalThis as { atob?: (input: string) => string }).atob;
  if (!decode) throw new Error("Base64 decoding is unavailable in this runtime.");
  const binary = decode(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Summarize a raw BDA response's shape for logs without dumping full OCR text. */
function describeRawShape(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return `typeof=${typeof raw}`;
  const record = raw as Record<string, unknown>;
  const segments = Array.isArray(record.outputSegments) ? record.outputSegments : [];
  const segmentShapes = segments.map((segment) => {
    const item = (segment && typeof segment === "object" ? segment : {}) as Record<string, unknown>;
    const standardOutput = typeof item.standardOutput === "string" ? item.standardOutput.length : undefined;
    const customOutput = typeof item.customOutput === "string" ? item.customOutput.length : undefined;
    return `{standardOutputChars=${standardOutput ?? "none"}, customOutputChars=${customOutput ?? "none"}}`;
  });
  return `topLevelKeys=[${Object.keys(record).join(",")}] outputSegments=[${segmentShapes.join(", ")}]`;
}

function imageBytes(input: DocumentAnalysisInput): Uint8Array {
  if (input.image.bytes && input.image.bytes.byteLength > 0) return input.image.bytes;
  if (input.image.base64) return bytesFromBase64(input.image.base64);
  if (input.image.dataUrl) {
    const match = input.image.dataUrl.match(/^data:image\/(?:jpeg|jpg|png);base64,(.+)$/i);
    if (!match) throw new Error("Canonical image dataUrl must be a base64 JPEG or PNG.");
    return bytesFromBase64(match[1]!);
  }
  throw new Error("A canonical image byte payload is required for BDA analysis.");
}

async function defaultBdaInvoker(config: AwsBdaDocumentAnalyzerConfig): Promise<BdaInvoker> {
  const load = new Function("moduleName", "return import(moduleName)") as (
    moduleName: string,
  ) => Promise<Record<string, any>>;
  const sdk = await load("@aws-sdk/client-bedrock-data-automation-runtime");
  const client = new sdk.BedrockDataAutomationRuntimeClient({ region: config.region ?? process.env.AWS_REGION });
  return async (request) => {
    const command = new sdk.InvokeDataAutomationCommand({
      dataAutomationConfiguration: {
        dataAutomationProjectArn: request.projectArn,
        stage: request.stage,
      },
      dataAutomationProfileArn: request.profileArn,
      inputConfiguration: { bytes: request.bytes },
    });
    return await client.send(command);
  };
}

function mergeSemantic(
  regions: ReturnType<typeof regionsFromBda>["regions"],
  semantic: Awaited<ReturnType<NovaSemanticMapper["map"]>>,
): ReturnType<typeof regionsFromBda>["regions"] {
  const byId = new Map(semantic.artifacts.map((artifact) => [artifact.regionId, artifact]));
  return regions.map((region) => {
    const artifact = byId.get(region.id);
    if (!artifact) return region;
    return {
      ...region,
      transcription: artifact.transcription ?? region.transcription,
      latex: artifact.latex,
      confidence: artifact.confidence ?? region.confidence,
      source: "combined" as const,
    };
  });
}

/**
 * Synchronous BDA adapter. The SDK and raw response exist only inside this
 * class; callers receive normalized `AnalyzedPage` contracts.
 */
export class AwsBdaDocumentAnalyzer implements DocumentAnalyzer {
  private readonly config: AwsBdaDocumentAnalyzerConfig;
  private readonly semanticMapper?: NovaSemanticMapperLike;
  private invokePromise?: Promise<BdaInvoker>;

  constructor(config: AwsBdaDocumentAnalyzerConfig) {
    if (!config.projectArn || !config.profileArn) throw new Error("BDA project and profile ARNs are required.");
    this.config = config;
    this.semanticMapper = config.semanticMapper ?? (config.nova ? new NovaSemanticMapper(config.nova) : undefined);
  }

  private invoke(): Promise<BdaInvoker> {
    if (this.config.invoke) return Promise.resolve(this.config.invoke);
    this.invokePromise ??= defaultBdaInvoker(this.config);
    return this.invokePromise;
  }

  async analyze(input: DocumentAnalysisInput): Promise<AnalyzedPage[]> {
    const started = Date.now();
    // The client canonicalizes (EXIF-rotates, resizes, re-encodes) every
    // page before upload, so the bytes reaching this action already match
    // what BDA's OCR needs to see. See src/features/document-import/canonicalize.ts.
    const bytes = imageBytes(input);
    if (bytes.byteLength > MAX_SYNC_IMAGE_BYTES) throw new Error("Canonical image exceeds the 5 MB synchronous BDA limit.");
    const raw = await (await this.invoke())({
      projectArn: this.config.projectArn,
      profileArn: this.config.profileArn,
      stage: this.config.stage ?? "LIVE",
      bytes,
    });
    const geometry = regionsFromBda(raw, { pageId: input.page.id, revision: input.page.revision });
    if (geometry.lineCount === 0 && geometry.wordCount === 0) {
      console.warn(
        `[bda:geometry] page ${input.page.id} revision ${input.page.revision} had no line/word geometry. ` +
        `Raw BDA response shape: ${describeRawShape(raw)}. Parsed standard-output shape: ${describeBdaPayloadShape(raw)}`,
      );
      throw new Error("BDA returned no readable text geometry for this page.");
    }
    let regions = groupPageRegions(geometry.regions);
    const warnings: string[] = [];
    let transcription = detectedTranscription(regions);
    let latex = fallbackLatex(transcription);
    let annotations = [] as AnalyzedPage["annotations"];
    let semanticPass: "nova" | "none" = "none";
    if (this.semanticMapper) {
      const semantic = await this.semanticMapper.map({
        image: bytes,
        question: input.question,
        regions,
        pageId: input.page.id,
      });
      semanticPass = "nova";
      warnings.push(...semantic.warnings);
      if (semantic.status === "used") {
        regions = mergeSemantic(regions, semantic);
        transcription = semantic.transcription || transcription;
        latex = semantic.latex || latex;
        annotations = semantic.annotations;
      }
    }
    return [{
      pageId: input.page.id,
      revision: input.page.revision,
      regions,
      transcription: transcription || undefined,
      latex: latex || undefined,
      annotations,
      warnings,
      metadata: {
        provider: "aws_bda",
        adapterVersion: DOCUMENT_ANALYZER_ADAPTER_VERSION,
        latencyMs: Math.max(0, Date.now() - started),
        regionCount: regions.length,
        bdaLineCount: geometry.lineCount,
        bdaWordCount: geometry.wordCount,
        semanticPass,
      },
    }];
  }
}

export function createAwsBdaDocumentAnalyzer(config: AwsBdaDocumentAnalyzerConfig): DocumentAnalyzer {
  return new AwsBdaDocumentAnalyzer(config);
}

export { AwsBdaDocumentAnalyzer as BdaDocumentAnalyzer };
