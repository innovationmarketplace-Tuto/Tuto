import { DEMO_PAGE, DEMO_REGIONS } from "../constants/demo-fixtures";
import { GOLDEN_SKILLS, GOLDEN_TEACHING_BRIEFS } from "./eval-fixtures";
import { FakeTutorModel } from "./fake-tutor";
import { BedrockTutorModel } from "./bedrock-tutor";
import { OpenAiTutorModel } from "./openai-tutor";
import { regionsFromBda } from "./bda-geometry";
import { AwsBdaDocumentAnalyzer } from "./bda-adapter";
import { cropLocalToPage, verifyCropMapping } from "./crop-geometry";
import { FakeDocumentAnalyzer, GOLDEN_PAGE, goldenPageRegions } from "./fake-document-analyzer";
import { groupPageRegions } from "./region-grouping";
import { resolveSkill } from "./skill-resolver";
import { selectDocumentAnalyzer, selectTutorProvider } from "./providers";
import { mapNovaResponse } from "./nova-mapper";
import { StructuredOutputError, validateTutorResult } from "./validation";

// A 1x1 PNG, used wherever a test needs real, decodable image bytes rather
// than a page's actual pixels (e.g. to exercise canonicalization).
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==",
  "base64",
);

type TestCallback = () => void | Promise<void>;
const test = (_name: string, callback: TestCallback): void => {
  void Promise.resolve(callback()).catch((error) => {
    throw error;
  });
};
const assert = {
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`Expected ${String(actual)} to equal ${String(expected)}`);
  },
  notEqual(actual: unknown, expected: unknown): void {
    if (actual === expected) throw new Error(`Expected values to differ: ${String(actual)}`);
  },
  ok(value: unknown): void {
    if (!value) throw new Error("Expected a truthy value");
  },
  match(value: string, pattern: RegExp): void {
    if (!pattern.test(value)) throw new Error(`Expected ${value} to match ${pattern}`);
  },
  doesNotMatch(value: string, pattern: RegExp): void {
    if (pattern.test(value)) throw new Error(`Expected ${value} not to match ${pattern}`);
  },
  deepEqual(actual: unknown, expected: unknown): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  },
  throws(callback: () => unknown, predicate: (error: unknown) => boolean): void {
    try {
      callback();
    } catch (error) {
      if (predicate(error)) return;
      throw error;
    }
    throw new Error("Expected callback to throw");
  },
};

const tutorInput = (studentId: string) => ({
  studentId,
  threadId: "test-thread",
  message: "How should I add 1/2 + 1/3?",
  teachingBrief: GOLDEN_TEACHING_BRIEFS[studentId],
  artifactContext: { artifactId: DEMO_PAGE.artifactId, pageId: DEMO_PAGE.id, activeRegionIds: ["region-denominator-step"] },
  pageRegions: DEMO_REGIONS,
});

test("fake tutor deterministically personalizes the same question", async () => {
  const model = new FakeTutorModel();
  const maya = await model.generateTurn(tutorInput("maya"));
  const jonah = await model.generateTurn(tutorInput("jonah"));
  assert.notEqual(maya.reply, jonah.reply);
  assert.match(maya.reply, /common denominator/i);
  assert.match(jonah.reply, /check/i);
  assert.equal(maya.annotations[0]?.targetRegionId, "region-denominator-step");
  assert.equal(maya.metadata?.provider, "fake");
});

test("strict tutor validation rejects malformed output", () => {
  assert.throws(
    () => validateTutorResult({ reply: "", skillResolutions: [], candidateEvidence: [], annotations: [] }, tutorInput("maya")),
    (error: unknown) => error instanceof StructuredOutputError,
  );
});

test("Bedrock adapter validates structured output and falls back without raw leakage", async () => {
  const model = new BedrockTutorModel({
    modelId: "test-model",
    converse: async () => ({ output: { message: { content: [{ text: "not json" }] } } }),
    fallback: new FakeTutorModel(),
  });
  const result = await model.generateTurn(tutorInput("maya"));
  assert.equal(result.metadata?.provider, "bedrock");
  assert.equal(result.metadata?.fallbackUsed, true);
  assert.equal(result.metadata?.fallbackProvider, "fake");
  assert.doesNotMatch(JSON.stringify(result), /not json/);
});

test("OpenAI adapter validates structured output and falls back without raw leakage", async () => {
  const model = new OpenAiTutorModel({
    model: "test-model",
    chat: async () => ({ choices: [{ message: { content: "not json" } }] }),
    fallback: new FakeTutorModel(),
  });
  const result = await model.generateTurn(tutorInput("maya"));
  assert.equal(result.metadata?.provider, "openai");
  assert.equal(result.metadata?.fallbackUsed, true);
  assert.equal(result.metadata?.fallbackProvider, "fake");
  assert.doesNotMatch(JSON.stringify(result), /not json/);
});

test("OpenAI adapter defaults to low reasoning effort and omits temperature", async () => {
  let request: any;
  const model = new OpenAiTutorModel({
    model: "test-model",
    chat: async (req) => {
      request = req;
      return { choices: [{ message: { content: JSON.stringify({ reply: "ok", skillResolutions: [], candidateEvidence: [], annotations: [], learnerFacts: [] }) } }] };
    },
  });
  await model.generateTurn(tutorInput("maya"));
  assert.equal(request.reasoning_effort, "low");
  assert.equal("temperature" in request, false);
  // Reasoning models (gpt-5.x family) reject `max_tokens` with a 400 and
  // require `max_completion_tokens`; regressing this silently falls back to
  // the fake tutor on every call instead of surfacing the failure.
  assert.equal("max_tokens" in request, false);
  assert.equal(typeof request.max_completion_tokens, "number");
});

test("BDA geometry adapter normalizes pixels and links words to lines", () => {
  const result = regionsFromBda({
    metadata: { image_width_pixels: 1_000, image_height_pixels: 800 },
    image: {
      text_lines: [{ id: "line-a", text: "x = 6", confidence: 0.96, locations: [{ bounding_box: { left: 100, top: 160, width: 500, height: 80 } }] }],
      text_words: [{ id: "word-b", line_id: "line-a", text: "6", confidence: 0.98, locations: [{ bounding_box: { left: 500, top: 160, width: 100, height: 80 } }] }],
    },
  }, { pageId: "page-001", revision: 1 });
  assert.equal(result.regions[0]?.id, "line-001");
  assert.equal(result.regions[1]?.id, "line-001-word-01");
  assert.deepEqual(result.regions[0]?.bounds, { x: 0.1, y: 0.2, width: 0.5, height: 0.09999999999999998 });
  assert.equal(result.regions[1]?.parentRegionId, "line-001");
  assert.equal(result.regions[1]?.confidence, 0.98);
});

test("BDA geometry adapter reads DOCUMENT-modality output (top-level text_lines, singular locations)", () => {
  // Bedrock Data Automation classifies some pages as DOCUMENT rather than
  // IMAGE modality. That shape puts text_lines/text_words at the payload's
  // top level (not nested under `image`) and gives each item a single
  // `locations` object instead of an array, with bounding boxes already
  // normalized to the page. See docs.aws.amazon.com/bedrock standard output
  // for documents.
  const result = regionsFromBda({
    metadata: { semantic_modality: "DOCUMENT" },
    document: { statistics: { line_count: 1, word_count: 1 } },
    pages: [{ id: "page-1", page_index: 0 }],
    elements: [],
    text_lines: [{
      id: "line-a",
      text: "x = 6",
      confidence: 0.96,
      locations: { page_index: 0, bounding_box: { left: 0.1, top: 0.2, width: 0.5, height: 0.1 } },
    }],
    text_words: [{
      id: "word-b",
      line_id: "line-a",
      text: "6",
      confidence: 0.98,
      locations: { page_index: 0, bounding_box: { left: 0.5, top: 0.2, width: 0.1, height: 0.1 } },
    }],
  }, { pageId: "page-001", revision: 1 });
  assert.equal(result.lineCount, 1);
  assert.equal(result.wordCount, 1);
  assert.equal(result.regions[0]?.id, "line-001");
  assert.equal(result.regions[1]?.id, "line-001-word-01");
  assert.equal(result.regions[1]?.parentRegionId, "line-001");
});

test("Nova semantic mapping accepts only existing region IDs and never returns coordinates", () => {
  const mapping = mapNovaResponse({
    transcription: "x = 6",
    latex: "x = 6",
    regions: [
      { regionId: "line-001", transcription: "x = 6", latex: "x = 6", bounds: { x: 0, y: 0, width: 1, height: 1 } },
      { regionId: "invented", latex: "y = 7", bounds: { x: 0, y: 0, width: 1, height: 1 } },
    ],
    annotations: [{ regionId: "line-001", type: "highlight" }, { regionId: "invented", type: "circle" }],
  }, {
    pageId: "page-001",
    regions: [{ id: "line-001", pageId: "page-001", revision: 1, kind: "equation", polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], bounds: { x: 0, y: 0, width: 1, height: 1 }, source: "text_detector" }],
  });
  assert.equal(mapping.artifacts.length, 1);
  assert.equal(mapping.annotations.length, 1);
  assert.equal("bounds" in mapping.artifacts[0]!, false);
});

test("BDA adapter keeps raw provider output inside the adapter", async () => {
  const analyzer = new AwsBdaDocumentAnalyzer({
    projectArn: "arn:aws:bedrock:test:project",
    profileArn: "arn:aws:bedrock:test:profile",
    invoke: async () => ({
      outputSegments: [{ standardOutput: JSON.stringify({ metadata: { image_width_pixels: 100, image_height_pixels: 100 }, image: { text_lines: [{ id: "line-a", text: "x = 6", confidence: 0.9, locations: [{ bounding_box: { left: 10, top: 10, width: 30, height: 10 } }] }] } }) }],
      secret: "must not escape",
    }),
  });
  const page = (await analyzer.analyze({ artifactId: GOLDEN_PAGE.artifactId, page: GOLDEN_PAGE, image: { mimeType: "image/png", bytes: ONE_PIXEL_PNG } }))[0]!;
  assert.equal(page.metadata.provider, "aws_bda");
  assert.doesNotMatch(JSON.stringify(page), /must not escape/);
});

test("region grouping and crop conversion are deterministic and bounded", () => {
  const source = goldenPageRegions();
  const grouped = groupPageRegions(source);
  assert.equal(grouped.filter((region) => region.kind === "problem").length, 1);
  assert.ok(grouped.some((region) => region.kind === "solution_step"));
  assert.equal(new Set(grouped.map((region) => region.id)).size, grouped.length);
  const local = { polygon: [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.2 }, { x: 0.9, y: 0.8 }, { x: 0.1, y: 0.8 }], bounds: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 } };
  const crop = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 };
  assert.deepEqual(cropLocalToPage(local, crop).bounds, { x: 0.24000000000000002, y: 0.33999999999999997, width: 0.32000000000000006, height: 0.12000000000000005 });
  assert.equal(verifyCropMapping(local, crop).valid, true);
  assert.equal(verifyCropMapping({ ...local, polygon: [{ x: -0.2, y: 0 }, ...local.polygon.slice(1)] }, crop).valid, false);
});

test("fake analyzer returns the checked-in golden revision", async () => {
  const pages = await new FakeDocumentAnalyzer().analyze({ artifactId: GOLDEN_PAGE.artifactId, page: GOLDEN_PAGE, image: { mimeType: "image/jpeg", dataUrl: GOLDEN_PAGE.imageUrl } });
  assert.equal(pages.length, 1);
  assert.equal(pages[0]?.pageId, GOLDEN_PAGE.id);
  assert.equal(pages[0]?.revision, GOLDEN_PAGE.revision);
  assert.ok(pages[0]?.regions.some((region) => region.id === "step-001"));
});

test("skill resolver is exact/text-first and never silently activates proposals", () => {
  assert.deepEqual(resolveSkill({ objective: "common denominator", skills: GOLDEN_SKILLS }).decision, "existing");
  assert.deepEqual(resolveSkill({ objective: "choose a fraction operation from a story", skills: GOLDEN_SKILLS }).decision, "proposed");
});

test("provider selection defaults to fake and disables incomplete real configuration", () => {
  const tutor = selectTutorProvider({ TUTOR_MODEL_PROVIDER: "bedrock" });
  const openaiTutor = selectTutorProvider({ TUTOR_MODEL_PROVIDER: "openai" });
  const analyzer = selectDocumentAnalyzer({ DOCUMENT_ANALYSIS_PROVIDER: "aws_bda" });
  assert.equal(tutor.provider, "fake");
  assert.equal(tutor.enabled, false);
  assert.equal(openaiTutor.provider, "fake");
  assert.equal(openaiTutor.enabled, false);
  assert.equal(analyzer.provider, "fake");
  assert.equal(analyzer.enabled, false);
});

test("provider selection enables OpenAI once an API key is present", () => {
  const tutor = selectTutorProvider({ TUTOR_MODEL_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
  assert.equal(tutor.provider, "openai");
  assert.equal(tutor.enabled, true);
});
