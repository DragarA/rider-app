import { db } from "@riding-app/db";
import { sql } from "drizzle-orm";
import { fetchPassEvents, napConfigured } from "./napClient.js";

// How long a cached NAP fetch stays fresh before the next request
// triggers a refetch — a lazy cache-aside refresh, not a scheduled job:
// this stack has no cron/worker process anywhere (see road_segments'
// one-time-ETL precedent), so "cached with a scheduled refresh" (the
// original Phase 5 wording) is implemented as "cached with a max age",
// which gets the same practical result without new infra.
const CACHE_TTL_MINUTES = 15;

// Generous relative to how precisely a promet.si/NAP event's location
// pins the actual pass — events are road-network points, not the pass's
// own coordinate, so a tight radius would miss real matches.
const CORRELATION_RADIUS_METERS = 3000;

export type LivePassEvent = {
  id: string;
  title: string;
  description: string | null;
  category: string;
};

export type PassConditionSummary = {
  poiId: string;
  name: string;
  lat: number;
  lon: number;
  passClosedInWinter: boolean;
  liveEvents: LivePassEvent[];
};

export type PassConditionsResult = {
  configured: boolean;
  passes: PassConditionSummary[];
};

async function cacheIsStale(): Promise<boolean> {
  const [row] = await db.execute(sql`SELECT max(fetched_at) AS latest FROM pass_conditions`);
  const latest = row?.latest as Date | string | null;
  if (!latest) return true;
  const latestMs = latest instanceof Date ? latest.getTime() : new Date(latest).getTime();
  return Date.now() - latestMs > CACHE_TTL_MINUTES * 60 * 1000;
}

async function refreshCache(): Promise<void> {
  const events = await fetchPassEvents();
  for (const event of events) {
    if (!event.point) continue; // no representative point, nothing to correlate against
    await db.execute(sql`
      INSERT INTO pass_conditions (id, title, description, category, geom, raw, fetched_at)
      VALUES (
        ${event.id}, ${event.title}, ${event.description}, ${event.category},
        ST_SetSRID(ST_MakePoint(${event.point.lon}, ${event.point.lat}), 4326),
        ${JSON.stringify(event.raw)}::jsonb, now()
      )
      ON CONFLICT (id) DO UPDATE SET
        title = excluded.title, description = excluded.description,
        category = excluded.category, geom = excluded.geom, raw = excluded.raw,
        fetched_at = excluded.fetched_at
    `);
  }
}

// Public entry point: GET /api/v1/conditions/passes calls this directly.
// Degrades gracefully when NAP isn't configured yet (no env vars set) —
// same spirit as how AI_PROVIDER already degrades when unset — returning
// just the manual passClosedInWinter baseline instead of erroring.
export async function getPassConditions(): Promise<PassConditionsResult> {
  const configured = napConfigured();

  if (configured && (await cacheIsStale())) {
    try {
      await refreshCache();
    } catch (err) {
      // A NAP outage or bad credentials shouldn't break this endpoint —
      // fall through and serve whatever's cached (possibly nothing yet)
      // plus the manual flag.
      console.error("NAP pass-conditions refresh failed:", err);
    }
  }

  const passRows = await db.execute(sql`
    SELECT id, name, ST_Y(geom) AS lat, ST_X(geom) AS lon, metadata
    FROM pois
    WHERE category = 'mountain_pass' AND verified = true
  `);

  const passes: PassConditionSummary[] = [];
  for (const row of passRows) {
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    const metadata = row.metadata as { passClosedInWinter?: boolean } | null;

    const eventRows = configured
      ? await db.execute(sql`
          SELECT id, title, description, category
          FROM pass_conditions
          WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
            ${CORRELATION_RADIUS_METERS}
          )
        `)
      : [];

    passes.push({
      poiId: row.id as string,
      name: row.name as string,
      lat,
      lon,
      passClosedInWinter: metadata?.passClosedInWinter ?? false,
      liveEvents: eventRows.map((e) => ({
        id: e.id as string,
        title: e.title as string,
        description: e.description as string | null,
        category: e.category as string,
      })),
    });
  }

  return { configured, passes };
}
