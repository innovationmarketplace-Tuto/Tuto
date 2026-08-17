import { BedrockRuntimeClient, ConverseCommand, type ContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { Annotation, Region, SemanticArtifact } from "./types.js";
import { getRegion, regionCatalog } from "./geometry.js";
import { createRegionGuideImage } from "./image.js";

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION,
});

function novaModelId(configured?: string): string {
  const modelId = configured ?? process.env.NOVA_MODEL_ID ?? "us.amazon.nova-2-lite-v1:0";
  // Nova 2 Lite has no US in-region on-demand path. Keep old deployments that
  // still have the base ID in their environment working after a code update.
  if (modelId === "amazon.nova-2-lite-v1:0" && (process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "").startsWith("us-")) {
    return "us.amazon.nova-2-lite-v1:0";
  }
  return modelId;
}

export interface NovaResult {
  status: "used" | "unavailable";
  transcription: string;
  latex: string;
  artifacts: SemanticArtifact[];
  annotations: Annotation[];
  rawText?: string;
  modelId?: string;
  stopReason?: string;
  warnings: string[];
}

function textFromContent(content: ContentBlock[] | undefined): string {
  return (content ?? [])
    .flatMap((block) => ("text" in block && block.text ? [block.text] : []))
    .join("\n")
    .trim();
}

function toolInputFromContent(content: ContentBlock[] | undefined): unknown {
  for (const block of content ?? []) {
    if ("toolUse" in block && block.toolUse?.input !== undefined) return block.toolUse.input;
  }
  return undefined;
}

type NovaPayload = Record<string, unknown>;

function objectPayload(value: unknown): NovaPayload | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as NovaPayload;
  if (typeof value !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as NovaPayload : undefined;
  } catch {
    return undefined;
  }
}

function parseFallbackJson(rawText: string): NovaPayload | undefined {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? rawText;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return objectPayload(fenced.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function field(payload: NovaPayload | undefined, ...names: string[]): unknown {
  for (const name of names) {
    if (payload?.[name] !== undefined) return payload[name];
  }
  return undefined;
}

function nestedPayload(payload: NovaPayload | undefined): NovaPayload | undefined {
  const nested = field(payload, "output", "result", "document");
  return objectPayload(nested) ?? payload;
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
    .replace(/^\s*\\\[\s*/, "")
    .replace(/\s*\\\]\s*$/, "")
    .trim();
}

function validSemanticArtifacts(value: unknown, regions: Region[]): SemanticArtifact[] {
  const objectValue = objectPayload(value);
  const candidates = Array.isArray(value)
    ? value
    : Array.isArray(objectValue?.artifacts)
      ? objectValue.artifacts
      : objectValue
        ? Object.entries(objectValue).map(([regionId, artifact]) => ({ ...(objectPayload(artifact) ?? {}), regionId }))
        : undefined;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const regionIdValue = item.regionId ?? item.region_id ?? item.regionID ?? item.id;
    const regionId = typeof regionIdValue === "string" ? regionIdValue : "";
    const latexValue = item.latex ?? item.LaTeX ?? item.tex ?? item.math;
    const latex = typeof latexValue === "string" ? normalizeLatex(latexValue) : "";
    if (!getRegion(regions, regionId) || !latex) return [];
    return [{
      regionId,
      transcription: typeof (item.transcription ?? item.text ?? item.message) === "string" ? String(item.transcription ?? item.text ?? item.message).trim() : undefined,
      latex,
      confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : undefined,
    } satisfies SemanticArtifact];
  });
}

function fallbackArtifactsFromText(text: string, regions: Region[]): SemanticArtifact[] {
  const targets = regions.filter((region) => region.kind === "line");
  const parts = text.split(/\r?\n/).map((part) => normalizeLatex(part)).filter(Boolean);
  if (parts.length === 0) return [];
  if (targets.length > 0 && parts.length <= targets.length) {
    return parts.map((latex, index) => ({ regionId: targets[index]!.id, transcription: latex, latex }));
  }
  const target = targets[0] ?? regions.find((region) => region.kind === "page");
  return target ? [{ regionId: target.id, transcription: text.trim(), latex: normalizeLatex(text) }] : [];
}

function lineArtifactsFromPageLatex(latex: string, regions: Region[]): SemanticArtifact[] {
  const targets = regions.filter((region) => region.kind === "line");
  const parts = latex.split(/\r?\n/).map((part) => normalizeLatex(part)).filter(Boolean);
  if (targets.length === 0 || parts.length < 2 || parts.length > targets.length) return [];
  return parts.map((part, index) => ({
    regionId: targets[index]!.id,
    transcription: part,
    latex: part,
  }));
}

function validAnnotations(value: unknown, regions: Region[]): Annotation[] {
  const candidates = Array.isArray(value) ? value : objectPayload(value)?.annotations;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const regionIdValue = item.regionId ?? item.region_id ?? item.regionID ?? item.id;
    const regionId = typeof regionIdValue === "string" ? regionIdValue : "";
    const type = item.type ?? item.kind;
    if (!getRegion(regions, regionId) || !["highlight", "circle", "underline", "arrow", "focus"].includes(String(type))) return [];
    return [{
      type: type as Annotation["type"],
      regionId,
      label: typeof item.label === "string" ? item.label : undefined,
      reason: typeof item.reason === "string" ? item.reason : undefined,
      confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : undefined,
    } satisfies Annotation];
  });
}

function prompt(question: string, regions: Region[]): string {
  return [
    "You are the authoritative transcription pass for a handwritten notebook page.",
    "The first image is the original page. The second image is the same page with deterministic region IDs drawn on top of it. BDA text in the catalog is a noisy hint, not ground truth.",
    "Inspect the original pixels yourself and correct BDA's text whenever it disagrees with the page. Transcribe only what is visibly present, in reading order. Preserve mathematical symbols, operators, superscripts, subscripts, stacked fractions, crossed-out text, and uncertainty as written.",
    "Do not decide what is right or wrong. Do not correct, solve, normalize, or silently reinterpret the student's work.",
    "The latex field is required. Return actual LaTeX fragments, not Unicode math and not a prose description. Use \\frac{...}{...} for visible stacked fractions, ^{...} and _{...} for scripts, \\sqrt{...} for roots, and standard LaTeX operators. Preserve a handwritten fraction's numerator and denominator exactly; never turn it into a decimal or solve it.",
    "Geometry must come from the supplied region catalog.",
    "Do not invent coordinates. Choose regionId values exactly from the catalog.",
    "Return one compact region entry for every line region, using its exact regionId. Do not return word entries or annotations in this pass.",
    "Return only one JSON object, with no markdown or preamble, using exactly these keys: transcription, latex, regions. Each regions entry must have regionId and latex, and may have transcription. Example shape: {\"transcription\":\"...\",\"latex\":\"...\",\"regions\":[{\"regionId\":\"line-001\",\"transcription\":\"...\",\"latex\":\"...\"}]}",
    question ? `Optional extraction focus: ${question}` : "Extraction focus: transcribe everything visible on this page.",
    "Region catalog (boxes use Nova's 0-1000 convention, for reference only):",
    regionCatalog(regions),
  ].join("\n\n");
}

export async function analyzeWithNova(input: {
  image: Buffer;
  question: string;
  regions: Region[];
  modelId?: string;
}): Promise<NovaResult> {
  const modelId = novaModelId(input.modelId);
  const warnings: string[] = [];
  try {
    const novaRegions = input.regions.filter((region) => region.kind === "line" || region.kind === "page");
    const guideImage = await createRegionGuideImage(input.image, novaRegions);
    const messages = [{
      role: "user" as const,
      content: [
        { image: { format: "jpeg" as const, source: { bytes: input.image } } },
        { image: { format: "jpeg" as const, source: { bytes: guideImage } } },
        { text: prompt(input.question, novaRegions) },
      ],
    }];
    const inferenceConfig = { maxTokens: Number(process.env.NOVA_MAX_TOKENS ?? 5000), temperature: 0.02 };
    let response = await client.send(new ConverseCommand({
      modelId,
      messages: [...messages, { role: "assistant" as const, content: [{ text: "{" }] }],
      inferenceConfig,
    }));
    if (response.stopReason === "max_tokens") {
      warnings.push("Nova reached the output limit; retrying with line-only JSON.");
      response = await client.send(new ConverseCommand({
        modelId,
        messages: [{
          role: "user",
          content: [
            { image: { format: "jpeg", source: { bytes: input.image } } },
            { image: { format: "jpeg", source: { bytes: guideImage } } },
            { text: `Read the original handwritten page. Correct the noisy OCR. Return ONLY compact valid JSON with a page-level LaTeX string and one LaTeX entry per line region. Use \\frac{...}{...} for fractions. Shape: {"latex":"...","regions":[{"regionId":"line-001","latex":"..."}]}\n\n${regionCatalog(novaRegions)}` },
          ],
        }, { role: "assistant", content: [{ text: "{" }] }],
        inferenceConfig,
      }));
    }

    const content = response.output?.message?.content;
    const modelText = textFromContent(content);
    const responseText = modelText.trimStart().startsWith("{") ? modelText : `{${modelText}`;
    const toolInputValue = toolInputFromContent(content);
    const toolInput = objectPayload(toolInputValue);
    const rawText = modelText || (toolInputValue === undefined ? undefined : JSON.stringify(toolInputValue));
    const fallback = toolInput ? undefined : parseFallbackJson(responseText) ?? parseFallbackJson(modelText);
    const payload = nestedPayload(toolInput ?? fallback);
    const transcriptionValue = field(payload, "transcription", "message", "text", "pageText", "page_text", "plainText");
    const latexValue = field(payload, "latex", "LaTeX", "tex", "math", "pageLatex", "page_latex", "pageLatexTranscription");
    const artifactsValue = field(payload, "artifacts", "regions", "items", "elements", "lineArtifacts", "line_artifacts");
    const annotationsValue = field(payload, "annotations", "highlights");
    const artifacts = validSemanticArtifacts(artifactsValue, input.regions);
    const annotations = validAnnotations(annotationsValue, input.regions);
    if (response.stopReason && response.stopReason !== "end_turn") warnings.push(`Nova structured output stopped with reason: ${response.stopReason}.`);
    let transcription = typeof transcriptionValue === "string" ? transcriptionValue.trim() : "";
    let latex = typeof latexValue === "string" ? normalizeLatex(latexValue) : "";
    if (!transcription && modelText) transcription = modelText;
    if (!latex && modelText) {
      latex = normalizeLatex(modelText);
      warnings.push("Nova returned unstructured text instead of the requested JSON output; it was preserved as the LaTeX candidate.");
    }
    if (artifacts.length === 0 && responseText && !fallback) artifacts.push(...fallbackArtifactsFromText(responseText, input.regions));
    if (artifacts.length === 0 && latex) {
      const lineArtifacts = lineArtifactsFromPageLatex(latex, input.regions);
      if (lineArtifacts.length > 0) {
        artifacts.push(...lineArtifacts);
        warnings.push(`Nova returned page LaTeX without region artifacts; split it across ${lineArtifacts.length} BDA line regions.`);
      } else {
        const target = input.regions.find((region) => region.kind === "line") ?? input.regions.find((region) => region.kind === "page");
        if (target) {
          artifacts.push({ regionId: target.id, transcription: transcription || latex, latex });
          warnings.push(`Nova returned page LaTeX without region artifacts; it was attached to ${target.id}.`);
        }
      }
    }
    if (artifacts.length === 0) warnings.push("Nova returned no valid LaTeX artifacts; no Nova text could be attached to a page region.");
    if (annotationsValue !== undefined && annotations.length === 0) warnings.push("Nova returned annotations without valid region IDs; deterministic geometry remains available.");
    return {
      status: "used",
      modelId,
      transcription,
      latex,
      artifacts,
      annotations,
      rawText,
      stopReason: response.stopReason,
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "unavailable",
      modelId,
      transcription: "",
      latex: "",
      artifacts: [],
      annotations: [],
      warnings: [`Nova unavailable: ${message}`],
    };
  }
}
