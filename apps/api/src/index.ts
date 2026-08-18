import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { sql } from "drizzle-orm";
import { db } from "@riding-app/db";
import { routesRouter } from "./routes/index.js";
import { savedRoutesRouter } from "./routes/saved-routes.js";
import { aiRouter } from "./routes/ai.js";
import { placesRouter } from "./routes/places.js";
import { poisRouter } from "./routes/pois.js";
import { adminRouter } from "./routes/admin.js";
import { conditionsRouter } from "./routes/conditions.js";
import { auth } from "./lib/auth.js";
import { attachUser, type AppEnv } from "./lib/auth-middleware.js";

const app = new Hono<AppEnv>().basePath("/api/v1");

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  }),
);
app.use("*", attachUser);

app.on(["POST", "GET"], "/auth/*", (c) => auth.handler(c.req.raw));

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/health/db", async (c) => {
  try {
    await db.execute(sql`select 1`);
    return c.json({ status: "ok" });
  } catch (err) {
    return c.json({ status: "error", message: (err as Error).message }, 503);
  }
});

app.route("/routes", routesRouter);
app.route("/routes", savedRoutesRouter);
app.route("/ai", aiRouter);
app.route("/places", placesRouter);
app.route("/pois", poisRouter);
app.route("/admin", adminRouter);
app.route("/conditions", conditionsRouter);

const port = Number(process.env.API_PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`riding-app API listening on http://localhost:${info.port}/api/v1`);
});

export type AppType = typeof app;
