import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { routeConstraintsSchema } from "../schemas/constraints.js";
import { targetDistanceMeters } from "../lib/pace.js";
import { generateCandidates } from "../lib/generate.js";
import { buildGpx } from "../lib/gpx.js";

export const routesRouter = new Hono();

// Structured constraints only, synchronous JSON response — the Phase 1
// form and the "advanced" fallback UI post here directly. The prompt-driven
// path (natural language -> AI extraction -> these same constraints) is
// POST /api/v1/ai/generate (routes/ai.ts), SSE-streamed since it has real
// intermediate stages ("interpreting…" before "generating…"). This endpoint
// doesn't need that: structured input is already fully resolved.
//
// surfacePref is accepted here for forward compatibility with the documented
// contract, but isn't enforced yet — filtering by road surface needs the
// road_segments cache from Phase 3, so every candidate is scored purely on
// distance fit and curviness for now.
routesRouter.post("/generate", zValidator("json", routeConstraintsSchema), async (c) => {
  const constraints = c.req.valid("json");
  const target = targetDistanceMeters(constraints);
  const candidates = await generateCandidates({ constraints, targetDistanceMeters: target });

  if (candidates.length === 0) {
    return c.json(
      { error: "No route candidates could be generated for this origin — try a different starting point." },
      502,
    );
  }

  return c.json({ constraints, targetDistanceMeters: target, candidates });
});

const gpxRequestSchema = z.object({
  title: z.string().min(1).max(150),
  geometry: z.object({
    type: z.literal("LineString"),
    coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
  }),
});

// Ad-hoc GPX export for an unsaved candidate — Phase 1 needs "generate then
// export" to work before route persistence (Phase 4) exists. Once routes
// can be saved, GET /routes/:id/gpx (PROJECT_SPEC.md §3.1) serves the same
// format for a saved route; this endpoint stays for exporting a candidate
// the user hasn't decided to save yet.
routesRouter.post("/gpx", zValidator("json", gpxRequestSchema), (c) => {
  const { title, geometry } = c.req.valid("json");
  const gpx = buildGpx({ title, geometry: geometry as GeoJSON.LineString });

  c.header("Content-Type", "application/gpx+xml");
  c.header("Content-Disposition", `attachment; filename="${title.replace(/[^a-z0-9-_]+/gi, "_")}.gpx"`);
  return c.body(gpx);
});
