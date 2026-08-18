import assert from "node:assert/strict";
import test from "node:test";

import type { PageRegion } from "../domain/regions";
import type { Skill } from "../domain/skills";
import {
  extractSubjectContext,
  rankContextSkills,
  skillIdsForContext,
} from "./context-extractor";

function region(overrides: Partial<PageRegion> = {}): PageRegion {
  return {
    id: "region-1",
    pageId: "page-1",
    revision: 2,
    kind: "problem",
    polygon: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0.2 },
      { x: 0, y: 0.2 },
    ],
    bounds: { x: 0, y: 0, width: 1, height: 0.2 },
    source: "document_analyzer",
    ...overrides,
  };
}

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "fraction-common-denominator",
    namespace: "tuto",
    status: "active",
    name: "Common denominator",
    objective: "Choose a common denominator before adding fractions with unlike denominators.",
    subject: "fractions",
    aliases: ["common denominator", "unlike denominators"],
    version: 1,
    createdBy: "human",
    ...overrides,
  };
}

test("worksheet context prioritizes the current active-region transcription", () => {
  const context = extractSubjectContext({
    scope: "worksheet",
    activeRegionIds: ["active"],
    pageRegions: [
      region({ id: "older", bounds: { x: 0, y: 0.8, width: 1, height: 0.2 }, transcription: "Reduce this fraction to lowest terms." }),
      region({ id: "active", transcription: "Choose a common denominator before adding fractions." }),
    ],
  });

  assert.equal(context.source, "worksheet");
  assert.equal(context.subject, "fractions");
  assert.equal(context.objective, "Choose a common denominator before adding fractions.");
  assert.match(context.text, /^Choose a common denominator/);
  assert.match(context.text, /Reduce this fraction/);
});

test("chat context comes from the current student message, not page or memory-shaped fields", () => {
  const context = extractSubjectContext({
    scope: "chat",
    message: "How do I add fractions with unlike denominators?",
    pageRegions: [region({ transcription: "Find the area of the wall." })],
    // This is intentionally an unknown extra at runtime: extractor input does
    // not define learner memory or current skill IDs as a source of context.
    ...( { currentSkillIds: ["untrusted-skill"], currentProblem: "old geometry problem" } as Record<string, unknown>),
  });

  assert.equal(context.source, "chat");
  assert.equal(context.subject, "fractions");
  assert.equal(context.objective, "How do I add fractions with unlike denominators?");
  assert.doesNotMatch(context.text, /wall|geometry/i);
  assert.doesNotMatch(context.text, /untrusted-skill|old geometry/i);
});

test("skill lookup uses extracted subject and never returns proposed or mismatched skills", () => {
  const context = extractSubjectContext({
    scope: "chat",
    message: "Please help me choose a common denominator before adding fractions.",
  });
  const candidates = [
    skill(),
    skill({
      id: "geometry-area",
      name: "Find area",
      objective: "Find the area of a rectangle.",
      subject: "geometry",
      aliases: ["area"],
    }),
    skill({
      id: "proposed-unreviewed",
      status: "proposed",
      name: "Choose an operation from a story",
      objective: "Choose the operation from a word problem.",
      subject: "fractions",
      aliases: ["operation from a story"],
    }),
  ];

  const ranked = rankContextSkills(context, candidates);
  assert.equal(ranked[0]?.skill.id, "fraction-common-denominator");
  assert.equal(ranked.some((candidate) => candidate.skill.id === "geometry-area"), false);
  assert.deepEqual(skillIdsForContext(context, candidates), ["fraction-common-denominator"]);
});

test("worksheet without usable transcription produces no objective or skill IDs", () => {
  const context = extractSubjectContext({
    scope: "worksheet",
    activeRegionIds: ["empty"],
    pageRegions: [region({ id: "empty" })],
  });

  assert.equal(context.objective, "");
  assert.equal(context.subject, undefined);
  assert.deepEqual(skillIdsForContext(context, [skill()]), []);
});

