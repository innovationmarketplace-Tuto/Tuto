import {
  DocumentUploadError,
  normalizeDocumentMime,
  normalizePersistedRegions,
  uploadBlobToConvex,
  uploadCanonicalPage,
  waitForAnalysisJob,
} from "./upload";

type TestCallback = () => void | Promise<void>;
const test = (_name: string, callback: TestCallback): void => {
  void Promise.resolve(callback()).catch((error: unknown) => {
    throw error;
  });
};
function equal(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${String(actual)} to equal ${String(expected)}`);
}
function ok(value: unknown): void {
  if (!value) throw new Error("Expected a truthy value");
}
function deepEqual(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
}
function throws(callback: () => unknown, predicate: (error: unknown) => boolean): void {
  try {
    callback();
  } catch (error) {
    if (predicate(error)) return;
    throw error;
  }
  throw new Error("Expected callback to throw");
}

test("normalizes picker MIME metadata and rejects unsupported pages", () => {
  equal(normalizeDocumentMime({ mimeType: "image/jpg", name: "worksheet" }), "image/jpeg");
  equal(normalizeDocumentMime({ mimeType: undefined, name: "worksheet.PNG" }), "image/png");
  throws(
    () => normalizeDocumentMime({ mimeType: "application/pdf", name: "worksheet.pdf" }),
    (error: unknown) => error instanceof DocumentUploadError && error.code === "unsupported_type",
  );
});

test("retries transient Convex storage failures and posts a Blob, never base64", async () => {
  const body = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
  const requests: RequestInit[] = [];
  let attempts = 0;
  const sleepCalls: number[] = [];
  const storageId = await uploadBlobToConvex("https://convex.test/upload", body, "image/jpeg", {
    maxRetries: 2,
    sleep: async (milliseconds) => { sleepCalls.push(milliseconds); },
    fetchImpl: async (_input, init) => {
      attempts += 1;
      requests.push(init ?? {});
      if (attempts === 1) return new Response("busy", { status: 503 });
      return new Response(JSON.stringify({ storageId: "storage-page-1" }), { status: 200 });
    },
  });
  equal(storageId, "storage-page-1");
  equal(attempts, 2);
  equal(sleepCalls.length, 1);
  equal(requests[0]?.headers instanceof Headers ? requests[0].headers.get("Content-Type") : "image/jpeg", "image/jpeg");
  ok(requests[0]?.body instanceof Blob);
  equal(typeof requests[0]?.body, "object");
});

test("uploads a canonical page to Convex storage before scheduling analysis", async () => {
  const calls: string[] = [];
  const asset = {
    uri: "file:///worksheet.jpg",
    name: "worksheet.jpg",
    mimeType: "image/jpeg",
    width: 1_200,
    height: 1_600,
    file: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" }),
  };
  const result = await uploadCanonicalPage({
    artifactId: "artifact-1",
    studentId: "student-1",
    idempotencyKey: "scan-1",
    asset,
    generateUploadUrl: async () => {
      calls.push("generateUploadUrl");
      return "https://convex.test/upload";
    },
    createArtifact: async () => {
      calls.push("createArtifact");
      return "artifact-record-1" as never;
    },
    createPage: async (args) => {
      calls.push(`createPage:${args.storageId}`);
      equal(args.byteLength, 4);
      equal(args.naturalWidth, 1_200);
      return "page-1" as never;
    },
    submitScan: async (args) => {
      calls.push(`submitScan:${args.pageId}:${args.pageRevision}`);
      return "job-1" as never;
    },
    fetchImpl: async (_input, init) => {
      calls.push(`upload:${init?.method}`);
      ok(init?.body instanceof Blob);
      return new Response(JSON.stringify({ storageId: "storage-1" }), { status: 201 });
    },
  });
  deepEqual(calls, [
    "createArtifact",
    "generateUploadUrl",
    "upload:POST",
    "createPage:storage-1",
    "submitScan:page-1:1",
  ]);
  equal(result.storageId, "storage-1");
  equal(result.jobId, "job-1");
});

test("maps persisted Convex regions to normalized renderer IDs", () => {
  const regions = normalizePersistedRegions([{
    _id: "region-child",
    pageId: "page-1",
    parentRegionId: "region-parent",
    revision: 2,
    kind: "equation",
    polygon: [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.4 }],
    bounds: { x: 0.1, y: 0.2, width: 0.4, height: 0.2 },
    transcription: "x = 6",
    source: "text_detector",
  }]);
  deepEqual(regions, [{
    id: "region-child",
    pageId: "page-1",
    parentRegionId: "region-parent",
    revision: 2,
    kind: "equation",
    polygon: [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.4 }],
    bounds: { x: 0.1, y: 0.2, width: 0.4, height: 0.2 },
    transcription: "x = 6",
    source: "text_detector",
  }]);
});

test("waits for a terminal analysis job with exponential delays", async () => {
  const states = ["scheduled", "running", "completed"] as const;
  let reads = 0;
  const delays: number[] = [];
  const job = await waitForAnalysisJob(
    async () => ({ status: states[Math.min(reads++, states.length - 1)]! }),
    { initialDelayMs: 10, maxDelayMs: 20, sleep: async (milliseconds) => { delays.push(milliseconds); } },
  );
  equal(job.status, "completed");
  deepEqual(delays, [10, 20]);
});
