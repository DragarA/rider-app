import { Hono } from "hono";
import { isAdmin, type AppEnv } from "../lib/auth-middleware.js";

export const adminRouter = new Hono<AppEnv>();

// Lets the frontend decide whether to show admin-only nav links (e.g.
// "Moderate POIs") without duplicating the ADMIN_EMAILS check client-side —
// the actual moderation endpoints (POST /pois/:id/verify etc.) still
// enforce requireAdmin themselves regardless of what this reports.
adminRouter.get("/status", (c) => {
  return c.json({ isAdmin: isAdmin(c.get("user")) });
});
