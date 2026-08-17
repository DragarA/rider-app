import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { extractDraftConstraints } from "../lib/ai/extract.js";
import { resolvePlace } from "../lib/gazetteer.js";
import { targetDistanceMeters } from "../lib/pace.js";
import { generateCandidates } from "../lib/generate.js";
import type { RouteConstraints } from "../schemas/constraints.js";

export const aiRouter = new Hono();

const promptRequestSchema = z.object({
  prompt: z.string().min(3).max(500),
});

// The prompt-driven counterpart to POST /routes/generate (PROJECT_SPEC.md
// §4.2). SSE because there are real intermediate stages worth showing the
// user: "interpreting your request" (the LLM call) happens before
// "generating candidates" (GraphHopper + ranking) even starts.
//
// Pipeline: extractDraftConstraints (1 LLM call) -> resolvePlace for the
// origin and, if mentioned, the mustPassNear place (deterministic gazetteer
// lookups, no LLM involved) -> generateCandidates (deterministic, shared
// with the structured endpoint). See extract.ts for why grounding place
// names is kept out of the LLM call entirely.
aiRouter.post("/generate", zValidator("json", promptRequestSchema), async (c) => {
  const { prompt } = c.req.valid("json");

  return streamSSE(c, async (stream) => {
    let draft;
    try {
      draft = await extractDraftConstraints(prompt);
    } catch (err) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: `Couldn't interpret that request: ${(err as Error).message}` }),
      });
      return;
    }

    const origin = await resolvePlace(draft.originQuery);
    if (!origin) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: `Couldn't find a place called "${draft.originQuery}" in Slovenia.` }),
      });
      return;
    }

    const mustPassNear = draft.mustPassNearQuery ? await resolvePlace(draft.mustPassNearQuery) : null;

    const constraints: RouteConstraints = {
      origin: { lat: origin.lat, lon: origin.lon, label: origin.name },
      maxDurationMinutes: draft.maxDurationMinutes,
      curvinessPref: draft.curvinessPref,
      surfacePref: draft.surfacePref,
      avoidHighways: draft.avoidHighways,
    };

    await stream.writeSSE({
      event: "constraints",
      data: JSON.stringify({
        constraints,
        mustPassNear: mustPassNear ? { name: mustPassNear.name, lat: mustPassNear.lat, lon: mustPassNear.lon } : null,
        unresolvedMustPassNearQuery: draft.mustPassNearQuery && !mustPassNear ? draft.mustPassNearQuery : null,
      }),
    });

    const target = targetDistanceMeters(constraints);
    const candidates = await generateCandidates({
      constraints,
      targetDistanceMeters: target,
      mustPassNear: mustPassNear ?? undefined,
    });

    if (candidates.length === 0) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          message: "No route candidates could be generated for this origin — try a different starting point.",
        }),
      });
      return;
    }

    await stream.writeSSE({
      event: "candidates",
      data: JSON.stringify({ targetDistanceMeters: target, candidates }),
    });
    await stream.writeSSE({ event: "done", data: "{}" });
  });
});
