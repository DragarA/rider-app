import { db } from "@riding-app/db";
import { sql } from "drizzle-orm";

export type Poi = {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  description: string | null;
  isBikerFriendly: boolean;
  verified: boolean;
};

function rowToPoi(r: Record<string, unknown>): Poi {
  return {
    id: r.id as string,
    name: r.name as string,
    category: r.category as string,
    lat: Number(r.lat),
    lon: Number(r.lon),
    description: r.description as string | null,
    isBikerFriendly: r.is_biker_friendly as boolean,
    verified: r.verified as boolean,
  };
}

// Same bbox-prefilter-then-precise-check shape as surface.ts's
// computeSurfaceBreakdown — cheap on today's 8-row pois table, but keeps
// this correct (index-using) once real POI coverage grows past a handful
// of hand-seeded biker cafés.
const NEARBY_BBOX_PAD_DEGREES = 0.03; // ~2-3km at Slovenia's latitude

export async function findNearbyPois(geometry: GeoJSON.LineString, radiusMeters: number): Promise<Poi[]> {
  const geojson = JSON.stringify(geometry);

  const rows = await db.execute(sql`
    WITH route AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326) AS geom
    )
    SELECT p.id, p.name, p.category, ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon,
           p.description, p.is_biker_friendly, p.verified
    FROM pois p, route r
    WHERE p.geom && ST_Expand(r.geom, ${NEARBY_BBOX_PAD_DEGREES})
      AND ST_DWithin(p.geom::geography, r.geom::geography, ${radiusMeters})
  `);

  return rows.map(rowToPoi);
}

export type PoiFilters = {
  bbox?: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
  near?: { lat: number; lon: number; radiusMeters: number };
  categories?: string[];
  bikerFriendly?: boolean;
  verified?: boolean;
};

export async function queryPois(filters: PoiFilters): Promise<Poi[]> {
  const conditions = [sql`true`];

  if (filters.bbox) {
    const [minLon, minLat, maxLon, maxLat] = filters.bbox;
    conditions.push(sql`p.geom && ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)`);
  }
  if (filters.near) {
    conditions.push(sql`
      ST_DWithin(
        p.geom::geography,
        ST_SetSRID(ST_MakePoint(${filters.near.lon}, ${filters.near.lat}), 4326)::geography,
        ${filters.near.radiusMeters}
      )
    `);
  }
  if (filters.categories && filters.categories.length > 0) {
    conditions.push(sql`p.category = ANY(${filters.categories})`);
  }
  if (filters.bikerFriendly !== undefined) {
    conditions.push(sql`p.is_biker_friendly = ${filters.bikerFriendly}`);
  }
  if (filters.verified !== undefined) {
    conditions.push(sql`p.verified = ${filters.verified}`);
  }

  const whereClause = sql.join(conditions, sql` AND `);

  const rows = await db.execute(sql`
    SELECT p.id, p.name, p.category, ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon,
           p.description, p.is_biker_friendly, p.verified
    FROM pois p
    WHERE ${whereClause}
    LIMIT 200
  `);

  return rows.map(rowToPoi);
}
