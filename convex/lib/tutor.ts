/** Provider metadata allowed to cross the persistence/client boundary. */
export function normalizeTutorMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = metadata as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  if (value.provider === "bedrock" || value.provider === "fake") output.provider = value.provider;
  if (typeof value.model === "string" && value.model.trim()) output.model = value.model.trim().slice(0, 200);
  if (typeof value.promptVersion === "string" && value.promptVersion.trim()) output.promptVersion = value.promptVersion.trim().slice(0, 100);
  if (typeof value.latencyMs === "number" && Number.isFinite(value.latencyMs)) output.latencyMs = Math.max(0, Math.round(value.latencyMs));
  if (value.fallbackUsed === true) output.fallbackUsed = true;
  if (value.fallbackProvider === "fake") output.fallbackProvider = "fake";
  if (typeof value.fallbackReason === "string") output.fallbackReason = value.fallbackReason.slice(0, 500);
  if (value.usage && typeof value.usage === "object") {
    const usage: Record<string, number> = {};
    const source = value.usage as Record<string, unknown>;
    for (const key of ["inputTokens", "outputTokens", "totalTokens"]) {
      if (typeof source[key] === "number" && Number.isFinite(source[key])) usage[key] = Math.max(0, Math.floor(source[key]));
    }
    if (Object.keys(usage).length > 0) output.usage = usage;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

