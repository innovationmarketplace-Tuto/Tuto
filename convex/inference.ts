import { internalMutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireUserId } from "./lib/auth";
import { getInferenceSettings, usageSnapshot } from "./lib/db";
import { DEFAULT_INFERENCE_SETTINGS } from "./lib/guards";

const query = queryGeneric;
const internalMutation = internalMutationGeneric;

export const status = query({
  args: { kind: v.optional(v.union(v.literal("tutor"), v.literal("document_analysis"))) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const settings = await getInferenceSettings(ctx);
    const kind = args.kind ?? "tutor";
    const usage = await usageSnapshot(ctx, kind);
    const userRow = await (ctx.db as any).query("inferenceUsage").withIndex("by_kind_bucket_scope_user", (q: any) => q.eq("kind", kind).eq("bucketStart", usage.bucketStart).eq("scope", "user").eq("userId", userId)).unique();
    return { enabled: settings.globalEnabled, kind, userCount: userRow?.count ?? 0, globalCount: usage.globalCount, limits: usage.limits };
  },
});

/** Internal operator/seed control; clients can observe but cannot flip it. */
export const setSettings = internalMutation({
  args: {
    globalEnabled: v.boolean(),
    maxTutorPerUserPerDay: v.number(),
    maxTutorGlobalPerDay: v.number(),
    maxDocumentPerUserPerDay: v.number(),
    maxDocumentGlobalPerDay: v.number(),
    allowFakeFallback: v.boolean(),
    updatedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    for (const [key, value] of Object.entries(args)) {
      if (key !== "globalEnabled" && key !== "allowFakeFallback" && key !== "updatedBy" && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error("Inference limits must be non-negative finite numbers");
    }
    const existing = await (ctx.db as any).query("inferenceSettings").withIndex("by_key", (q: any) => q.eq("key", "global")).unique();
    const value = { key: "global", globalEnabled: args.globalEnabled, maxTutorPerUserPerDay: Math.floor(args.maxTutorPerUserPerDay), maxTutorGlobalPerDay: Math.floor(args.maxTutorGlobalPerDay), maxDocumentPerUserPerDay: Math.floor(args.maxDocumentPerUserPerDay), maxDocumentGlobalPerDay: Math.floor(args.maxDocumentGlobalPerDay), allowFakeFallback: args.allowFakeFallback, updatedAt: new Date().toISOString(), ...(args.updatedBy ? { updatedBy: args.updatedBy } : {}) };
    if (existing) await (ctx.db as any).patch(existing._id, value);
    else await (ctx.db as any).insert("inferenceSettings", value);
    return value;
  },
});

export const initialize = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await (ctx.db as any).query("inferenceSettings").withIndex("by_key", (q: any) => q.eq("key", "global")).unique();
    if (existing) return existing._id;
    return await (ctx.db as any).insert("inferenceSettings", { key: "global", ...DEFAULT_INFERENCE_SETTINGS, updatedAt: new Date().toISOString() });
  },
});
