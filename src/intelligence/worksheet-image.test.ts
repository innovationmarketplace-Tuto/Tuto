import assert from "node:assert/strict";
import test from "node:test";

import type { PageRegion } from "../domain/regions";
import { emptyTeachingBrief, type TutorModelInput } from "./contracts";
import { BedrockTutorModel, type BedrockConverseRequest } from "./bedrock-tutor";
import { mapNovaResponse } from "./nova-mapper";

const region: PageRegion = {
  id: "page-region-1",
  pageId: "page-1",
  revision: 1,
  kind: "prose",
  polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
  bounds: { x: 0, y: 0, width: 1, height: 1 },
  transcription: "Share the wall equally.",
  source: "document_analyzer",
};

function input(): TutorModelInput {
  return {
    studentId: "student-1",
    threadId: "thread-1",
    message: "What should I do next?",
    teachingBrief: emptyTeachingBrief(),
    artifactContext: {
      artifactId: "artifact-1",
      pageId: "page-1",
      pageRevision: 1,
      activeRegionIds: [region.id],
    },
    pageRegions: [region],
    image: { mimeType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) },
  };
}

test("Bedrock tutor sends canonical worksheet bytes as a multimodal image block", async () => {
  let request: BedrockConverseRequest | undefined;
  const model = new BedrockTutorModel({
    converse: async (nextRequest) => {
      request = nextRequest;
      return {
        output: {
          message: {
            content: [{
              text: JSON.stringify({
                reply: "Start by naming the quantities shown on the page.",
                skillResolutions: [],
                candidateEvidence: [],
                annotations: [],
              }),
            }],
          },
        },
      };
    },
  });

  await model.generateTurn(input());

  const content = request?.messages[0]?.content ?? [];
  assert.deepEqual(content[0], {
    image: { format: "jpeg", source: { bytes: new Uint8Array([1, 2, 3]) } },
  });
  assert.equal("text" in (content[1] ?? {}), true);
  assert.match((content[1] as { text: string }).text, /Share the wall equally/);
});

test("Nova keeps transcription-only prose artifacts for tutor grounding", () => {
  const mapped = mapNovaResponse({
    transcription: "Share the wall equally.",
    regions: [{ regionId: region.id, transcription: "Share the wall equally." }],
  }, { pageId: region.pageId, regions: [region] });

  assert.equal(mapped.artifacts.length, 1);
  assert.equal(mapped.artifacts[0]?.transcription, "Share the wall equally.");
  assert.equal(mapped.artifacts[0]?.latex, undefined);
});
