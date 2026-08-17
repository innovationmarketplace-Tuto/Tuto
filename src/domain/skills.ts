/**
 * Curriculum skill graph and the unknown-skill lifecycle. See "Skill model"
 * in PROJECT_PLAN.md. Runtime AI may create a "proposed" skill; it may not
 * activate a canonical skill automatically.
 */

export type Skill = {
  id: string;
  namespace: string;
  status: "proposed" | "active" | "merged" | "deprecated";
  name: string;
  objective: string;
  subject: string;
  level?: string;
  aliases: string[];
  version: number;
  createdBy: "human" | "ai";
  sourceReference?: string;
};

export type SkillEdge = {
  fromSkillId: string;
  toSkillId: string;
  kind: "requires" | "part_of" | "related_to";
  confidence: number;
  rationale?: string;
};

export type NewSkillProposal = {
  suggestedName: string;
  objective: string;
  whyExistingSkillsDoNotFit: string;
  prerequisiteCandidateIds: string[];
  aliases: string[];
  positiveExamples: string[];
  sourceMessageIds: string[];
};

export type SkillResolution =
  | { decision: "existing"; skillId: string; confidence: number }
  | { decision: "ambiguous"; candidateIds: string[]; reason: string }
  | { decision: "proposed"; proposal: NewSkillProposal };
