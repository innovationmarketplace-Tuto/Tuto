import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireUserId } from "./lib/auth";
import { assertNonEmpty } from "./lib/validation";

const query = queryGeneric;
const mutation = mutationGeneric;

export const DEFAULT_SELF_DISPLAY_NAME = "Student";

function now(): string {
  return new Date().toISOString();
}

/**
 * Stable, account-scoped ID for the one direct student profile.  It is derived
 * from the authenticated subject only; callers cannot choose another account
 * or make a profile collide with an arbitrary learner ID in normal use.
 */
export function selfStudentIdForOwner(ownerUserId: string): string {
  return `self-${ownerUserId}`;
}

/** Only rows explicitly provisioned as the account's direct student count. */
export function isSelfOwnedLearner(row: (Record<string, unknown> & { isSelfOwned?: unknown }) | null | undefined): boolean {
  return row?.isSelfOwned === true;
}

function publicLearner(row: any): any {
  // Never expose identity-provider metadata or account records in this API.
  return {
    _id: row._id,
    studentId: row.studentId,
    displayName: row.displayName,
    isSynthetic: row.isSynthetic,
    isSelfOwned: isSelfOwnedLearner(row),
    ...(row.archivedAt ? { archivedAt: row.archivedAt } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function findSelfLearner(ctx: any, ownerUserId: string): Promise<any | null> {
  const rows = await (ctx.db as any)
    .query("learners")
    .withIndex("by_owner_and_self", (q: any) => q.eq("ownerUserId", ownerUserId).eq("isSelfOwned", true))
    .collect();
  if (rows.length > 1) throw new Error("Account has multiple self student profiles");
  return rows[0] ?? null;
}

/** Return the authenticated account's direct student profile, if provisioned. */
export const getSelf = query({
  args: {},
  handler: async (ctx) => {
    const ownerUserId = await requireUserId(ctx);
    const learner = await findSelfLearner(ctx, ownerUserId);
    return learner ? publicLearner(learner) : null;
  },
});

/**
 * Provision the authenticated account's one direct student profile.
 *
 * This is intentionally a creation-only path: it provisions a fresh
 * account-owned row and never adopts another learner. Repeated calls are
 * idempotent and return the already-provisioned self row.
 */
export const ensureSelf = mutation({
  args: { displayName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUserId(ctx);
    const existing = await findSelfLearner(ctx, ownerUserId);
    if (existing) return publicLearner(existing);

    const identity = await ctx.auth.getUserIdentity();
    const user = typeof (ctx.db as any).get === "function" ? await (ctx.db as any).get(ownerUserId) : null;
    const userName = typeof user?.name === "string" ? user.name.trim() : "";
    const identityName = typeof identity?.name === "string" ? identity.name.trim() : "";
    const displayName = assertNonEmpty(
      args.displayName ?? (userName || identityName || DEFAULT_SELF_DISPLAY_NAME),
      "student display name",
      200,
    );
    const studentId = selfStudentIdForOwner(ownerUserId);
    const conflicting = await (ctx.db as any)
      .query("learners")
      .withIndex("by_student", (q: any) => q.eq("studentId", studentId))
      .unique();
    if (conflicting) {
      // The ID is account-derived. Fail closed if a collision ever occurs.
      throw new Error("Self student ID is already in use");
    }

    const timestamp = now();
    const id = await (ctx.db as any).insert("learners", {
      studentId,
      ownerUserId,
      displayName,
      isSynthetic: false,
      isSelfOwned: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return publicLearner({
      _id: id,
      studentId,
      ownerUserId,
      displayName,
      isSynthetic: false,
      isSelfOwned: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  },
});

/** Update only the authenticated account's direct student profile. */
export const updateSelf = mutation({
  args: { displayName: v.string() },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUserId(ctx);
    const learner = await findSelfLearner(ctx, ownerUserId);
    if (!learner) throw new Error("Self student profile is not provisioned");
    if (learner.archivedAt) throw new Error("Self student profile is archived");
    const displayName = assertNonEmpty(args.displayName, "student display name", 200);
    const updatedAt = now();
    await (ctx.db as any).patch(learner._id, { displayName, updatedAt });
    return publicLearner({ ...learner, displayName, updatedAt });
  },
});
