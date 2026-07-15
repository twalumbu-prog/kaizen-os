import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        return {
          email: params.email as string,
          name: (params.name as string) ?? undefined,
        };
      },
    }),
  ],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, { userId, profile }) {
      const name =
        (typeof profile.name === "string" && profile.name) ||
        (typeof profile.email === "string" ? profile.email : "New user");
      await ctx.runMutation(internal.profiles.ensureProfile, { userId, name });
    },
  },
});
