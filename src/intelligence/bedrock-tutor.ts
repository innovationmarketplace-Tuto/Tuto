import type {
  TutorModel,
  TutorModelInput,
  TutorModelOutput,
  TutorCallMetadata,
  TutorUsage,
} from "./contracts";
import { FakeTutorModel } from "./fake-tutor";
import { buildTutorTurnPrompt, TUTOR_PROMPT_VERSION } from "./prompt";
import {
  estimateUsage,
  parseStructuredJson,
  StructuredOutputError,
  validateTutorResult,
  withTutorMetadata,
} from "./validation";

export const DEFAULT_BEDROCK_TUTOR_MODEL = "us.amazon.nova-2-lite-v1:0" as const;

export type BedrockConverseContent =
  | { text: string }
  | { image: { format: "jpeg" | "png"; source: { bytes: Uint8Array } } };

export type BedrockConverseRequest = {
  modelId: string;
  messages: { role: "user" | "assistant"; content: BedrockConverseContent[] }[];
  inferenceConfig: { temperature: number; maxTokens: number };
};

export type BedrockConverseResponse = {
  output?: {
    message?: {
      content?: {
        text?: string;
        toolUse?: { input?: unknown };
      }[];
    };
  };
  stopReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};

export type BedrockConverse = (
  request: BedrockConverseRequest,
) => Promise<BedrockConverseResponse>;

export type BedrockTutorConfig = {
  modelId?: string;
  region?: string;
  maxTokens?: number;
  temperature?: number;
  converse?: BedrockConverse;
  fallback?: TutorModel;
};

function usage(response: BedrockConverseResponse, reply: string): TutorUsage {
  const value = response.usage;
  return value && (value.inputTokens !== undefined || value.outputTokens !== undefined || value.totalTokens !== undefined)
    ? {
        inputTokens: value.inputTokens,
        outputTokens: value.outputTokens,
        totalTokens: value.totalTokens,
      }
    : estimateUsage(reply);
}

function modelText(response: BedrockConverseResponse): unknown {
  const content = response.output?.message?.content ?? [];
  const toolUse = content.find((part) => part.toolUse?.input !== undefined)?.toolUse?.input;
  if (toolUse !== undefined) return toolUse;
  return content.map((part) => part.text ?? "").join("\n").trim();
}

function nonEmpty(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

const annotationKinds = new Set(["highlight", "circle", "underline", "arrow", "focus", "label"]);

function normalizeModelPayload(value: unknown, input: TutorModelInput): unknown {
  const object = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  const nested = object?.result && typeof object.result === "object" && !Array.isArray(object.result)
    ? object.result as Record<string, unknown>
    : object;
  if (!nested) return value;
  const annotations = Array.isArray(nested.annotations)
    ? nested.annotations.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
        const candidate = item as Record<string, unknown>;
        const requestedKind = nonEmpty(candidate.kind ?? candidate.type, "focus");
        const kind = annotationKinds.has(requestedKind) ? requestedKind : "focus";
        const pageId = nonEmpty(candidate.pageId, input.artifactContext?.pageId ?? "");
        const targetRegionId = nonEmpty(
          candidate.targetRegionId ?? candidate.regionId,
          input.artifactContext?.activeRegionIds?.[0] ?? input.pageRegions?.[0]?.id ?? "",
        );
        // An annotation without a page/region cannot be rendered safely. Drop
        // just that annotation and keep an otherwise useful tutor response.
        if (!pageId || !targetRegionId) return undefined;
        const label = nonEmpty(candidate.label, "");
        return {
          id: nonEmpty(candidate.id, `bedrock-annotation-${String(index + 1).padStart(3, "0")}`),
          pageId,
          messageId: nonEmpty(candidate.messageId, `bedrock-message-${input.threadId}`),
          targetRegionId,
          kind,
          ...(label ? { label } : {}),
        };
      }).filter((item) => item !== undefined)
    : nested.annotations;
  return {
    reply: nested.reply,
    skillResolutions: nested.skillResolutions,
    candidateEvidence: nested.candidateEvidence,
    annotations,
    learnerFacts: nested.learnerFacts,
  };
}

function requestContent(input: TutorModelInput): BedrockConverseContent[] {
  const content: BedrockConverseContent[] = [];
  const image = input.image;
  if (image?.bytes && image.bytes.byteLength > 0) {
    content.push({
      image: {
        format: image.mimeType === "image/png" ? "png" : "jpeg",
        source: { bytes: image.bytes },
      },
    });
  }
  content.push({ text: buildTutorTurnPrompt(input) });
  return content;
}

async function defaultConverse(config: BedrockTutorConfig): Promise<BedrockConverse> {
  // Keep the SDK out of the client bundle and out of fake/test paths. Convex
  // Node actions provide the SDK at runtime and its default credential chain
  // reads server-side environment variables.
  const load = new Function("moduleName", "return import(moduleName)") as (
    moduleName: string,
  ) => Promise<Record<string, any>>;
  const sdk = await load("@aws-sdk/client-bedrock-runtime");
  const client = new sdk.BedrockRuntimeClient({ region: config.region ?? process.env.AWS_REGION });
  return async (request) => {
    const command = new sdk.ConverseCommand({
      modelId: request.modelId,
      messages: request.messages,
      inferenceConfig: request.inferenceConfig,
    });
    return await client.send(command) as BedrockConverseResponse;
  };
}

/**
 * Opt-in Bedrock tutor adapter. It never exposes the raw provider response;
 * malformed/failed calls return a deterministic fake result with explicit
 * fallback metadata so demos and persistence remain safe.
 */
export class BedrockTutorModel implements TutorModel {
  private readonly modelId: string;
  private readonly fallback: TutorModel;
  private readonly config: BedrockTutorConfig;
  private conversePromise?: Promise<BedrockConverse>;

  constructor(config: BedrockTutorConfig = {}) {
    this.config = config;
    this.modelId = config.modelId ?? DEFAULT_BEDROCK_TUTOR_MODEL;
    this.fallback = config.fallback ?? new FakeTutorModel();
  }

  private getConverse(): Promise<BedrockConverse> {
    if (this.config.converse) return Promise.resolve(this.config.converse);
    this.conversePromise ??= defaultConverse(this.config);
    return this.conversePromise;
  }

  private async fallbackResult(input: TutorModelInput, started: number, reason: string): Promise<TutorModelOutput> {
    const fake = await this.fallback.generateTurn(input);
    const fallbackMetadata: TutorCallMetadata = {
      provider: "bedrock",
      model: this.modelId,
      latencyMs: Math.max(0, Date.now() - started),
      promptVersion: TUTOR_PROMPT_VERSION,
      usage: fake.metadata?.usage,
      fallbackUsed: true,
      fallbackProvider: "fake",
      fallbackReason: reason.slice(0, 500),
    };
    return withTutorMetadata({
      reply: fake.reply,
      skillResolutions: fake.skillResolutions,
      candidateEvidence: fake.candidateEvidence,
      annotations: fake.annotations,
      learnerFacts: fake.learnerFacts,
    }, fallbackMetadata);
  }

  async generateTurn(input: TutorModelInput): Promise<TutorModelOutput> {
    const started = Date.now();
    try {
      const converse = await this.getConverse();
      const response = await converse({
        modelId: this.modelId,
        messages: [{ role: "user", content: requestContent(input) }],
        inferenceConfig: {
          temperature: this.config.temperature ?? 0.1,
          maxTokens: this.config.maxTokens ?? 2_000,
        },
      });
      if (response.stopReason === "max_tokens") {
        throw new StructuredOutputError("Bedrock tutor output reached the configured token limit.");
      }
      const parsed = parseStructuredJson(modelText(response));
      if (!parsed) throw new StructuredOutputError("Bedrock tutor returned no JSON object.");
      const normalized = normalizeModelPayload(parsed, input);
      const result = validateTutorResult(normalized, input);
      return withTutorMetadata(result, {
        provider: "bedrock",
        model: this.modelId,
        latencyMs: Math.max(0, Date.now() - started),
        promptVersion: TUTOR_PROMPT_VERSION,
        usage: usage(response, result.reply),
      });
    } catch (error) {
      const reason = error instanceof StructuredOutputError
        ? error.message
        : "Bedrock tutor invocation failed.";
      return await this.fallbackResult(input, started, reason);
    }
  }
}

export function createBedrockTutorModel(config: BedrockTutorConfig = {}): TutorModel {
  return new BedrockTutorModel(config);
}
