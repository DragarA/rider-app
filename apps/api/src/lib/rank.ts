import type { RouteConstraints } from "../schemas/constraints.js";
import type { SurfaceBreakdown } from "./surface.js";

// Where each curviness preference sits on the 0-1 curvatureScore scale —
// see curvature.ts for how that scale was calibrated. A candidate is
// ranked by how close it lands to this target, not by "more curvy = better":
// someone asking for "relaxed" shouldn't get penalized for avoiding hairpins.
const TARGET_CURVINESS: Record<RouteConstraints["curvinessPref"], number> = {
  relaxed: 0.15,
  twisty: 0.45,
  very_twisty: 0.8,
};

// Beyond this, a route no longer reads as "passing near" the requested
// place — round_trip has no way to aim for a point (verified empirically:
// its `heading` param has zero effect on the resulting loop), so this
// rewards candidates that happen to swing that way out of a batch of
// random-seed loops rather than trying to force it.
const MAX_PROXIMITY_METERS = 8000;

// round_trip's actual duration routinely blows past what was asked for
// (measured empirically: pace.ts's ROUND_TRIP_OVERSHOOT_FACTOR compensates
// the request, but variance is too high to trust that alone — up to 2.4x
// overshoot seen near mountainous origins). So ranking scores candidates
// against the rider's real maxDurationMinutes, not the internal distance
// used to ask GraphHopper for a loop. Going over the stated budget is
// penalized much harder than coming in under it: "at most 3 hours" is a
// budget the rider is planning their day around, not a rough preference —
// finishing early is a non-issue, finishing an hour late is the failure
// mode this exists to avoid.
const OVER_BUDGET_PENALTY = 2.5;
const UNDER_BUDGET_PENALTY = 0.5;

// How fast surfaceFit drops to 0 as the non-asphalt fraction climbs.
// "any" is flat at 0 — the fit is always 1 regardless of surface, since
// the rider said they don't care. No hard filter for asphalt_only either
// (consistent with duration/curviness elsewhere in this function): Slovenia
// has enough gravel forest roads that a hard cutoff risks zero candidates
// surviving. Instead the penalty is just steep — 17% non-asphalt already
// zeroes out asphalt_only's surfaceFit, vs. 50% for asphalt_preferred.
const NON_ASPHALT_STEEPNESS: Record<RouteConstraints["surfacePref"], number> = {
  any: 0,
  asphalt_preferred: 2,
  asphalt_only: 6,
};

type Weights = { duration: number; curviness: number; surface: number; proximity: number };

// Curviness match matters more than exactly hitting the duration budget —
// "twisty" is the whole point of this app, and durationFit's asymmetric
// penalty already keeps over-budget candidates from ranking well. When a
// mustPassNear point is in play, proximity to it dominates: that's the one
// thing the rider named explicitly, on top of what the structured form
// already covers.
const WEIGHTS_DEFAULT: Weights = { duration: 0.3, curviness: 0.5, surface: 0.2, proximity: 0 };
const WEIGHTS_WITH_PROXIMITY: Weights = { duration: 0.2, curviness: 0.25, surface: 0.15, proximity: 0.4 };

export function rankScore(
  candidate: {
    estDurationSeconds: number;
    curvinessScore: number;
    surfaceBreakdown: SurfaceBreakdown;
    proximityMeters?: number;
  },
  constraints: RouteConstraints,
): number {
  const maxDurationSeconds = constraints.maxDurationMinutes * 60;
  const overBy = Math.max(0, candidate.estDurationSeconds - maxDurationSeconds) / maxDurationSeconds;
  const underBy = Math.max(0, maxDurationSeconds - candidate.estDurationSeconds) / maxDurationSeconds;
  const durationFit = 1 - Math.min(overBy * OVER_BUDGET_PENALTY + underBy * UNDER_BUDGET_PENALTY, 1);

  const target = TARGET_CURVINESS[constraints.curvinessPref];
  const curvinessFit = 1 - Math.min(Math.abs(candidate.curvinessScore - target), 1);

  const nonAsphalt = candidate.surfaceBreakdown.gravel + candidate.surfaceBreakdown.cobblestone;
  const steepness = NON_ASPHALT_STEEPNESS[constraints.surfacePref];
  const surfaceFit = 1 - Math.min(nonAsphalt * steepness, 1);

  const hasProximity = candidate.proximityMeters !== undefined;
  const weights = hasProximity ? WEIGHTS_WITH_PROXIMITY : WEIGHTS_DEFAULT;
  const proximityFit = hasProximity
    ? 1 - Math.min(candidate.proximityMeters! / MAX_PROXIMITY_METERS, 1)
    : 0;

  return (
    weights.duration * durationFit +
    weights.curviness * curvinessFit +
    weights.surface * surfaceFit +
    weights.proximity * proximityFit
  );
}
