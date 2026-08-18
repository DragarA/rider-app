import { db } from "@riding-app/db";
import { sql } from "drizzle-orm";

export type PoiMetadata = {
  openingHours?: string;
  elevationMeters?: number;
  passClosedInWinter?: boolean;
  externalUrl?: string;
  locationPrecision?: "exact" | "town";
};

export type Poi = {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  description: string | null;
  isBikerFriendly: boolean;
  verified: boolean;
  createdById: string | null;
  metadata: PoiMetadata | null;
};

const POI_COLUMNS = sql`
  p.id, p.name, p.category, ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon,
  p.description, p.is_biker_friendly, p.verified, p.created_by_id, p.metadata
`;

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
    createdById: r.created_by_id as string | null,
    metadata: r.metadata as PoiMetadata | null,
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
    SELECT ${POI_COLUMNS}
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
  createdById?: string;
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
    // Not `p.category = ANY(${filters.categories})`: passing a JS array as
    // a single bound parameter through Drizzle's `sql` tag loses its
    // "array" type on the wire, so postgres.js's driver receives a bare
    // string and ANY() 500s with "malformed array literal" — a real,
    // previously-unexercised bug found via live testing (GET /pois's
    // `category` filter had never actually been called end-to-end before
    // this phase). An OR-chain of plain equality checks sidesteps the
    // array-binding question entirely.
    conditions.push(
      sql`(${sql.join(
        filters.categories.map((c) => sql`p.category = ${c}`),
        sql` OR `,
      )})`,
    );
  }
  if (filters.bikerFriendly !== undefined) {
    conditions.push(sql`p.is_biker_friendly = ${filters.bikerFriendly}`);
  }
  if (filters.verified !== undefined) {
    conditions.push(sql`p.verified = ${filters.verified}`);
  }
  if (filters.createdById !== undefined) {
    conditions.push(sql`p.created_by_id = ${filters.createdById}`);
  }

  const whereClause = sql.join(conditions, sql` AND `);

  const rows = await db.execute(sql`
    SELECT ${POI_COLUMNS}
    FROM pois p
    WHERE ${whereClause}
    LIMIT 200
  `);

  return rows.map(rowToPoi);
}

export async function getPoiById(id: string): Promise<Poi | null> {
  const rows = await db.execute(sql`SELECT ${POI_COLUMNS} FROM pois p WHERE p.id = ${id}`);
  return rows[0] ? rowToPoi(rows[0]) : null;
}

export type CreatePoiInput = {
  createdById: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  description: string | null;
  isBikerFriendly: boolean;
  metadata: PoiMetadata | null;
};

export async function insertPoi(input: CreatePoiInput): Promise<Poi> {
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

  const [row] = await db.execute(sql`
    INSERT INTO pois (created_by_id, name, category, geom, description, is_biker_friendly, verified, metadata)
    VALUES (
      ${input.createdById}, ${input.name}, ${input.category},
      ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326),
      ${input.description}, ${input.isBikerFriendly}, false, ${metadataJson}::jsonb
    )
    RETURNING id
  `);
  return (await getPoiById(row!.id as string))!;
}

export type UpdatePoiInput = {
  name?: string;
  category?: string;
  description?: string | null;
  isBikerFriendly?: boolean;
  metadata?: PoiMetadata | null;
};

export async function updatePoi(id: string, patch: UpdatePoiInput): Promise<Poi | null> {
  const sets = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.category !== undefined) sets.push(sql`category = ${patch.category}`);
  if (patch.description !== undefined) sets.push(sql`description = ${patch.description}`);
  if (patch.isBikerFriendly !== undefined) sets.push(sql`is_biker_friendly = ${patch.isBikerFriendly}`);
  if (patch.metadata !== undefined) {
    sets.push(sql`metadata = ${patch.metadata ? JSON.stringify(patch.metadata) : null}::jsonb`);
  }
  if (sets.length === 0) return getPoiById(id);

  await db.execute(sql`UPDATE pois SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
  return getPoiById(id);
}

export async function deletePoi(id: string): Promise<boolean> {
  const rows = await db.execute(sql`DELETE FROM pois WHERE id = ${id} RETURNING id`);
  return rows.length > 0;
}

export async function setPoiVerified(id: string, verified: boolean): Promise<Poi | null> {
  await db.execute(sql`UPDATE pois SET verified = ${verified} WHERE id = ${id}`);
  return getPoiById(id);
}
