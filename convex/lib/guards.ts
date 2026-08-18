const DAY_MS = 86_400_000;

export type InferenceKind = "tutor" | "document_analysis";
export type InferenceSettings = {
  globalEnabled: boolean;
  maxTutorPerUserPerDay: number;
  maxTutorGlobalPerDay: number;
  maxDocumentPerUserPerDay: number;
  maxDocumentGlobalPerDay: number;
  allowFakeFallback: boolean;
};

export const DEFAULT_INFERENCE_SETTINGS: InferenceSettings = {
  globalEnabled: true,
  maxTutorPerUserPerDay: 40,
  maxTutorGlobalPerDay: 200,
  maxDocumentPerUserPerDay: 10,
  maxDocumentGlobalPerDay: 50,
  allowFakeFallback: true,
};

export function dayBucket(nowMs = Date.now()): number {
  return Math.floor(nowMs / DAY_MS) * DAY_MS;
}

export function limitsFor(kind: InferenceKind, settings: InferenceSettings) {
  return kind === "tutor"
    ? { user: settings.maxTutorPerUserPerDay, global: settings.maxTutorGlobalPerDay }
    : { user: settings.maxDocumentPerUserPerDay, global: settings.maxDocumentGlobalPerDay };
}

export function assertInferenceEnabled(settings: InferenceSettings): void {
  if (!settings.globalEnabled) throw new Error("Inference is temporarily disabled");
}

export function assertWithinInferenceLimit(
  kind: InferenceKind,
  settings: InferenceSettings,
  currentUserCount: number,
  currentGlobalCount: number,
): void {
  assertInferenceEnabled(settings);
  const limits = limitsFor(kind, settings);
  if (currentUserCount >= limits.user) throw new Error(`${kind} per-user limit reached`);
  if (currentGlobalCount >= limits.global) throw new Error(`${kind} global limit reached`);
}

export function providerName(): "fake" | "aws_bda" {
  // Convex action code reads this server-side environment variable.  Keeping
  // the mapping here prevents clients from selecting an arbitrary provider.
  const env = typeof process !== "undefined" ? process.env : undefined;
  if (env?.DOCUMENT_ANALYSIS_KILL_SWITCH?.toLocaleLowerCase() === "true") return "fake";
  const configured = env?.DOCUMENT_ANALYSIS_PROVIDER?.toLocaleLowerCase();
  if (
    configured === "aws_bda" &&
    env?.AWS_REGION &&
    env.AWS_BDA_PROJECT_ARN &&
    env.AWS_BDA_PROFILE_ARN
  ) return "aws_bda";
  return "fake";
}
