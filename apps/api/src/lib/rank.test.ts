import { test } from "node:test";
import assert from "node:assert/strict";
import { rankScore } from "./rank.js";
import type { RouteConstraints } from "../schemas/constraints.js";
import type { SurfaceBreakdown } from "./surface.js";

const BASE_CONSTRAINTS: RouteConstraints = {
  origin: { lat: 46.0569, lon: 14.5058 },
  maxDurationMinutes: 180, // 3h budget, matching the bug report
  curvinessPref: "twisty",
  surfacePref: "any",
  avoidHighways: true,
};

const FULLY_PAVED: SurfaceBreakdown = { gravel: 0, cobblestone: 0, asphalt: 1 };

test("a candidate exactly on the duration budget outscores one 50% over it", () => {
  const onBudget = rankScore(
    { estDurationSeconds: 180 * 60, curvinessScore: 0.45, surfaceBreakdown: FULLY_PAVED },
    BASE_CONSTRAINTS,
  );
  const wayOver = rankScore(
    { estDurationSeconds: 270 * 60, curvinessScore: 0.45, surfaceBreakdown: FULLY_PAVED }, // 4h30m, the reported bug
    BASE_CONSTRAINTS,
  );
  assert.ok(onBudget > wayOver, `expected on-budget (${onBudget}) > over-budget (${wayOver})`);
});

test("going over budget is penalized harder than coming in under it by the same margin", () => {
  const over = rankScore(
    { estDurationSeconds: 180 * 60 * 1.2, curvinessScore: 0.45, surfaceBreakdown: FULLY_PAVED }, // 20% over
    BASE_CONSTRAINTS,
  );
  const under = rankScore(
    { estDurationSeconds: 180 * 60 * 0.8, curvinessScore: 0.45, surfaceBreakdown: FULLY_PAVED }, // 20% under
    BASE_CONSTRAINTS,
  );
  assert.ok(under > over, `expected under-budget (${under}) > over-budget (${over}) for equal-magnitude misses`);
});

test("a candidate matching the curviness target outscores one that doesn't, at equal duration", () => {
  const matching = rankScore(
    { estDurationSeconds: 180 * 60, curvinessScore: 0.45, surfaceBreakdown: FULLY_PAVED }, // "twisty" target is 0.45
    BASE_CONSTRAINTS,
  );
  const mismatched = rankScore(
    { estDurationSeconds: 180 * 60, curvinessScore: 0.05, surfaceBreakdown: FULLY_PAVED }, // reads as "relaxed"
    BASE_CONSTRAINTS,
  );
  assert.ok(matching > mismatched);
});

test("closer proximity to a mustPassNear point outscores farther, all else equal", () => {
  const close = rankScore(
    { estDurationSeconds: 180 * 60, curvinessScore: 0.45, surfaceBreakdown: FULLY_PAVED, proximityMeters: 200 },
    BASE_CONSTRAINTS,
  );
  const far = rankScore(
    { estDurationSeconds: 180 * 60, curvinessScore: 0.45, surfaceBreakdown: FULLY_PAVED, proximityMeters: 7000 },
    BASE_CONSTRAINTS,
  );
  assert.ok(close > far);
});

test("surfacePref 'any' ignores gravel entirely", () => {
  const paved = rankScore(
    { estDurationSeconds: 180 * 60, curvinessScore: 0.45, surfaceBreakdown: FULLY_PAVED },
    { ...BASE_CONSTRAINTS, surfacePref: "any" },
  );
  const gravelly = rankScore(
    {
      estDurationSeconds: 180 * 60,
      curvinessScore: 0.45,
      surfaceBreakdown: { gravel: 0.4, cobblestone: 0, asphalt: 0.6 },
    },
    { ...BASE_CONSTRAINTS, surfacePref: "any" },
  );
  assert.equal(paved, gravelly, "surfacePref 'any' should score identically regardless of gravel%");
});

test("the same gravel% is penalized harder under asphalt_only than asphalt_preferred", () => {
  const gravelly: SurfaceBreakdown = { gravel: 0.2, cobblestone: 0, asphalt: 0.8 };
  const preferred = rankScore(
    { estDurationSeconds: 180 * 60, curvinessScore: 0.45, surfaceBreakdown: gravelly },
    { ...BASE_CONSTRAINTS, surfacePref: "asphalt_preferred" },
  );
  const only = rankScore(
    { estDurationSeconds: 180 * 60, curvinessScore: 0.45, surfaceBreakdown: gravelly },
    { ...BASE_CONSTRAINTS, surfacePref: "asphalt_only" },
  );
  assert.ok(preferred > only, `expected asphalt_preferred (${preferred}) > asphalt_only (${only}) for the same 20% gravel`);
});

test("a fully paved candidate outscores a gravelly one under asphalt_only", () => {
  const paved = rankScore(
    { estDurationSeconds: 180 * 60, curvinessScore: 0.45, surfaceBreakdown: FULLY_PAVED },
    { ...BASE_CONSTRAINTS, surfacePref: "asphalt_only" },
  );
  const gravelly = rankScore(
    {
      estDurationSeconds: 180 * 60,
      curvinessScore: 0.45,
      surfaceBreakdown: { gravel: 0.3, cobblestone: 0, asphalt: 0.7 },
    },
    { ...BASE_CONSTRAINTS, surfacePref: "asphalt_only" },
  );
  assert.ok(paved > gravelly);
});
