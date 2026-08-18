import assert from "node:assert/strict";
import test from "node:test";

import type { PageRegion } from "../domain/regions";
import { emptyTeachingBrief, type TutorModelInput } from "./contracts";
import { FakeTutorModel } from "./fake-tutor";
import { buildTutorTurnPrompt } from "./prompt";

const WALL_PAINT_TRANSCRIPTION =
  "If 4 students share a 30-square-foot wall equally, how many square feet of the wall will be painted by each student?";

const WALL_PAINT_REGIONS: PageRegion[] = [{
  id: "wall-paint-problem",
  pageId: "wall-paint-page",
  revision: 1,
  kind: "problem",
  polygon: [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.25 },
    { x: 0.1, y: 0.25 },
  ],
  bounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.15 },
  transcription: WALL_PAINT_TRANSCRIPTION,
  source: "document_analyzer",
}];

function wallPaintInput(): TutorModelInput {
  return {
    studentId: "worksheet-student",
    threadId: "worksheet-wall-paint",
    // Do not put the worksheet topic in the chat message. The regression must
    // prove that page-region transcription is used as worksheet context.
    message: "Can you help me solve the problem on this worksheet?",
    teachingBrief: emptyTeachingBrief(),
    artifactContext: {
      artifactId: "wall-paint-artifact",
      pageId: "wall-paint-page",
      activeRegionIds: ["wall-paint-problem"],
    },
    pageRegions: WALL_PAINT_REGIONS,
  };
}

test("worksheet prompt carries the analyzed region transcription", () => {
  const prompt = buildTutorTurnPrompt(wallPaintInput());

  assert.equal(prompt.includes(WALL_PAINT_TRANSCRIPTION), true);
  assert.match(prompt, /wall-paint-problem/);
});

test("worksheet tutor grounds its reply in wall-paint division instead of canned fraction guidance", async () => {
  const output = await new FakeTutorModel().generateTurn(wallPaintInput());

  assert.match(output.reply, /paint|wall|share|divid/i);
  for (const cannedPhrase of [
    /common denominator/i,
    /equivalent fractions/i,
    /add(?: only)? the numerators/i,
    /keep the denominator/i,
    /what common denominator do 2 and 3 share/i,
  ]) {
    assert.doesNotMatch(output.reply, cannedPhrase);
  }
  assert.ok(output.annotations.some((annotation) => annotation.targetRegionId === "wall-paint-problem"));
});
