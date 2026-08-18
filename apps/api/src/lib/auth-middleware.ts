import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { auth, type AuthUser } from "./auth.js";

export type AppEnv = { Variables: { user: AuthUser | null } };

export async function getOptionalUser(c: Context): Promise<AuthUser | null> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user ?? null;
}

// Populates c.get("user") for every request (null when signed out) so
// handlers can branch on it without each one calling getSession itself.
export const attachUser: MiddlewareHandler<AppEnv> = createMiddleware<AppEnv>(async (c, next) => {
  c.set("user", await getOptionalUser(c));
  await next();
});

export const requireAuth: MiddlewareHandler<AppEnv> = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }
  await next();
});

// No role table — an admin is just an email on this list. Simplest
// mechanism that solves the actual Phase 5 need (a handful of trusted
// moderators), same bias toward minimal infra as requireAuth itself.
function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdmin(user: AuthUser | null): boolean {
  return user !== null && adminEmails().has(user.email.toLowerCase());
}

export const requireAdmin: MiddlewareHandler<AppEnv> = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }
  if (!isAdmin(user)) {
    return c.json({ error: "Admin access required" }, 403);
  }
  await next();
});
