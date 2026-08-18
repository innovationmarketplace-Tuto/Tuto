import type { Auth } from "convex/server";

export type AuthenticatedContext = { auth: Auth };

/** The Convex Auth user document ID is the only owner key used by public APIs. */
export async function requireUserId(ctx: AuthenticatedContext): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new Error("Unauthenticated");
  // Convex Auth's Password provider encodes the user document ID and session
  // ID in the subject. Keep the account owner stable across sessions.
  const value = identity.subject.split("|", 1)[0] ?? "";
  if (value.length === 0) throw new Error("Authenticated identity has no user ID");
  return value;
}

export function assertSameUser(expectedUserId: string, actualUserId: string): void {
  if (expectedUserId !== actualUserId) throw new Error("Forbidden");
}
