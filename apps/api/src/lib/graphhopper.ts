const GRAPHHOPPER_URL = process.env.GRAPHHOPPER_URL ?? "http://localhost:8989";

// Suppresses motorway/trunk edges when avoidHighways is set. Verified
// against the live instance during Phase 0/1: a Ljubljana→Celje test route
// dropped from using the A1 motorway (47min) to routing entirely via
// secondary/tertiary roads (73min) once this custom_model was applied.
const AVOID_HIGHWAYS_CUSTOM_MODEL = {
  priority: [{ if: "road_class == MOTORWAY || road_class == TRUNK", multiply_by: "0" }],
};

type RoundTripParams = {
  origin: { lat: number; lon: number };
  distanceMeters: number;
  seed: number;
  avoidHighways: boolean;
};

type RoundTripResult = {
  geometry: GeoJSON.LineString;
  distanceMeters: number;
  estDurationSeconds: number;
};

export async function requestRoundTrip(params: RoundTripParams): Promise<RoundTripResult | null> {
  const body: Record<string, unknown> = {
    points: [[params.origin.lon, params.origin.lat]],
    profile: "car",
    algorithm: "round_trip",
    "round_trip.distance": params.distanceMeters,
    "round_trip.seed": params.seed,
    points_encoded: false,
    // round_trip only runs in flexible mode — see infra/graphhopper/config.yml
    // for why we don't prepare Contraction Hierarchies for the car profile.
    "ch.disable": true,
  };
  if (params.avoidHighways) {
    body.custom_model = AVOID_HIGHWAYS_CUSTOM_MODEL;
  }

  const res = await fetch(`${GRAPHHOPPER_URL}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(`GraphHopper round_trip failed (seed=${params.seed}):`, await res.text());
    return null;
  }

  const data = (await res.json()) as {
    paths?: { distance: number; time: number; points: GeoJSON.LineString }[];
  };
  const path = data.paths?.[0];
  if (!path) return null;

  return {
    geometry: path.points,
    distanceMeters: path.distance,
    estDurationSeconds: Math.round(path.time / 1000),
  };
}

type WaypointRouteParams = {
  points: { lat: number; lon: number }[];
  avoidHighways: boolean;
};

// A real multi-point route (origin -> waypoint -> ... -> origin), not
// round_trip. Exists because round_trip's direction is fundamentally
// uncontrollable — verified in Phase 2 that its `heading` param has zero
// effect on the resulting loop — so "pass near place X" can only ever be a
// hope with random-seed round_trip, not a guarantee. A real point-to-point
// request reliably reaches every listed point, at the cost of being an
// out-and-back rather than a proper loop (GraphHopper may or may not pick
// different roads each direction). Used as one guaranteed candidate
// alongside the random round_trip attempts, not a replacement for them.
export async function requestWaypointRoute(params: WaypointRouteParams): Promise<RoundTripResult | null> {
  const body: Record<string, unknown> = {
    points: params.points.map((p) => [p.lon, p.lat]),
    profile: "car",
    points_encoded: false,
    "ch.disable": true,
  };
  if (params.avoidHighways) {
    body.custom_model = AVOID_HIGHWAYS_CUSTOM_MODEL;
  }

  const res = await fetch(`${GRAPHHOPPER_URL}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error("GraphHopper waypoint route failed:", await res.text());
    return null;
  }

  const data = (await res.json()) as {
    paths?: { distance: number; time: number; points: GeoJSON.LineString }[];
  };
  const path = data.paths?.[0];
  if (!path) return null;

  return {
    geometry: path.points,
    distanceMeters: path.distance,
    estDurationSeconds: Math.round(path.time / 1000),
  };
}
