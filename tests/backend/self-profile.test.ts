import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureSelf,
  getSelf,
  isSelfOwnedLearner,
  selfStudentIdForOwner,
  updateSelf,
} from "../../convex/learners";

type Row = Record<string, any> & { _id: string };

/** Small in-memory Convex-shaped store for exercising authenticated handlers. */
class FakeDb {
  private readonly tables = new Map<string, Row[]>();
  private nextId = 1;

  seed(table: string, value: Record<string, any>): string {
    const id = `${table}:${this.nextId++}`;
    this.put(table, id, value);
    return id;
  }

  seedWithId(table: string, id: string, value: Record<string, any>): string {
    this.put(table, id, value);
    return id;
  }

  private put(table: string, id: string, value: Record<string, any>): void {
    const rows = this.tables.get(table) ?? [];
    rows.push({ ...value, _id: id });
    this.tables.set(table, rows);
  }

  query(table: string) {
    const rows = this.tables.get(table) ?? [];
    return new FakeQuery(rows);
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
    const filtered = this.rows.filter((row) => clauses.every(([field, value]) => row[field] === value));
    return new FakeQueryResult(filtered);
  }
}

class FakeQueryResult {
  constructor(private readonly rows: Row[]) {}

  async collect(): Promise<Row[]> {
    return [...this.rows];
  }

  async unique(): Promise<Row | null> {
    if (this.rows.length > 1) throw new Error("unique() found multiple rows");
    return this.rows[0] ?? null;
  }
}

function context(db: FakeDb, subject: string) {
  return {
    db,
    auth: { getUserIdentity: async () => ({ subject }) },
  };
}

async function invoke(builder: unknown, db: FakeDb, subject: string, args: Record<string, unknown> = {}) {
  return (builder as any)._handler(context(db, subject), args);
}

test("self student IDs are stable and only the explicit marker counts", () => {
  assert.equal(selfStudentIdForOwner("user-a"), selfStudentIdForOwner("user-a"));
  assert.notEqual(selfStudentIdForOwner("user-a"), selfStudentIdForOwner("user-b"));
  assert.equal(isSelfOwnedLearner({ isSelfOwned: true }), true);
  assert.equal(isSelfOwnedLearner({ isSelfOwned: false }), false);
  assert.equal(isSelfOwnedLearner({ ownerUserId: "user-a" }), false);
});

test("ensureSelf provisions one account-owned student and is idempotent", async () => {
  const db = new FakeDb();
  db.seedWithId("users", "user-a", { name: "Ada" });

  const first = await invoke(ensureSelf, db, "user-a|session-1", { displayName: "Ada" });
  const second = await invoke(ensureSelf, db, "user-a|session-2", { displayName: "A different name" });

  assert.equal(first.isSelfOwned, true);
  assert.equal(first.displayName, "Ada");
  assert.equal(second._id, first._id);
  assert.equal(second.displayName, "Ada");
  assert.equal(db.rows("learners").length, 1);
  assert.deepEqual(await invoke(getSelf, db, "user-a"), first);
});

test("ensureSelf uses the authenticated users.name when no display name is sent", async () => {
  const db = new FakeDb();
  db.seedWithId("users", "user-a", { name: "Sam Student" });

  const profile = await invoke(ensureSelf, db, "user-a");
  assert.equal(profile.displayName, "Sam Student");
});

test("ensureSelf stays account-scoped", async () => {
  const db = new FakeDb();
  const self = await invoke(ensureSelf, db, "user-a");
  assert.equal((await invoke(getSelf, db, "user-b")), null);

  const otherSelf = await invoke(ensureSelf, db, "user-b");
  assert.notEqual(otherSelf.studentId, self.studentId);
  assert.equal((await invoke(getSelf, db, "user-a")).studentId, self.studentId);
});

test("self profile updates stay owner-scoped", async () => {
  const db = new FakeDb();
  const self = await invoke(ensureSelf, db, "user-a", { displayName: "Ari" });

  const updated = await invoke(updateSelf, db, "user-a", { displayName: "Ari Student" });
  assert.equal(updated._id, self._id);
  assert.equal(updated.displayName, "Ari Student");
  await assert.rejects(() => invoke(updateSelf, db, "user-b", { displayName: "No access" }), /not provisioned/);
});
