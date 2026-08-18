import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireUserId } from "./lib/auth";
import { requireOwnedLearner } from "./lib/db";
import { assertNonEmpty, assertPageRevision } from "./lib/validation";

const query = queryGeneric;
const mutation = mutationGeneric;

const role = v.union(v.literal("student"), v.literal("tutor"));
const scope = v.union(v.literal("chat"), v.literal("worksheet"));

type MessageScope = "chat" | "worksheet";

function normalizeScope(value: unknown, pageId?: unknown): MessageScope {
  if (value === "worksheet" || (value === undefined && pageId)) return "worksheet";
  return "chat";
}

function normalizeContextKey(
  requestedScope: MessageScope,
  value: unknown,
  pageId?: unknown,
): string | undefined {
  if (requestedScope === "chat") return undefined;
  const candidate = typeof value === "string" && value.trim().length > 0
    ? value
    : (pageId ? String(pageId) : "");
  return assertNonEmpty(candidate, "worksheet context key", 300);
}

function rowScopeMatches(row: any, requestedScope: MessageScope, contextKey?: string): boolean {
  const rowScope = row?.scope === "worksheet" ? "worksheet" : "chat";
  return requestedScope === "chat"
    ? rowScope === "chat"
    : rowScope === "worksheet" && row?.contextKey === contextKey;
}

function sessionScopeMatches(session: any, requestedScope: MessageScope, contextKey?: string): boolean {
  const sessionScope = session?.scope === "worksheet" ? "worksheet" : "chat";
  return requestedScope === "chat"
    ? sessionScope === "chat"
    : sessionScope === "worksheet" && session?.contextKey === contextKey;
}

function cleanThreadId(value: string): string {
  return assertNonEmpty(value, "thread ID", 300);
}

function publicMessage(row: any): any {
  // Legacy fixture rows may not have a role/owner. They are never returned by
  // the owner index below; production rows always carry both fields.
  return {
    _id: row._id,
    studentId: row.studentId,
    threadId: row.threadId,
    role: row.role,
    text: row.text,
    annotationIds: row.annotationIds ?? [],
    ...(row.pageId ? { pageId: row.pageId } : {}),
    ...(row.pageRevision !== undefined ? { pageRevision: row.pageRevision } : {}),
    ...(row.scope ? { scope: row.scope } : {}),
    ...(row.contextKey ? { contextKey: row.contextKey } : {}),
    ...(row.isVisible !== undefined ? { isVisible: row.isVisible } : {}),
    ...(row.isHidden !== undefined ? { isHidden: row.isHidden } : {}),
    createdAt: row.createdAt ?? new Date(row._creationTime ?? Date.now()).toISOString(),
  };
}

async function ensureSession(
  ctx: any,
  studentId: string,
  ownerUserId: string,
  threadId: string,
  requestedScope: MessageScope,
  contextKey: string | undefined,
): Promise<any> {
  const existing = await ctx.db
    .query("learnerSessions")
    .withIndex("by_student_and_thread", (q: any) => q.eq("studentId", studentId).eq("threadId", threadId))
    .unique();
  if (existing) {
    if (existing.ownerUserId !== ownerUserId) throw new Error("Forbidden");
    if (existing.status === "archived") throw new Error("Session is archived");
    if (!sessionScopeMatches(existing, requestedScope, contextKey)) {
      throw new Error("Thread belongs to another conversation scope");
    }
    return existing;
  }
  const timestamp = new Date().toISOString();
  const id = await ctx.db.insert("learnerSessions", {
    studentId,
    ownerUserId,
    threadId,
    scope: requestedScope,
    ...(contextKey ? { contextKey } : {}),
    currentSkillIds: [],
    hintsShown: 0,
    hintSummaries: [],
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return {
    _id: id,
    studentId,
    ownerUserId,
    threadId,
    scope: requestedScope,
    ...(contextKey ? { contextKey } : {}),
    currentSkillIds: [],
    hintsShown: 0,
    hintSummaries: [],
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export const list = query({
  args: {
    studentId: v.string(),
    threadId: v.string(),
    limit: v.optional(v.number()),
    scope: v.optional(scope),
    contextKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUserId(ctx);
    await requireOwnedLearner(ctx, args.studentId, ownerUserId);
    const threadId = cleanThreadId(args.threadId);
    const requestedScope = normalizeScope(args.scope);
    const contextKey = normalizeContextKey(requestedScope, args.contextKey);
    const limit = Math.min(200, Math.max(1, Math.floor(args.limit ?? 100)));
    const session = await (ctx.db as any)
      .query("learnerSessions")
      .withIndex("by_student_and_thread", (q: any) => q.eq("studentId", args.studentId).eq("threadId", threadId))
      .unique();
    if (session && !sessionScopeMatches(session, requestedScope, contextKey)) {
      throw new Error("Thread belongs to another conversation scope");
    }
    const rows = await (ctx.db as any)
      .query("tutorMessages")
      .withIndex("by_owner_and_thread", (q: any) => q.eq("ownerUserId", ownerUserId).eq("threadId", threadId))
      .order("desc")
      .take(limit * 2);
    return rows
      .filter((row: any) => row.studentId === args.studentId
        && (row.role === "student" || row.role === "tutor")
        && row.isVisible !== false
        && row.isHidden !== true
        && rowScopeMatches(row, requestedScope, contextKey)
        && (!session || sessionScopeMatches(session, requestedScope, contextKey)))
      .slice(0, limit)
      .reverse()
      .map(publicMessage);
  },
});

export const create = mutation({
  args: {
    studentId: v.string(),
    threadId: v.string(),
    text: v.string(),
    role: v.optional(role),
    scope: v.optional(scope),
    contextKey: v.optional(v.string()),
    pageId: v.optional(v.id("artifactPages")),
    pageRevision: v.optional(v.number()),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUserId(ctx);
    const learner = await requireOwnedLearner(ctx, args.studentId, ownerUserId);
    if (learner.archivedAt) throw new Error("Learner is archived");
    const threadId = cleanThreadId(args.threadId);
    const text = assertNonEmpty(args.text, "message text", 8_000);
    const messageRole = args.role ?? "student";
    const requestedScope = normalizeScope(args.scope, args.pageId);
    const contextKey = normalizeContextKey(requestedScope, args.contextKey, args.pageId);
    if (args.idempotencyKey !== undefined) {
      const key = assertNonEmpty(args.idempotencyKey, "idempotency key", 300);
      const existing = await (ctx.db as any)
        .query("tutorMessages")
        .withIndex("by_owner_and_idempotency", (q: any) => q.eq("ownerUserId", ownerUserId).eq("idempotencyKey", key))
        .unique();
      if (existing) {
        if (existing.studentId !== args.studentId || existing.threadId !== threadId) throw new Error("Idempotency key belongs to another thread");
        if (!rowScopeMatches(existing, requestedScope, contextKey)) throw new Error("Idempotency key belongs to another conversation scope");
        return existing._id;
      }
    }
    await ensureSession(ctx, args.studentId, ownerUserId, threadId, requestedScope, contextKey);
    if (args.pageId) {
      const page = await (ctx.db as any).get(args.pageId);
      if (!page || page.ownerUserId !== ownerUserId || page.studentId !== args.studentId) throw new Error("Forbidden");
      if (args.pageRevision === undefined) throw new Error("pageRevision is required for page messages");
      assertPageRevision(page.revision, args.pageRevision);
    } else if (args.pageRevision !== undefined) {
      throw new Error("pageId is required with pageRevision");
    }
    const createdAt = new Date().toISOString();
    return await (ctx.db as any).insert("tutorMessages", {
      studentId: args.studentId,
      ownerUserId,
      threadId,
      role: messageRole,
      text,
      annotationIds: [],
      scope: requestedScope,
      ...(contextKey ? { contextKey } : {}),
      ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey.trim() } : {}),
      ...(args.pageId ? { pageId: args.pageId } : {}),
      ...(args.pageRevision !== undefined ? { pageRevision: args.pageRevision } : {}),
      createdAt,
    });
  },
});

export const get = query({
  args: { messageId: v.id("tutorMessages") },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUserId(ctx);
    const row = await (ctx.db as any).get(args.messageId);
    if (!row || row.ownerUserId !== ownerUserId) throw new Error("Forbidden");
    if (row.isVisible === false || row.isHidden === true) return null;
    return publicMessage(row);
  },
});

export const listMessages = list;
export const createMessage = create;
export const getMessage = get;
