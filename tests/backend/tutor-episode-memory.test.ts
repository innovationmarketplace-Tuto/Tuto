import assert from "node:assert/strict";
import test from "node:test";

import { complete, prepare } from "../../convex/tutor";

type Row = Record<string, any> & { _id: string };

/** Minimal Convex-shaped store supporting both reads and writes, since
 * `complete` (unlike `prepare`) inserts/patches rows as it persists a turn. */
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
      const row = rows.find((candidate) => candidate._id === String(id));
      if (row) return row;
    }
    return null;
  }

  async patch(id: string, value: Record<string, any>): Promise<void> {
    for (const rows of this.tables.values()) {
      const row = rows.find((candidate) => candidate._id === String(id));
      if (row) {
        Object.assign(row, value);
        return;
      }
    }
    throw new Error(`patch target not found: ${id}`);
  }

  async insert(table: string, value: Record<string, any>): Promise<string> {
    return this.seed(table, value);
  }

  all(table: string): Row[] {
    return this.tables.get(table) ?? [];
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
    return new FakeQueryResult(this.rows.filter((row) => clauses.every(([field, value]) => row[field] === value)));
  }
}

class FakeQueryResult {
  constructor(private readonly rows: Row[]) {}

  order(direction: "asc" | "desc"): FakeQueryResult {
    const sorted = [...this.rows].sort((left, right) => {
      const leftValue = String(left.createdAt ?? left.updatedAt ?? left._id);
      const rightValue = String(right.createdAt ?? right.updatedAt ?? right._id);
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

function seedSkill(db: FakeDb): string {
  return db.seed("skills", {
    _id: "skill-power-rule",
    namespace: "tuto-demo",
    status: "active",
    name: "Differentiate power functions using the power rule",
    objective: "Apply the power rule to differentiate power functions",
    subject: "calculus",
    aliases: ["power rule"],
    version: 1,
    createdBy: "human",
  });
}

test("chat retains the thread's prior skill when a vague follow-up resolves nothing", async () => {
  const db = new FakeDb();
  db.seed("learners", { studentId: "student-a", ownerUserId: "user-a" });
  seedSkill(db);
  db.seed("learnerSessions", {
    studentId: "student-a",
    ownerUserId: "user-a",
    threadId: "chat-thread",
    scope: "chat",
    currentSkillIds: ["skill-power-rule"],
    hintsShown: 0,
    hintSummaries: [],
    status: "active",
  });

  const result = await invoke(prepare, db, {
    ownerUserId: "user-a",
    studentId: "student-a",
    threadId: "chat-thread",
    scope: "chat",
    message: "remind me what I was working on earlier",
  });

  assert.deepEqual(result.teachingBrief.currentSkillIds, ["skill-power-rule"]);
  assert.deepEqual(result.resolvedCurrentSkillIds, ["skill-power-rule"]);
});

test("chat falls back to recent episodes regardless of topic when no skill is known at all", async () => {
  const db = new FakeDb();
  db.seed("learners", { studentId: "student-a", ownerUserId: "user-a" });
  seedSkill(db);
  db.seed("episodicSummaries", {
    studentId: "student-a",
    ownerUserId: "user-a",
    summary: "Practiced the power rule on x^3 and x^5; independent by the end.",
    skillIds: ["skill-power-rule"],
    evidenceIds: [],
    importance: 0.6,
    sourceThreadId: "some-other-thread",
    createdAt: "2026-08-01T00:00:00.000Z",
  });

  const result = await invoke(prepare, db, {
    ownerUserId: "user-a",
    studentId: "student-a",
    threadId: "brand-new-chat-thread",
    scope: "chat",
    message: "remind me of what I was working on",
  });

  assert.deepEqual(result.teachingBrief.currentSkillIds, []);
  assert.deepEqual(result.teachingBrief.relevantEpisodes, [
    "Practiced the power rule on x^3 and x^5; independent by the end.",
  ]);
});

test("completing a turn with candidate evidence writes an episodic summary for later recall", async () => {
  const db = new FakeDb();
  const skillId = seedSkill(db);
  db.seed("learners", { studentId: "student-a", ownerUserId: "user-a" });
  const studentMessageId = db.seed("tutorMessages", {
    studentId: "student-a",
    ownerUserId: "user-a",
    threadId: "chat-thread",
    role: "student",
    text: "Can you check my work on x^4?",
    annotationIds: [],
    isVisible: true,
    idempotencyKey: "turn-1",
    createdAt: "2026-08-19T00:00:00.000Z",
  });
  const turnId = db.seed("tutorTurns", {
    studentId: "student-a",
    ownerUserId: "user-a",
    threadId: "chat-thread",
    idempotencyKey: "turn-1",
    scope: "chat",
    studentMessageId,
    status: "pending",
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
  });

  await invoke(complete, db, {
    ownerUserId: "user-a",
    turnId,
    result: {
      reply: "Nice work -- you correctly brought the exponent down and subtracted one.",
      skillResolutions: [],
      candidateEvidence: [
        {
          skillId,
          outcome: "correct",
          independence: "independent",
          confidence: 0.8,
          rationale: "Applied d/dx[x^4] = 4x^3 without hints.",
        },
      ],
      annotations: [],
    },
  });

  const episodes = db.all("episodicSummaries");
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0]!.studentId, "student-a");
  assert.deepEqual(episodes[0]!.skillIds, [skillId]);
  assert.match(episodes[0]!.summary, /Differentiate power functions using the power rule/);
  assert.match(episodes[0]!.summary, /Applied d\/dx\[x\^4\] = 4x\^3 without hints\./);
  assert.equal(episodes[0]!.sourceThreadId, "chat-thread");
});

test("completing a turn with no candidate evidence writes no episodic summary", async () => {
  const db = new FakeDb();
  db.seed("learners", { studentId: "student-a", ownerUserId: "user-a" });
  const studentMessageId = db.seed("tutorMessages", {
    studentId: "student-a",
    ownerUserId: "user-a",
    threadId: "chat-thread",
    role: "student",
    text: "hi",
    annotationIds: [],
    isVisible: true,
    idempotencyKey: "turn-2",
    createdAt: "2026-08-19T00:00:00.000Z",
  });
  const turnId = db.seed("tutorTurns", {
    studentId: "student-a",
    ownerUserId: "user-a",
    threadId: "chat-thread",
    idempotencyKey: "turn-2",
    scope: "chat",
    studentMessageId,
    status: "pending",
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
  });

  await invoke(complete, db, {
    ownerUserId: "user-a",
    turnId,
    result: {
      reply: "Hello! What would you like to work on today?",
      skillResolutions: [],
      candidateEvidence: [],
      annotations: [],
    },
  });

  assert.equal(db.all("episodicSummaries").length, 0);
});
