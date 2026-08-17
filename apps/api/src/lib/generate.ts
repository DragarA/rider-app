import { pointToLineDistance } from "@turf/turf";
import type { RouteConstraints, RouteCandidate } from "../schemas/constraints.js";
import { requestRoundTrip, requestWaypointRoute } from "./graphhopper.js";
import { curvatureScore } from "./curvature.js";
import { computeSurfaceBreakdown } from "./surface.js";
import { findNearbyPois } from "./pois.js";
import { rankScore } from "./rank.js";

// How close a POI has to be to a candidate's geometry to show up as
// "along the route" — loose enough to catch a café just off the road,
// tight enough that it still reads as "on this loop" rather than
// "somewhere in the same valley".
const NEARBY_POI_RADIUS_METERS = 2000;

type GenerateOptions = {
  constraints: RouteConstraints;
  targetDistanceMeters: number;
  count?: number;
  // A resolved point the rider wants the loop to pass near. round_trip
  // can't be steered toward it directly (see rank.ts), so instead this
  // requests more candidates and ranks by which one happens to swing
  // closest, on top of the usual distance/curviness fit.
  mustPassNear?: { lat: number; lon: number };
};

// Higher than the original 3/6: round_trip's duration variance is wide
// enough (empirically 1.05x-2.4x the requested distance, occasionally an
// outright failure near mountainous origins) that more attempts noticeably
// improve the odds of landing at least one candidate inside the rider's
// actual time budget.
const DEFAULT_CANDIDATE_COUNT = 5;
const WITH_PROXIMITY_CANDIDATE_COUNT = 8;

export async function generateCandidates(opts: GenerateOptions): Promise<RouteCandidate[]> {
  const count = opts.count ?? (opts.mustPassNear ? WITH_PROXIMITY_CANDIDATE_COUNT : DEFAULT_CANDIDATE_COUNT);

  const seeds = new Set<number>();
  while (seeds.size < count) {
    seeds.add(Math.floor(Math.random() * 1_000_000));
  }

  const roundTripPromises = [...seeds].map((seed) =>
    requestRoundTrip({
      origin: opts.constraints.origin,
      distanceMeters: opts.targetDistanceMeters,
      seed,
      avoidHighways: opts.constraints.avoidHighways,
    }),
  );

  // A real, deterministic origin -> mustPassNear -> origin route, run
  // alongside the random round_trip attempts rather than instead of them.
  // Needed because round_trip can't be aimed at a point at all — its
  // `heading` param was verified to have zero effect on the resulting
  // loop — so on its own it only reaches a requested place by luck. A
  // live bug report caught this: 8/8 random attempts from Ljubljana
  // toward Rakitna (~14km away) got no closer than 4.86km before looping
  // back, while a direct waypoint request reached it in 39km/57min. This
  // is an out-and-back, not a proper loop, so it's one candidate among
  // several rather than the only option — ranking (rank.ts) still decides
  // whether it's actually the best pick once duration/curviness/surface
  // are weighed too.
  const waypointPromise = opts.mustPassNear
    ? requestWaypointRoute({
        points: [opts.constraints.origin, opts.mustPassNear, opts.constraints.origin],
        avoidHighways: opts.constraints.avoidHighways,
      })
    : Promise.resolve(null);

  const results = await Promise.all([...roundTripPromises, waypointPromise]);

  const successful = results.filter((r): r is NonNullable<typeof r> => r !== null);

  // Surface lookups are independent per candidate (each ~300-500ms — see
  // surface.ts) so they run concurrently rather than adding up serially.
  const candidates = await Promise.all(
    successful.map(async (r) => {
      const curviness = curvatureScore(r.geometry);
      const [surfaceBreakdown, nearbyPois] = await Promise.all([
        computeSurfaceBreakdown(r.geometry),
        findNearbyPois(r.geometry, NEARBY_POI_RADIUS_METERS),
      ]);
      const proximityMeters = opts.mustPassNear
        ? pointToLineDistance([opts.mustPassNear.lon, opts.mustPassNear.lat], r.geometry, { units: "meters" })
        : undefined;

      const candidate: RouteCandidate = {
        geometry: r.geometry,
        distanceMeters: r.distanceMeters,
        estDurationSeconds: r.estDurationSeconds,
        curvinessScore: curviness,
        surfaceBreakdown,
        nearbyPois,
        rankScore: rankScore(
          { estDurationSeconds: r.estDurationSeconds, curvinessScore: curviness, surfaceBreakdown, proximityMeters },
          opts.constraints,
        ),
      };
      return candidate;
    }),
  );

  return candidates.sort((a, b) => b.rankScore - a.rankScore);
}
