import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { searchPlaces } from "../lib/gazetteer.js";

export const placesRouter = new Hono();

const searchQuerySchema = z.object({
  q: z.string().min(1).max(100),
});

// PROJECT_SPEC.md §3.4 — gazetteer lookup, shared by UI autocomplete (not
// yet wired into the frontend) and the AI grounding step (ai.ts uses
// resolvePlace() directly rather than an HTTP round-trip to this route).
placesRouter.get("/search", zValidator("query", searchQuerySchema), async (c) => {
  const { q } = c.req.valid("query");
  const places = await searchPlaces(q);
  return c.json({ places });
});
