import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

/**
 * Self-contained email/password authentication for the Expo web/native app.
 *
 * Password reset and email verification are deliberately not enabled until an
 * email delivery provider is configured. Sign-up still uses the library's
 * default scrypt password hashing and rate limiting; production deployments
 * must set the JWT key variables documented in `.env.example`.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password({
    profile(params) {
      const email = typeof params.email === "string" ? params.email.trim().toLocaleLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
        throw new Error("Invalid email address");
      }
      const name = typeof params.name === "string" ? params.name.trim().slice(0, 200) : "";
      return { email, ...(name ? { name } : {}) };
    },
    validatePasswordRequirements(password) {
      if (password.length < 8 || password.length > 256) throw new Error("Password must be 8-256 characters");
    },
  })],
});
