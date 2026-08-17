import { z } from "zod";
import type { SurfaceBreakdown } from "../lib/surface.js";
import type { Poi } from "../lib/pois.js";

// Structured route constraints — the Phase 1 form posts this shape directly.
// Phase 2 adds a natural-language prompt that gets turned into this same
// shape via the AI SDK, so this schema is the contract both paths converge on.
export const routeConstraintsSchema = z.object({
  origin: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    label: z.string().optional(),
  }),
  maxDurationMinutes: z.number().min(15).max(720),
  curvinessPref: z.enum(["relaxed", "twisty", "very_twisty"]),
  surfacePref: z.enum(["asphalt_only", "asphalt_preferred", "any"]),
  avoidHighways: z.boolean(),
});

export type RouteConstraints = z.infer<typeof routeConstraintsSchema>;

export type RouteCandidate = {
  geometry: GeoJSON.LineString;
  distanceMeters: number;
  estDurationSeconds: number;
  curvinessScore: number;
  surfaceBreakdown: SurfaceBreakdown;
  nearbyPois: Poi[];
  rankScore: number;
};
