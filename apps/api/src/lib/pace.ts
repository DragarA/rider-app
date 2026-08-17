import type { RouteConstraints } from "../schemas/constraints.js";

// Effective average speed per curviness tier, including stops — used to turn
// a requested ride duration into a target loop distance for GraphHopper's
// round_trip. These are rough planning assumptions, not physics; revisit
// once real ride data (route_ratings) gives us actual pace-vs-curviness
// numbers to calibrate against.
const EFFECTIVE_KMH: Record<RouteConstraints["curvinessPref"], number> = {
  relaxed: 55,
  twisty: 40,
  very_twisty: 30,
};

// GraphHopper's round_trip reliably overshoots the distance it's asked
// for — measured empirically across origins/distances: mean 1.31x, but
// ranging from 1.05x on flat routes near Ljubljana up to 2.4x near
// Kranjska Gora's mountain terrain. Asking for less up front reduces how
// far ranking has to compensate, but the variance is too high to rely on
// this alone — see rank.ts, which scores candidates against the rider's
// actual stated duration budget rather than trusting this estimate.
const ROUND_TRIP_OVERSHOOT_FACTOR = 1.31;

export function targetDistanceMeters(constraints: RouteConstraints): number {
  const kmh = EFFECTIVE_KMH[constraints.curvinessPref];
  const hours = constraints.maxDurationMinutes / 60;
  return Math.round((kmh * hours * 1000) / ROUND_TRIP_OVERSHOOT_FACTOR);
}
