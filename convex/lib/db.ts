import {
  assertInferenceEnabled,
  assertWithinInferenceLimit,
  dayBucket,
  DEFAULT_INFERENCE_SETTINGS,
  limitsFor,
  type InferenceKind,
  type InferenceSettings,
} from "./guards";

type DbContext = { db: any };

export async function findLearner(ctx: DbContext, studentId: string): Promise<any | null> {
  return (await ctx.db
    .query("learners")
    .withIndex("by_student", (q: any) => q.eq("studentId", studentId))
    .unique()) as any;
}

export async function requireOwnedLearner(
  ctx: DbContext,
  studentId: string,
  ownerUserId: string,
  options: { allowArchived?: boolean } = {},
): Promise<any> {
  const learner = await findLearner(ctx, studentId);
  if (learner === null || learner.ownerUserId !== ownerUserId) throw new Error("Forbidden");
  if (learner.archivedAt && options.allowArchived !== true) throw new Error("Learner is archived");
  return learner;
}

export async function requireOwnedLearnerIncludingArchived(
  ctx: DbContext,
  studentId: string,
  ownerUserId: string,
): Promise<any> {
  return requireOwnedLearner(ctx, studentId, ownerUserId, { allowArchived: true });
}

export async function getInferenceSettings(ctx: DbContext): Promise<InferenceSettings> {
  const row = await ctx.db
    .query("inferenceSettings")
    .withIndex("by_key", (q: any) => q.eq("key", "global"))
    .unique();
  if (row === null) return DEFAULT_INFERENCE_SETTINGS;
  return {
    globalEnabled: row.globalEnabled,
    maxTutorPerUserPerDay: row.maxTutorPerUserPerDay,
    maxTutorGlobalPerDay: row.maxTutorGlobalPerDay,
    maxDocumentPerUserPerDay: row.maxDocumentPerUserPerDay,
    maxDocumentGlobalPerDay: row.maxDocumentGlobalPerDay,
    allowFakeFallback: row.allowFakeFallback,
  };
}

async function getUsage(
  ctx: DbContext,
  kind: InferenceKind,
  bucketStart: number,
  scope: "user" | "global",
  userId: string,
): Promise<any | null> {
  return (await ctx.db
    .query("inferenceUsage")
    .withIndex("by_kind_bucket_scope_user", (q: any) =>
      q.eq("kind", kind).eq("bucketStart", bucketStart).eq("scope", scope).eq("userId", userId),
    )
    .unique()) as any;
}

/** Atomically reserve one provider call for both the user and global bucket. */
export async function consumeInferenceBudget(
  ctx: DbContext,
  userId: string,
  kind: InferenceKind,
  nowMs = Date.now(),
): Promise<void> {
  const settings = await getInferenceSettings(ctx);
  assertInferenceEnabled(settings);
  const bucketStart = dayBucket(nowMs);
  const userUsage = await getUsage(ctx, kind, bucketStart, "user", userId);
  const globalUsage = await getUsage(ctx, kind, bucketStart, "global", "__global__");
  const userCount = userUsage?.count ?? 0;
  const globalCount = globalUsage?.count ?? 0;
  assertWithinInferenceLimit(kind, settings, userCount, globalCount);
  const updatedAt = new Date(nowMs).toISOString();
  if (userUsage) await ctx.db.patch(userUsage._id, { count: userUsage.count + 1, updatedAt });
  else await ctx.db.insert("inferenceUsage", { kind, bucketStart, scope: "user", userId, count: 1, updatedAt });
  if (globalUsage) await ctx.db.patch(globalUsage._id, { count: globalUsage.count + 1, updatedAt });
  else await ctx.db.insert("inferenceUsage", { kind, bucketStart, scope: "global", userId: "__global__", count: 1, updatedAt });
}

export async function usageSnapshot(ctx: DbContext, kind: InferenceKind, nowMs = Date.now()) {
  const bucketStart = dayBucket(nowMs);
  const rows = await ctx.db
    .query("inferenceUsage")
    .withIndex("by_kind_bucket_scope", (q: any) => q.eq("kind", kind).eq("bucketStart", bucketStart))
    .collect();
  const global = rows.find((row: any) => row.scope === "global");
  const users = rows.filter((row: any) => row.scope === "user");
  return { bucketStart, globalCount: global?.count ?? 0, userCount: users.reduce((sum: number, row: any) => sum + row.count, 0), limits: limitsFor(kind, await getInferenceSettings(ctx)) };
}
