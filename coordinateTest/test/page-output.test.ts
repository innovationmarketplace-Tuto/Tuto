import test from "node:test";
import assert from "node:assert/strict";
import { detectedTranscription, documentOutput } from "../src/page-output.js";

test("emits plan-shaped page JSON without tutoring evidence", () => {
  const regions = [{
    id: "line-001",
    kind: "line" as const,
    polygon: [[0.1, 0.2], [0.6, 0.2], [0.6, 0.3], [0.1, 0.3]] as [number, number][],
    bbox: [0.1, 0.2, 0.6, 0.3] as [number, number, number, number],
    ocrText: "x = 6",
    confidence: 96,
    source: "bda" as const,
  }];
  const transcription = detectedTranscription(regions);
  const output = documentOutput({
    requestId: "request-1",
    canonical: { bytes: Buffer.from("image"), dataUrl: "data:image/jpeg;base64,aW1hZ2U=", width: 1000, height: 800, format: "jpeg" },
    regions,
    transcription,
    latex: "x = 6",
    semanticArtifacts: [{ regionId: "line-001", transcription: "x = 6", latex: "x = 6", confidence: 0.97 }],
    annotations: [{ type: "highlight", regionId: "line-001", reason: "content" }],
  });

  assert.equal(output.transcription, "x = 6");
  assert.equal(output.latex, "x = 6");
  assert.equal(output.pages[0]?.id, "page-001");
  assert.equal(output.regions[0]?.kind, "equation");
  assert.equal(output.regions[0]?.latex, "x = 6");
  assert.equal(output.regions[0]?.source, "combined");
  assert.deepEqual(output.regions[0]?.bounds, { x: 0.1, y: 0.2, width: 0.5, height: 0.09999999999999998 });
  assert.equal(output.annotations[0]?.targetRegionId, "line-001");
  assert.deepEqual(output.messages[0]?.annotationIds, ["annotation-001"]);
});
