import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export type Role = "admin" | "manager" | "employee";

export async function requireProfile(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"profiles">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (profile === null) throw new Error("No profile for authenticated user");
  return profile;
}

export async function requireRole(
  ctx: QueryCtx | MutationCtx,
  roles: Role[],
): Promise<Doc<"profiles">> {
  const profile = await requireProfile(ctx);
  if (!roles.includes(profile.role)) {
    throw new Error(`Requires role ${roles.join(" or ")}, got ${profile.role}`);
  }
  return profile;
}
