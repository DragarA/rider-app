import { Hono } from "hono";
import { getPassConditions } from "../lib/passConditions.js";

export const conditionsRouter = new Hono();

// Public, no auth — mirrors how POIs/gazetteer stay anonymous. See
// PROJECT_SPEC.md §0.1 for the NAP integration's live-verification status.
conditionsRouter.get("/passes", async (c) => {
  return c.json(await getPassConditions());
});
