import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { queryPois } from "../lib/pois.js";

export const poisRouter = new Hono();

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
});

poisRouter.get("/", zValidator("query", poiQuerySchema), async (c) => {
  const q = c.req.valid("query");

  const pois = await queryPois({
    bbox: q.bbox as [number, number, number, number] | undefined,
    near: q.near ? { lon: q.near[0]!, lat: q.near[1]!, radiusMeters: (q.radiusKm ?? 5) * 1000 } : undefined,
    categories: q.category ? q.category.split(",") : undefined,
    bikerFriendly: q.bikerFriendly === undefined ? undefined : q.bikerFriendly === "true",
    verified: q.verified === undefined ? undefined : q.verified === "true",
  });

  return c.json({ pois });
});
