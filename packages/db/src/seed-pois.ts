import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { db } from "./client.js";
import { sql } from "drizzle-orm";

// Reads <repo root>/biker_cafes.csv (columns: name,town,description,url —
// user-curated, since "which cafes are actually biker-friendly" isn't
// something OSM tags or any API can answer) and geocodes each entry
// against OpenStreetMap's Nominatim: first the exact business name + town
// (finds real POIs that are individually mapped), falling back to just the
// town if that fails (a real but coarser location — never a guessed one).
// Re-run this whenever biker_cafes.csv gains new rows.
const CSV_PATH = fileURLToPath(new URL("../../../biker_cafes.csv", import.meta.url));

const NOMINATIM_USER_AGENT = "riding-app-dev-geocode/1.0 (local dev tool, low-volume one-off seed script)";
const NOMINATIM_RATE_LIMIT_MS = 1100; // Nominatim's usage policy caps at 1 req/sec

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.length > 0)) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.length > 0)) rows.push(row);
  }
  return rows;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function nominatimSearch(query: string): Promise<{ lat: number; lon: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q: query,
    format: "json",
    countrycodes: "si",
    limit: "1",
  })}`;
  const res = await fetch(url, { headers: { "User-Agent": NOMINATIM_USER_AGENT } });
  if (!res.ok) return null;
  const results = (await res.json()) as { lat: string; lon: string }[];
  if (results.length === 0) return null;
  return { lat: Number(results[0]!.lat), lon: Number(results[0]!.lon) };
}

type Row = { name: string; town: string; description: string; url: string };

// Curated mountain_pass POIs (Phase 5) — reuses the exact coordinates
// already verified in the `places` gazetteer (seed.ts) rather than
// re-guessing them (see the Rakitna coordinate bug from Phase 3.5:
// verify once, reuse everywhere, don't hand-type the same place twice).
// passClosedInWinter is a real, well-known fact for both, and is the
// fallback baseline `apps/api/src/lib/passConditions.ts` uses whenever a
// live NAP signal doesn't correlate to the pass.
const MOUNTAIN_PASS_POIS = [
  { name: "Vršič", lat: 46.4331, lon: 13.7478 },
  { name: "Mangart", lat: 46.4389, lon: 13.6122 },
];

// biker_cafes.csv's descriptive names ("Gostilna in Pizzerija Grof") don't
// always match how OSM tags the place ("GROF"). Verified by hand for these
// two — searching the alias directly finds the real business/landmark
// instead of falling back to a several-km-off town centroid:
//   "GROF" -> the actual restaurant (Vransko), not just Vransko's centroid
//   "Črnivec" -> the actual mountain pass (Gornji Grad municipality is
//     ~9km from the pass itself, which is what the CSV's description
//     — "at top of Črnivec pass" — is actually naming)
const NAME_ALIASES: Record<string, string> = {
  "Gostilna in Pizzerija Grof": "GROF",
  "Pizzerija in Moto Bar Črnivec": "Črnivec",
};

async function main() {
  const csvText = await readFile(CSV_PATH, "utf-8");
  const [header, ...dataRows] = parseCsv(csvText);
  if (!header || header.map((h) => h.trim()).join(",") !== "name,town,description,url") {
    throw new Error(`Unexpected CSV header in ${CSV_PATH}: ${header?.join(",")}`);
  }

  const rows: Row[] = dataRows.map(([name, town, description, url]) => ({
    name: name ?? "",
    town: town ?? "",
    description: description ?? "",
    url: url ?? "",
  }));

  console.log(`Geocoding ${rows.length} places from ${CSV_PATH}…`);
  // DELETE, not TRUNCATE: waypoints has an FK to pois, and TRUNCATE refuses
  // to run against a referenced table without CASCADE. pois stays tiny, so
  // DELETE's lack of a fast-path doesn't matter here.
  await db.execute(sql`DELETE FROM pois`);

  console.log(`Seeding ${MOUNTAIN_PASS_POIS.length} mountain passes…`);
  for (const pass of MOUNTAIN_PASS_POIS) {
    await db.execute(sql`
      INSERT INTO pois (name, category, geom, is_biker_friendly, verified, metadata)
      VALUES (
        ${pass.name},
        'mountain_pass',
        ST_SetSRID(ST_MakePoint(${pass.lon}, ${pass.lat}), 4326),
        true,
        true,
        ${JSON.stringify({ passClosedInWinter: true })}::jsonb
      )
    `);
  }

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    // Tried in this order because a literal ", Slovenia" suffix and the
    // full business name together measurably hurt Nominatim's match rate
    // (verified: this exact query variant found only 1/8 exact matches on
    // a first pass, vs. 4/8 when queried as bare name or name+town without
    // the country string — countrycodes=si already scopes the search, so
    // spelling out "Slovenia" is redundant noise for its parser).
    let result = await nominatimSearch(row.name);
    await sleep(NOMINATIM_RATE_LIMIT_MS);

    if (!result) {
      result = await nominatimSearch(`${row.name}, ${row.town}`);
      await sleep(NOMINATIM_RATE_LIMIT_MS);
    }

    if (!result && NAME_ALIASES[row.name]) {
      result = await nominatimSearch(NAME_ALIASES[row.name]!);
      await sleep(NOMINATIM_RATE_LIMIT_MS);
    }

    let precision: "exact" | "town" = result ? "exact" : "town";

    if (!result) {
      result = await nominatimSearch(row.town);
      await sleep(NOMINATIM_RATE_LIMIT_MS);
    }

    if (!result) {
      console.warn(`  SKIP "${row.name}" (${row.town}) — no geocoding match, not even at town level`);
      skipped++;
      continue;
    }

    console.log(
      `  ${precision === "exact" ? "✓ exact" : "~ town-level"}  ${row.name} -> ${result.lat.toFixed(4)}, ${result.lon.toFixed(4)}`,
    );

    const metadata = JSON.stringify({
      ...(row.url ? { externalUrl: row.url } : {}),
      locationPrecision: precision,
    });

    await db.execute(sql`
      INSERT INTO pois (name, category, geom, description, is_biker_friendly, verified, metadata)
      VALUES (
        ${row.name},
        'biker_cafe',
        ST_SetSRID(ST_MakePoint(${result.lon}, ${result.lat}), 4326),
        ${row.description || null},
        true,
        true,
        ${metadata}::jsonb
      )
    `);
    inserted++;
  }

  console.log(`Done. Inserted ${inserted}, skipped ${skipped}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
