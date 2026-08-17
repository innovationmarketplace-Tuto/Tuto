import test from "node:test";
import assert from "node:assert/strict";
import { novaBoxFromRegion, regionsFromBda } from "../src/geometry.js";

test("maps BDA line and linked word polygons to stable normalized regions", () => {
  const regions = regionsFromBda(JSON.stringify({
    metadata: { image_width_pixels: 1000, image_height_pixels: 800 },
    image: {
      text_lines: [{
        id: "line-a", text: "x = 6", confidence: 0.96,
        locations: [{ bounding_box: { left: 100, top: 160, width: 500, height: 80 }, polygon: [
          { x: 100, y: 160 }, { x: 600, y: 160 }, { x: 600, y: 240 }, { x: 100, y: 240 },
        ] }],
      }],
      text_words: [{
        id: "word-b", line_id: "line-a", text: "6", confidence: 0.98,
        locations: [{ bounding_box: { left: 500, top: 160, width: 100, height: 80 } }],
      }],
    },
  }));
  assert.equal(regions[0]?.id, "line-001");
  assert.equal(regions[1]?.id, "line-001-word-01");
  assert.deepEqual(novaBoxFromRegion(regions[0]!), [100, 200, 600, 300]);
  assert.equal(regions[1]?.confidence, 98);
  assert.equal(regions[1]?.source, "bda");
});

test("always supplies a page target when BDA returns no geometry", () => {
  const regions = regionsFromBda(undefined);
  assert.deepEqual(regions[0]?.bbox, [0, 0, 1, 1]);
  assert.equal(regions[0]?.id, "page-001");
});
