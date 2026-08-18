import { db } from "@riding-app/db";
import { sql } from "drizzle-orm";
import type { SurfaceBreakdown } from "./surface.js";

export type RouteVisibility = "private" | "unlisted" | "public";

export type SavedRoute = {
  id: string;
  ownerId: string | null;
  title: string;
  description: string | null;
  geometry: GeoJSON.LineString;
  distanceMeters: number;
  estDurationSeconds: number;
  curvinessScore: number | null;
  surfaceBreakdown: Record<string, number> | null;
  visibility: RouteVisibility;
  generatedFromPrompt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RatingSummary = {
  count: number;
  avgScenicScore: number | null;
  avgSurfaceScore: number | null;
  avgFunScore: number | null;
};

export type Rating = {
  id: string;
  userId: string;
  scenicScore: number;
  surfaceScore: number;
  funScore: number;
  comment: string | null;
  riddenAt: string | null;
  createdAt: string;
};

// postgres.js returns timestamptz columns as Date normally, but as a plain
// string when the value came back through certain raw-SQL/RETURNING paths
// in this driver version — normalize both to ISO here rather than relying
// on one shape.
function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(value as string).toISOString();
}

function rowToSavedRoute(r: Record<string, unknown>): SavedRoute {
  return {
    id: r.id as string,
    ownerId: r.owner_id as string | null,
    title: r.title as string,
    description: r.description as string | null,
    geometry: JSON.parse(r.geometry_json as string) as GeoJSON.LineString,
    distanceMeters: r.distance_meters as number,
    estDurationSeconds: r.est_duration_seconds as number,
    curvinessScore: r.curviness_score === null ? null : Number(r.curviness_score),
    surfaceBreakdown: r.surface_breakdown as Record<string, number> | null,
    visibility: r.visibility as RouteVisibility,
    generatedFromPrompt: r.generated_from_prompt as string | null,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

// The routing engine only ever reports a gravel/cobblestone/asphalt split
// (see lib/surface.ts) — OSM's `surface` tag records material, not
// condition, so there's no way to populate asphalt_good vs. asphalt_worn
// from an automated import. All asphalt is stored as asphalt_good; unknown
// stays 0. See PROJECT_SPEC.md §3.3 for why the candidate shape itself only
// has three surface buckets.
export function mapSurfaceBreakdownToDb(sb: SurfaceBreakdown): Record<string, number> {
  return {
    asphalt_good: sb.asphalt,
    asphalt_worn: 0,
    gravel: sb.gravel,
    cobblestone: sb.cobblestone,
    unknown: 0,
  };
}

export type CreateRouteInput = {
  ownerId: string;
  title: string;
  description: string | null;
  geometry: GeoJSON.LineString;
  distanceMeters: number;
  estDurationSeconds: number;
  curvinessScore: number | null;
  surfaceBreakdown: Record<string, number> | null;
  visibility: RouteVisibility;
  generatedFromPrompt: string | null;
  generationConstraints: unknown;
};

export async function insertRoute(input: CreateRouteInput): Promise<SavedRoute> {
  const geojson = JSON.stringify(input.geometry);
  const surfaceJson = input.surfaceBreakdown ? JSON.stringify(input.surfaceBreakdown) : null;
  const constraintsJson = input.generationConstraints ? JSON.stringify(input.generationConstraints) : null;

  const [row] = await db.execute(sql`
    INSERT INTO routes (
      owner_id, title, description, geom, distance_meters, est_duration_seconds,
      curviness_score, surface_breakdown, visibility, generated_from_prompt,
      generation_constraints, source_routing_engine
    )
    VALUES (
      ${input.ownerId}, ${input.title}, ${input.description},
      ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326),
      ${Math.round(input.distanceMeters)}, ${Math.round(input.estDurationSeconds)}, ${input.curvinessScore},
      ${surfaceJson}::jsonb, ${input.visibility}, ${input.generatedFromPrompt},
      ${constraintsJson}::jsonb, 'graphhopper'
    )
    RETURNING id, owner_id, title, description, ST_AsGeoJSON(geom) AS geometry_json,
      distance_meters, est_duration_seconds, curviness_score, surface_breakdown,
      visibility, generated_from_prompt, created_at, updated_at
  `);
  return rowToSavedRoute(row!);
}

export async function getRouteById(id: string): Promise<SavedRoute | null> {
  const rows = await db.execute(sql`
    SELECT id, owner_id, title, description, ST_AsGeoJSON(geom) AS geometry_json,
      distance_meters, est_duration_seconds, curviness_score, surface_breakdown,
      visibility, generated_from_prompt, created_at, updated_at
    FROM routes
    WHERE id = ${id}
  `);
  return rows[0] ? rowToSavedRoute(rows[0]) : null;
}

export async function listMyRoutes(ownerId: string): Promise<SavedRoute[]> {
  const rows = await db.execute(sql`
    SELECT id, owner_id, title, description, ST_AsGeoJSON(geom) AS geometry_json,
      distance_meters, est_duration_seconds, curviness_score, surface_breakdown,
      visibility, generated_from_prompt, created_at, updated_at
    FROM routes
    WHERE owner_id = ${ownerId}
    ORDER BY created_at DESC
    LIMIT 50
  `);
  return rows.map(rowToSavedRoute);
}

export type PublicRouteFilters = {
  near?: { lat: number; lon: number; radiusMeters: number };
  maxDurationMinutes?: number;
};

export async function listPublicRoutes(filters: PublicRouteFilters): Promise<SavedRoute[]> {
  const conditions = [sql`visibility = 'public'`];

  if (filters.near) {
    conditions.push(sql`
      ST_DWithin(
        geom::geography,
        ST_SetSRID(ST_MakePoint(${filters.near.lon}, ${filters.near.lat}), 4326)::geography,
        ${filters.near.radiusMeters}
      )
    `);
  }
  if (filters.maxDurationMinutes !== undefined) {
    conditions.push(sql`est_duration_seconds <= ${filters.maxDurationMinutes * 60}`);
  }

  const whereClause = sql.join(conditions, sql` AND `);

  const rows = await db.execute(sql`
    SELECT id, owner_id, title, description, ST_AsGeoJSON(geom) AS geometry_json,
      distance_meters, est_duration_seconds, curviness_score, surface_breakdown,
      visibility, generated_from_prompt, created_at, updated_at
    FROM routes
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT 50
  `);
  return rows.map(rowToSavedRoute);
}

export type UpdateRouteInput = {
  title?: string;
  description?: string | null;
  visibility?: RouteVisibility;
};

export async function updateRoute(id: string, patch: UpdateRouteInput): Promise<SavedRoute | null> {
  const sets = [sql`updated_at = now()`];
  if (patch.title !== undefined) sets.push(sql`title = ${patch.title}`);
  if (patch.description !== undefined) sets.push(sql`description = ${patch.description}`);
  if (patch.visibility !== undefined) sets.push(sql`visibility = ${patch.visibility}`);

  const rows = await db.execute(sql`
    UPDATE routes
    SET ${sql.join(sets, sql`, `)}
    WHERE id = ${id}
    RETURNING id, owner_id, title, description, ST_AsGeoJSON(geom) AS geometry_json,
      distance_meters, est_duration_seconds, curviness_score, surface_breakdown,
      visibility, generated_from_prompt, created_at, updated_at
  `);
  return rows[0] ? rowToSavedRoute(rows[0]) : null;
}

export async function deleteRoute(id: string): Promise<boolean> {
  const rows = await db.execute(sql`DELETE FROM routes WHERE id = ${id} RETURNING id`);
  return rows.length > 0;
}

export type UpsertRatingInput = {
  routeId: string;
  userId: string;
  scenicScore: number;
  surfaceScore: number;
  funScore: number;
  comment: string | null;
  riddenAt: string | null;
};

export async function upsertRating(input: UpsertRatingInput): Promise<void> {
  await db.execute(sql`
    INSERT INTO route_ratings (route_id, user_id, scenic_score, surface_score, fun_score, comment, ridden_at)
    VALUES (
      ${input.routeId}, ${input.userId}, ${input.scenicScore}, ${input.surfaceScore},
      ${input.funScore}, ${input.comment}, ${input.riddenAt}
    )
    ON CONFLICT (route_id, user_id) DO UPDATE SET
      scenic_score = excluded.scenic_score,
      surface_score = excluded.surface_score,
      fun_score = excluded.fun_score,
      comment = excluded.comment,
      ridden_at = excluded.ridden_at
  `);
}

export async function listRatings(routeId: string): Promise<Rating[]> {
  const rows = await db.execute(sql`
    SELECT id, user_id, scenic_score, surface_score, fun_score, comment, ridden_at, created_at
    FROM route_ratings
    WHERE route_id = ${routeId}
    ORDER BY created_at DESC
  `);
  return rows.map((r) => ({
    id: r.id as string,
    userId: r.user_id as string,
    scenicScore: r.scenic_score as number,
    surfaceScore: r.surface_score as number,
    funScore: r.fun_score as number,
    comment: r.comment as string | null,
    riddenAt: r.ridden_at ? toIso(r.ridden_at) : null,
    createdAt: toIso(r.created_at),
  }));
}

export async function getRatingSummary(routeId: string): Promise<RatingSummary> {
  const [row] = await db.execute(sql`
    SELECT count(*)::int AS count,
      avg(scenic_score)::float AS avg_scenic,
      avg(surface_score)::float AS avg_surface,
      avg(fun_score)::float AS avg_fun
    FROM route_ratings
    WHERE route_id = ${routeId}
  `);
  return {
    count: row!.count as number,
    avgScenicScore: row!.avg_scenic as number | null,
    avgSurfaceScore: row!.avg_surface as number | null,
    avgFunScore: row!.avg_fun as number | null,
  };
}

// A route is visible to `userId` (null = anonymous) if it's public,
// unlisted (findable by anyone who has the link/id — no owner check by
// design), or private and owned by the caller.
export function canView(route: SavedRoute, userId: string | null): boolean {
  if (route.visibility === "public" || route.visibility === "unlisted") return true;
  return route.ownerId !== null && route.ownerId === userId;
}
