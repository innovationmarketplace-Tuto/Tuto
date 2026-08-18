import assert from "node:assert/strict";
import test from "node:test";

import { prepare } from "../../convex/tutor";

type Row = Record<string, any> & { _id: string };

class FakeDb {
  private readonly tables = new Map<string, Row[]>();
  private nextId = 1;

  seed(table: string, value: Record<string, any>): string {
    const id = String(value._id ?? `${table}:${this.nextId++}`);
    const rows = this.tables.get(table) ?? [];
    rows.push({ ...value, _id: id });
    this.tables.set(table, rows);
    return id;
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

  withIndex(_name: string, configure: (query: { eq: (field: string, value: unknown) => any }) => unknown): FakeQueryResult {
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
      const leftValue = String(left.updatedAt ?? left.createdAt ?? left._id);
      const rightValue = String(right.updatedAt ?? right.createdAt ?? right._id);
      return direction === "desc" ? rightValue.localeCompare(leftValue) : leftValue.localeCompare(rightValue);
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

function context(db: FakeDb) {
  return { db, auth: { getUserIdentity: async () => ({ subject: "user-a|session-1" }) } };
}

async function invoke(builder: unknown, db: FakeDb, args: Record<string, unknown>) {
  return (builder as any)._handler(context(db), args);
}

function seedPage(db: FakeDb, transcription: string): void {
  db.seed("artifactPages", {
    _id: "page:1",
    artifactId: "artifact:1",
    studentId: "student-a",
    ownerUserId: "user-a",
    revision: 1,
    storageId: "storage:1",
    mimeType: "image/jpeg",
    naturalWidth: 1_000,
    naturalHeight: 1_000,
  });
  db.seed("pageRegions", {
    _id: "region:1",
    pageId: "page:1",
    revision: 1,
    kind: "problem",
    transcription,
    polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    source: "text_detector",
  });
}

function seedCommon(db: FakeDb): void {
  db.seed("learners", { studentId: "student-a", ownerUserId: "user-a" });
  db.seed("learnerSessions", {
    studentId: "student-a",
    ownerUserId: "user-a",
    threadId: "worksheet-thread",
    scope: "worksheet",
    contextKey: "page:1",
    currentSkillIds: ["skill-stale"],
    hintsShown: 0,
    hintSummaries: [],
    status: "active",
  });
  db.seed("skills", {
    _id: "skill-denominator",
    namespace: "tuto-demo",
    status: "active",
    name: "Find a common denominator",
    objective: "Find a common denominator before adding fractions",
    subject: "fractions",
    aliases: ["common denominator", "make denominators match"],
    version: 1,
    createdBy: "human",
  });
  db.seed("skills", {
    _id: "skill-stale",
    namespace: "tuto-demo",
    status: "active",
    name: "Recognize equivalent fractions",
    objective: "Recognize equivalent fractions",
    subject: "fractions",
    aliases: ["equivalent fractions"],
    version: 1,
    createdBy: "human",
  });
}

test("prepare resolves worksheet skills from regions instead of stale session IDs", async () => {
  const db = new FakeDb();
  seedCommon(db);
  seedPage(db, "Find a common denominator before adding fractions.");

  const result = await invoke(prepare, db, {
    ownerUserId: "user-a",
    studentId: "student-a",
    threadId: "worksheet-thread",
    scope: "worksheet",
    contextKey: "page:1",
    message: "What should I check in this step?",
    currentSkillIds: ["skill-stale"],
    pageId: "page:1",
    pageRevision: 1,
    activeRegionIds: ["region:1"],
  });

  assert.deepEqual(result.teachingBrief.currentSkillIds, ["skill-denominator"]);
  assert.deepEqual(result.resolvedCurrentSkillIds, ["skill-denominator"]);
});

test("prepare clears stale worksheet IDs when no active skill matches page text", async () => {
  const db = new FakeDb();
  seedCommon(db);
  seedPage(db, "A wall is 12 feet long and 8 feet high.");

  const result = await invoke(prepare, db, {
    ownerUserId: "user-a",
    studentId: "student-a",
    threadId: "worksheet-thread",
    scope: "worksheet",
    contextKey: "page:1",
    message: "Can you help me start?",
    pageId: "page:1",
    pageRevision: 1,
    activeRegionIds: ["region:1"],
  });

  assert.deepEqual(result.teachingBrief.currentSkillIds, []);
  assert.deepEqual(result.resolvedCurrentSkillIds, []);
});
