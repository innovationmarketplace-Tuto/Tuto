/**
 * Core tutoring-turn contracts and the provider-neutral AI interfaces.
 * See "AI recommendation" and "Core contracts" in PROJECT_PLAN.md.
 *
 * These are the boundaries between the three work areas and should not
 * change without cross-boundary review (see PROJECT_PLAN.md "Working
 * agreements").
 */

import type { PageRegion } from "./regions";
import type { ArtifactPage } from "./artifacts";
import type { TutorAnnotation } from "./annotations";
import type { CandidateLearningEvidence } from "./evidence";
import type { StudentSkillState } from "./memory";
import type { SkillResolution } from "./skills";

export type TutorTurnInput = {
  studentId: string;
  threadId: string;
  message: string;
  activityId?: string;
  /** Server-derived or explicitly persisted problem text for non-page turns. */
  currentProblem?: string;
  artifactContext?: {
    artifactId: string;
    pageId: string;
    pageRevision?: number;
    activeRegionIds?: string[];
  };
  /** Canonical worksheet bytes are attached by the server action, never by the client. */
  image?: CanonicalImageInput;
};

export type TeachingBrief = {
  /** The server-derived learning target for this turn, even when no canonical skill exists yet. */
  focus?: {
    source: "worksheet" | "chat";
    subject?: string;
    objective: string;
    evidence: string[];
  };
  /** Human-readable canonical skills; IDs alone are not enough context for a tutor model. */
  currentSkills?: TeachingBriefSkill[];
  /** Canonical prerequisite gaps with both curriculum meaning and learner state. */
  prerequisiteSkills?: TeachingBriefSkill[];
  currentSkillIds: string[];
  skillStates: StudentSkillState[];
  prerequisiteGaps: StudentSkillState[];
  activeMisconceptions: string[];
  relevantEpisodes: string[];
};

export type TeachingBriefSkill = {
  skillId: string;
  name: string;
  objective: string;
  subject: string;
  level?: string;
  mastery: number | null;
  confidence: number;
  evidenceCount: number;
  misconceptionIds: string[];
};

export type TutorTurnResult = {
  reply: string;
  skillResolutions: SkillResolution[];
  candidateEvidence: CandidateLearningEvidence[];
  annotations: TutorAnnotation[];
};

export type TutorRecentMessage = {
  role: "student" | "tutor";
  text: string;
};

export type TutorUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type TutorCallMetadata = {
  provider: "fake" | "bedrock";
  model: string;
  latencyMs: number;
  usage?: TutorUsage;
  promptVersion: string;
  fallbackUsed?: boolean;
  fallbackProvider?: "fake";
  fallbackReason?: string;
  requestId?: string;
};

export type TutorModelInput = TutorTurnInput & {
  teachingBrief?: TeachingBrief;
  recentMessages?: readonly TutorRecentMessage[];
  pageRegions?: readonly PageRegion[];
  promptVersion?: string;
};

export type TutorModelOutput = TutorTurnResult & {
  metadata?: TutorCallMetadata;
};

/**
 * Provider-neutral tutor model interface. Real inference is opt-in through
 * environment configuration; a deterministic fake implementation is the
 * default for development and automated tests (A-01).
 *
 * Inputs and outputs stay plan-shaped so Product and Memory can integrate
 * against deterministic fakes while Intelligence swaps providers.
 */
export interface TutorModel {
  generateTurn(input: TutorModelInput): Promise<TutorModelOutput>;
}

/**
 * Provider-neutral document-analyzer interface (see AWS_PLAN.md for the
 * accepted BDA + Nova implementation). The adapter's return value is
 * normalized to page-scoped records; raw provider fields are not part of this
 * contract.
 */
export interface DocumentAnalyzer {
  analyze(input: DocumentAnalysisInput): Promise<AnalyzedPage[]>;
}

export type CanonicalImageInput = {
  mimeType: "image/jpeg" | "image/png";
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
  question?: string;
};

export type AnalyzedPage = {
  pageId: string;
  revision: number;
  regions: PageRegion[];
  transcription?: string;
  latex?: string;
  annotations?: TutorAnnotation[];
  warnings: string[];
  metadata: {
    provider: "fake" | "aws_bda";
    adapterVersion: string;
    latencyMs: number;
    regionCount: number;
    bdaLineCount?: number;
    bdaWordCount?: number;
    semanticPass?: "nova" | "none";
    fallbackUsed?: boolean;
    fallbackReason?: string;
  };
};
