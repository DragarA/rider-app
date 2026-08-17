import { db } from "@riding-app/db";
import { sql } from "drizzle-orm";

export type ResolvedPlace = {
  name: string;
  kind: string;
  region: string | null;
  lat: number;
  lon: number;
  similarity: number;
};

// Below this, a trigram match is more likely coincidence than intent.
// Raised from an initial 0.3 after two live false positives: "Ivančna
// Gorica" (missing from the gazetteer at the time) matched "Nova Gorica"
// at 0.35 — a real town, but 100km from the one the rider meant. Expanding
// the gazetteer (seed.ts) fixed that specific case, but similar collisions
// remain for anything still missing: "Rateče" -> "Radeče" scores 0.4,
// "Vipavska dolina" -> "Loška Dolina" scores 0.45 — both real places,
// both wrong. 0.5 clears both of those while comfortably keeping genuine
// matches: "vrsic" -> "Vršič" scores 1.0, "kranjska" -> "Kranjska Gora"
// scores ~0.64.
const MIN_SIMILARITY = 0.5;

export async function searchPlaces(query: string, limit = 5): Promise<ResolvedPlace[]> {
  const rows = await db.execute(sql`
    SELECT
      name,
      kind,
      region,
      ST_Y(geom) AS lat,
      ST_X(geom) AS lon,
      similarity(unaccent(name), unaccent(${query})) AS sim
    FROM places
    WHERE similarity(unaccent(name), unaccent(${query})) > ${MIN_SIMILARITY}
    ORDER BY sim DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    name: r.name as string,
    kind: r.kind as string,
    region: r.region as string | null,
    lat: Number(r.lat),
    lon: Number(r.lon),
    similarity: Number(r.sim),
  }));
}

export async function resolvePlace(query: string): Promise<ResolvedPlace | null> {
  const [best] = await searchPlaces(query, 1);
  return best ?? null;
}
