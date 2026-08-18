import assert from "node:assert/strict";
import test from "node:test";

import { prepare } from "../../convex/tutor";

type Row = Record<string, any> & { _id: string };

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

  withIndex(_name: string, configure: (query: { eq: (field: string, value: unknown) => unknown }) => unknown): FakeQueryResult {
    const clauses: Array<[string, unknown]> = [];
    const query = {
      eq: (field: string, value: unknown) => {
        clauses.push([field, value]);
        return query;
      },
    };
    configure(query);
    return new FakeQueryResult(this.rows.filter((row) => clauses.every(([field, value]) => row[field] === value)));
  }
}

class FakeQueryResult {
  constructor(private readonly rows: Row[]) {}

  order(direction: "asc" | "desc"): FakeQueryResult {
    const sorted = [...this.rows].sort((left, right) => {
      const leftTime = String(left.updatedAt ?? left.createdAt ?? left._id);
      const rightTime = String(right.updatedAt ?? right.createdAt ?? right._id);
      return direction === "desc" ? rightTime.localeCompare(leftTime) : leftTime.localeCompare(rightTime);
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

function invoke(db: FakeDb, args: Record<string, unknown>): Promise<any> {
  const context = { db, auth: { getUserIdentity: async () => ({ subject: "user-a|session-1" }) } };
  return (prepare as any)._handler(context, args);
}

function seedBase(
  db: FakeDb,
  studentId: string,
  threadId: string,
  currentSkillIds: string[],
  scope: "chat" | "worksheet" = "worksheet",
): void {
  db.seed("learners", `${studentId}:learner`, { studentId, ownerUserId: "user-a" });
  db.seed("learnerSessions", threadId, {
    studentId,
    ownerUserId: "user-a",
    threadId,
    scope,
    ...(scope === "worksheet" ? { contextKey: "page-wall" } : {}),
    currentSkillIds,
    hintsShown: 0,
    hintSummaries: [],
    status: "active",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  });
}

function seedSkill(db: FakeDb, id: string, value: { name: string; objective: string; subject: string; aliases: string[] }): void {
  db.seed("skills", id, {
    namespace: "tuto",
    status: "active",
    ...value,
    version: 1,
    createdBy: "human",
  });
}

function seedRegionPage(db: FakeDb, transcription: string): void {
  db.seed("artifactPages", "page-wall", {
    _id: "page-wall",
    ownerUserId: "user-a",
    studentId: "student-wall",
    artifactId: "artifact-wall",
    revision: 1,
    storageId: undefined,
    mimeType: "image/jpeg",
    naturalWidth: 800,
    naturalHeight: 1_000,
  });
  db.seed("pageRegions", "region-wall", {
    pageId: "page-wall",
    revision: 1,
    kind: "problem",
    polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.2 }, { x: 0, y: 0.2 }],
    bounds: { x: 0, y: 0, width: 1, height: 0.2 },
    transcription,
    source: "document_analyzer",
  });
}

test("worksheet teaching brief resolves from current page transcription, not spoofed skill memory", async () => {
  const db = new FakeDb();
  seedSkill(db, "fraction-common-denominator", {
    name: "Common denominator",
    objective: "Choose a common denominator before adding fractions.",
    subject: "fractions",
    aliases: ["common denominator"],
  });
  seedSkill(db, "equal-sharing", {
    name: "Equal sharing",
    objective: "Partition a total into equal shares.",
    subject: "math",
    aliases: ["share equally"],
  });
  seedBase(db, "student-wall", "thread-wall", ["fraction-common-denominator"]);
  seedRegionPage(db, "Share equally: 30 square feet among 4 students.");

  const prepared = await invoke(db, {
    ownerUserId: "user-a",
    studentId: "student-wall",
    threadId: "thread-wall",
    scope: "worksheet",
    contextKey: "page-wall",
    pageId: "page-wall",
    pageRevision: 1,
    activeRegionIds: ["region-wall"],
    currentSkillIds: ["fraction-common-denominator"],
    currentProblem: "Common denominator from a stale client request",
  });

  assert.deepEqual(prepared.teachingBrief.currentSkillIds, ["equal-sharing"]);
  assert.equal(prepared.subjectContext.source, "worksheet");
  assert.match(prepared.subjectContext.objective, /Share equally/);
  assert.doesNotMatch(JSON.stringify(prepared.teachingBrief), /fraction-common-denominator/);
});

test("chat teaching brief resolves from the current message only", async () => {
  const db = new FakeDb();
  seedSkill(db, "fraction-common-denominator", {
    name: "Common denominator",
    objective: "Choose a common denominator before adding fractions.",
    subject: "fractions",
    aliases: ["common denominator"],
  });
  seedSkill(db, "equal-sharing", {
    name: "Equal sharing",
    objective: "Partition a total into equal shares.",
    subject: "math",
    aliases: ["share equally"],
  });
  seedBase(db, "student-chat", "thread-chat", ["equal-sharing"], "chat");

  const prepared = await invoke(db, {
    ownerUserId: "user-a",
    studentId: "student-chat",
    threadId: "thread-chat",
    scope: "chat",
    message: "How do I find a common denominator for 1/2 + 1/3?",
    currentSkillIds: ["equal-sharing"],
    currentProblem: "An old equal-sharing problem",
  });

  assert.deepEqual(prepared.teachingBrief.currentSkillIds, ["fraction-common-denominator"]);
  assert.equal(prepared.subjectContext.source, "chat");
  assert.equal(prepared.subjectContext.subject, "fractions");
  assert.doesNotMatch(JSON.stringify(prepared.teachingBrief), /equal-sharing/);
});
