# Slovenian Ride Planner — Project Spec

Status: **Phases 0-5 implemented** (Phase 3.5 bug-fix round included).
Phase 5's POI contribution/moderation half is verified live; its
mountain-pass-conditions half is code-complete and unit-tested but **not**
verified against real data — see §0.1 below for exactly why. This
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
- Email+password auth (Better Auth), saving a generated candidate as a persisted route, `private`/`unlisted`/`public` visibility, a "My Routes" + anonymous "Public" browse view, GPX export for saved routes, and 1–5 star scenic/surface/fun ratings with a comment all work end-to-end.
- Community POI submission (`POST /pois`, unverified by default), an
  email-allowlist admin/moderation queue (approve/reject), and ownership-
  gated edit/delete all work end-to-end. Two curated `mountain_pass` POIs
  (Vršič, Mangart) are seeded and show a live/manual condition badge on
  the map when clicked.
- **Not verified live**: `GET /conditions/passes`' NAP (nap.si) client is
  real code against real, curl-confirmed endpoints, but has never
  successfully authenticated — the user's NAP dataset access/credentials
  weren't ready yet this session. It degrades to `{configured: false}` and
  the manual `passClosedInWinter` flag until that's resolved (see the NAP
  bullet below).

**Key deviations from the original plan below**, decided during implementation (see §5 "Decisions actually made" for the reasoning):
- Map: **MapLibre GL JS + OpenFreeMap**, not Mapbox or Leaflet — OpenFreeMap serves vector tiles for a MapLibre/Mapbox-style renderer, which Leaflet can't consume natively, so "Leaflet + OpenFreeMap" (the original recommendation) was never actually viable.
- Routing: **GraphHopper**, as planned, but `round_trip`'s direction turned out to be completely uncontrollable (`heading` has zero measured effect) — "pass near a specific place" needed a second mechanism (a real point-to-point request run alongside the random loops), not just ranking.
- AI extraction uses `generateText` + `output: Output.object(...)`, not `generateObject` — the latter is deprecated in the AI SDK version this project ended up on. Grounding (`lookupPlace`) is plain backend code calling the gazetteer directly, not a tool the model invokes.
- Provider list grew to three: Anthropic, OpenAI, **and OpenRouter** (added for cheap local-dev iteration against multiple model backends through one key).
- Two extra tables beyond the original five: `places` (gazetteer) and `road_segments` (non-paved surface cache) — both were always implied by the design but not spec'd in §2 originally.
- Auth: **Better Auth**, email+password only for now, decided in Phase 4 (§5 "Decisions actually made" has the reasoning). It reuses the app's own `users` table (field-mapped, not a parallel table) and adds three more tables it requires (`sessions`, `accounts`, `verifications`) — nine tables total, not seven. `waypoints` is still unused: saving a candidate persists its geometry directly, not a decomposed start/via/end sequence, since generation doesn't produce named waypoints beyond raw geometry.
- Admin/moderation (Phase 5): no role table — an "admin" is just an email
  on the `ADMIN_EMAILS` env var, checked by a `requireAdmin` middleware.
  Chosen over a real role system as the simplest mechanism that solves the
  actual need (a handful of trusted moderators), same bias as `requireAuth`
  itself in Phase 4.
- Mountain-pass data source (Phase 5): the spec originally said "a public
  SI roads API" without naming one. Two real candidates were investigated
  live this session — promet.si's own B2B portal (DATEX II/GeoJSON,
  requires a "MOJ PIC" account + emailing `info@promet.si`) and **NAP
  (nap.si)**, Slovenia's EU-mandated National Access Point, which the user
  registered on mid-session and which turned out to be the better channel:
  same publisher (DARS/PIC) via a proper self-service dataset-request flow
  and a standard OAuth2 API. **Decided: NAP.** Its token endpoint
  (`POST https://b2b.nap.si/uc/user/token`) and data endpoints
  (`GET https://b2b.nap.si/data/b2b.events.geojson.en_US`,
  `b2b.roadworks.geojson.en_US`) are confirmed real via curl (401/400 with
  the expected OAuth2 error shapes when unauthenticated) — but dataset
  approval and a working `client_id`/credentials weren't in hand by the
  end of this session, so the integration is code-complete and
  unit-tested against a hand-built fixture, **not verified against real
  NAP data**. See `apps/api/src/lib/napClient.ts`'s file header for the
  exact unconfirmed details (whether `NAP_CLIENT_SECRET` is required; the
  real GeoJSON property names).

**Real bugs found via live testing that are worth knowing about before extending this further** (full detail in `README.md`):
1. A GraphHopper spatial query cast an indexed geometry column to `geography`, silently defeating the GiST index — 43.7s per surface-quality query, down to ~350ms after adding a bbox prefilter.
2. OpenAI's strict structured-output mode rejects `.optional()` Zod fields; needs `.nullable()` instead.
3. Ranking originally scored candidates against an internal distance estimate instead of the rider's actual stated duration; a candidate could exceed the requested time budget and still rank first.
4. The original hand-typed ~30-place gazetteer was missing real towns and had a similarity threshold low enough to confidently return the *wrong* town instead of "not found."
5. One gazetteer coordinate (Rakitna) was flat-out wrong — hand-typed from memory back in Phase 0 and never verified like the rest of the gazetteer, off by ~12.6km. Every earlier demo involving Rakitna was quietly routing to the wrong place.
6. A MapLibre symbol layer with no explicit `text-font` 404'd against the style's font endpoint and silently dropped labels.
7. (Phase 4) `POST /routes` 500'd on every real candidate: `distanceMeters`/`estDurationSeconds` from the routing engine are floats (e.g. `59338.921`), but `routes.distance_meters`/`est_duration_seconds` are `integer` columns — fixed by rounding both before insert.
8. (Phase 4) Better Auth's client threw `Invalid base URL` at import time with a relative `baseURL` (`"/api/v1/auth"`) — unlike this app's own plain `fetch()` calls, which happily use relative paths through the Vite proxy, Better Auth's client requires an absolute URL. Fixed by resolving against `window.location.origin` at runtime instead of hardcoding a host.
9. (Phase 4) The first cut gated the entire "My Routes" view (including the anonymous-accessible "Public" tab) behind being signed in, since the view toggle lived inside the sign-in-only branch of the header widget — found via live browser testing (a signed-out session had no way to reach Public browsing at all). Fixed by moving the view toggle out of the auth widget into the header directly, always visible regardless of session state.
10. (Phase 5) `GET /pois?category=X` 500'd with `malformed array literal` — a **pre-existing bug from Phase 3**, never exercised live before (the frontend only ever calls `GET /pois` with zero filters). Root cause: `p.category = ANY(${filters.categories})` passes a JS array as a single Drizzle `sql` parameter, which loses its "array" type on the wire, so postgres.js's driver receives a bare string. Fixed with an OR-chain of plain equality checks instead of `ANY()`, sidestepping the array-binding question entirely (`apps/api/src/lib/pois.ts`).
11. (Phase 5, caught during implementation, not live testing) The initial `GET /pois` default (no `verified` filter → no filter applied) would have shown a brand-new *unverified* community submission on the public map immediately, before any moderation — defeating the entire point of Phase 5's moderation queue. Caught by re-reading the actual data flow before wiring the frontend, not by a bug report: fixed by having the frontend's `fetchAllPois()` request `verified=true` explicitly rather than relying on the (intentionally permissive, for other API consumers) unfiltered default.

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
                                   │  /routes (CRUD) /routes/:id/ratings │
                                   │  /ai/generate (SSE)             │
                                   │  /places/search  /pois           │
                                   │  /auth/* (Better Auth handler)    │
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
                                   │   users/routes/route_ratings (live)│
                                   │   sessions/accounts/verifications │
                                   │   (Better Auth) · waypoints unused │
                                   └────────────────────────────┘
```

### 1.2 Component responsibilities

- **React SPA (Vite)**: map rendering, route-request form + prompt box, GPX
  download, an "Open in Google Maps" preview link, sign-in/up/out, saving a
  candidate, and a "My Routes"/"Public" browsing + rating view. Talks only
  to the Hono API — never directly to GraphHopper or the DB. POI
  contribution UI still doesn't exist (Phase 5).
- **Hono API**: single TypeScript backend. Owns validation (Zod) and
  orchestration between the AI extraction layer, GraphHopper, and PostGIS.
  Auth (Better Auth) gates the write side of the saved-routes/ratings API;
  everything else (candidate generation, POI/gazetteer lookups, public
  route browsing) stays anonymous by design.
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
  the 140k-row non-paved `road_segments` cache, and the 13-row `pois` table
  — plus, as of Phase 4, live `users`/`routes`/`route_ratings` and Better
  Auth's `sessions`/`accounts`/`verifications`. `waypoints` remains unused:
  saving a candidate persists its geometry directly, not a decomposed
  start/via/end sequence.
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
- `users`, `routes`, and `route_ratings` are live as of Phase 4. `waypoints`
  is still unused — saving a candidate persists its geometry directly, not
  a decomposed start/via/end sequence, since generation doesn't produce
  named waypoints beyond raw geometry (a deliberate scope call, not an
  oversight).
- **Three tables beyond the resulting seven, all added for Better Auth**
  (`packages/db/src/schema.ts`, `apps/api/src/lib/auth.ts`): `sessions`,
  `accounts`, `verifications`. Better Auth binds directly onto the existing
  `users` table (`usePlural: true` + a `name`→`displayName` field mapping)
  rather than getting a parallel table of its own — `users` also gained
  `emailVerified`/`image`/`updatedAt` columns Better Auth's core schema
  requires, even though the app itself doesn't use them yet.
- **One more table for Phase 5**: `pass_conditions` — a server-side cache
  of events fetched from NAP (see §0.1/§5), keyed by NAP's own event id
  (not generated here, so a refetch naturally upserts). Ten tables total.
  `pois.createdById`/`pois.verified` (both already in the original design)
  turned out to be exactly what community submission + moderation needed —
  no schema change for that half of Phase 5 at all.

---

## 3. API Contract (REST, Hono)

Base path: `/api/v1`. Most endpoints stay anonymous (candidate generation,
POI/gazetteer lookups, public route browsing); the write side of the saved-
routes/ratings API (§3.1) requires a Better Auth session cookie, checked via
the `requireAuth` Hono middleware (`apps/api/src/lib/auth-middleware.ts`).

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
  Query: ?bbox=minLon,minLat,maxLon,maxLat  &near=lon,lat&radiusKm=  &category=biker_cafe,...  &bikerFriendly=true  &verified=true  &mine=true (auth required)
  Response: { pois: Poi[] }
  # All filters combine with AND. `verified=false` (the moderation queue)
  # 403s for non-admins (Phase 5) — every other combination, including no
  # `verified` filter at all, is unchanged since Phase 3. The frontend's
  # own default map view calls this with verified=true explicitly (not by
  # relying on the permissive unfiltered default — see §0.1 bug #11).

POST   /api/v1/pois                         (auth required, Phase 5)
  Body: { name, category, lat, lon, description?, isBikerFriendly?, metadata? }
  Response: 201 { poi: Poi }, verified: false always, regardless of who submits it.

GET    /api/v1/pois/:id
PATCH  /api/v1/pois/:id                     (creator or admin)
DELETE /api/v1/pois/:id                     (creator or admin)

POST   /api/v1/pois/:id/verify              (admin only)
  Body: { verified: boolean }
  # The moderation decision — separate from PATCH, same "action endpoint"
  # pattern as POST /routes/:id/ratings.

GET    /api/v1/admin/status
  Response: { isAdmin: boolean }
  # Lets the frontend decide whether to show admin-only nav links without
  # duplicating the ADMIN_EMAILS check client-side. The real moderation
  # endpoints enforce requireAdmin themselves regardless of this.

GET    /api/v1/conditions/passes
  Response: { configured: boolean, passes: PassConditionSummary[] }
  # Public, no auth. `configured: false` (today's real state — see §0.1)
  # means no NAP credentials are set; passes still returns the manual
  # passClosedInWinter baseline per mountain_pass POI. See §5 Phase 5 and
  # apps/api/src/lib/{napClient,passConditions}.ts.

POST   /api/v1/auth/sign-up/email  |  /sign-in/email  |  /sign-out  |  GET /get-session  (+ more)
  # Better Auth's own handler, mounted at /api/v1/auth/* (apps/api/src/lib/auth.ts,
  # index.ts). Not hand-written — this app only configures Better Auth and
  # consumes its session cookie via requireAuth (auth-middleware.ts).

POST   /api/v1/routes                       (auth required)
  Body: { title, description?, geometry, distanceMeters, estDurationSeconds,
          curvinessScore?, surfaceBreakdown?, visibility?, generatedFromPrompt? }
  Response: 201 { route: SavedRoute }
  # Saves a generated candidate. surfaceBreakdown's 3-key
  # {gravel,cobblestone,asphalt} maps onto the DB's 5-key surfaceTypeEnum —
  # see mapSurfaceBreakdownToDb in lib/savedRoutes.ts for why that's a real,
  # deliberate lossy conversion (OSM's surface tag has no condition data).

GET    /api/v1/routes                       ?mine=true (auth required) | public browse otherwise
  Query (public browse): ?near=lon,lat&radiusKm=  &maxDurationMinutes=
  Response: { routes: SavedRoute[] }

GET    /api/v1/routes/:id                   # visibility-gated: public → anyone,
                                             # unlisted → anyone with the id,
                                             # private → owner only (404 otherwise)
  Response: { route: SavedRoute, ratingSummary: RatingSummary }

PATCH  /api/v1/routes/:id                   (auth required, owner only)
DELETE /api/v1/routes/:id                   (auth required, owner only)

GET    /api/v1/routes/:id/gpx               # GPX for a *saved* route (vs. the ad-hoc POST above),
                                             # same visibility gate as GET /routes/:id

POST   /api/v1/routes/:id/ratings           (auth required)
  Body: { scenicScore, surfaceScore, funScore (1-5 each), comment?, riddenAt? }
  Response: 201 { ratingSummary: RatingSummary }
  # Upserts on route_ratings' existing (route_id, user_id) unique constraint.

GET    /api/v1/routes/:id/ratings
  Response: { ratings: Rating[], summary: RatingSummary }
```

### 3.2 Planned, not built (Phase 6+)

Nothing currently — every endpoint originally planned through Phase 5 has
shipped (§3.1). Future candidates would come from a Phase 6, not yet
scoped.

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

### ✅ Phase 4 — Save, rate, share (community layer) — DONE
- Auth: **Better Auth**, email+password only, wired directly onto the
  app's existing `users` table (`apps/api/src/lib/auth.ts` maps Better
  Auth's `name` field onto `displayName` rather than adding a redundant
  column) plus three new tables it requires (`sessions`, `accounts`,
  `verifications`). Session cookie, `requireAuth` Hono middleware
  (`apps/api/src/lib/auth-middleware.ts`).
- `POST /routes` (save a generated candidate — geometry, distance,
  duration, curviness, surface breakdown, optional prompt/constraints),
  `GET /routes` (`?mine=true` for the caller's own at any visibility, or
  public browsing with `near=lon,lat&radiusKm=`/`maxDurationMinutes=`
  filters), `GET /routes/:id`, `PATCH /routes/:id`, `DELETE /routes/:id`
  (`apps/api/src/routes/saved-routes.ts`, backed by
  `apps/api/src/lib/savedRoutes.ts` — same raw-`sql` +
  `ST_GeomFromGeoJSON`/`ST_AsGeoJSON` pattern already used by `lib/pois.ts`,
  not Drizzle's query builder, for consistency with the rest of this
  codebase).
- `visibility` (private/unlisted/public) gating: `public` → anyone;
  `unlisted` → anyone with the id (no owner check, by design); `private` →
  owner only, 404 (not 403) for everyone else to avoid confirming a private
  route's existence.
- `GET /routes/:id/gpx` for a saved route (reuses `buildGpx` from
  `lib/gpx.ts`, same as the Phase 1 ad-hoc `POST /routes/gpx`).
- `POST /routes/:id/ratings` (upserts on the existing
  `route_ratings_route_user_unique` constraint) + `GET /routes/:id/ratings`,
  both with an aggregate scenic/surface/fun average.
- Frontend: `AuthPanel` (sign in/up/out) and an always-visible "My
  Routes"/"Back to planner" header toggle (deliberately *not* gated behind
  being signed in — a live bug found in testing, see §0.1 bug #9), a "Save
  route" button + inline title/visibility form on the selected candidate in
  `CandidateList`, and `MyRoutesPanel` (Mine/Public tabs, view-on-map,
  download GPX, owner-only delete/visibility edit, star rating widget). No
  new routing or state-management library — still plain `useState`, no
  router, matching every earlier phase's frontend.
- **Milestone met**: verified live in a real browser (Playwright-driven
  Chromium, not just curl/typecheck) — sign-up, sign-in, save, list, view
  on map, rate, change visibility, sign out, and anonymous public viewing
  all confirmed end-to-end, plus the three bugs in §0.1 (#7-9) were each
  found this way.

### 🟡 Phase 5 — Community POI contribution + moderation — POI half DONE, pass-conditions half code-complete but unverified
- `POST /pois` from users (unverified by default), `PATCH`/`DELETE`
  (creator or admin), `POST /pois/:id/verify` (admin only) — all via
  `apps/api/src/routes/pois.ts` + `lib/pois.ts`.
- Admin/moderation: `ADMIN_EMAILS` env-var allowlist (no role table —
  see §5 "Decisions actually made"), `requireAdmin` middleware, a
  `ModeratePoisPanel` frontend view reachable from a "Moderate POIs" header
  link shown only when `GET /admin/status` says so.
- Mountain-pass condition integration: real client
  (`apps/api/src/lib/napClient.ts`) against NAP (nap.si)'s confirmed-live
  OAuth2 token endpoint and GeoJSON data endpoints (§0.1), cache-aside
  orchestration (`lib/passConditions.ts`, 15-minute TTL — this stack has no
  cron/worker process, so "scheduled refresh" from the original plan is
  implemented as "cached with a max age" instead), and
  `GET /conditions/passes`. Two `mountain_pass` POIs seeded (Vršič,
  Mangart) with a manual `passClosedInWinter` baseline as the fallback
  when no live signal correlates. **Not live-verified** — no working NAP
  credentials by the end of this session; degrades to
  `{configured: false}` and the manual flag until that's resolved.
- **Milestone met (POI half only)**: verified live in a real browser
  (Playwright-driven Chromium) — submit as one user, confirm it's not on
  the public map yet, moderate-approve as an admin user, confirm it now
  is. Also verified: non-admins get 403 from the moderation queue and
  verify endpoint; a stranger gets 403 editing/deleting someone else's
  POI; the owner can still edit their own. Two real bugs found this way,
  documented in §0.1 (#10, #11).

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
- **Auth provider — decided: Better Auth**, email+password only for now
  (no OAuth providers yet). Chosen for being self-hosted and
  framework-agnostic — no external account/service dependency for local
  dev, unlike a hosted auth-as-a-service option — and its Drizzle adapter
  binds directly onto this app's existing `users` table (via `usePlural:
  true` and a `name`→`displayName` field mapping) rather than requiring a
  parallel user table. See §5 Phase 4 for what shipped.
