import assert from "node:assert/strict";
import test from "node:test";

import { listSessions } from "../../convex/memory";
import { list as listMessages } from "../../convex/messages";
import { begin } from "../../convex/tutor";

type Row = Record<string, any> & { _id: string };

class FakeDb {
  private readonly tables = new Map<string, Row[]>();
  private nextId = 1;

  seed(table: string, value: Record<string, any>): string {
    const id = `${table}:${this.nextId++}`;
    const rows = this.tables.get(table) ?? [];
    rows.push({ ...value, _id: id });
    this.tables.set(table, rows);
    return id;
  }

  query(table: string) {
    return new FakeQuery(this.tables.get(table) ?? []);
  }

  async insert(table: string, value: Record<string, any>): Promise<string> {
    return this.seed(table, value);
  }

  async patch(id: string, value: Record<string, any>): Promise<void> {
    for (const rows of this.tables.values()) {
      const row = rows.find((candidate) => candidate._id === id);
      if (row) Object.assign(row, value);
    }
  }

  async get(id: string): Promise<Row | null> {
    for (const rows of this.tables.values()) {
      const row = rows.find((candidate) => candidate._id === id);
      if (row) return row;
    }
    return null;
  }

  rows(table: string): Row[] {
    return [...(this.tables.get(table) ?? [])];
  }
}

class FakeQuery {
  constructor(private readonly rows: Row[]) {}

  withIndex(_name: string, configure: (query: { eq: (field: string, value: unknown) => any }) => unknown) {
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

  order(direction: "asc" | "desc") {
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

function context(db: FakeDb, subject = "user-a|session-1") {
  return { db, auth: { getUserIdentity: async () => ({ subject }) } };
}

async function invoke(builder: unknown, db: FakeDb, args: Record<string, unknown>, subject = "user-a|session-1") {
  return (builder as any)._handler(context(db, subject), args);
}

const timestamps = {
  old: "2026-08-17T00:00:00.000Z",
  new: "2026-08-17T01:00:00.000Z",
};

test("session history treats legacy rows as chat and scopes worksheets by context", async () => {
  const db = new FakeDb();
  db.seed("learners", { studentId: "student-a", ownerUserId: "user-a" });
  const base = {
    studentId: "student-a",
    ownerUserId: "user-a",
    currentSkillIds: [],
    hintsShown: 0,
    hintSummaries: [],
    status: "active",
  };
  db.seed("learnerSessions", { ...base, threadId: "legacy", createdAt: timestamps.old, updatedAt: timestamps.old });
  db.seed("learnerSessions", { ...base, threadId: "chat", scope: "chat", createdAt: timestamps.new, updatedAt: timestamps.new });
  db.seed("learnerSessions", { ...base, threadId: "worksheet-a", scope: "worksheet", contextKey: "page:a", createdAt: timestamps.new, updatedAt: timestamps.new });
  db.seed("learnerSessions", { ...base, threadId: "worksheet-b", scope: "worksheet", contextKey: "page:b", createdAt: timestamps.new, updatedAt: timestamps.new });

  const chat = await invoke(listSessions, db, { studentId: "student-a", scope: "chat" });
  assert.deepEqual(chat.map((row: any) => row.threadId).sort(), ["chat", "legacy"]);
  const worksheet = await invoke(listSessions, db, { studentId: "student-a", scope: "worksheet", contextKey: "page:a" });
  assert.deepEqual(worksheet.map((row: any) => row.threadId), ["worksheet-a"]);
});

test("system tutor kickoffs persist privately and visible history contains only the tutor reply", async () => {
  const db = new FakeDb();
  db.seed("learners", { studentId: "student-a", ownerUserId: "user-a" });
  const result = await invoke(begin, db, {
    ownerUserId: "user-a",
    studentId: "student-a",
    threadId: "worksheet-a",
    scope: "worksheet",
    contextKey: "page:a",
    message: "Welcome the learner and ask them to choose a step.",
    idempotencyKey: "kickoff-1",
    systemInitiated: true,
    currentSkillIds: [],
  });
  assert.equal(result.status, "pending");
  const kickoff = db.rows("tutorMessages")[0];
  assert.equal(kickoff.isVisible, false);
  assert.equal(kickoff.isHidden, true);

  db.seed("tutorMessages", {
    studentId: "student-a",
    ownerUserId: "user-a",
    threadId: "worksheet-a",
    scope: "worksheet",
    contextKey: "page:a",
    role: "tutor",
    text: "Which step would you like to inspect?",
    annotationIds: [],
    isVisible: true,
    createdAt: timestamps.new,
  });
  const visible = await invoke(listMessages, db, {
    studentId: "student-a",
    threadId: "worksheet-a",
    scope: "worksheet",
    contextKey: "page:a",
  });
  assert.deepEqual(visible.map((row: any) => row.role), ["tutor"]);
  await assert.rejects(
    () => invoke(listMessages, db, { studentId: "student-a", threadId: "worksheet-a", scope: "chat" }),
    /another conversation scope/,
  );
});
