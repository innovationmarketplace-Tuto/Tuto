import type { PageRegion } from "../domain/regions";
import type { TutorAnnotation } from "../domain/annotations";
import { novaBoxFromRegion } from "./bda-geometry";
import { parseStructuredJson } from "./validation";

export type NovaSemanticArtifact = {
  regionId: string;
  transcription?: string;
  latex?: string;
  confidence?: number;
};

export type NovaSemanticMapping = {
  status: "used" | "unavailable";
  transcription: string;
  latex: string;
  artifacts: NovaSemanticArtifact[];
  annotations: TutorAnnotation[];
  warnings: string[];
  modelId?: string;
};

export type NovaMappingInput = {
  image?: Uint8Array;
  question?: string;
  regions: readonly PageRegion[];
  pageId: string;
};

export type NovaInvokeRequest = {
  modelId: string;
  image?: Uint8Array;
  prompt: string;
  maxTokens: number;
  temperature: number;
};

export type NovaInvoker = (request: NovaInvokeRequest) => Promise<unknown>;

export type NovaSemanticMapperLike = {
  map(input: NovaMappingInput): Promise<NovaSemanticMapping>;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function textFromProviderResponse(value: unknown): unknown {
  const response = object(value);
  const content = object(response?.output)?.message;
  const blocks = Array.isArray(content && (content as Record<string, unknown>).content)
    ? (content as Record<string, unknown>).content as unknown[]
    : [];
  const tool = blocks.map(object).find((item) => object(item?.toolUse)?.input !== undefined);
  if (tool) return object(tool.toolUse)?.input;
  return blocks.map((item) => object(item)?.text).filter((item): item is string => typeof item === "string").join("\n");
}

function normalizeLatex(value: string): string {
  return value
    .trim()
    .replace(/^```(?:latex|tex)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^\s*\$\$?\s*/, "")
    .replace(/\s*\$\$?\s*$/, "")
    .replace(/^\s*\\\(\s*/, "")
    .replace(/\s*\\\)\s*$/, "")
    .trim();
}

export function fallbackLatex(text: string): string {
  return text
    .replace(/×/g, "\\times ")
    .replace(/·/g, "\\cdot ")
    .replace(/÷/g, "\\div ")
    .replace(/≤/g, "\\le ")
    .replace(/≥/g, "\\ge ")
    .replace(/≠/g, "\\ne ")
    .trim();
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function catalog(regions: readonly PageRegion[]): string {
  return [...regions]
    .filter((region) => region.kind !== "term")
    .sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x || left.id.localeCompare(right.id))
    .slice(0, 160)
    .map((region) => `${region.id} kind=${region.kind} box=[${novaBoxFromRegion(region).join(",")}] text=${JSON.stringify(region.transcription ?? "")}`)
    .join("\n");
}

function validArtifacts(value: unknown, regions: readonly PageRegion[]): NovaSemanticArtifact[] {
  const known = new Set(regions.map((region) => region.id));
  const payload = object(value);
  const candidateValue = Array.isArray(value)
    ? value
    : Array.isArray(payload?.artifacts)
      ? payload.artifacts
      : Array.isArray(payload?.regions)
        ? payload.regions
        : payload?.artifacts && object(payload.artifacts)
          ? Object.entries(payload.artifacts).map(([regionId, artifact]) => ({ ...(object(artifact) ?? {}), regionId }))
          : payload?.regions && object(payload.regions)
            ? Object.entries(payload.regions).map(([regionId, artifact]) => ({ ...(object(artifact) ?? {}), regionId }))
            : [];
  const candidates = candidateValue;
  return candidates.flatMap((candidate) => {
    const item = object(candidate);
    const regionId = string(item?.regionId ?? item?.region_id ?? item?.id);
    const transcription = string(item?.transcription ?? item?.text ?? item?.message);
    const latex = string(item?.latex ?? item?.LaTeX ?? item?.tex ?? item?.math);
    const normalizedLatex = latex ? normalizeLatex(latex) : "";
    // Prose regions are valid semantic output even when Nova correctly has no
    // mathematical LaTeX to return. Keeping their transcription is important:
    // the tutor's worksheet context is otherwise reduced to an empty
    // full-page region and the canonical image becomes the only remaining
    // grounding signal.
    if (!regionId || !known.has(regionId) || (!normalizedLatex && !transcription)) return [];
    return [{
      regionId,
      ...(normalizedLatex ? { latex: normalizedLatex } : {}),
      ...(transcription ? { transcription } : {}),
      confidence: number(item?.confidence),
    }];
  });
}

function validAnnotations(value: unknown, regions: readonly PageRegion[], pageId: string): TutorAnnotation[] {
  const known = new Set(regions.map((region) => region.id));
  const candidates = Array.isArray(value) ? value : object(value)?.annotations;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate, index) => {
    const item = object(candidate);
    const targetRegionId = string(item?.targetRegionId ?? item?.regionId ?? item?.region_id);
    const kind = item?.kind ?? item?.type;
    if (!targetRegionId || !known.has(targetRegionId) || !["highlight", "circle", "underline", "arrow", "focus", "label"].includes(String(kind))) return [];
    return [{
      id: string(item?.id) ?? `nova-annotation-${String(index + 1).padStart(3, "0")}`,
      pageId,
      targetRegionId,
      messageId: string(item?.messageId) ?? "nova-message-001",
      kind: kind as TutorAnnotation["kind"],
      label: string(item?.label),
    }];
  });
}

/** Normalize a Nova result while discarding any raw response fields. */
export function mapNovaResponse(
  raw: unknown,
  input: Pick<NovaMappingInput, "regions" | "pageId">,
): NovaSemanticMapping {
  const parsed = parseStructuredJson(textFromProviderResponse(raw)) ?? object(raw);
  if (!parsed) {
    return { status: "unavailable", transcription: "", latex: "", artifacts: [], annotations: [], warnings: ["Nova returned no structured semantic output."] };
  }
  const nested = object(parsed.result) ?? parsed;
  const artifacts = validArtifacts(nested.regions ?? nested.artifacts, input.regions);
  const transcription = string(nested.transcription ?? nested.text ?? nested.message)
    ?? artifacts.map((artifact) => artifact.transcription ?? artifact.latex).filter(Boolean).join("\n");
  const latex = normalizeLatex(string(nested.latex ?? nested.LaTeX ?? nested.math)
    ?? artifacts.map((artifact) => artifact.latex).filter(Boolean).join("\n"));
  const annotations = validAnnotations(nested.annotations, input.regions, input.pageId);
  const warnings: string[] = [];
  if (artifacts.length === 0) warnings.push("Nova returned no valid region-referenced LaTeX artifacts.");
  if (nested.annotations !== undefined && annotations.length === 0) warnings.push("Nova annotations did not reference valid page-region IDs.");
  return { status: "used", transcription, latex, artifacts, annotations, warnings };
}

function prompt(input: NovaMappingInput): string {
  return [
    "You are the semantic pass for a handwritten mathematics page.",
    "BDA region text is a noisy hint. Inspect the supplied page image and correct transcription, but do not solve or silently correct the student's work.",
    "Return exactly one JSON object with transcription, latex, and regions. Every region entry must reference an existing regionId from the catalog. Do not return coordinates.",
    "Use actual LaTeX; preserve visible fractions, signs, scripts, crossed-out work, and uncertainty.",
    input.question ? `Focus: ${input.question}` : "Focus: transcribe the complete page.",
    `Region catalog (Nova [0,1000] reference boxes):\n${catalog(input.regions) || "(none)"}`,
  ].join("\n\n");
}

export type NovaSemanticMapperConfig = {
  modelId?: string;
  region?: string;
  maxTokens?: number;
  temperature?: number;
  invoke?: NovaInvoker;
};

function serverRegion(): string | undefined {
  return typeof process === "undefined" ? undefined : process.env.AWS_REGION;
}

function configuredNovaModel(): string | undefined {
  return typeof process === "undefined" ? undefined : process.env.NOVA_MODEL_ID;
}

async function defaultNovaInvoker(config: NovaSemanticMapperConfig): Promise<NovaInvoker> {
  const load = new Function("moduleName", "return import(moduleName)") as (
    moduleName: string,
  ) => Promise<Record<string, any>>;
  const sdk = await load("@aws-sdk/client-bedrock-runtime");
  const client = new sdk.BedrockRuntimeClient({ region: config.region ?? serverRegion() });
  return async (request) => {
    const content: Record<string, unknown>[] = [];
    if (request.image) content.push({ image: { format: "jpeg", source: { bytes: request.image } } });
    content.push({ text: request.prompt });
    const command = new sdk.ConverseCommand({
      modelId: request.modelId,
      messages: [{ role: "user", content }],
      inferenceConfig: { maxTokens: request.maxTokens, temperature: request.temperature },
    });
    return await client.send(command);
  };
}

export class NovaSemanticMapper implements NovaSemanticMapperLike {
  private readonly config: NovaSemanticMapperConfig;
  private invokePromise?: Promise<NovaInvoker>;
  readonly modelId: string;

  constructor(config: NovaSemanticMapperConfig = {}) {
    this.config = config;
    this.modelId = config.modelId ?? configuredNovaModel() ?? "us.amazon.nova-2-lite-v1:0";
  }

  private invoke(): Promise<NovaInvoker> {
    if (this.config.invoke) return Promise.resolve(this.config.invoke);
    this.invokePromise ??= defaultNovaInvoker(this.config);
    return this.invokePromise;
  }

  async map(input: NovaMappingInput): Promise<NovaSemanticMapping> {
    if (!input.image) return { status: "unavailable", transcription: "", latex: "", artifacts: [], annotations: [], warnings: ["Nova semantic pass skipped because no canonical image bytes were supplied."], modelId: this.modelId };
    try {
      const raw = await (await this.invoke())({
        modelId: this.modelId,
        image: input.image,
        prompt: prompt(input),
        maxTokens: this.config.maxTokens ?? 5_000,
        temperature: this.config.temperature ?? 0.02,
      });
      return { ...mapNovaResponse(raw, input), modelId: this.modelId };
    } catch {
      return { status: "unavailable", transcription: "", latex: "", artifacts: [], annotations: [], warnings: ["Nova semantic pass unavailable."], modelId: this.modelId };
    }
  }
}

export function createNovaSemanticMapper(config: NovaSemanticMapperConfig = {}): NovaSemanticMapper {
  return new NovaSemanticMapper(config);
}
