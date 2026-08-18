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

export const DEFAULT_OPENAI_TUTOR_MODEL = "gpt-5.6-luna" as const;
export const DEFAULT_OPENAI_REASONING_EFFORT = "low" as const;
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1" as const;

export type OpenAiReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export type OpenAiChatContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type OpenAiChatRequest = {
  model: string;
  messages: { role: "user" | "assistant"; content: OpenAiChatContent[] }[];
  temperature?: number;
  // Reasoning models (the gpt-5.x family) reject `max_tokens` and require
  // `max_completion_tokens`; there is no non-reasoning OpenAI tutor path.
  max_completion_tokens: number;
  response_format: { type: "json_object" };
  reasoning_effort?: OpenAiReasoningEffort;
};

export type OpenAiChatResponse = {
  choices?: {
    message?: { content?: string | null };
    finish_reason?: string;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type OpenAiChat = (request: OpenAiChatRequest) => Promise<OpenAiChatResponse>;

export type OpenAiTutorConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  /** Reasoning models ignore an explicit temperature, so set this to omit it. */
  reasoningEffort?: OpenAiReasoningEffort;
  chat?: OpenAiChat;
  fallback?: TutorModel;
};

function usage(response: OpenAiChatResponse, reply: string): TutorUsage {
  const value = response.usage;
  return value && (value.prompt_tokens !== undefined || value.completion_tokens !== undefined || value.total_tokens !== undefined)
    ? {
        inputTokens: value.prompt_tokens,
        outputTokens: value.completion_tokens,
        totalTokens: value.total_tokens,
      }
    : estimateUsage(reply);
}

function modelText(response: OpenAiChatResponse): string {
  return response.choices?.[0]?.message?.content ?? "";
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
          id: nonEmpty(candidate.id, `openai-annotation-${String(index + 1).padStart(3, "0")}`),
          pageId,
          messageId: nonEmpty(candidate.messageId, `openai-message-${input.threadId}`),
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
  };
}

function imageDataUrl(input: TutorModelInput): string | undefined {
  const image = input.image;
  if (!image?.bytes || image.bytes.byteLength === 0) return undefined;
  const base64 = Buffer.from(image.bytes).toString("base64");
  return `data:${image.mimeType};base64,${base64}`;
}

function requestContent(input: TutorModelInput): OpenAiChatContent[] {
  const content: OpenAiChatContent[] = [];
  const dataUrl = imageDataUrl(input);
  if (dataUrl) content.push({ type: "image_url", image_url: { url: dataUrl } });
  content.push({ type: "text", text: buildTutorTurnPrompt(input) });
  return content;
}

function defaultChat(config: OpenAiTutorConfig): OpenAiChat {
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI tutor adapter requires an API key.");
  const baseUrl = config.baseUrl ?? DEFAULT_OPENAI_BASE_URL;
  return async (request) => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error(`OpenAI tutor request failed with status ${response.status}.`);
    }
    return await response.json() as OpenAiChatResponse;
  };
}

/**
 * Opt-in OpenAI tutor adapter for conversational tutor turns. It never
 * exposes the raw provider response; malformed/failed calls return a
 * deterministic fake result with explicit fallback metadata so demos and
 * persistence remain safe. Document/page extraction stays on the Bedrock/BDA
 * pipeline regardless of this provider's availability.
 */
export class OpenAiTutorModel implements TutorModel {
  private readonly model: string;
  private readonly reasoningEffort: OpenAiReasoningEffort;
  private readonly fallback: TutorModel;
  private readonly config: OpenAiTutorConfig;
  private chatFn?: OpenAiChat;

  constructor(config: OpenAiTutorConfig = {}) {
    this.config = config;
    this.model = config.model ?? DEFAULT_OPENAI_TUTOR_MODEL;
    this.reasoningEffort = config.reasoningEffort ?? DEFAULT_OPENAI_REASONING_EFFORT;
    this.fallback = config.fallback ?? new FakeTutorModel();
  }

  private getChat(): OpenAiChat {
    this.chatFn ??= this.config.chat ?? defaultChat(this.config);
    return this.chatFn;
  }

  private async fallbackResult(input: TutorModelInput, started: number, reason: string): Promise<TutorModelOutput> {
    const fake = await this.fallback.generateTurn(input);
    const fallbackMetadata: TutorCallMetadata = {
      provider: "openai",
      model: this.model,
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
    }, fallbackMetadata);
  }

  async generateTurn(input: TutorModelInput): Promise<TutorModelOutput> {
    const started = Date.now();
    try {
      const chat = this.getChat();
      const response = await chat({
        model: this.model,
        messages: [{ role: "user", content: requestContent(input) }],
        // Reasoning models reject a non-default temperature, so it is only
        // sent when the caller explicitly overrides the reasoning effort.
        ...(this.config.temperature !== undefined ? { temperature: this.config.temperature } : {}),
        max_completion_tokens: this.config.maxTokens ?? 2_000,
        response_format: { type: "json_object" },
        reasoning_effort: this.reasoningEffort,
      });
      if (response.choices?.[0]?.finish_reason === "length") {
        throw new StructuredOutputError("OpenAI tutor output reached the configured token limit.");
      }
      const parsed = parseStructuredJson(modelText(response));
      if (!parsed) throw new StructuredOutputError("OpenAI tutor returned no JSON object.");
      const normalized = normalizeModelPayload(parsed, input);
      const result = validateTutorResult(normalized, input);
      return withTutorMetadata(result, {
        provider: "openai",
        model: this.model,
        latencyMs: Math.max(0, Date.now() - started),
        promptVersion: TUTOR_PROMPT_VERSION,
        usage: usage(response, result.reply),
      });
    } catch (error) {
      const reason = error instanceof StructuredOutputError
        ? error.message
        : error instanceof Error
          ? error.message
          : "OpenAI tutor invocation failed.";
      return await this.fallbackResult(input, started, reason);
    }
  }
}

export function createOpenAiTutorModel(config: OpenAiTutorConfig = {}): TutorModel {
  return new OpenAiTutorModel(config);
}
