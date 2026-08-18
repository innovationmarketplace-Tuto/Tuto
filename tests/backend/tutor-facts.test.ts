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
}

class FakeQuery {
  constructor(private readonly rows: Row[]) {}

  withIndex(
    _name: string,
    configure: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
  ): FakeQueryResult {
    const clauses: [string, unknown][] = [];
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

test("prepare returns only owned, bounded tutor-facing learner facts", async () => {
  const db = new FakeDb();
  db.seed("learners", "learner-a", {
    studentId: "student-a",
    ownerUserId: "user-a",
    archivedAt: undefined,
  });
  db.seed("learnerSessions", "thread-a", {
    studentId: "student-a",
    ownerUserId: "user-a",
    threadId: "thread-a",
    scope: "chat",
    currentSkillIds: [],
    status: "active",
  });
  const now = Date.now();
  for (let index = 0; index < 22; index += 1) {
    db.seed("learnerFacts", `fact-${index}`, {
      studentId: "student-a",
      ownerUserId: "user-a",
      key: index === 0 ? `goal-${"k".repeat(140)}` : `goal-${index}`,
      value: index === 0 ? `visual support ${"v".repeat(1_100)}` : `value-${index}`,
      source: "human_review",
      confidence: 0.8,
      editable: true,
      createdAt: new Date(now - index * 1_000).toISOString(),
      updatedAt: new Date(now - index * 1_000).toISOString(),
    });
  }
  db.seed("learnerFacts", "fact-wrong-owner", {
    studentId: "student-a",
    ownerUserId: "user-b",
    key: "private-other-learner",
    value: "must not escape",
    source: "student",
    confidence: 1,
    editable: true,
  });
  db.seed("learnerFacts", "fact-invalid", {
    studentId: "student-a",
    ownerUserId: "user-a",
    key: "invalid",
    value: "must be dropped",
    source: "unknown",
    confidence: 2,
  });

  const prepared = await (prepare as any)._handler({ db }, {
    ownerUserId: "user-a",
    studentId: "student-a",
    threadId: "thread-a",
    scope: "chat",
    message: "What should I work on?",
  });

  assert.ok(prepared.durableFacts.length <= 20);
  assert.ok(prepared.durableFacts.length > 0);
  assert.equal(prepared.durableFacts.some((fact: any) => fact.key === "private-other-learner"), false);
  assert.equal(prepared.durableFacts.some((fact: any) => fact.key === "invalid"), false);
  assert.ok(prepared.durableFacts.every((fact: any) => Object.keys(fact).sort().join(",") === "confidence,key,source,value"));
  assert.ok(prepared.durableFacts.every((fact: any) => fact.key.length <= 120 && fact.value.length <= 1_000));
  assert.equal(prepared.durableFacts[0]?.source, "human_review");
});
