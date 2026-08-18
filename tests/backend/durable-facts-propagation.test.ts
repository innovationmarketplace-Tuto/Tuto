import assert from "node:assert/strict";
import test from "node:test";

import { prepare } from "../../convex/tutor";
import type { BedrockConverseRequest } from "../../src/intelligence/bedrock-tutor";
import { BedrockTutorModel } from "../../src/intelligence/bedrock-tutor";

type Row = Record<string, any> & { _id: string };

/** Minimal Convex-shaped store for exercising the server prepare query. */
class FakeDb {
  private readonly tables = new Map<string, Row[]>();

  seed(table: string, id: string, value: Record<string, any>): void {
    const rows = this.tables.get(table) ?? [];
    rows.push({ ...value, _id: id });
    this.tables.set(table, rows);
  }

  query(table: string): FakeQuery {
    return new FakeQuery(this.tables.get(table) ?? []);
  }

  async get(id: string): Promise<Row | null> {
    for (const rows of this.tables.values()) {
      const row = rows.find((candidate) => candidate._id === id);
      if (row) return row;
    }
    return null;
  }
}

class FakeQuery {
  constructor(private readonly rows: Row[]) {}

  withIndex(
    _name: string,
    configure: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
  ): FakeQueryResult {
    const clauses: Array<[string, unknown]> = [];
    const query = {
      eq: (field: string, value: unknown) => {
        clauses.push([field, value]);
        return query;
      },
    };
    configure(query);
    return new FakeQueryResult(
      this.rows.filter((row) => clauses.every(([field, value]) => row[field] === value)),
    );
  }
}

class FakeQueryResult {
  constructor(private readonly rows: Row[]) {}

  order(direction: "asc" | "desc"): FakeQueryResult {
    const sorted = [...this.rows].sort((left, right) => {
      const leftTime = String(left.updatedAt ?? left.createdAt ?? left._id);
      const rightTime = String(right.updatedAt ?? right.createdAt ?? right._id);
      return direction === "desc"
        ? rightTime.localeCompare(leftTime)
        : leftTime.localeCompare(rightTime);
    });
    return new FakeQueryResult(sorted);
  }

  async take(limit: number): Promise<Row[]> {
    return this.rows.slice(0, limit);
  }

  async collect(): Promise<Row[]> {
    return [...this.rows];
  }

  async unique(): Promise<Row | null> {
    if (this.rows.length > 1) throw new Error("unique() found multiple rows");
    return this.rows[0] ?? null;
  }
}

function invokePrepare(db: FakeDb, args: Record<string, unknown>): Promise<any> {
  return (prepare as any)._handler({
    db,
    auth: { getUserIdentity: async () => ({ subject: "user-a|session-1" }) },
  }, args);
}

function seedLearnerAndSession(db: FakeDb): void {
  db.seed("learners", "learner-facts", {
    studentId: "student-facts",
    ownerUserId: "user-a",
    archivedAt: undefined,
  });
  db.seed("learnerSessions", "thread-facts", {
    studentId: "student-facts",
    ownerUserId: "user-a",
    threadId: "thread-facts",
    scope: "chat",
    currentSkillIds: [],
    hintsShown: 0,
    hintSummaries: [],
    status: "active",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  });
}

function seedFacts(db: FakeDb): void {
  // More rows than the retrieval contract permits. The oldest rows must stay
  // out of both the teaching brief and the provider request.
  for (let index = 0; index < 25; index += 1) {
    const minute = String(index).padStart(2, "0");
    db.seed("learnerFacts", `fact-noise-${minute}`, {
      studentId: "student-facts",
      ownerUserId: "user-a",
      key: `noise-${minute}`,
      value: `noise-value-${minute}`,
      source: "import",
      confidence: 0.4,
      editable: true,
      createdAt: `2026-08-17T00:${minute}:00.000Z`,
      updatedAt: `2026-08-17T00:${minute}:00.000Z`,
    });
  }

  // This is the only fact the model needs to personalize this turn. The
  // extra fields represent database metadata that must not cross the prompt
  // boundary, even though they are present on the server row.
  db.seed("learnerFacts", "fact-preferred-support", {
    studentId: "student-facts",
    ownerUserId: "user-a",
    key: "preferred_support",
    value: "Use a visual prerequisite explanation.",
    source: "human_review",
    confidence: 0.97,
    editable: true,
    createdAt: "2026-08-17T01:00:00.000Z",
    updatedAt: "2026-08-17T01:00:00.000Z",
    privateDatabaseNote: "do-not-send-private-note",
    providerTraceId: "do-not-send-provider-trace",
  });
}

test("server durable facts survive prepare, prompt projection, and Bedrock request boundaries", async () => {
  const db = new FakeDb();
  seedLearnerAndSession(db);
  seedFacts(db);

  const prepared = await invokePrepare(db, {
    ownerUserId: "user-a",
    studentId: "student-facts",
    threadId: "thread-facts",
    message: "How should I approach this problem?",
    scope: "chat",
  });

  const briefFacts = prepared.durableFacts;
  assert.equal(briefFacts.length, 20, "prepare should apply the bounded durable-fact limit");
  assert.equal(briefFacts.some((fact: any) => fact.key === "noise-00"), false);
  assert.deepEqual(
    briefFacts.find((fact: any) => fact.key === "preferred_support"),
    {
      key: "preferred_support",
      value: "Use a visual prerequisite explanation.",
      source: "human_review",
      confidence: 0.97,
    },
    "the teaching brief should expose only model-relevant fact fields",
  );
  assert.equal(JSON.stringify(prepared.teachingBrief).includes("do-not-send-private-note"), false);
  assert.equal(JSON.stringify(prepared.teachingBrief).includes("do-not-send-provider-trace"), false);

  let request: BedrockConverseRequest | undefined;
  const model = new BedrockTutorModel({
    modelId: "test-durable-facts-model",
    converse: async (nextRequest) => {
      request = nextRequest;
      return {
        output: {
          message: {
            content: [{
              text: JSON.stringify({
                reply: "Use the visual prerequisite explanation, then name the quantities.",
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

  await model.generateTurn({
    studentId: "student-facts",
    threadId: "thread-facts",
    message: "How should I approach this problem?",
    currentProblem: prepared.currentProblem,
    subjectContext: prepared.subjectContext,
    teachingBrief: prepared.teachingBrief,
    durableFacts: prepared.durableFacts,
    recentMessages: prepared.recentMessages,
  });

  const content = request?.messages[0]?.content ?? [];
  const promptPart = content.find((part) => "text" in part);
  assert.ok(promptPart && "text" in promptPart, "Bedrock request should include the tutor prompt");
  const prompt = (promptPart as { text: string }).text;
  assert.match(prompt, /preferred_support/);
  assert.match(prompt, /Use a visual prerequisite explanation/);
  assert.doesNotMatch(prompt, /do-not-send-private-note|do-not-send-provider-trace/);
  assert.doesNotMatch(prompt, /"noise-00"/);
});
