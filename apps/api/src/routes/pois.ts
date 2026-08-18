import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { poiCategoryEnum } from "@riding-app/db";
import {
  deletePoi,
  getPoiById,
  insertPoi,
  queryPois,
  setPoiVerified,
  updatePoi,
} from "../lib/pois.js";
import { isAdmin as isAdminUser, requireAdmin, requireAuth, type AppEnv } from "../lib/auth-middleware.js";

export const poisRouter = new Hono<AppEnv>();

// PROJECT_SPEC.md §3.2. Query params are all optional and combine with AND.
const poiQuerySchema = z.object({
  bbox: z
    .string()
    .optional()
    .transform((v) => v?.split(",").map(Number))
    .refine((v) => v === undefined || (v.length === 4 && v.every((n) => Number.isFinite(n))), {
      message: "bbox must be minLon,minLat,maxLon,maxLat",
    }),
  near: z
    .string()
    .optional()
    .transform((v) => v?.split(",").map(Number))
    .refine((v) => v === undefined || (v.length === 2 && v.every((n) => Number.isFinite(n))), {
      message: "near must be lon,lat",
    }),
  radiusKm: z.coerce.number().positive().optional(),
  category: z.string().optional(),
  bikerFriendly: z.enum(["true", "false"]).optional(),
  verified: z.enum(["true", "false"]).optional(),
  mine: z.enum(["true", "false"]).optional(),
});

// Requesting the moderation queue (?verified=false) is admin-only — pending
// submissions shouldn't be publicly enumerable before review. Every other
// combination (including no `verified` filter at all) is unchanged from
// before this phase.
poisRouter.get("/", zValidator("query", poiQuerySchema), async (c) => {
  const q = c.req.valid("query");
  const user = c.get("user");

  if (q.verified === "false" && !isAdminUser(user)) {
    return c.json({ error: "Admin access required" }, 403);
  }

  let createdById: string | undefined;
  if (q.mine === "true") {
    if (!user) return c.json({ error: "Authentication required" }, 401);
    createdById = user.id;
  }

  const pois = await queryPois({
    bbox: q.bbox as [number, number, number, number] | undefined,
    near: q.near ? { lon: q.near[0]!, lat: q.near[1]!, radiusMeters: (q.radiusKm ?? 5) * 1000 } : undefined,
    categories: q.category ? q.category.split(",") : undefined,
    bikerFriendly: q.bikerFriendly === undefined ? undefined : q.bikerFriendly === "true",
    verified: q.verified === undefined ? undefined : q.verified === "true",
    createdById,
  });

  return c.json({ pois });
});

poisRouter.get("/:id", async (c) => {
  const poi = await getPoiById(c.req.param("id"));
  if (!poi) return c.json({ error: "POI not found" }, 404);
  return c.json({ poi });
});

const metadataSchema = z
  .object({
    openingHours: z.string().optional(),
    elevationMeters: z.number().optional(),
    passClosedInWinter: z.boolean().optional(),
    externalUrl: z.string().url().optional(),
  })
  .optional();

const createPoiSchema = z.object({
  name: z.string().min(1).max(150),
  category: z.enum(poiCategoryEnum.enumValues),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  description: z.string().max(2000).nullable().optional(),
  isBikerFriendly: z.boolean().optional(),
  metadata: metadataSchema,
});

// Community submission — always lands unverified, regardless of who
// submits it (including admins, who approve it via POST /:id/verify like
// anyone else's submission — no fast-path for self-approval).
poisRouter.post("/", requireAuth, zValidator("json", createPoiSchema), async (c) => {
  const user = c.get("user")!;
  const body = c.req.valid("json");

  const poi = await insertPoi({
    createdById: user.id,
    name: body.name,
    category: body.category,
    lat: body.lat,
    lon: body.lon,
    description: body.description ?? null,
    isBikerFriendly: body.isBikerFriendly ?? false,
    metadata: body.metadata ?? null,
  });

  return c.json({ poi }, 201);
});

const updatePoiSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  category: z.enum(poiCategoryEnum.enumValues).optional(),
  description: z.string().max(2000).nullable().optional(),
  isBikerFriendly: z.boolean().optional(),
  metadata: metadataSchema,
});

poisRouter.patch("/:id", requireAuth, zValidator("json", updatePoiSchema), async (c) => {
  const user = c.get("user")!;
  const existing = await getPoiById(c.req.param("id"));
  if (!existing) return c.json({ error: "POI not found" }, 404);
  if (existing.createdById !== user.id && !isAdminUser(user)) {
    return c.json({ error: "Not authorized to edit this POI" }, 403);
  }

  const poi = await updatePoi(existing.id, c.req.valid("json"));
  return c.json({ poi });
});

poisRouter.delete("/:id", requireAuth, async (c) => {
  const user = c.get("user")!;
  const existing = await getPoiById(c.req.param("id"));
  if (!existing) return c.json({ error: "POI not found" }, 404);
  if (existing.createdById !== user.id && !isAdminUser(user)) {
    return c.json({ error: "Not authorized to delete this POI" }, 403);
  }

  await deletePoi(existing.id);
  return c.body(null, 204);
});

const verifySchema = z.object({ verified: z.boolean() });

poisRouter.post("/:id/verify", requireAdmin, zValidator("json", verifySchema), async (c) => {
  const existing = await getPoiById(c.req.param("id"));
  if (!existing) return c.json({ error: "POI not found" }, 404);

  const poi = await setPoiVerified(existing.id, c.req.valid("json").verified);
  return c.json({ poi });
});

