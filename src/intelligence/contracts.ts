/**
 * Provider-facing contracts for the intelligence boundary.
 *
 * These types deliberately live outside a provider implementation. A model
 * may be swapped (or disabled altogether) without changing the tutor or
 * workspace code. In particular, no AWS response type is allowed to cross
 * this boundary.
 */

import type { ArtifactPage } from "../domain/artifacts";
import type { TutorAnnotation } from "../domain/annotations";
import type { TutorLearnerFact } from "../domain/memory";
import type { PageRegion } from "../domain/regions";
import type {
  TeachingBrief,
  TutorTurnInput,
  TutorTurnResult,
} from "../domain/tutoring";
import type { SubjectContext } from "./context-extractor";

export const TUTOR_PROMPT_VERSION = "tutor-turn.v4" as const;
export const DOCUMENT_ANALYZER_ADAPTER_VERSION = "document-analyzer-v1" as const;

export type TutorRecentMessage = {
  role: "student" | "tutor";
  text: string;
};

/**
 * The teaching brief is optional for local callers so the deterministic fake
 * remains useful while a memory backend is being developed. Production tutor
 * orchestration should always provide it.
 */
export type TutorModelInput = TutorTurnInput & {
  /**
   * Persisted session problem, when the caller has one. This is intentionally
   * separate from `message`: worksheet kickoff turns are generic prompts, so
   * the provider needs the durable problem statement to stay grounded.
   */
  currentProblem?: string;
  teachingBrief?: TeachingBrief;
  /** Server-extracted subject/objective; never a client memory hint. */
  subjectContext?: SubjectContext;
  /** Server-owned, compact learner facts; clients cannot supply this context. */
  durableFacts?: readonly TutorLearnerFact[];
  recentMessages?: readonly TutorRecentMessage[];
  pageRegions?: readonly PageRegion[];
  /** The prompt version is metadata, never a free-form client instruction. */
  promptVersion?: string;
};

export type TutorUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type TutorCallMetadata = {
  provider: "fake" | "bedrock" | "openai";
  model: string;
  latencyMs: number;
  usage?: TutorUsage;
  promptVersion: string;
  fallbackUsed?: boolean;
  fallbackProvider?: "fake";
  fallbackReason?: string;
  /** Safe operational fields only; never include prompts, images, or secrets. */
  requestId?: string;
};

/**
 * Tutor output is intentionally the plan-shaped result, with operational
 * metadata alongside it. Keeping `reply` at the top level makes this shape
 * directly consumable by the existing TutorTurnResult contract.
 */
export type TutorModelOutput = TutorTurnResult & {
  metadata?: TutorCallMetadata;
};

export type CanonicalImageInput = {
  mimeType: "image/jpeg" | "image/png";
  /** Server-side adapters may receive bytes; clients should use an upload URL. */
  bytes?: Uint8Array;
  base64?: string;
  dataUrl?: string;
  naturalWidth?: number;
  naturalHeight?: number;
};

export type DocumentAnalysisInput = {
  artifactId: string;
  page: ArtifactPage;
  image: CanonicalImageInput;
  /** Optional semantic extraction focus; never provider configuration. */
  question?: string;
};

export type DocumentAnalysisMetadata = {
  provider: "fake" | "aws_bda";
  adapterVersion: typeof DOCUMENT_ANALYZER_ADAPTER_VERSION;
  latencyMs: number;
  regionCount: number;
  bdaLineCount?: number;
  bdaWordCount?: number;
  semanticPass?: "nova" | "none";
  fallbackUsed?: boolean;
  fallbackReason?: string;
};

/**
 * Normalized analysis. The raw BDA/Nova response is consumed and discarded by
 * the adapter, so only application contracts reach persistence or a client.
 */
export type AnalyzedPage = {
  pageId: string;
  revision: number;
  regions: PageRegion[];
  transcription?: string;
  latex?: string;
  annotations?: TutorAnnotation[];
  warnings: string[];
  metadata: DocumentAnalysisMetadata;
};

export type TutorModel = {
  generateTurn(input: TutorModelInput): Promise<TutorModelOutput>;
};

export type DocumentAnalyzer = {
  analyze(input: DocumentAnalysisInput): Promise<AnalyzedPage[]>;
};

export function emptyTeachingBrief(): TeachingBrief {
  return {
    currentSkillIds: [],
    skillStates: [],
    prerequisiteGaps: [],
    activeMisconceptions: [],
    relevantEpisodes: [],
  };
}
