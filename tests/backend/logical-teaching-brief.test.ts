import assert from "node:assert/strict";
import test from "node:test";

import { prepare } from "../../convex/tutor";
import type { Skill } from "../../src/domain/skills";
import { GOLDEN_SKILLS } from "../../src/intelligence/eval-fixtures";
import { resolveSkill } from "../../src/intelligence/skill-resolver";

type Row = Record<string, any> & { _id: string };

/** Small Convex-shaped store for exercising the internal prepare query. */
class FakeDb {
  private readonly tables = new Map<string, Row[]>();

  seed(table: string, value: Record<string, any>): string {
    const id = `${table}:${this.tables.size + this.rowCount() + 1}`;
    return this.seedWithId(table, id, value);
  }

  seedWithId(table: string, id: string, value: Record<string, any>): string {
    const rows = this.tables.get(table) ?? [];
    rows.push({ ...value, _id: id });
    this.tables.set(table, rows);
    return id;
  }

  private rowCount(): number {
    let count = 0;
    for (const rows of this.tables.values()) count += rows.length;
    return count;
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

const logicalSkills: Skill[] = [
  {
    id: "division",
    namespace: "tuto.math",
    status: "active",
    name: "Division",
    objective: "Use division to calculate a quotient",
    subject: "math",
    aliases: ["divide", "division", "quotient"],
    version: 1,
    createdBy: "human",
  },
  {
    id: "equal-sharing",
    namespace: "tuto.math",
    status: "active",
    name: "Equal sharing",
    objective: "Partition a total into equal shares",
    subject: "math",
    aliases: ["equal sharing", "share equally", "equal parts", "each student"],
    version: 1,
    createdBy: "human",
  },
  {
    id: "division-foundation",
    namespace: "tuto.math",
    status: "active",
    name: "Division foundations",
    objective: "Recognize the groups and amount in a division problem",
    subject: "math",
    aliases: ["division foundations"],
    version: 1,
    createdBy: "human",
  },
  {
    id: "multiplication-facts",
    namespace: "tuto.math",
    status: "active",
    name: "Multiplication facts",
    objective: "Recall multiplication facts",
    subject: "math",
    aliases: ["multiplication facts"],
    version: 1,
    createdBy: "human",
  },
  {
    id: "algebra-linear-equations",
    namespace: "tuto.algebra",
    status: "active",
    name: "Solve linear equations",
    objective: "Solve linear equations with one variable",
    subject: "algebra",
    aliases: ["linear equations", "algebra"],
    version: 1,
    createdBy: "human",
  },
  {
    id: "variable-isolation",
    namespace: "tuto.algebra",
    status: "active",
    name: "Isolate a variable",
    objective: "Isolate a variable using inverse operations",
    subject: "algebra",
    aliases: ["isolate a variable", "inverse operations"],
    version: 1,
    createdBy: "human",
  },
];

const allSkills = [...GOLDEN_SKILLS, ...logicalSkills];
const now = "2026-08-17T00:00:00.000Z";

function resolveExisting(objective: string): string {
  const resolution = resolveSkill({ objective, skills: allSkills });
  if (resolution.decision !== "existing") {
    throw new Error(`Expected an existing skill for ${objective}; got ${JSON.stringify(resolution)}`);
  }
  return resolution.skillId;
}

function seedSkills(db: FakeDb): void {
  for (const skill of allSkills) db.seedWithId("skills", skill.id, skill);
  db.seedWithId("skillEdges", "edge-equal-sharing-foundation", {
    fromSkillId: "equal-sharing",
    toSkillId: "division-foundation",
    kind: "requires",
  });
  db.seedWithId("skillEdges", "edge-division-facts", {
    fromSkillId: "division",
    toSkillId: "multiplication-facts",
    kind: "requires",
  });
  db.seedWithId("skillEdges", "edge-algebra-isolation", {
    fromSkillId: "algebra-linear-equations",
    toSkillId: "variable-isolation",
    kind: "requires",
  });
}

function seedLearner(db: FakeDb, studentId: string): void {
  db.seedWithId("learners", `${studentId}-learner`, {
    studentId,
    ownerUserId: "user-a",
    archivedAt: undefined,
  });
}

function seedWallPage(db: FakeDb): void {
  db.seedWithId("artifactPages", "wall-page", {
    artifactId: "wall-artifact",
    studentId: "student-wall",
    ownerUserId: "user-a",
    revision: 1,
    storageId: "wall-storage",
    mimeType: "image/jpeg",
    naturalWidth: 1_000,
    naturalHeight: 1_000,
  });
  const region = (id: string, transcription: string, y: number) => ({
    pageId: "wall-page",
    revision: 1,
    kind: "problem",
    transcription,
    polygon: [{ x: 0, y }, { x: 1, y }, { x: 1, y: y + 0.1 }],
    bounds: { x: 0, y, width: 1, height: 0.1 },
    source: "text_detector",
  });
  db.seedWithId(
    "pageRegions",
    "wall-division",
    region("wall-division", "Divide the wall's 30 square feet among 4 students.", 0.1),
  );
  db.seedWithId(
    "pageRegions",
    "wall-sharing",
    region("wall-sharing", "Share the wall equally; each student gets the same amount.", 0.3),
  );
}

function seedSession(
  db: FakeDb,
  value: {
    studentId: string;
    threadId: string;
    scope: "chat" | "worksheet";
    contextKey?: string;
    currentSkillIds: string[];
  },
): void {
  db.seedWithId("learnerSessions", value.threadId, {
    ...value,
    ownerUserId: "user-a",
    hintsShown: 0,
    hintSummaries: [],
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

function context(db: FakeDb) {
  return { db, auth: { getUserIdentity: async () => ({ subject: "user-a|session-1" }) } };
}

async function invoke(
  db: FakeDb,
  args: Record<string, unknown>,
): Promise<any> {
  return (prepare as any)._handler(context(db), args);
}

function briefSkillIds(brief: any): string[] {
  return [
    ...brief.currentSkillIds,
    ...brief.skillStates.map((state: { skillId: string }) => state.skillId),
    ...brief.prerequisiteGaps.map((state: { skillId: string }) => state.skillId),
  ];
}

test("wall-sharing worksheet selects division/equal-sharing skills and prerequisite gaps", async () => {
  const db = new FakeDb();
  seedSkills(db);
  seedLearner(db, "student-wall");
  seedWallPage(db);

  const divisionSkillId = resolveExisting("divide the total");
  const equalSharingSkillId = resolveExisting("share equally");
  assert.deepEqual(
    new Set([divisionSkillId, equalSharingSkillId]),
    new Set(["division", "equal-sharing"]),
  );

  db.seedWithId("studentSkillStates", "wall-equal-sharing-state", {
    studentId: "student-wall",
    skillId: equalSharingSkillId,
    mastery: 0.35,
    confidence: 0.5,
    evidenceCount: 1,
    misconceptionIds: ["unequal-share-units"],
    supportingEvidenceIds: ["wall-evidence-1"],
    modelVersion: "weighted-evidence-v1",
  });
  db.seedWithId("episodicSummaries", "episode-fractions", {
    studentId: "student-wall",
    summary: "Previously needed help finding a common denominator.",
    skillIds: ["fraction-common-denominator"],
    createdAt: "2026-08-17T00:02:00.000Z",
  });
  db.seedWithId("episodicSummaries", "episode-sharing", {
    studentId: "student-wall",
    summary: "Explained how equal shares map to division.",
    skillIds: ["equal-sharing"],
    createdAt: "2026-08-17T00:01:00.000Z",
  });

  // A previous fraction worksheet belongs to another context. Its stale
  // current ID is deliberately persisted on the new worksheet session too;
  // authoritative worksheet text must replace it.
  seedSession(db, {
    studentId: "student-wall",
    threadId: "old-fractions",
    scope: "worksheet",
    contextKey: "fraction-page:1",
    currentSkillIds: ["fraction-common-denominator"],
  });
  seedSession(db, {
    studentId: "student-wall",
    threadId: "wall-sharing",
    scope: "worksheet",
    contextKey: "wall-page:1",
    currentSkillIds: ["fraction-common-denominator"],
  });

  const prepared = await invoke(db, {
    ownerUserId: "user-a",
    studentId: "student-wall",
    threadId: "wall-sharing",
    message: "What should I check in this worksheet step?",
    scope: "worksheet",
    contextKey: "wall-page:1",
    pageId: "wall-page",
    pageRevision: 1,
    activeRegionIds: ["wall-division", "wall-sharing"],
  });
  const brief = prepared.teachingBrief;

  assert.equal(brief.focus.source, "worksheet");
  assert.match(brief.focus.objective, /Divide the wall's 30 square feet/);
  assert.deepEqual(brief.currentSkillIds, ["division", "equal-sharing"]);
  assert.deepEqual(
    brief.currentSkills.map((skill: { name: string }) => skill.name),
    ["Division", "Equal sharing"],
  );
  assert.deepEqual(
    brief.prerequisiteGaps.map((state: { skillId: string }) => state.skillId).sort(),
    ["division-foundation", "multiplication-facts"],
  );
  assert.deepEqual(
    brief.prerequisiteSkills.map((skill: { name: string }) => skill.name).sort(),
    ["Division foundations", "Multiplication facts"],
  );
  assert.deepEqual(brief.activeMisconceptions, ["unequal-share-units"]);
  assert.deepEqual(brief.relevantEpisodes, ["Explained how equal shares map to division."]);
  assert.equal(briefSkillIds(brief).some((skillId) => skillId.startsWith("fraction")), false);
});

test("general linear-equation chat selects algebra skills without seeded fractions", async () => {
  const db = new FakeDb();
  seedSkills(db);
  seedLearner(db, "student-algebra");

  const algebraSkillId = resolveExisting("solve linear equations with one variable");
  assert.equal(algebraSkillId, "algebra-linear-equations");

  seedSession(db, {
    studentId: "student-algebra",
    threadId: "old-fractions",
    scope: "worksheet",
    contextKey: "fraction-page:1",
    currentSkillIds: ["fraction-addition"],
  });
  seedSession(db, {
    studentId: "student-algebra",
    threadId: "linear-equations-chat",
    scope: "chat",
    currentSkillIds: ["fraction-addition"],
  });

  const prepared = await invoke(db, {
    ownerUserId: "user-a",
    studentId: "student-algebra",
    threadId: "linear-equations-chat",
    message: "How do I solve linear equations with one variable?",
    scope: "chat",
  });
  const brief = prepared.teachingBrief;

  assert.equal(brief.focus.source, "chat");
  assert.equal(brief.focus.subject, "algebra");
  assert.equal(brief.focus.objective, "How do I solve linear equations with one variable?");
  assert.deepEqual(brief.currentSkillIds, ["algebra-linear-equations"]);
  assert.equal(brief.currentSkills[0]?.objective, "Solve linear equations with one variable");
  assert.deepEqual(
    brief.prerequisiteGaps.map((state: { skillId: string }) => state.skillId),
    ["variable-isolation"],
  );
  assert.equal(briefSkillIds(brief).some((skillId) => skillId.startsWith("fraction")), false);
});
