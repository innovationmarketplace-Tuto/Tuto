import type { PageRegion } from "../domain/regions";
import type { NewSkillProposal, Skill, SkillResolution } from "../domain/skills";

export type SkillResolverInput = {
  objective: string;
  skills: readonly Skill[];
  sourceMessageIds?: readonly string[];
  subject?: string;
  level?: string;
  prerequisiteCandidateIds?: readonly string[];
};

export type SkillCandidate = {
  skill: Skill;
  score: number;
  matchedOn: "exact" | "text";
};

/**
 * The small, provider-neutral slice of a worksheet region that is useful for
 * skill lookup. Keeping this separate from the full page contract also makes
 * the resolver usable by server code before a provider input is assembled.
 */
export type SkillContextRegion = Pick<PageRegion, "id" | "kind"> &
  Partial<Pick<PageRegion, "transcription" | "latex">>;

export type SkillContextInput = {
  /** The current student request, including a short follow-up question. */
  message?: string;
  /** Durable problem text supplied by the client or a previous turn. */
  currentProblem?: string;
  /** OCR/semantic text from the canonical worksheet revision. */
  pageRegions?: readonly SkillContextRegion[];
  /** Selected regions get priority over the rest of the page text. */
  activeRegionIds?: readonly string[];
  skills: readonly Skill[];
  subject?: string;
  sourceMessageIds?: readonly string[];
};

export type SkillContextResolution = {
  /** Stable active IDs suitable for a TeachingBrief. */
  currentSkillIds: string[];
  /** Provider-neutral resolution decisions retained for diagnostics/tests. */
  resolutions: SkillResolution[];
  /** Bounded text objectives that produced the decisions. */
  matchedObjectives: string[];
};

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 1));
}

function overlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const token of left) if (right.has(token)) common += 1;
  return common / Math.max(left.size, right.size);
}

function searchValues(skill: Skill): string[] {
  return [skill.name, skill.objective, ...skill.aliases]
    .map(normalize)
    .filter(Boolean);
}

function contextText(region: SkillContextRegion): string {
  return (region.transcription?.trim() || region.latex?.trim() || "").slice(0, 4_000);
}

/**
 * Return deterministic, bounded objectives from a tutor turn. Selected page
 * regions and the persisted problem are considered before the free-form
 * message, while every source remains available when a turn is underspecified.
 * Duplicate text is removed so repeated OCR does not over-weight a candidate.
 */
function contextObjectives(input: SkillContextInput): string[] {
  const objectives: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value !== "string") return;
    const text = value.trim().slice(0, 4_000);
    const key = normalize(text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    objectives.push(text);
  };

  add(input.currentProblem);

  const regions = [...(input.pageRegions ?? [])]
    .filter((region) => contextText(region).length > 0)
    .sort((left, right) => left.id.localeCompare(right.id));
  const activeIds = new Set(input.activeRegionIds ?? []);
  for (const region of regions) {
    if (activeIds.has(region.id)) add(contextText(region));
  }
  for (const region of regions) {
    if (!activeIds.has(region.id)) add(contextText(region));
  }

  add(input.message);
  return objectives.slice(0, 40);
}

function activeSkills(input: SkillResolverInput): Skill[] {
  return input.skills.filter((skill) => skill.status === "active");
}

function rankedCandidates(input: SkillResolverInput): SkillCandidate[] {
  const objective = normalize(input.objective);
  const objectiveTokens = tokens(objective);
  const subject = input.subject ? normalize(input.subject) : undefined;
  return activeSkills(input)
    .flatMap((skill) => {
      const values = searchValues(skill);
      const exact = values.includes(objective);
      const scores = values.map((value) => {
        const valueTokens = tokens(value);
        const tokenScore = overlap(objectiveTokens, valueTokens);
        const phraseScore = objective.includes(value) || value.includes(objective) ? 0.9 : 0;
        return Math.max(tokenScore, phraseScore);
      });
      const textScore = exact ? 1 : Math.max(0, ...scores);
      // Subject is supporting evidence, not a hard filter. A geometry word
      // problem can legitimately exercise division or equal sharing, so a
      // coarse subject label must not hide cross-cutting skills.
      const subjectBoost = subject && normalize(skill.subject) === subject ? 0.06 : 0;
      const score = Math.min(1, textScore + subjectBoost);
      if (score <= 0) return [];
      return [{ skill, score, matchedOn: (exact ? "exact" : "text") as "exact" | "text" }];
    })
    .sort((left, right) => right.score - left.score || left.skill.id.localeCompare(right.skill.id));
}

function aliasesForProposal(objective: string): string[] {
  const normalized = normalize(objective);
  const words = normalized.split(" ").filter(Boolean);
  const aliases = [normalized];
  if (words.length > 3) aliases.push(words.slice(0, 3).join(" "));
  return [...new Set(aliases)].slice(0, 4);
}

function proposal(input: SkillResolverInput, candidates: readonly SkillCandidate[]): NewSkillProposal {
  const objective = input.objective.trim();
  const suggestedName = objective
    .replace(/\s+/g, " ")
    .replace(/^./, (character) => character.toLocaleUpperCase())
    .slice(0, 160);
  const nearCandidates = candidates
    .filter((candidate) => candidate.score >= 0.35)
    .slice(0, 3)
    .map((candidate) => candidate.skill.id);
  return {
    suggestedName,
    objective,
    whyExistingSkillsDoNotFit: nearCandidates.length > 0
      ? `No active skill was a sufficiently reliable match; nearby candidates were ${nearCandidates.join(", ")}.`
      : "No active skill matched the objective by exact alias or text overlap.",
    prerequisiteCandidateIds: [...(input.prerequisiteCandidateIds ?? nearCandidates)],
    aliases: aliasesForProposal(objective),
    positiveExamples: [objective],
    sourceMessageIds: [...(input.sourceMessageIds ?? [])],
  };
}

/**
 * Resolve in the safe order: exact canonical name/alias/objective, then text
 * candidates, then an explicit proposal. Proposed skills never become active
 * implicitly.
 */
export function resolveSkill(input: SkillResolverInput): SkillResolution {
  const objective = normalize(input.objective);
  if (!objective) {
    return {
      decision: "proposed",
      proposal: proposal({ ...input, objective: "Unspecified learning objective" }, []),
    };
  }
  const candidates = rankedCandidates(input);
  const exact = candidates.filter((candidate) => candidate.matchedOn === "exact");
  if (exact.length === 1) {
    return { decision: "existing", skillId: exact[0]!.skill.id, confidence: 1 };
  }
  if (exact.length > 1) {
    return {
      decision: "ambiguous",
      candidateIds: exact.map((candidate) => candidate.skill.id),
      reason: "The objective exactly matches more than one active skill alias; review the candidate before attaching evidence.",
    };
  }

  const best = candidates[0];
  const second = candidates[1];
  if (best && best.score >= 0.82 && (!second || best.score - second.score >= 0.12)) {
    return {
      decision: "existing",
      skillId: best.skill.id,
      confidence: Number(Math.min(0.95, best.score).toFixed(3)),
    };
  }
  if (best && best.score >= 0.42 && (!second || best.score - second.score < 0.12)) {
    return {
      decision: "ambiguous",
      candidateIds: candidates.filter((candidate) => candidate.score >= best.score - 0.12).slice(0, 4).map((candidate) => candidate.skill.id),
      reason: "Text-first matching found close active skill candidates; retain the objective for review instead of making a mastery claim.",
    };
  }
  return { decision: "proposed", proposal: proposal(input, candidates) };
}

export function resolveSkillObjective(input: SkillResolverInput): SkillResolution {
  return resolveSkill(input);
}

/**
 * Resolve the active skills for a tutor turn from server-owned context.
 *
 * Existing/session IDs remain useful as a continuity fallback at the caller,
 * but this function deliberately does not accept them: worksheet text and the
 * student's current request must be able to replace stale client context.
 * Only stable existing matches become `currentSkillIds`; ambiguous and
 * proposed decisions stay diagnostic data and never become canonical IDs.
 */
export function resolveSkillsFromContext(input: SkillContextInput): SkillContextResolution {
  const resolutionsByKey = new Map<string, SkillResolution>();
  const existingBySkill = new Map<string, { confidence: number; objective: string }>();
  const matchedObjectives: string[] = [];

  for (const objective of contextObjectives(input)) {
    const resolution = resolveSkill({
      objective,
      skills: input.skills,
      subject: input.subject,
      sourceMessageIds: input.sourceMessageIds,
    });
    const resolutionKey = JSON.stringify(resolution);
    if (!resolutionsByKey.has(resolutionKey)) resolutionsByKey.set(resolutionKey, resolution);
    if (resolution.decision === "existing") {
      const previous = existingBySkill.get(resolution.skillId);
      if (!previous || resolution.confidence > previous.confidence) {
        existingBySkill.set(resolution.skillId, { confidence: resolution.confidence, objective });
      }
      continue;
    }
    matchedObjectives.push(objective);
  }

  const currentSkillIds = [...existingBySkill.entries()]
    .sort((left, right) => right[1].confidence - left[1].confidence || left[0].localeCompare(right[0]))
    .slice(0, 20)
    .map(([skillId]) => skillId);
  const resolvedObjectives = [...existingBySkill.values()].map((value) => value.objective);
  const allMatchedObjectives = [...new Set([...resolvedObjectives, ...matchedObjectives])].slice(0, 40);
  return {
    currentSkillIds,
    resolutions: [...resolutionsByKey.values()],
    matchedObjectives: allMatchedObjectives,
  };
}

export class SkillResolver {
  resolve(input: SkillResolverInput): SkillResolution {
    return resolveSkill(input);
  }
}
