# Slovenian Ride Planner

[![CI](https://github.com/DragarA/rider-app/actions/workflows/ci.yml/badge.svg)](https://github.com/DragarA/rider-app/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

An AI-assisted motorcycle route planner for Slovenia that turns natural-language ride requests (*"3-hour twisty loop from Ljubljana around Rakitna, no highways"*) into ranked, exportable GPX loops—grounded against a PostGIS gazetteer and scored empirically for road curviness, surface quality, and mountain pass conditions.

### Highlights

- **Empirical curviness & loop ranking** (`apps/api/src/lib/curvature.ts`, `rank.ts`) — Scores routes by cumulative heading change per km (calibrated against real Slovenian roads from the A1 motorway to Vršič switchbacks) and filters GPS noise.
- **Grounded AI extraction** — Uses a provider-agnostic AI SDK (`anthropic`, `openai`, or `openrouter`) streamed over SSE; place queries are resolved against a PostGIS trigram + `unaccent` gazetteer rather than trusting raw LLM coordinates.
- **Full-stack geospatial architecture** — Self-hosted GraphHopper `round_trip` routing, PostgreSQL + PostGIS (Drizzle ORM), MapLibre GL JS over OpenFreeMap vector tiles, Better Auth, and GPX 1.1 export.

```text
Natural-language prompt / Map constraints (React + MapLibre GL JS)
        │  SSE / REST
        ▼
Hono API (AI extraction → PostGIS gazetteer → GraphHopper loops → Curvature/Surface/Pass ranker)
        │
        ▼
Ranked GPX candidates · Saved routes · Community POIs & Pass status
```

See [`PROJECT_SPEC.md`](./PROJECT_SPEC.md) for the full architecture, domain
model, API contract, AI integration strategy, and MVP roadmap.

## Stack

- **API**: Hono (TypeScript, Node) — `apps/api`
- **Web**: React + Vite + Tailwind, MapLibre GL JS over OpenFreeMap tiles — `apps/web`
- **DB**: PostgreSQL + PostGIS, Drizzle ORM — `packages/db`
- **Routing engine**: self-hosted GraphHopper — `infra/graphhopper`

## Decisions locked for Phase 1

- Routing engine: **GraphHopper** (native `round_trip` algorithm)
- Map library: **MapLibre GL JS + OpenFreeMap** (free vector tiles, no token) —
  note this is MapLibre, not Leaflet: OpenFreeMap serves vector tiles for a
  MapLibre/Mapbox-style renderer, which Leaflet doesn't consume natively
- AI provider: provider-agnostic via the AI SDK — concrete model chosen per-request via `AI_PROVIDER`
- Auth: **Better Auth**, email+password only (Phase 4 — see that section below)

## Local development

### 1. Install dependencies

```bash
pnpm install
```

### 2. Environment

```bash
cp .env.example .env
```

### 3. Start Postgres + PostGIS

```bash
pnpm infra:up
```

### 4. Run migrations

```bash
pnpm db:generate   # generate SQL from packages/db/src/schema.ts
pnpm db:migrate     # apply to the local database
```

### 5. Start the API and web app

```bash
pnpm dev:api   # http://localhost:8787/api/v1/health
pnpm dev:web   # http://localhost:5173
```

### 6. Start GraphHopper

Needed for route generation. One-time setup (OSM extract download,
~300MB) is documented in
[`infra/graphhopper/README.md`](./infra/graphhopper/README.md); after
that it's just:

```bash
docker compose --profile routing up -d graphhopper
```

## Phase 1: generate → GPX

With all four services running, open `http://localhost:5173`, click the
map to set a starting point, adjust the constraints, and hit **Generate
route**. Under the hood:

- `POST /api/v1/routes/generate` — structured constraints in, three
  round_trip candidates from GraphHopper, each scored for curviness
  (`apps/api/src/lib/curvature.ts`, unit-tested in `curvature.test.ts`
  against a straight road, a hairpin switchback, and GPS-noise jitter)
  and ranked against the requested duration/curviness
  (`apps/api/src/lib/rank.ts`). Plain JSON for now — the prompt-driven,
  SSE-streamed version of this endpoint arrives in Phase 2.
- `POST /api/v1/routes/gpx` — exports any candidate as a GPX 1.1 file
  without requiring it to be saved first (route persistence is Phase 4).
- `surfacePref` is accepted by the schema but not yet enforced — that
  needs the `road_segments` surface cache from Phase 3.
- `avoidHighways` is enforced via a GraphHopper `custom_model` that zeroes
  the priority of `MOTORWAY`/`TRUNK` edges.

Run `pnpm --filter @riding-app/api test` to run the curvature unit tests.

## Phase 2: describe your ride in plain language

Set `AI_PROVIDER` (`anthropic`, `openai`, or `openrouter`) and the matching
API key in `.env`, then use the **Describe** tab instead of **Advanced**.
For local dev, `openrouter` is the path of least resistance if you already
have OpenRouter credits — one key covers every provider's models, and this
task's per-call cost is negligible (a few hundred tokens per extraction) on
any of them:

- `POST /api/v1/ai/generate` (SSE) — `{ prompt }` in, three events out:
  `constraints` (the AI's resolved interpretation — origin, duration,
  curviness, surface, avoid-highways, and an optional "pass near" place),
  `candidates` (same shape as the structured endpoint), `done`. An `error`
  event replaces the rest of the stream if extraction or grounding fails
  (missing API key, unrecognized place name, etc).
- Place names are never trusted from the model directly. `extractDraftConstraints`
  (`apps/api/src/lib/ai/extract.ts`) only produces free-text place *queries*;
  `resolvePlace` (`apps/api/src/lib/gazetteer.ts`) grounds them against a
  seeded `places` table using Postgres trigram similarity + `unaccent` (so
  "Vrsic" without diacritics still resolves to "Vršič"). Seed data:
  `packages/db/src/seed.ts`, re-run with `pnpm db:seed`.
- "Pass near X": GraphHopper's `round_trip` has no way to aim toward a
  point — verified empirically, its `heading` param has zero effect on the
  resulting loop. Instead, when a `mustPassNearQuery` resolves, more
  candidates are requested (6 instead of 3) and ranked by how close each
  one's geometry actually passes to that point (`apps/api/src/lib/rank.ts`).
- `GET /api/v1/places/search?q=` — the same gazetteer lookup as a plain
  endpoint (not yet wired into the UI as an autocomplete).

**Verified live** against `openrouter` / `openai/gpt-4.1-mini`: "3-hour
twisty route from Ljubljana around Rakitna with smooth asphalt" correctly
resolved to `{maxDurationMinutes: 180, curvinessPref: "twisty",
surfacePref: "asphalt_only", avoidHighways: true}`, origin grounded to
Ljubljana, "Rakitna" grounded and used to rank 6 candidates by proximity.

One real bug surfaced by that first live call, now fixed: `mustPassNearQuery`
was originally `z.string().optional()`, which OpenAI's strict
structured-output mode (hit via OpenRouter → Azure) rejects — strict mode
requires every property in the schema's `required` array, so an omittable
key 400s with `'required' is required... Missing 'mustPassNearQuery'`.
Fixed by making it `.nullable()` instead of `.optional()` (present but
allowed to be `null`) in `apps/api/src/lib/ai/extract.ts`. Worth knowing if
you add more optional fields to that schema later.

A second bug surfaced by real usage (a Slovenian-language prompt asking for
"at most 3 hours"): every returned candidate exceeded the stated budget, up
to 4h29m for a 3-hour request. Cause — `round_trip`'s actual distance
routinely overshoots what it's asked for, empirically 1.05x-2.4x depending
on terrain (measured across origins/distances, see git history on
`pace.ts`/`rank.ts`), and candidates were being ranked against an internal
distance estimate instead of the rider's actual time budget, so an
over-budget loop could still rank first. Fixed two ways: `pace.ts` now
compensates the requested distance by the measured mean overshoot (1.31x),
and `rank.ts` scores candidates directly against `maxDurationMinutes` with
an asymmetric penalty — coming in under budget costs little, going over
costs a lot (5x the per-unit penalty), since "at most N hours" is a budget
the rider plans their day around. Candidate count went from 3/6 to 5/8 to
give the higher-variance search more chances to land in budget. Covered by
`rank.test.ts`.

A third bug, also from real usage: "Ivančna Gorica" (a real town) resolved
to "Nova Gorica" — a real town, ~100km away and nothing like the one
requested. Two compounding causes, both fixed. First, the original
hand-typed gazetteer (~30 towns) simply didn't have Ivančna Gorica in it —
replaced with all 212 real Slovenian municipalities pulled from OpenStreetMap
(`packages/db/src/seed.ts`; the query and its ISO3166-2 filter — an early
attempt leaked Austrian municipalities sharing the same `admin_level` — are
documented in that file's comments). Second, even with a complete
gazetteer, the similarity threshold was too permissive: "Ivančna Gorica"
vs "Nova Gorica" scored 0.35 on the old 0.3 cutoff, just barely a false
match. Raised to 0.5 after finding two more live collisions at the source of
the problem: "Rateče" (a real, still-missing village) → "Radeče" scores 0.4,
"Vipavska dolina" → "Loška Dolina" scores 0.45. Both real places, both
wrong, both would've passed a 0.4 threshold. 0.5 clears both while keeping
genuine matches like "kranjska" → "Kranjska Gora" (0.64) comfortably
through. See `gazetteer.ts`.

## Phase 3: surface quality + POIs

- **Surface quality**: `infra/road-surfaces/extract.py` pulls non-paved
  road segments (gravel, cobblestone, unpaved track) out of the Slovenia
  OSM extract into `road_segments` — only the ~140k-row *exception* to
  "presumed paved", not the full ~500k highway ways, since absence from
  the table already means asphalt. `apps/api/src/lib/surface.ts` scores
  what fraction of a candidate overlaps those segments; `surfacePref` is
  now actually enforced in `rank.ts`, not just accepted. Re-run the
  extract → `infra/postgres` staging-table `\copy` → `road_segments`
  pipeline documented in that directory's README if the OSM extract is
  ever refreshed.

  Found and fixed a real performance bug here: the naive query cast the
  indexed geometry column to `geography` for the proximity check, which
  silently defeats the GiST index — full parallel sequential scan across
  140k rows, **43.7 seconds per query**. Fixed with a geometry-domain bbox
  prefilter before the precise check: **43.7s → ~350ms**.

- **POIs**: `pois` table seeded from two sources. `packages/db/src/seed.ts`
  covers passes/regions; biker cafés come from a user-curated
  `biker_cafes.csv` at the repo root (name/town/description/url — "which
  cafés are actually biker-friendly" isn't something OSM tags or any API
  can answer, so this one input has to be a real person's knowledge, not
  scraped or invented). `packages/db/src/seed-pois.ts` geocodes each entry
  against OpenStreetMap's Nominatim — tries the exact business name first,
  then name+town, then a couple of known aliases where the CSV's
  descriptive name doesn't match how OSM tags the place (e.g. "Gostilna in
  Pizzerija Grof" → the business is actually tagged "GROF"), then falls
  back to the town centroid, honestly recording which precision tier each
  entry landed on in `metadata.locationPrecision`. Re-run with
  `pnpm db:seed:pois` whenever the CSV gains rows.

  `GET /api/v1/pois` (bbox/near/category/bikerFriendly/verified filters)
  and each generated candidate's `nearbyPois` (POIs within 2km of that
  specific loop) both reuse `apps/api/src/lib/pois.ts`. Rendered on the
  map for the selected candidate as green markers with a click-to-view
  popup.

  Also surfaced a real gazetteer bug while spot-checking this: Kranjska
  Gora's seeded coordinate (its municipality's polygon centroid) landed in
  roadless alpine terrain that GraphHopper couldn't snap to *any* road —
  confirmed via `GET /nearest` returning a hard 500, not just an unlucky
  `round_trip` seed. Batch-validated all 225 gazetteer points the same way;
  it was the only failure. Fixed with the actual settlement coordinate
  instead of the boundary centroid — see the comment above that entry in
  `seed.ts`.

## Phase 3.5: "ride to X" actually reaching X

A live bug report: "Ride from Ljubljana to Rakitna on a twisty road"
produced a route that never went anywhere near Rakitna — visibly, on the
map. Not a ranking bug: the proximity-weighted ranking was correctly
favoring whichever candidate got closest, but out of 8 random `round_trip`
attempts, the closest any of them came was 4.86km away. Root cause is
architectural, not a tunable parameter: `round_trip`'s direction can't be
aimed at all (§ Phase 2 already established `heading` has zero effect), so
"pass near a specific place" was only ever a matter of luck across random
seeds — confirmed by requesting a real point-to-point route instead
(`origin → Rakitna → origin`, no `round_trip`), which reached it in
39km/57min on the first try, every time.

Fixed by adding that real waypoint route as one more candidate alongside
the random `round_trip` attempts (`requestWaypointRoute` in
`graphhopper.ts`, wired into `generate.ts`), not as a replacement — the
existing duration/curviness/surface/proximity ranking still decides which
candidate actually wins, and a genuinely better random loop that also
happens to pass close by can still outrank it. The tradeoff, stated
honestly in the code: this candidate is an out-and-back, not a proper
loop — GraphHopper may reuse the same road in both directions. Verified
live: the guaranteed candidate now lands within 10m of Rakitna and ranks
first (0.909 vs. 0.74 for the best random attempt).

The fix above wasn't the end of it — a follow-up bug report showed the
"fixed" route still not going near Rakitna, this time visibly missing the
place on the map itself. Turned out the guaranteed waypoint mechanism was
working correctly; it was reliably reaching the *wrong coordinates*.
`Rakitna: (45.9339, 14.5914)` had been sitting in `seed.ts` since Phase 0/1
as a hand-typed value recalled from memory, never actually verified the way
every other gazetteer entry in this file was — off by **~12.6km** from the
real village (confirmed via Nominatim: 45.891, 14.4405, in Brezovica
municipality). Every earlier "ride to/around Rakitna" demo this session,
including the very first one, had quietly been routing to an empty patch
of forest near Škofljica instead. Fixed in `seed.ts`, re-verified routable
via `GET /nearest` (20m snap), and spot-checked the other hand-typed
entries (Trenta, Vršič, Mangart, Pokljuka, Črni Kal) the same way — Vršič's
plain-name Nominatim search matched an unrelated peak 95km away (that
toponym isn't unique in Slovenia), but cross-checking against Erjavčeva
Koča's already-verified location (0.68km apart) confirmed the stored
coordinate was actually fine; the rest were within a few km, normal for an
area/valley name rather than a single point. Only Rakitna was actually
wrong.

## Phase 4: auth + save/rate/share

Auth is **Better Auth**, email+password only (no OAuth yet). Set
`BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and `BETTER_AUTH_URL` in
`.env` — see `.env.example`. Rather than a parallel user table, Better
Auth's Drizzle adapter is configured (`apps/api/src/lib/auth.ts`) to bind
directly onto this app's existing `users` table (`usePlural: true`, plus a
`name`→`displayName` field mapping, since that's the one column name that
doesn't already match what Better Auth expects); three new tables it
requires — `sessions`, `accounts`, `verifications` — were added to
`packages/db/src/schema.ts` alongside it. The handler is mounted at
`/api/v1/auth/*` (`app.on(["POST","GET"], "/auth/*", ...)` in
`apps/api/src/index.ts`); the frontend talks to it via `better-auth/react`
(`apps/web/src/lib/authClient.ts`).

Saving/browsing/rating routes is a new router,
`apps/api/src/routes/saved-routes.ts` (backed by
`apps/api/src/lib/savedRoutes.ts`), mounted at the same `/routes` prefix as
the Phase 1 candidate-generation router — Hono matches the existing static
paths (`/routes/generate`, `/routes/gpx`) ahead of the new `/routes/:id`
param routes regardless of mount order, confirmed live, no collision.
Writes (`POST`/`PATCH`/`DELETE /routes`, `POST /routes/:id/ratings`)
require a session, via a `requireAuth` Hono middleware
(`apps/api/src/lib/auth-middleware.ts`) that reads `auth.api.getSession()`
off the request headers. `visibility` (`private`/`unlisted`/`public`) gates
reads: private routes 404 (not 403) for anyone but the owner, to avoid
confirming they exist.

Like every geometry write in this codebase (see `lib/pois.ts`,
`seed-pois.ts`), saved routes are inserted via raw `sql` +
`ST_GeomFromGeoJSON`/`ST_AsGeoJSON`, not Drizzle's query builder — this
repo doesn't use the query builder anywhere, by established convention, so
the new code followed suit rather than introducing a second style.

Three real bugs surfaced by live browser testing (Playwright-driven
Chromium against the running dev servers, not just curl/typecheck):

1. `POST /routes` 500'd on every real candidate. GraphHopper-derived
   `distanceMeters`/`estDurationSeconds` are floats (e.g. `59338.921`), but
   `routes.distance_meters`/`est_duration_seconds` are Postgres `integer`
   columns. Fixed by rounding both before insert
   (`Math.round(...)` in `lib/savedRoutes.ts`).
2. Better Auth's client threw `BetterAuthError: Invalid base URL` at import
   time when given a relative `baseURL` (`"/api/v1/auth"`) — unlike this
   app's plain `fetch()` calls elsewhere, which go through the Vite dev
   proxy fine with a relative path, Better Auth's client requires an
   absolute URL. Fixed by resolving against `window.location.origin` at
   runtime in `authClient.ts` instead of hardcoding a host — still
   same-origin through the proxy in dev, and in any same-origin prod
   deploy.
3. The first cut put the "My Routes" view toggle inside the sign-in-only
   branch of the header auth widget, so a signed-out visitor had no way to
   reach the anonymous-accessible "Public" tab at all — found by actually
   testing the signed-out path in a browser, not by reasoning about the
   component tree. Fixed by moving the toggle out of `AuthPanel` into
   `App.tsx`'s header directly, always visible regardless of session state.

Verified live end-to-end (Playwright/Chromium): sign-up, sign-in, session
persistence across reload, generate → save a candidate, "Mine" listing,
view-on-map for a saved route, star rating (scenic/surface/fun) + comment,
visibility change to `public`, sign-out, and anonymous "Public" browsing
all confirmed working, plus GPX export and delete for a saved route.

## Phase 5: community POIs + mountain-pass conditions

Two independent pieces. The POI half is fully built and verified live; the
mountain-pass-conditions half is real, working code that has never
actually talked to real data — read on for exactly why, and what's needed
to close that loop.

**POI contribution + moderation** — `POST /api/v1/pois` (auth required)
saves a submission with `verified: false`, regardless of who submits it
(no admin fast-path). Set `ADMIN_EMAILS` in `.env` (comma-separated) to
name moderators — there's no role table, just an email allowlist checked
by `requireAdmin` (`apps/api/src/lib/auth-middleware.ts`), the simplest
mechanism that solves the actual need. Admins see a "Moderate POIs" link
in the header (gated by `GET /api/v1/admin/status`, which the frontend
uses only to decide what to show — the real endpoints enforce
`requireAdmin` themselves either way), approve/reject via
`POST /api/v1/pois/:id/verify` and `DELETE /api/v1/pois/:id`. A submitter
or admin can `PATCH` a POI's content afterward; only admins can flip
`verified`.

Two bugs surfaced here, one of them a genuine pre-existing issue from
Phase 3 that had simply never been exercised: `GET /pois?category=X` 500'd
with `malformed array literal` — passing a JS array through Drizzle's
`sql` tag as `p.category = ANY(${categories})` loses its "array" type on
the wire, so postgres.js's driver receives a bare string. Fixed with an OR
chain of plain equality checks instead of `ANY()` (`lib/pois.ts`). The
second was caught while wiring the frontend, not from a bug report:
`GET /pois`'s default (no `verified` filter → no filter at all) would have
put a brand-new *unverified* submission straight onto the public map,
undermining the entire point of moderation — fixed by having the
frontend's `fetchAllPois()` request `verified=true` explicitly rather than
relying on that permissive default (which stays permissive for other API
consumers on purpose — a moderation queue view legitimately wants
`verified=false`, for instance).

Verified live end-to-end (Playwright/Chromium, two browser contexts —
contributor and admin): submit a POI as one user, confirm it does *not*
appear on the map yet, sign in as an `ADMIN_EMAILS` account, see it in
"Moderate POIs", approve it, confirm it now appears via a direct
`GET /pois?verified=true` check. Also verified: a non-admin gets 403 from
the moderation queue and the verify endpoint; a stranger gets 403 trying
to edit or delete someone else's POI; the actual owner can still edit
their own.

**Mountain-pass conditions** — the spec originally said "a public SI roads
API" without naming one. Two real candidates were investigated live this
session:

- **promet.si**'s own B2B portal — real endpoints confirmed via their B2B
  PDF (`https://www.promet.si/dc/b2b.dogodki.geojson?...`), but 401
  without a token, and getting one needs a "MOJ PIC" account plus emailing
  `info@promet.si`.
- **NAP (nap.si)**, Slovenia's EU-mandated National Access Point — the
  user registered here mid-session, and it turned out to be the better
  channel: same underlying publisher (DARS/PIC), but a proper self-service
  dataset-request flow and a standard OAuth2 API. Confirmed live via curl:
  `POST https://b2b.nap.si/uc/user/token` returns `{"error":"invalid_client"}`
  (400) unauthenticated — a real OAuth2 password-grant endpoint, not a
  guess — and `GET https://b2b.nap.si/data/b2b.events.geojson.en_US`
  returns 401 without a bearer token. Recommended datasets: "Roadworks
  (english GeoJSON)" and "Traffic events (english GeoJSON)" — JSON body,
  English, GeoJSON geometry, least parsing work.

**Decided: NAP.** `apps/api/src/lib/napClient.ts` implements the confirmed
OAuth2 password-grant flow (`NAP_USERNAME`/`NAP_PASSWORD`/`NAP_CLIENT_ID`
env vars) and normalizes the GeoJSON response into a `NapEvent` shape,
unit-tested against a hand-built fixture (`napClient.test.ts`).
`apps/api/src/lib/passConditions.ts` cache-asides the result into a new
`pass_conditions` table (a 15-minute max-age check on each request, not a
scheduled job — this stack has no cron/worker process anywhere, so that's
the pragmatic equivalent) and correlates cached events against two seeded
`mountain_pass` POIs (Vršič, Mangart — coordinates reused from the
already-verified `places` gazetteer entries, not re-typed) by proximity.

**What's not done**: dataset approval and a working `client_id` weren't in
hand by the end of this session, so `getAccessToken()` in `napClient.ts`
has never actually been called against the real token endpoint. Two
specific unknowns are flagged directly in that file's header comment:
whether `NAP_CLIENT_SECRET` is required alongside `client_id` (depends on
how NAP issued this account's credentials — only visible in the user's own
NAP dashboard), and the real GeoJSON `Feature.properties` field names (the
fixture's shape is a best-effort guess based on typical DATEX
II-to-GeoJSON conversions from other European portals, not a captured
real response). `GET /api/v1/conditions/passes` degrades gracefully in
the meantime — `{configured: false}` plus the manual `passClosedInWinter`
flag per pass — verified live. Once real credentials are available, this
needs one real request to confirm or fix those two unknowns; ask for a
live-verification pass at that point.

## Workspace layout

```
apps/
  api/       Hono API
  web/       React + Vite frontend
packages/
  db/        Drizzle schema, client, migrations
infra/
  postgres/       PostGIS init script
  graphhopper/    Dockerfile, config, extract download instructions
  road-surfaces/  OSM surface-tag extraction (extract.py) + load pipeline
biker_cafes.csv    user-curated biker café list (repo root) — seed-pois.ts input
```
