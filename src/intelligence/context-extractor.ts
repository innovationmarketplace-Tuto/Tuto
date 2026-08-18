import type { PageRegion } from "../domain/regions";
import type { Skill } from "../domain/skills";

/**
 * The source of a turn's learning context.  A worksheet turn is intentionally
 * separate from chat: worksheet OCR is authoritative for the page, while a
 * chat turn gets its subject from the student's current message only.
 */
export type SubjectContextSource = "worksheet" | "chat";

export type SubjectContext = {
  source: SubjectContextSource;
  /** A best-effort subject label; absent means the text did not identify one. */
  subject?: string;
  /** The bounded source text used as the learning objective. */
  objective: string;
  /** The text in source order, with active worksheet regions first. */
  text: string;
  /** Bounded, de-duplicated excerpts retained for audit/debugging. */
  evidence: string[];
};

export type SubjectContextInput = {
  /** Explicit scope from the authenticated tutor action. */
  scope?: SubjectContextSource;
  /** `source` is a readable alias for callers outside Convex. */
  source?: SubjectContextSource;
  message?: string;
  pageRegions?: readonly PageRegion[];
  activeRegionIds?: readonly string[];
  /** Optional page-level transcription from a document analyzer. */
  pageTranscription?: string;
};

export type ContextSkillMatch = {
  skill: Skill;
  score: number;
  matchedOn: "exact" | "phrase" | "text";
};

const MAX_OBJECTIVE_LENGTH = 2_000;
const MAX_TEXT_LENGTH = 12_000;
const MAX_EVIDENCE_ITEMS = 20;
const MAX_EVIDENCE_LENGTH = 1_200;

// These words carry little signal when matching a free-form question to an
// atomic skill. Keeping the list local makes matching deterministic and avoids
// making the persisted skill search contract provider-specific.
const STOP_WORDS = new Set([
  "a", "about", "an", "and", "are", "as", "at", "be", "can", "could", "do", "for", "from",
  "get", "give", "help", "how", "i", "if", "in", "is", "it", "me", "my", "of", "on", "or",
  "please", "show", "that", "the", "this", "to", "understand", "want", "what", "when", "where",
  "which", "why", "with", "would", "you", "your",
]);

const SUBJECT_PATTERNS: readonly { subject: string; pattern: RegExp }[] = [
  {
    subject: "fractions",
    pattern: /\b(?:fraction|fractions|numerator|denominator|mixed\s+number|common\s+denominator|equivalent\s+fraction)\b|\\frac|\b\d+\s*\/\s*\d+\b/i,
  },
  {
    subject: "algebra",
    pattern: /\b(?:algebra|variable|coefficient|linear\s+equation|quadratic|polynomial|solve\s+for\s+[a-z])\b|[a-z]\s*[=<>]\s*[-+]?\d/i,
  },
  {
    subject: "geometry",
    pattern: /\b(?:geometry|area|perimeter|volume|angle|triangle|circle|radius|diameter|polygon|parallel|congruent|similar)\b/i,
  },
  {
    subject: "statistics",
    pattern: /\b(?:statistics|mean|median|mode|range|probability|sample|distribution|data\s+set)\b/i,
  },
  {
    subject: "calculus",
    pattern: /\b(?:calculus|derivative|integral|limit|differentiate|antiderivative|slope\s+of\s+a\s+curve)\b/i,
  },
];

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function contentTokens(value: string): Set<string> {
  return new Set(normalize(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token)));
}

function regionText(region: PageRegion): string {
  return cleanText(region.transcription ?? region.latex ?? "", MAX_EVIDENCE_LENGTH);
}

function sortedRegions(regions: readonly PageRegion[]): PageRegion[] {
  return [...regions].sort((left, right) => (
    left.bounds.y - right.bounds.y
    || left.bounds.x - right.bounds.x
    || left.id.localeCompare(right.id)
  ));
}

function uniqueExcerpts(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = cleanText(value, MAX_EVIDENCE_LENGTH);
    const key = normalize(cleaned);
    if (!cleaned || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= MAX_EVIDENCE_ITEMS) break;
  }
  return result;
}

function subjectFromText(text: string): string | undefined {
  return SUBJECT_PATTERNS.find(({ pattern }) => pattern.test(text))?.subject;
}

function sourceFor(input: SubjectContextInput): SubjectContextSource {
  if (input.source === "worksheet" || input.source === "chat") return input.source;
  if (input.scope === "worksheet" || input.scope === "chat") return input.scope;
  return input.pageRegions || input.activeRegionIds || input.pageTranscription ? "worksheet" : "chat";
}

function worksheetEvidence(input: SubjectContextInput): string[] {
  const regions = sortedRegions(input.pageRegions ?? []);
  const activeIds = new Set((input.activeRegionIds ?? []).filter((id): id is string => typeof id === "string"));
  const active = regions.filter((region) => activeIds.has(region.id)).map(regionText).filter(Boolean);
  const rest = regions.filter((region) => !activeIds.has(region.id)).map(regionText).filter(Boolean);
  return uniqueExcerpts([
    ...active,
    cleanText(input.pageTranscription, MAX_EVIDENCE_LENGTH),
    ...rest,
  ]);
}

/**
 * Extract the only source text allowed to determine a turn's subject and
 * objective.  In particular, this function has no learner-memory or
 * `currentSkillIds` input, so callers cannot turn arbitrary client memory into
 * curriculum context.
 */
export function extractSubjectContext(input: SubjectContextInput): SubjectContext {
  const source = sourceFor(input);
  const evidence = source === "worksheet"
    ? worksheetEvidence(input)
    : uniqueExcerpts([cleanText(input.message, MAX_TEXT_LENGTH)]);
  const text = evidence.join("\n").slice(0, MAX_TEXT_LENGTH).trim();
  const objective = cleanText(
    source === "worksheet" && evidence.length > 0 ? evidence[0] : text,
    MAX_OBJECTIVE_LENGTH,
  );
  return {
    source,
    ...(subjectFromText(text) ? { subject: subjectFromText(text) } : {}),
    objective,
    text,
    evidence,
  };
}

function skillValues(skill: Skill): string[] {
  return [skill.name, skill.objective, ...skill.aliases]
    .map((value) => cleanText(value, MAX_OBJECTIVE_LENGTH))
    .filter(Boolean);
}

function scoreSkill(text: string, skill: Skill): Omit<ContextSkillMatch, "skill"> | null {
  const normalizedText = normalize(text);
  const textTokens = contentTokens(text);
  if (!normalizedText || textTokens.size === 0) return null;
  let bestScore = 0;
  let matchedOn: ContextSkillMatch["matchedOn"] = "text";
  for (const value of skillValues(skill)) {
    const normalizedValue = normalize(value);
    if (!normalizedValue) continue;
    if (normalizedValue === normalizedText) {
      bestScore = 1;
      matchedOn = "exact";
      continue;
    }
    // A phrase in a longer student question is a strong signal. Avoid short
    // one-word names because they create false matches on ordinary prose.
    if (normalizedValue.length >= 5 && normalizedText.includes(normalizedValue)) {
      if (bestScore < 0.94) {
        bestScore = 0.94;
        matchedOn = "phrase";
      }
      continue;
    }
    const valueTokens = contentTokens(value);
    if (valueTokens.size === 0) continue;
    let common = 0;
    for (const token of valueTokens) if (textTokens.has(token)) common += 1;
    // Recall against the skill phrase handles long worksheet problems while
    // the minimum common-token check rejects incidental single-word overlap.
    const score = common >= 2 ? common / valueTokens.size : 0;
    if (score > bestScore) {
      bestScore = score;
      matchedOn = "text";
    }
  }
  return bestScore > 0 ? { score: bestScore, matchedOn } : null;
}

/**
 * Rank active skills against extracted source text.  The subject extracted
 * from the same source is a filter when the skill graph contains that subject;
 * it is never taken from a caller-supplied skill ID.
 */
export function rankContextSkills(
  context: Pick<SubjectContext, "subject" | "text" | "objective">,
  skills: readonly Skill[],
): ContextSkillMatch[] {
  const sourceText = [context.objective, context.text].filter(Boolean).join("\n");
  if (!sourceText.trim()) return [];
  const subject = context.subject ? normalize(context.subject) : "";
  const active = skills.filter((skill) => skill.status === "active");
  const subjectMatches = subject
    ? active.filter((skill) => normalize(skill.subject) === subject)
    : [];
  const pool = subjectMatches.length > 0 ? subjectMatches : active;
  return pool
    .flatMap((skill) => {
      const scored = scoreSkill(sourceText, skill);
      return scored ? [{ skill, ...scored }] : [];
    })
    .filter((candidate) => candidate.score >= 0.34)
    .sort((left, right) => right.score - left.score || left.skill.id.localeCompare(right.skill.id));
}

/** Return a bounded set of context-matched active skill IDs for a brief. */
export function skillIdsForContext(
  context: Pick<SubjectContext, "subject" | "text" | "objective">,
  skills: readonly Skill[],
  limit = 4,
): string[] {
  const ranked = rankContextSkills(context, skills);
  if (ranked.length === 0) return [];
  const best = ranked[0]!.score;
  return ranked
    .filter((candidate) => candidate.score >= Math.max(0.34, best - 0.16))
    .slice(0, Math.max(0, Math.min(16, Math.floor(limit))))
    .map((candidate) => candidate.skill.id);
}

// Readable aliases for callers that use "turn context" terminology.
export const extractTurnContext = extractSubjectContext;
export const resolveContextSkillIds = skillIdsForContext;

