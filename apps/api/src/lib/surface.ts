import { db } from "@riding-app/db";
import { sql } from "drizzle-orm";

// Segments further than this from the route never actually touch it —
// this is slop for graph/geometry misalignment between GraphHopper's
// returned polyline and the raw OSM way geometry it was built from, not a
// "nearby POI" radius.
const PROXIMITY_METERS = 15;

// Degree-space padding for the bbox prefilter — generous relative to
// PROXIMITY_METERS (roughly 100m at Slovenia's latitude) since this only
// needs to be a cheap, index-friendly first pass, not the precise check.
const BBOX_PAD_DEGREES = 0.001;

export type SurfaceBreakdown = {
  gravel: number;
  cobblestone: number;
  asphalt: number;
};

// What fraction of a candidate's length runs over non-paved surface.
// road_segments only stores the exceptions to "presumed paved" (see
// infra/road-surfaces) — so asphalt% is derived as the remainder, not
// measured directly. There's no attempt at an asphalt_good/asphalt_worn
// split: OSM doesn't tag road condition, only material, so that
// distinction from RouteCandidate's original design isn't something this
// import can actually produce.
export async function computeSurfaceBreakdown(geometry: GeoJSON.LineString): Promise<SurfaceBreakdown> {
  const geojson = JSON.stringify(geometry);

  // LEFT JOIN, not an implicit cross join against `buffered`: a fully
  // paved route has nothing in `buffered` at all, and a plain cross join
  // against an empty set silently returns zero rows — which would make
  // "no bad segments nearby" indistinguishable from "route geometry was
  // empty/invalid" once parsed below. The LEFT JOIN guarantees at least
  // one row carrying total_meters regardless.
  //
  // `nearby` filters with && first (geometry-domain bbox overlap — uses
  // road_segments_geom_gist_idx) before the precise ST_DWithin(geography)
  // check. Measured live: without the && prefilter, the ::geography cast
  // on an indexed geometry column defeats the index entirely — Postgres
  // fell back to a parallel sequential scan across all ~140k rows,
  // 43.7s per query. With it, sub-second.
  const rows = await db.execute(sql`
    WITH route AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326) AS geom
    ),
    nearby AS (
      SELECT rs.category, rs.geom
      FROM road_segments rs, route r
      WHERE rs.geom && ST_Expand(r.geom, ${BBOX_PAD_DEGREES})
        AND ST_DWithin(rs.geom::geography, r.geom::geography, ${PROXIMITY_METERS})
    ),
    buffered AS (
      SELECT category, ST_Union(ST_Buffer(geom::geography, ${PROXIMITY_METERS})::geometry) AS buf
      FROM nearby
      GROUP BY category
    )
    SELECT
      b.category,
      CASE WHEN b.buf IS NOT NULL THEN ST_Length(ST_Intersection(r.geom, b.buf)::geography) ELSE 0 END AS overlap_meters,
      ST_Length(r.geom::geography) AS total_meters
    FROM route r
    LEFT JOIN buffered b ON true
  `);

  const totalMeters = rows[0] ? Number(rows[0].total_meters) : 0;
  if (totalMeters === 0) {
    // Genuinely degenerate input (empty/zero-length geometry) — shouldn't
    // happen with real GraphHopper output, but "no data" isn't "100% paved".
    return { gravel: 0, cobblestone: 0, asphalt: 0 };
  }

  let gravelMeters = 0;
  let cobblestoneMeters = 0;
  for (const row of rows) {
    if (row.category === null) continue;
    const overlap = Number(row.overlap_meters);
    if (row.category === "gravel") gravelMeters += overlap;
    else if (row.category === "cobblestone") cobblestoneMeters += overlap;
  }

  const gravel = Math.min(gravelMeters / totalMeters, 1);
  const cobblestone = Math.min(cobblestoneMeters / totalMeters, 1);
  const asphalt = Math.max(1 - gravel - cobblestone, 0);

  return { gravel, cobblestone, asphalt };
}
