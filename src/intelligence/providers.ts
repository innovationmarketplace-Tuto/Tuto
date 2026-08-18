import type { DocumentAnalyzer, TutorModel } from "./contracts";
import { BedrockTutorModel, type BedrockConverse } from "./bedrock-tutor";
import { OpenAiTutorModel, type OpenAiChat, type OpenAiReasoningEffort } from "./openai-tutor";
import { FakeTutorModel } from "./fake-tutor";
import { AwsBdaDocumentAnalyzer, type BdaInvoker } from "./bda-adapter";
import { FakeDocumentAnalyzer } from "./fake-document-analyzer";
import { NovaSemanticMapper, type NovaInvoker } from "./nova-mapper";

export type ProviderEnv = Record<string, string | undefined>;

export type ProviderSelection<T> = {
  provider: "fake" | "bedrock" | "openai" | "aws_bda";
  enabled: boolean;
  reason?: string;
  model: T;
};

function serverEnv(): ProviderEnv {
  return typeof process === "undefined" ? {} : process.env;
}

function hasServerCredentials(env: ProviderEnv): boolean {
  // Convex may use access keys or an AWS workload role. Never forward these
  // values to a client; this helper is server-side selection only.
  return Boolean(
    (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)
      || env.AWS_WEB_IDENTITY_TOKEN_FILE
      || env.AWS_ROLE_ARN
      || env.AWS_PROFILE,
  );
}

const REASONING_EFFORTS = new Set<OpenAiReasoningEffort>(["none", "low", "medium", "high", "xhigh", "max"]);

function asReasoningEffort(value: string | undefined): OpenAiReasoningEffort | undefined {
  return value && REASONING_EFFORTS.has(value as OpenAiReasoningEffort) ? value as OpenAiReasoningEffort : undefined;
}

export type TutorProviderOptions = {
  converse?: BedrockConverse;
  chat?: OpenAiChat;
};

export function selectTutorProvider(
  env: ProviderEnv = serverEnv(),
  options: TutorProviderOptions = {},
): ProviderSelection<TutorModel> {
  const fake = new FakeTutorModel();
  const provider = (env.TUTOR_MODEL_PROVIDER ?? "fake").toLocaleLowerCase();
  if (provider === "openai") {
    if (!env.OPENAI_API_KEY && !options.chat) {
      return {
        provider: "fake",
        enabled: false,
        model: fake,
        reason: "OpenAI is opt-in and requires OPENAI_API_KEY (or an injected server invoker).",
      };
    }
    return {
      provider: "openai",
      enabled: true,
      model: new OpenAiTutorModel({
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL,
        baseUrl: env.OPENAI_BASE_URL,
        reasoningEffort: asReasoningEffort(env.OPENAI_REASONING_EFFORT),
        chat: options.chat,
      }),
    };
  }
  if (provider !== "bedrock") {
    return { provider: "fake", enabled: true, model: fake, reason: "fake provider is the safe default" };
  }
  if (!env.TUTOR_MODEL_ID || !env.AWS_REGION || (!hasServerCredentials(env) && !options.converse)) {
    return {
      provider: "fake",
      enabled: false,
      model: fake,
      reason: "Bedrock is opt-in and requires TUTOR_MODEL_ID, AWS_REGION, and server-side credentials (or an injected server invoker).",
    };
  }
  return {
    provider: "bedrock",
    enabled: true,
    model: new BedrockTutorModel({ modelId: env.TUTOR_MODEL_ID, region: env.AWS_REGION, converse: options.converse }),
  };
}

export function createTutorModel(
  env: ProviderEnv = serverEnv(),
  options: TutorProviderOptions = {},
): TutorModel {
  return selectTutorProvider(env, options).model;
}

export type DocumentProviderOptions = {
  invoke?: BdaInvoker;
  novaInvoke?: NovaInvoker;
};

export function selectDocumentAnalyzer(
  env: ProviderEnv = serverEnv(),
  options: DocumentProviderOptions = {},
): ProviderSelection<DocumentAnalyzer> {
  const fake = new FakeDocumentAnalyzer();
  const provider = (env.DOCUMENT_ANALYSIS_PROVIDER ?? "fake").toLocaleLowerCase();
  if (provider !== "aws_bda") return { provider: "fake", enabled: true, model: fake, reason: "fake analyzer is the safe default" };
  if (env.DOCUMENT_ANALYSIS_KILL_SWITCH?.toLocaleLowerCase() === "true") {
    return { provider: "fake", enabled: false, model: fake, reason: "document-analysis kill switch is active" };
  }
  if (!env.AWS_REGION || !env.AWS_BDA_PROJECT_ARN || !env.AWS_BDA_PROFILE_ARN || (!hasServerCredentials(env) && !options.invoke)) {
    return {
      provider: "fake",
      enabled: false,
      model: fake,
      reason: "AWS BDA is opt-in and requires region, project/profile ARNs, and server-side credentials (or an injected server invoker).",
    };
  }
  const novaEnabled = Boolean(env.NOVA_MODEL_ID && (options.novaInvoke || hasServerCredentials(env)));
  return {
    provider: "aws_bda",
    enabled: true,
    model: new AwsBdaDocumentAnalyzer({
      projectArn: env.AWS_BDA_PROJECT_ARN,
      profileArn: env.AWS_BDA_PROFILE_ARN,
      stage: env.AWS_BDA_PROJECT_STAGE === "DEVELOPMENT" ? "DEVELOPMENT" : "LIVE",
      region: env.AWS_REGION,
      invoke: options.invoke,
      semanticMapper: novaEnabled
        ? new NovaSemanticMapper({ modelId: env.NOVA_MODEL_ID, region: env.AWS_REGION, invoke: options.novaInvoke })
        : undefined,
    }),
  };
}

export function createDocumentAnalyzer(
  env: ProviderEnv = serverEnv(),
  options: DocumentProviderOptions = {},
): DocumentAnalyzer {
  return selectDocumentAnalyzer(env, options).model;
}
