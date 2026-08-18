import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, type AppEnv } from "../lib/auth-middleware.js";
import { buildGpx } from "../lib/gpx.js";
import {
  canView,
  deleteRoute,
  getRatingSummary,
  getRouteById,
  insertRoute,
  listMyRoutes,
  listPublicRoutes,
  listRatings,
  mapSurfaceBreakdownToDb,
  updateRoute,
  upsertRating,
} from "../lib/savedRoutes.js";

// Persisted-route CRUD + ratings (PROJECT_SPEC.md §3.2, Phase 4). Mounted
// at the same "/routes" prefix as routes/index.ts's candidate-generation
// router (POST /routes/generate, POST /routes/gpx) — Hono matches those
// static segments ahead of the :id param routes below regardless of mount
// order, so there's no collision.
export const savedRoutesRouter = new Hono<AppEnv>();

const geometrySchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
});

const surfaceBreakdownSchema = z.object({
  gravel: z.number().min(0).max(1),
  cobblestone: z.number().min(0).max(1),
  asphalt: z.number().min(0).max(1),
});

const createRouteSchema = z.object({
  title: z.string().min(1).max(150),
  description: z.string().max(2000).nullable().optional(),
  geometry: geometrySchema,
  distanceMeters: z.number().positive(),
  estDurationSeconds: z.number().positive(),
  curvinessScore: z.number().min(0).max(1).nullable().optional(),
  surfaceBreakdown: surfaceBreakdownSchema.nullable().optional(),
  visibility: z.enum(["private", "unlisted", "public"]).optional(),
  generatedFromPrompt: z.string().nullable().optional(),
  generationConstraints: z.unknown().optional(),
});

savedRoutesRouter.post("/", requireAuth, zValidator("json", createRouteSchema), async (c) => {
  const user = c.get("user")!;
  const body = c.req.valid("json");

  const saved = await insertRoute({
    ownerId: user.id,
    title: body.title,
    description: body.description ?? null,
    geometry: body.geometry as GeoJSON.LineString,
    distanceMeters: body.distanceMeters,
    estDurationSeconds: body.estDurationSeconds,
    curvinessScore: body.curvinessScore ?? null,
    surfaceBreakdown: body.surfaceBreakdown ? mapSurfaceBreakdownToDb(body.surfaceBreakdown) : null,
    visibility: body.visibility ?? "private",
    generatedFromPrompt: body.generatedFromPrompt ?? null,
    generationConstraints: body.generationConstraints ?? null,
  });

  return c.json({ route: saved }, 201);
});

const listQuerySchema = z.object({
  mine: z.enum(["true", "false"]).optional(),
  near: z
    .string()
    .optional()
    .transform((v) => v?.split(",").map(Number))
    .refine((v) => v === undefined || (v.length === 2 && v.every((n) => Number.isFinite(n))), {
      message: "near must be lon,lat",
    }),
  radiusKm: z.coerce.number().positive().optional(),
  maxDurationMinutes: z.coerce.number().positive().optional(),
});

savedRoutesRouter.get("/", zValidator("query", listQuerySchema), async (c) => {
  const q = c.req.valid("query");

  if (q.mine === "true") {
    const user = c.get("user");
    if (!user) return c.json({ error: "Authentication required" }, 401);
    return c.json({ routes: await listMyRoutes(user.id) });
  }

  const routes = await listPublicRoutes({
    near: q.near ? { lon: q.near[0]!, lat: q.near[1]!, radiusMeters: (q.radiusKm ?? 20) * 1000 } : undefined,
    maxDurationMinutes: q.maxDurationMinutes,
  });
  return c.json({ routes });
});

savedRoutesRouter.get("/:id", async (c) => {
  const route = await getRouteById(c.req.param("id"));
  const user = c.get("user");
  if (!route || !canView(route, user?.id ?? null)) {
    return c.json({ error: "Route not found" }, 404);
  }
  return c.json({ route, ratingSummary: await getRatingSummary(route.id) });
});

const updateRouteSchema = z.object({
  title: z.string().min(1).max(150).optional(),
  description: z.string().max(2000).nullable().optional(),
  visibility: z.enum(["private", "unlisted", "public"]).optional(),
});

savedRoutesRouter.patch("/:id", requireAuth, zValidator("json", updateRouteSchema), async (c) => {
  const user = c.get("user")!;
  const existing = await getRouteById(c.req.param("id"));
  if (!existing || existing.ownerId !== user.id) {
    return c.json({ error: "Route not found" }, 404);
  }
  const updated = await updateRoute(existing.id, c.req.valid("json"));
  return c.json({ route: updated });
});

savedRoutesRouter.delete("/:id", requireAuth, async (c) => {
  const user = c.get("user")!;
  const existing = await getRouteById(c.req.param("id"));
  if (!existing || existing.ownerId !== user.id) {
    return c.json({ error: "Route not found" }, 404);
  }
  await deleteRoute(existing.id);
  return c.body(null, 204);
});

// Same buildGpx() as the ad-hoc POST /routes/gpx (routes/index.ts), just
// sourcing {title, geometry} from a saved row instead of the request body.
savedRoutesRouter.get("/:id/gpx", async (c) => {
  const route = await getRouteById(c.req.param("id"));
  const user = c.get("user");
  if (!route || !canView(route, user?.id ?? null)) {
    return c.json({ error: "Route not found" }, 404);
  }

  const gpx = buildGpx({ title: route.title, geometry: route.geometry });
  c.header("Content-Type", "application/gpx+xml");
  c.header("Content-Disposition", `attachment; filename="${route.title.replace(/[^a-z0-9-_]+/gi, "_")}.gpx"`);
  return c.body(gpx);
});

const ratingSchema = z.object({
  scenicScore: z.number().int().min(1).max(5),
  surfaceScore: z.number().int().min(1).max(5),
  funScore: z.number().int().min(1).max(5),
  comment: z.string().max(2000).nullable().optional(),
  riddenAt: z.string().datetime().nullable().optional(),
});

savedRoutesRouter.post("/:id/ratings", requireAuth, zValidator("json", ratingSchema), async (c) => {
  const user = c.get("user")!;
  const route = await getRouteById(c.req.param("id"));
  if (!route || !canView(route, user.id)) {
    return c.json({ error: "Route not found" }, 404);
  }

  const body = c.req.valid("json");
  await upsertRating({
    routeId: route.id,
    userId: user.id,
    scenicScore: body.scenicScore,
    surfaceScore: body.surfaceScore,
    funScore: body.funScore,
    comment: body.comment ?? null,
    riddenAt: body.riddenAt ?? null,
  });

  return c.json({ ratingSummary: await getRatingSummary(route.id) }, 201);
});

savedRoutesRouter.get("/:id/ratings", async (c) => {
  const route = await getRouteById(c.req.param("id"));
  const user = c.get("user");
  if (!route || !canView(route, user?.id ?? null)) {
    return c.json({ error: "Route not found" }, 404);
  }
  return c.json({ ratings: await listRatings(route.id), summary: await getRatingSummary(route.id) });
});
