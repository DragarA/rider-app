# Slovenian Ride Planner — Project Spec

Status: **Phases 0-3 implemented and verified live** (Phase 3.5 bug-fix
round included). Phase 4 (save/rate/share, needs auth) not started. This
document has been updated to describe what was actually built, not just
the original plan — where reality diverged from the plan below, that's
called out inline. For the detailed build diary (bugs found, root causes,
fixes, live verification evidence), see `README.md`; this file stays the
architecture reference.

## 0.1 Current status (read this first)

**Working end-to-end right now**, all verified live against real GraphHopper/Postgres/OpenRouter, not just typechecked:
- Structured-form route generation (`POST /routes/generate`) and natural-language prompt generation (`POST /ai/generate`, SSE) both produce ranked, real candidates with GPX export and a "open in Google Maps" preview link.
- Curvature scoring, surface-quality scoring (gravel/cobblestone vs. asphalt), POI proximity, and duration-budget-aware ranking all work and are unit-tested.
- The AI layer resolves place names via a real 225-entry Slovenian gazetteer (all 212 municipalities + hand-picked passes/regions), provider-agnostic across Anthropic/OpenAI/OpenRouter.
- "Pass near place X" is handled by a guaranteed deterministic waypoint route alongside random `round_trip` attempts, not by hoping a random loop gets lucky.
- 8 real biker cafés (user-curated, geocoded against OpenStreetMap) plus passes/viewpoints are seeded and always visible on the map.

**Key deviations from the original plan below**, decided during implementation (see §5 "Decisions actually made" for the reasoning):
- Map: **MapLibre GL JS + OpenFreeMap**, not Mapbox or Leaflet — OpenFreeMap serves vector tiles for a MapLibre/Mapbox-style renderer, which Leaflet can't consume natively, so "Leaflet + OpenFreeMap" (the original recommendation) was never actually viable.
- Routing: **GraphHopper**, as planned, but `round_trip`'s direction turned out to be completely uncontrollable (`heading` has zero measured effect) — "pass near a specific place" needed a second mechanism (a real point-to-point request run alongside the random loops), not just ranking.
- AI extraction uses `generateText` + `output: Output.object(...)`, not `generateObject` — the latter is deprecated in the AI SDK version this project ended up on. Grounding (`lookupPlace`) is plain backend code calling the gazetteer directly, not a tool the model invokes.
- Provider list grew to three: Anthropic, OpenAI, **and OpenRouter** (added for cheap local-dev iteration against multiple model backends through one key).
- Two extra tables beyond the original five: `places` (gazetteer) and `road_segments` (non-paved surface cache) — both were always implied by the design but not spec'd in §2 originally.
- No auth yet — Phase 4 needs it and hasn't started, so every route lives in-memory per request; nothing persists to `routes`/`waypoints`/`route_ratings` yet even though those tables exist in the schema.

**Real bugs found via live testing that are worth knowing about before extending this further** (full detail in `README.md`):
1. A GraphHopper spatial query cast an indexed geometry column to `geography`, silently defeating the GiST index — 43.7s per surface-quality query, down to ~350ms after adding a bbox prefilter.
2. OpenAI's strict structured-output mode rejects `.optional()` Zod fields; needs `.nullable()` instead.
3. Ranking originally scored candidates against an internal distance estimate instead of the rider's actual stated duration; a candidate could exceed the requested time budget and still rank first.
4. The original hand-typed ~30-place gazetteer was missing real towns and had a similarity threshold low enough to confidently return the *wrong* town instead of "not found."
5. One gazetteer coordinate (Rakitna) was flat-out wrong — hand-typed from memory back in Phase 0 and never verified like the rest of the gazetteer, off by ~12.6km. Every earlier demo involving Rakitna was quietly routing to the wrong place.
6. A MapLibre symbol layer with no explicit `text-font` 404'd against the style's font endpoint and silently dropped labels.

## 0. Product Summary

A web app for planning motorcycle rides in Slovenia. The user describes what
they want in natural language (or a form), the system generates a twisty,
scenic loop route using real OSM road data, enriches it with local knowledge
(surface quality, biker POIs, mountain pass conditions), and lets the rider
export it as a GPX file for their GPS unit or phone.

Two user-facing pillars:
1. **Route Generator** — AI-assisted, constraint-driven route creation.
2. **Community Layer** — saved routes, ratings, POI contributions, shared
   local knowledge (which passes are gravel, which cafés welcome bikers).

---

## 1. System Architecture

### 1.1 High-level component diagram

Updated to match what's actually running (see §0.1 for the deviations):

```
                                   ┌────────────────────────┐
                                   │        Browser          │
                                   │  React + Vite + TS       │
                                   │  MapLibre GL JS           │
                                   │  (OpenFreeMap vector tiles) │
                                   └───────────┬──────────────┘
                                               │ HTTPS (JSON / SSE for AI path)
                                               ▼
                                   ┌────────────────────────┐
                                   │      Hono API (Node)     │
                                   │  TypeScript                │
                                   ├────────────────────────┤
                                   │  /routes/generate  /routes/gpx │
                                   │  /ai/generate (SSE)             │
                                   │  /places/search  /pois           │
                                   │  (/auth /ratings — Phase 4, TBD)  │
                                   └──┬───────┬───────┬───────┘
                                      │       │       │
                    ┌─────────────────┘       │       └───────────────────┐
                    ▼                         ▼                           ▼
        ┌───────────────────┐   ┌───────────────────────┐   ┌─────────────────────┐
        │  AI extraction layer │   │  GraphHopper client     │   │  Deterministic scoring │
        │  Vercel AI SDK Core   │   │  round_trip (random)    │   │  curvature.ts           │
        │  generateText +        │   │  + waypoint route        │   │  surface.ts (PostGIS)    │
        │  Output.object          │   │  (guaranteed mustPassNear) │   │  pois.ts (PostGIS)        │
        └──────────┬──────────┘   └────────────┬────────────┘   └───────────┬───────────┘
                   │  free-text place names       │ returns geometry/GPX          │
                   │  (grounded via gazetteer.ts,  │                                │
                   │   plain backend code, not an  │                                │
                   │   LLM tool call)               │                                │
                   ▼                               ▼                                ▼
                                   ┌────────────────────────────┐
                                   │   PostgreSQL + PostGIS       │
                                   │   (Drizzle ORM)               │
                                   │   places (gazetteer, 225 rows)│
                                   │   road_segments (140k rows)    │
                                   │   pois (13 rows)                │
                                   │   users/routes/waypoints/        │
                                   │   route_ratings (schema exists,  │
                                   │   unused — no auth, Phase 4)      │
                                   └────────────────────────────┘
```

### 1.2 Component responsibilities

- **React SPA (Vite)**: map rendering, route-request form + prompt box, GPX
  download, an "Open in Google Maps" preview link. Talks only to the Hono
  API — never directly to GraphHopper or the DB. Route/POI browsing and
  ratings UI don't exist yet (Phase 4/5).
- **Hono API**: single TypeScript backend. Owns validation (Zod) and
  orchestration between the AI extraction layer, GraphHopper, and PostGIS.
  No auth yet — every request is anonymous.
- **AI extraction layer (Vercel AI SDK Core)**: a thin module inside the Hono
  process (`apps/api/src/lib/ai/`), not a standalone service. Given a
  natural-language prompt, produces a structured draft constraints object via
  `generateText` + `output: Output.object(...)` against a Zod schema
  (`generateObject` is deprecated in the AI SDK version this landed on).
  Place names stay free text at this stage — grounding is a separate,
  deterministic step (`gazetteer.ts`), not a tool the model invokes.
- **Routing Engine (GraphHopper)**: a separate self-hosted service (Docker)
  with a full Slovenia OSM graph. Two distinct request shapes are used
  against it, not one: `round_trip` (random seed, distance, no directional
  control — confirmed via testing that `heading` has zero effect) for
  general loop variety, and a plain multi-point route
  (`origin → waypoint → origin`, GraphHopper's normal routing, not
  `round_trip`) as a *guaranteed* candidate whenever the rider named a
  specific place to pass near. The Hono API is a client of this service — it
  does not reimplement routing.
- **PostGIS**: source of truth for curated data — the 225-place gazetteer,
  the 140k-row non-paved `road_segments` cache, and the 13-row `pois` table.
  Route/waypoint/rating persistence tables exist in the schema but are
  unused (no save flow yet — Phase 4).
- **Data services layer (weather, pass conditions)**: not built. Still
  planned for Phase 5's mountain-pass condition integration; nothing today
  calls promet.si/AMZS/Open-Meteo.

### 1.3 Request flow: "Generate a route from a prompt" (as actually built)

1. User types a prompt in the React app: *"3-hour twisty route from
   Ljubljana around Rakitna with smooth asphalt."*
2. React POSTs to `POST /api/v1/ai/generate` (SSE). This is a separate
   endpoint from the structured-form path (`POST /api/v1/routes/generate`,
   plain JSON) rather than one endpoint branching on a `prompt` vs.
   `constraints` body as originally planned — the prompt path has real
   intermediate stages worth streaming ("interpreting…" before
   "generating…"), the structured path doesn't need to.
3. Hono calls `extractDraftConstraints` (one `generateText` call, Slovenia-
   aware system prompt) to get a draft: origin as free text, duration,
   curviness/surface prefs, avoid-highways, and an optional single
   `mustPassNearQuery` (also free text). No LLM tool calls involved.
4. Hono resolves `originQuery` and `mustPassNearQuery` against the `places`
   gazetteer (`gazetteer.ts`, PostGIS trigram similarity + `unaccent`,
   entirely deterministic) and streams an `event: constraints` back so the
   UI can show what was understood before candidates exist.
5. Hono requests candidates from GraphHopper in parallel: 5 (or 8 if a
   `mustPassNear` point resolved) random-seed `round_trip` loops, plus — if
   `mustPassNear` resolved — one guaranteed `origin → mustPassNear → origin`
   route. Each successful result gets curvature-scored (turf.js,
   turn-angle-per-km), surface-scored (PostGIS overlap against
   `road_segments`), and checked for nearby POIs, then ranked by a weighted
   fit against duration/curviness/surface/proximity (`rank.ts`) — not
   filtered by any hard cutoff, so there's always something to show even
   when nothing fits perfectly.
6. Hono streams `event: candidates` with the ranked list (GeoJSON geometry,
   distance, est. duration, curviness score, surface breakdown, nearby
   POIs), then `event: done`.
7. User picks a candidate and either downloads GPX
   (`POST /api/v1/routes/gpx`, works on an unsaved candidate — no save flow
   exists yet) or opens an approximation in Google Maps (waypoint-limited,
   see §3.1).

### 1.4 Why this split (and not, e.g., AI calling GraphHopper directly)

The AI model should never be trusted to produce raw geometry or hit external
routing APIs directly — it's good at turning fuzzy human intent into
*structured constraints*, and mediocre/unreliable at anything requiring
precise geographic computation. Keeping "understand intent" (AI SDK) and
"compute geometry" (GraphHopper/Valhalla) as separate, composable stages
keeps the system debuggable and lets you swap either piece later.

---

## 2. Core Domain Models (Drizzle + PostGIS draft)

Using `drizzle-orm/pg-core` with the PostGIS extension via a custom
`geometry` column helper (Drizzle doesn't ship native PostGIS types yet, so
we define a small `geometry()` column helper using `customType`).

```typescript
// db/schema.ts
import {
  pgTable, uuid, varchar, text, timestamp, integer, real, boolean,
  jsonb, pgEnum, customType, primaryKey, index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// --- PostGIS geometry helper -------------------------------------------
const geometry = <TSrid extends number = 4326>(
  name: string,
  opts: { type: "Point" | "LineString" | "Polygon"; srid?: TSrid } = { type: "Point" },
) =>
  customType<{ data: string }>({
    dataType() {
      return `geometry(${opts.type},${opts.srid ?? 4326})`;
    },
  })(name);

// --- Enums ---------------------------------------------------------------
export const surfaceTypeEnum = pgEnum("surface_type", [
  "asphalt_good", "asphalt_worn", "gravel", "cobblestone", "unknown",
]);

export const poiCategoryEnum = pgEnum("poi_category", [
  "viewpoint", "fuel", "biker_cafe", "repair_shop", "mountain_pass",
  "border_crossing", "photo_spot", "hazard",
]);

export const routeVisibilityEnum = pgEnum("route_visibility", [
  "private", "unlisted", "public",
]);

// --- Users -----------------------------------------------------------------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  displayName: varchar("display_name", { length: 100 }).notNull(),
  homeBaseGeom: geometry("home_base_geom", { type: "Point" }),
  preferences: jsonb("preferences").$type<{
    defaultSurfacePref?: "asphalt_only" | "asphalt_preferred" | "any";
    defaultCurvinessPref?: "relaxed" | "twisty" | "very_twisty";
    unitSystem?: "metric" | "imperial";
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// --- Routes ------------------------------------------------------------
export const routes = pgTable("routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 150 }).notNull(),
  description: text("description"),
  geom: geometry("geom", { type: "LineString" }).notNull(),
  distanceMeters: integer("distance_meters").notNull(),
  estDurationSeconds: integer("est_duration_seconds").notNull(),
  elevationGainMeters: integer("elevation_gain_meters"),
  curvinessScore: real("curviness_score"), // precomputed, 0-1
  surfaceBreakdown: jsonb("surface_breakdown").$type<
    Partial<Record<(typeof surfaceTypeEnum.enumValues)[number], number>> // % of route
  >(),
  visibility: routeVisibilityEnum("visibility").default("private").notNull(),
  generatedFromPrompt: text("generated_from_prompt"), // original NL prompt, nullable
  generationConstraints: jsonb("generation_constraints"), // resolved RouteConstraints
  sourceRoutingEngine: varchar("source_routing_engine", { length: 30 }), // "graphhopper" | "valhalla" | "manual"
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  geomIdx: index("routes_geom_gist_idx").using("gist", t.geom),
  ownerIdx: index("routes_owner_idx").on(t.ownerId),
}));

// --- Waypoints (ordered stops within a route: start/end/via/POI-linked) ---
export const waypoints = pgTable("waypoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  routeId: uuid("route_id").notNull().references(() => routes.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(), // 0-based order along the route
  geom: geometry("geom", { type: "Point" }).notNull(),
  label: varchar("label", { length: 120 }),
  kind: varchar("kind", { length: 20 }).notNull().default("via"), // start|via|end|poi_stop
  poiId: uuid("poi_id").references(() => pois.id),
}, (t) => ({
  routeSeqIdx: index("waypoints_route_seq_idx").on(t.routeId, t.sequence),
  geomIdx: index("waypoints_geom_gist_idx").using("gist", t.geom),
}));

// --- POIs (community + curated) -----------------------------------------
export const pois = pgTable("pois", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdById: uuid("created_by_id").references(() => users.id),
  name: varchar("name", { length: 150 }).notNull(),
  category: poiCategoryEnum("category").notNull(),
  geom: geometry("geom", { type: "Point" }).notNull(),
  description: text("description"),
  isBikerFriendly: boolean("is_biker_friendly").default(false),
  verified: boolean("verified").default(false), // moderated/confirmed by admin
  metadata: jsonb("metadata").$type<{
    openingHours?: string;
    elevationMeters?: number;
    passClosedInWinter?: boolean;
    externalUrl?: string;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  geomIdx: index("pois_geom_gist_idx").using("gist", t.geom),
  categoryIdx: index("pois_category_idx").on(t.category),
}));

// --- Route Ratings ---------------------------------------------------------
export const routeRatings = pgTable("route_ratings", {
  id: uuid("id").primaryKey().defaultRandom(),
  routeId: uuid("route_id").notNull().references(() => routes.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  scenicScore: integer("scenic_score").notNull(),   // 1-5
  surfaceScore: integer("surface_score").notNull(), // 1-5
  funScore: integer("fun_score").notNull(),         // 1-5 ("twistiness fun factor")
  comment: text("comment"),
  riddenAt: timestamp("ridden_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniqueUserRoute: primaryKey({ columns: [t.routeId, t.userId] }),
}));

// --- Relations ---------------------------------------------------------
export const routesRelations = relations(routes, ({ one, many }) => ({
  owner: one(users, { fields: [routes.ownerId], references: [users.id] }),
  waypoints: many(waypoints),
  ratings: many(routeRatings),
}));

export const usersRelations = relations(users, ({ many }) => ({
  routes: many(routes),
  ratings: many(routeRatings),
}));
```

Notes:
- `geom` columns use SRID 4326 (WGS84 lon/lat) — standard for GPS/GPX
  interop; any distance/area math in PostGIS queries should cast to a
  metric projection (e.g. `ST_Transform(geom, 3857)` or a local SI
  projection) rather than trusting degree-based measurements.
- `curvinessScore` and `surfaceBreakdown` are **precomputed at generation
  time** (from the routing engine's returned geometry cross-referenced with
  an OSM road-attributes cache), not computed live on every read.
- A separate `road_segments` table (OSM way-derived, with `surface`,
  `curvature_score`, `maxspeed` tags cached from an Osmium/osm2pgsql import)
  is implied by §1 but intentionally left out of MVP scope — see §5.

### 2.1 Implementation notes (what's actually in `packages/db/src/schema.ts`)

The draft above is still directionally accurate but has drifted from the
real schema in a few ways — treat `schema.ts` as the source of truth, not
this file:

- **Two tables beyond the original five**, both live and populated:
  - `places` (the gazetteer): `id`, `name`, `kind` (town/region/mountain_pass/natural_feature), `region` (nullable), `geom` (Point), `createdAt`. GiST index on `geom`, GIN trigram index on `name` (needs the `pg_trgm` and `unaccent` Postgres extensions — see `infra/postgres/init.sql`). Seeded from `packages/db/src/seed.ts`: all 212 Slovenian municipalities pulled from OpenStreetMap (Overpass API), plus a handful of hand-picked non-municipality places (mountain passes, regions, a couple of named villages) — verify any new hand-typed entry against a real geocoder before trusting it (§0.1, bug #5).
  - `road_segments`: `osmWayId` (bigint PK), `highway`, `surfaceTag` (nullable), `category` (`gravel` | `cobblestone` | `unknown`), `geom` (LineString). Only stores the *exception* to "presumed paved" — absence from this table means asphalt. Populated by a one-time ETL (`infra/road-surfaces/extract.py` + a `\copy`-based staging-table load), not at request time.
- **`pois.metadata`** gained a field not in the original draft:
  `locationPrecision?: "exact" | "town"` — records whether a seeded POI's
  coordinates came from geocoding the exact business or only its town,
  since not every hand-curated entry resolves precisely.
- **`route_ratings`**'s uniqueness constraint is a `unique()` on
  `(routeId, userId)` with a separate surrogate `id` as the actual primary
  key, not the composite primary key shown in the draft above (Drizzle
  tables need exactly one PK; a composite PK plus a separate `id` column
  was self-contradictory in the original draft).
- Enums grew: `placeKindEnum`, `waypointKindEnum`, and
  `roadSurfaceCategoryEnum` were added alongside the original three.
- None of `users`, `routes`, `waypoints`, `route_ratings` have any real data
  yet — they exist and migrate cleanly, but nothing writes to them until
  Phase 4 adds auth and a save flow.

---

## 3. API Contract (REST, Hono)

Base path: `/api/v1`. **No auth exists yet** — every endpoint is anonymous
today; session cookie / bearer token auth is still Phase 4 scope.

### 3.1 Implemented and verified live

```
POST   /api/v1/routes/generate
  Body: RouteConstraints (structured, see 3.3)  — no prompt/stream option here
  Response: 200 JSON { constraints, targetDistanceMeters, candidates: RouteCandidate[] }
  # Plain JSON, not SSE — the structured-form path has no intermediate
  # stages worth streaming. Used by the "Advanced" tab.

POST   /api/v1/ai/generate
  Body: { prompt: string }
  Response: 200, Content-Type: text/event-stream
    - event "constraints": { constraints, mustPassNear, unresolvedMustPassNearQuery }
    - event "candidates":  { targetDistanceMeters, candidates: RouteCandidate[] }
    - event "done":        {}
    - event "error":       { message: string }
  # The prompt-driven path — separate endpoint from routes/generate (see §1.3
  # for why). Used by the "Describe" tab.

POST   /api/v1/routes/gpx
  Body: { title: string, geometry: GeoJSON.LineString }
  Response: 200, Content-Type: application/gpx+xml, Content-Disposition: attachment
  # Exports an unsaved candidate directly — no persistence required. This is
  # deliberately not GET /routes/:id/gpx yet, since routes can't be saved
  # until Phase 4 adds persistence; this ad-hoc endpoint stays useful even
  # after that lands, for exporting a candidate before deciding to save it.

GET    /api/v1/places/search?q=Rakitna
  Response: { places: { name, kind, region, lat, lon, similarity }[] }
  # Gazetteer lookup (PostGIS trigram + unaccent). Used internally by the AI
  # grounding step and exposed here for UI autocomplete (not yet wired into
  # the frontend — the origin picker is still map-click only).

GET    /api/v1/pois
  Query: ?bbox=minLon,minLat,maxLon,maxLat  &near=lon,lat&radiusKm=  &category=biker_cafe,...  &bikerFriendly=true  &verified=true
  Response: { pois: Poi[] }
  # All filters combine with AND. Frontend currently calls this with no
  # filters on load to always show every POI on the map (see §1.3 of the
  # README for why "only show POIs near the selected route" was a UX bug).
```

### 3.2 Planned, not built (Phase 4/5)

```
GET    /api/v1/routes                       # list saved routes
GET    /api/v1/routes/:id                   # route detail + waypoints + ratings
POST   /api/v1/routes                       # save a generated candidate
PATCH  /api/v1/routes/:id
DELETE /api/v1/routes/:id
GET    /api/v1/routes/:id/gpx               # GPX for a *saved* route (vs. the ad-hoc POST above)

GET    /api/v1/pois/:id
POST   /api/v1/pois                         # community submission, verified=false until moderated
PATCH  /api/v1/pois/:id
DELETE /api/v1/pois/:id

POST   /api/v1/routes/:id/ratings
GET    /api/v1/routes/:id/ratings

GET    /api/v1/conditions/passes            # mountain-pass status, Phase 5
```

### 3.3 Shared types (as actually implemented — `apps/api/src/schemas/constraints.ts`)

```typescript
type RouteConstraints = {
  origin: { lat: number; lon: number; label?: string };
  maxDurationMinutes: number;
  curvinessPref: "relaxed" | "twisty" | "very_twisty";
  surfacePref: "asphalt_only" | "asphalt_preferred" | "any";
  avoidHighways: boolean;
  // No loopRadiusKm, no mustPassNear array — the AI path resolves at most
  // one mustPassNearQuery internally (see §4) and folds it into candidate
  // generation server-side; it isn't part of this shared constraints shape.
};

type RouteCandidate = {
  geometry: GeoJSON.LineString;
  distanceMeters: number;
  estDurationSeconds: number;
  curvinessScore: number;
  surfaceBreakdown: { gravel: number; cobblestone: number; asphalt: number };
  // No asphalt_good/asphalt_worn split — OSM doesn't tag road condition,
  // only material, so that distinction from the original draft isn't
  // something an automated import can actually produce.
  nearbyPois: Poi[];
  rankScore: number;
};
```

---

## 4. AI Integration Strategy

### 4.1 Goal

Convert a fuzzy natural-language ask into a **validated, structured
`RouteConstraints` object**, then hand off to deterministic systems
(GraphHopper + PostGIS) for the actual geometry. The AI's job stops at
"understand intent" — it does not compute or hallucinate coordinates/roads.

### 4.2 Pipeline (as implemented — `apps/api/src/lib/ai/extract.ts`)

**Step 1 — Structured extraction, implemented with `generateText` + `Output.object`, not `generateObject`**

`generateObject` is deprecated in the AI SDK version this project landed
on (`ai@7`); the current recommended pattern is `generateText` with an
`output` spec:

```typescript
const draftConstraintsSchema = z.object({
  originQuery: z.string().describe("The starting town/place name, e.g. 'Ljubljana' or 'Rakitna'."),
  maxDurationMinutes: z.number().min(15).max(720),
  curvinessPref: z.enum(["relaxed", "twisty", "very_twisty"]),
  surfacePref: z.enum(["asphalt_only", "asphalt_preferred", "any"]),
  avoidHighways: z.boolean(),
  // .nullable(), not .optional(): OpenAI's strict structured-output mode
  // (hit in practice via OpenRouter -> Azure) requires every property in
  // the schema's "required" array. An omittable key 400s with
  // "'required' is required... Missing 'mustPassNearQuery'".
  mustPassNearQuery: z.string().nullable().describe("A single place the rider wants the loop to pass near, or null."),
});

const result = await generateText({
  model: getModel(), // provider-agnostic: anthropic | openai | openrouter, see 4.4
  system: SYSTEM_PROMPT,
  prompt,
  output: Output.object({ schema: draftConstraintsSchema }),
});
const draft = result.output;
```

Also a real, deliberate simplification from the original draft: at most
**one** `mustPassNearQuery` (a string, not an array). The routing mechanism
that honors it (§1.3 step 5) only supports a single guaranteed waypoint —
an array would promise more than the system can deliver.

The system prompt encodes Slovenia-specific defaults and vocabulary so the
model doesn't need world knowledge it might get wrong: known regions
(Notranjska, Gorenjska, Primorska...), known passes (Vršič, Mangart,
Pokljuka), and explicit default rules for every field (origin defaults to
Ljubljana, duration to 90 minutes, curviness to "twisty", surface to
"asphalt_preferred", avoid-highways to true) so the model isn't guessing at
sensible fallbacks on its own.

**Step 2 — Grounding, implemented as plain backend code, not a tool call**

The original draft proposed a `lookupPlace` *tool* the model would invoke.
What's actually built is simpler and fully deterministic: after Step 1
returns, backend code calls `resolvePlace(query)` directly —

```typescript
// gazetteer.ts — no LLM involved in this step at all
export async function resolvePlace(query: string): Promise<ResolvedPlace | null> {
  const [best] = await searchPlaces(query, 1); // PostGIS trigram similarity + unaccent
  return best ?? null;
}
```

This is the "two-pass extract → resolve → finalize" option the original
draft already flagged as simpler to test than an agentic tool loop — it's
what got built, and it held up: the ranking function and the grounding
function are both unit-testable without ever hitting an LLM. `originQuery`
and `mustPassNearQuery` are both resolved this way; if either fails to
resolve, an `event: error` is streamed back with a specific message
("Couldn't find a place called \"X\" in Slovenia") rather than silently
guessing.

**Step 3 — Deterministic route computation, extended beyond the original plan**

Grounded constraints → GraphHopper requests. Still plain TypeScript, no AI
— but with one addition the original draft didn't anticipate:

- `maxDurationMinutes` → target distance via an assumed pace per curviness
  tier, **then compensated by an empirically-measured overshoot factor
  (1.31x)** — `round_trip`'s actual distance reliably overshoots what it's
  asked for, measured live at 1.05x-2.4x depending on terrain.
- `curvinessPref` → request 5 (or 8 if `mustPassNearQuery` resolved)
  `round_trip` candidates with random seeds, rank by curvature score
  (turn-angle-per-km via turf.js, unit-tested against a straight road, a
  hairpin switchback, and GPS-noise jitter).
- **New**: if `mustPassNearQuery` resolved, *also* request one plain
  multi-point route (`origin → mustPassNear → origin`, not `round_trip`) as
  a guaranteed-to-arrive candidate alongside the random loops. Needed
  because `round_trip`'s direction turned out to be completely
  uncontrollable in practice (`heading` measured to have zero effect on
  the result) — without this, "pass near place X" was only ever a matter
  of luck across random seeds, confirmed by a live bug report where 8/8
  random attempts got no closer than several km to the requested place.
- `surfacePref` → PostGIS spatial-overlap query against `road_segments`
  (the cached table, not a live GraphHopper field — GraphHopper's `surface`
  data isn't exposed per-edge in query responses the way this needed).
  `asphalt_only` penalizes non-paved surface more steeply than
  `asphalt_preferred` in ranking; neither is a hard filter, matching how
  duration and curviness are also ranking inputs rather than cutoffs (a
  hard filter risked zero candidates surviving on a bad request).

**Step 4 — Explain & confirm: not built**

The original draft's per-candidate natural-language summary ("This loop
takes the Rakitna–Cerknica back road...") doesn't exist. The UI shows
structured stats (distance, duration, curviness bar, surface warning,
nearby POIs) instead of prose. Worth reconsidering once/if user feedback
says the structured stats aren't enough on their own.

### 4.3 Why not let the AI call GraphHopper as a "tool" directly

It's tempting to expose `generateRoute` as a tool the AI calls freely, but
that couples route-quality entirely to prompt engineering and makes
failures non-deterministic and hard to test. Keeping the AI SDK step scoped
to *intent extraction + place grounding*, and treating route computation +
ranking as deterministic backend code, keeps the system testable (you can
unit-test the ranking function without ever hitting an LLM) and keeps LLM
costs/latency bounded to one (maybe two) calls per generation.

### 4.4 Model & cost considerations (as implemented — `apps/api/src/lib/ai/model.ts`)

- **Three providers, not one**: `AI_PROVIDER` env var selects `anthropic`,
  `openai`, or `openrouter` at runtime, each with its own API key env var
  and an overridable default model
  (`claude-haiku-4-5-20251001` / `gpt-4.1-mini` / `openai/gpt-4.1-mini`
  respectively — note OpenRouter's model slugs differ from the providers'
  own IDs, confirmed against `openrouter.ai/api/v1/models` rather than
  guessed). OpenRouter was added beyond the original plan specifically to
  make local dev cheap and provider-flexible with a single key.
- At this task's scale (a few hundred tokens per extraction call), model
  cost genuinely doesn't matter — verified against OpenRouter's live
  pricing that even the priciest reasonable option costs a fraction of a
  cent per generation. Model *quality* (reliable structured-output/schema
  adherence) matters more than price at this volume.
- Gazetteer lookups are direct PostGIS queries now, not LLM tool calls, so
  "cache tool-call volume" isn't a relevant cost lever anymore — the cost
  surface is just the one `generateText` call per prompt.

---

## 5. Phase 1 MVP Roadmap

Ordered to get a thin vertical slice (prompt → route → GPX) working before
layering community features. Each phase should be independently shippable/
demoable. **Status below reflects what's actually built**, not the plan.

### ✅ Phase 0 — Foundations — DONE
- Repo scaffold: Hono API + Vite/React app in a pnpm-workspace monorepo.
- PostgreSQL + PostGIS via Docker Compose (`docker-compose.yml`).
- Drizzle schema + migrations (grew to 7 tables, not 5 — see §2.1).
- Self-hosted GraphHopper (Docker) with the Slovenia OSM extract; `round_trip` verified via raw curl before any app code was written against it (`infra/graphhopper/README.md`).
- **Auth**: not wired. Deferred to Phase 4 as planned — nothing needed it yet.

### ✅ Phase 1 — Manual route generation — DONE
- `POST /routes/generate` (structured constraints, JSON response) → GraphHopper → ranked candidates.
- Curvature scoring (turf.js turn-angle-per-km), unit-tested — calibrated against real GraphHopper output: A1 motorway ~0.03, a Rakitna-area rural road ~0.22, the Vršič switchbacks ~0.86.
- React: map, structured form, candidates rendered with stats.
- GPX export + download button, working end-to-end onto a real GPX file.
- **Milestone met**: verified live in a headless browser, not just the API.

### ✅ Phase 2 — AI prompt-to-constraints layer — DONE
- `generateText` + `Output.object` (not `generateObject`, deprecated — §4.2), Slovenia-aware system prompt.
- Gazetteer table + deterministic grounding (not a tool call — §4.2 Step 2).
- Prompt input ("Describe" tab) alongside the structured form ("Advanced" tab).
- SSE streaming (`POST /ai/generate`) with progressive "interpreting…" → "generating…" states.
- Provider-agnostic across Anthropic/OpenAI/OpenRouter (§4.4).

### ✅ Phase 3 — Surface quality & POI enrichment — DONE
- `road_segments` cache (Python/pyosmium ETL, `infra/road-surfaces/`), 140k rows, `surfacePref` actually enforced in ranking.
- 8 real biker cafés (user-curated CSV, geocoded via Nominatim) + passes/viewpoints seeded — not the full 30-50 the original plan mentioned, but the plan explicitly said that was optional for a first pass.
- POIs shown on the map — as an always-visible layer (fetched once on load), not gated on a generated route passing nearby, after a live UX bug report showed the latter meant POIs were essentially never visible with only 8 seeded.

### ✅ Phase 3.5 — Unplanned: bug-fix round from live usage
Not in the original roadmap, but substantial enough to call out — five real
bugs found via actually using the app (not just testing the API), each with
a live-verified fix. Full detail in `README.md`; summarized in §0.1. Worth
noting as a pattern: every one of these was invisible to typechecking,
unit tests, or API-level curl testing, and only surfaced by generating
real routes and looking at the map.

### ⬜ Phase 4 — Save, rate, share (community layer) — NOT STARTED
- `POST /routes` (save a generated candidate), user's "My Routes" list.
- Route detail page with `visibility` (private/unlisted/public).
- Ratings endpoints + UI (scenic/surface/fun scores + comment).
- Public route browsing (`GET /routes?visibility=public`) with basic
  filters (near me, duration).
- **Needs auth first** — nothing in Phase 0-3 required it, so it's still an
  open question, not just an implementation task (see "Open decisions" below).

### ⬜ Phase 5 — Community POI contribution + moderation — NOT STARTED
- `POST /pois` from users (unverified by default).
- Minimal admin/moderation view to verify submitted POIs.
- Mountain pass condition integration (`/conditions/passes`) sourced from a
  public SI roads API, cached server-side with a scheduled refresh.

### Explicitly out of scope for MVP (avoid over-engineering)
- Turn-by-turn live navigation in-app (GPX export to existing GPS apps
  covers this need).
- Real-time multi-rider group tracking.
- Native mobile app (responsive web is sufficient for MVP).
- Full agentic multi-step AI tool loop — the two-pass extract→ground that
  shipped has held up fine through Phase 3; no evidence yet it needs to
  become agentic.
- Weather-based dynamic rerouting (static "pass condition" flag is enough
  initially; live weather-aware routing is a strong v2 candidate).
- User-to-user messaging/social graph.

### Decisions actually made (was "open decisions to make")

- **Map library — decided: MapLibre GL JS + OpenFreeMap**, not Mapbox, and
  *not* Leaflet as the original draft leaned toward. That original
  recommendation ("Leaflet + OpenFreeMap") turned out to be internally
  inconsistent: OpenFreeMap serves vector tiles for a MapLibre/Mapbox-style
  renderer, which Leaflet can't consume natively without a heavy plugin.
  MapLibre + OpenFreeMap delivers what "Leaflet + OpenFreeMap" was actually
  reaching for — free, no token — correctly.
- **Routing engine — decided: GraphHopper**, as recommended. Its
  `round_trip` algorithm was the right call for loop generation, but turned
  out to have a real limitation the original draft didn't anticipate: its
  direction is completely uncontrollable (`heading` measured to have zero
  effect). Valhalla wasn't reconsidered — the fix was architectural
  (a second, guaranteed request type for "must pass near X", §1.3), not a
  reason to switch engines.
- **Auth provider — still undecided.** Better Auth remains the reasonable
  default suggested originally, but Phase 4 hasn't started, so this is a
  live open question for whoever picks this up next, not a settled choice.
  Nothing in Phases 0-3 needed auth, which is itself worth confirming was
  the right call before committing to Better Auth vs. an alternative.
