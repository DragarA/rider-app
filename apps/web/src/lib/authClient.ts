import { createAuthClient } from "better-auth/react";

// Better Auth's client requires an absolute base URL (unlike the plain
// relative fetch() calls elsewhere in lib/api.ts), so this resolves against
// window.location.origin at runtime rather than hardcoding a host — it
// still goes through the same Vite dev proxy ("/api" -> :8787, see
// vite.config.ts) and stays same-origin, in dev and in a same-origin prod
// deploy alike.
export const authClient = createAuthClient({
  baseURL: `${window.location.origin}/api/v1/auth`,
});

export const { signIn, signUp, signOut, useSession } = authClient;
