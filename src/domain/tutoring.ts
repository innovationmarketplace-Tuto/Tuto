/**
 * Core tutoring-turn contracts and the provider-neutral AI interfaces.
 * See "AI recommendation" and "Core contracts" in PROJECT_PLAN.md.
 *
 * These are the boundaries between the three work areas and should not
 * change without cross-boundary review (see PROJECT_PLAN.md "Working
 * agreements").
 */

import type { PageRegion } from "./regions";
import type { TutorAnnotation } from "./annotations";
import type { CandidateLearningEvidence } from "./evidence";
import type { StudentSkillState } from "./memory";
import type { SkillResolution } from "./skills";

export type TutorTurnInput = {
  studentId: string;
  threadId: string;
  message: string;
  activityId?: string;
  artifactContext?: {
    artifactId: string;
    pageId: string;
    activeRegionIds?: string[];
  };
};

export type TeachingBrief = {
  currentSkillIds: string[];
  skillStates: StudentSkillState[];
  prerequisiteGaps: StudentSkillState[];
  activeMisconceptions: string[];
  relevantEpisodes: string[];
};

export type TutorTurnResult = {
  reply: string;
  skillResolutions: SkillResolution[];
  candidateEvidence: CandidateLearningEvidence[];
  annotations: TutorAnnotation[];
};

/**
 * Provider-neutral tutor model interface. Real inference is opt-in through
 * environment configuration; a deterministic fake implementation is the
 * default for development and automated tests (A-01).
 *
 * Input/output shapes are intentionally left to the Intelligence owner to
 * define alongside the real provider adapter (A-02, A-03) rather than
 * guessed at here.
 */
export interface TutorModel {
  generateTurn(input: TutorModelInput): Promise<TutorModelOutput>;
}
export type TutorModelInput = unknown;
export type TutorModelOutput = unknown;

/**
 * Provider-neutral document-analyzer interface (see AWS_PLAN.md for the
 * accepted BDA + Nova implementation). Input/output shapes are intentionally
 * left to the Intelligence owner to define alongside the real adapter
 * (A-07) rather than guessed at here; the adapter's return value must
 * normalize to PageRegion[].
 */
export interface DocumentAnalyzer {
  analyze(input: DocumentAnalysisInput): Promise<AnalyzedPage[]>;
}
export type DocumentAnalysisInput = unknown;
export type AnalyzedPage = { regions: PageRegion[] };
