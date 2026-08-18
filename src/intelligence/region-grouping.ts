import type { NormalizedBounds, NormalizedPoint, PageRegion } from "../domain/regions";

export type RegionGroupingOptions = {
  /** Maximum visual gap (as a multiple of neighboring line height) within a step. */
  maxGapFactor?: number;
  maxGroups?: number;
};

function unionBounds(regions: readonly PageRegion[]): NormalizedBounds {
  const x = Math.min(...regions.map((region) => region.bounds.x));
  const y = Math.min(...regions.map((region) => region.bounds.y));
  const right = Math.max(...regions.map((region) => region.bounds.x + region.bounds.width));
  const bottom = Math.max(...regions.map((region) => region.bounds.y + region.bounds.height));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

function polygon(bounds: NormalizedBounds): NormalizedPoint[] {
  return [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ];
}

function lineLike(region: PageRegion): boolean {
  return region.id !== "page-001" && (region.kind === "equation" || region.kind === "prose");
}

function questionLike(text: string): boolean {
  return /\?|\b(?:solve|find|calculate|simplify|evaluate|what is|determine)\b/i.test(text);
}

function groupText(group: readonly PageRegion[]): string {
  return group
    .slice()
    .sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x || left.id.localeCompare(right.id))
    .map((region) => region.transcription?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

function meanConfidence(group: readonly PageRegion[]): number | undefined {
  const values = group.map((region) => region.confidence).filter((value): value is number => value !== undefined);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

function makeDerived(
  group: readonly PageRegion[],
  pageId: string,
  revision: number,
  kind: "problem" | "solution_step",
  index: number,
): PageRegion {
  const bounds = unionBounds(group);
  const text = groupText(group);
  return {
    id: `${kind === "problem" ? "problem" : "step"}-${String(index).padStart(3, "0")}`,
    pageId,
    revision,
    kind,
    polygon: polygon(bounds),
    bounds,
    transcription: text || undefined,
    confidence: meanConfidence(group),
    source: "derived",
  };
}

/**
 * Deterministically group nearby BDA line regions into problem/solution-step
 * containers. It uses only normalized geometry and transcription and never
 * asks a model to invent coordinates.
 */
export function groupPageRegions(
  regions: readonly PageRegion[],
  options: RegionGroupingOptions = {},
): PageRegion[] {
  const ordered = [...regions].sort((left, right) =>
    left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x || left.id.localeCompare(right.id));
  const lineRegions = ordered.filter(lineLike);
  if (lineRegions.length === 0) return ordered;

  const factor = options.maxGapFactor ?? 2.5;
  const groups: PageRegion[][] = [];
  for (const region of lineRegions) {
    const current = groups.at(-1);
    if (!current) {
      groups.push([region]);
      continue;
    }
    const previous = current[current.length - 1]!;
    const previousBottom = previous.bounds.y + previous.bounds.height;
    const gap = region.bounds.y - previousBottom;
    const maxHeight = Math.max(previous.bounds.height, region.bounds.height, 0.001);
    if (gap <= maxHeight * factor) current.push(region);
    else groups.push([region]);
  }

  const limited = options.maxGroups && options.maxGroups > 0 ? groups.slice(0, options.maxGroups) : groups;
  const hasProblem = limited.some((group) => questionLike(groupText(group)));
  const derived: PageRegion[] = [];
  const usedIds = new Set(ordered.map((region) => region.id));
  let problemIndex = 1;
  let stepIndex = 1;
  for (let index = 0; index < limited.length; index += 1) {
    const group = limited[index]!;
    const text = groupText(group);
    const kind: "problem" | "solution_step" = questionLike(text)
      || (!hasProblem && index === 0 && limited.length > 1)
      ? "problem"
      : "solution_step";
    let container = makeDerived(group, group[0]!.pageId, group[0]!.revision, kind, kind === "problem" ? problemIndex++ : stepIndex++);
    while (usedIds.has(container.id)) container = { ...container, id: `derived-${container.id}` };
    usedIds.add(container.id);
    derived.push(container);
  }

  // Attach the derived parent to the line regions while keeping every source
  // region and its ID intact. Words/terms are left untouched.
  const parentByChild = new Map<string, string>();
  limited.forEach((group, index) => {
    const parent = derived[index];
    for (const region of group) parentByChild.set(region.id, parent!.id);
  });
  const linked = ordered.map((region) => parentByChild.has(region.id) && !region.parentRegionId
    ? { ...region, parentRegionId: parentByChild.get(region.id) }
    : region);
  return [...linked, ...derived];
}

export const groupRegions = groupPageRegions;
export const groupDetectedRegions = groupPageRegions;
