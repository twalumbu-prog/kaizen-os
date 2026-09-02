import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export type Role = "admin" | "manager" | "employee";

export async function requireProfile(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"profiles">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");

  const user = await ctx.db.get(userId);
  if (user === null) throw new Error("User record not found");

  const profiles = await ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();

  if (profiles.length === 0) throw new Error("No profile for authenticated user");

  // If user has a selected org and a profile for it, return that one.
  if (user.selectedOrgId) {
    const selected = profiles.find((p) => p.orgId === user.selectedOrgId);
    if (selected) return selected;
  }

  // Fall back to the first profile (oldest by creation time).
  return profiles[0];
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
