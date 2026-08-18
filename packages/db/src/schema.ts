import {
  pgTable, uuid, varchar, text, timestamp, integer, real, boolean,
  jsonb, pgEnum, customType, unique, index, bigint,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// --- PostGIS geometry helper -----------------------------------------------
// Drizzle has no native PostGIS column type, so geometry columns are typed
// as opaque strings (WKT/GeoJSON in application code) and cast in raw SQL
// where spatial functions (ST_*) are needed.
const geometry = (
  name: string,
  opts: { type: "Point" | "LineString" | "Polygon"; srid?: number } = { type: "Point" },
) =>
  customType<{ data: string }>({
    dataType() {
      return `geometry(${opts.type},${opts.srid ?? 4326})`;
    },
  })(name);

// --- Enums -------------------------------------------------------------
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

export const waypointKindEnum = pgEnum("waypoint_kind", [
  "start", "via", "end", "poi_stop",
]);

export const placeKindEnum = pgEnum("place_kind", [
  "town", "region", "mountain_pass", "natural_feature",
]);

// Deliberately smaller than surfaceTypeEnum: road_segments only ever
// stores the *exception* to "presumed paved" (see infra/road-surfaces),
// so there's no "asphalt_good"/"asphalt_worn" state to represent here —
// a way's absence from this table *is* the asphalt signal.
export const roadSurfaceCategoryEnum = pgEnum("road_surface_category", [
  "gravel", "cobblestone", "unknown",
]);

// --- Users -------------------------------------------------------------
// Doubles as Better Auth's "user" table (apps/api/src/lib/auth.ts maps
// Better Auth's `name` field onto `displayName` rather than adding a
// redundant column) — emailVerified/image/updatedAt below exist only
// because Better Auth's core schema requires them, not for app logic.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  displayName: varchar("display_name", { length: 100 }).notNull(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  homeBaseGeom: geometry("home_base_geom", { type: "Point" }),
  preferences: jsonb("preferences").$type<{
    defaultSurfacePref?: "asphalt_only" | "asphalt_preferred" | "any";
    defaultCurvinessPref?: "relaxed" | "twisty" | "very_twisty";
    unitSystem?: "metric" | "imperial";
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- Better Auth session/account/verification tables ---------------------
// Standard Better Auth Drizzle-adapter shape (see auth.ts) — sessions are
// server-side session records keyed by an opaque bearer token in a cookie;
// accounts holds the scrypt password hash for the "credential" provider
// (email+password) and would hold OAuth tokens if a provider were added
// later; verifications backs email-verification/password-reset flows (not
// exposed in the UI yet, but the table is part of Better Auth's core
// schema regardless of which flows are enabled).
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 255 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("sessions_user_idx").on(t.userId),
]);

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: varchar("account_id", { length: 255 }).notNull(),
  providerId: varchar("provider_id", { length: 50 }).notNull(),
  password: text("password"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("accounts_user_idx").on(t.userId),
]);

export const verifications = pgTable("verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: varchar("identifier", { length: 255 }).notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- Routes --------------------------------------------------------------
export const routes = pgTable("routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 150 }).notNull(),
  description: text("description"),
  geom: geometry("geom", { type: "LineString" }).notNull(),
  distanceMeters: integer("distance_meters").notNull(),
  estDurationSeconds: integer("est_duration_seconds").notNull(),
  elevationGainMeters: integer("elevation_gain_meters"),
  curvinessScore: real("curviness_score"),
  surfaceBreakdown: jsonb("surface_breakdown").$type<
    Partial<Record<(typeof surfaceTypeEnum.enumValues)[number], number>>
  >(),
  visibility: routeVisibilityEnum("visibility").default("private").notNull(),
  generatedFromPrompt: text("generated_from_prompt"),
  generationConstraints: jsonb("generation_constraints"),
  sourceRoutingEngine: varchar("source_routing_engine", { length: 30 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("routes_geom_gist_idx").using("gist", t.geom),
  index("routes_owner_idx").on(t.ownerId),
]);

// --- Waypoints ---------------------------------------------------------
export const waypoints = pgTable("waypoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  routeId: uuid("route_id").notNull().references(() => routes.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  geom: geometry("geom", { type: "Point" }).notNull(),
  label: varchar("label", { length: 120 }),
  kind: waypointKindEnum("kind").notNull().default("via"),
  poiId: uuid("poi_id").references((): typeof pois.id => pois.id),
}, (t) => [
  index("waypoints_route_seq_idx").on(t.routeId, t.sequence),
  index("waypoints_geom_gist_idx").using("gist", t.geom),
]);

// --- POIs --------------------------------------------------------------
export const pois = pgTable("pois", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdById: uuid("created_by_id").references(() => users.id),
  name: varchar("name", { length: 150 }).notNull(),
  category: poiCategoryEnum("category").notNull(),
  geom: geometry("geom", { type: "Point" }).notNull(),
  description: text("description"),
  isBikerFriendly: boolean("is_biker_friendly").default(false).notNull(),
  verified: boolean("verified").default(false).notNull(),
  metadata: jsonb("metadata").$type<{
    openingHours?: string;
    elevationMeters?: number;
    passClosedInWinter?: boolean;
    externalUrl?: string;
    // Geocoding confidence for imported POIs (see seed-pois.ts): "exact"
    // when the business itself was found in OSM, "town" when only its
    // town/village resolved and the business's own coordinates weren't
    // found — a real but coarser location, not a guess.
    locationPrecision?: "exact" | "town";
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("pois_geom_gist_idx").using("gist", t.geom),
  index("pois_category_idx").on(t.category),
]);

// --- Route Ratings -------------------------------------------------------
export const routeRatings = pgTable("route_ratings", {
  id: uuid("id").primaryKey().defaultRandom(),
  routeId: uuid("route_id").notNull().references(() => routes.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  scenicScore: integer("scenic_score").notNull(),
  surfaceScore: integer("surface_score").notNull(),
  funScore: integer("fun_score").notNull(),
  comment: text("comment"),
  riddenAt: timestamp("ridden_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  // One rating per user per route — the /ratings endpoint upserts on this.
  unique("route_ratings_route_user_unique").on(t.routeId, t.userId),
]);

// --- Places (gazetteer) ---------------------------------------------------
// Backs GET /places/search and the AI grounding step (PROJECT_SPEC.md §4.2
// Step 2): resolves a free-text place name from a prompt into coordinates.
// Seeded from a curated list (packages/db/src/seed.ts), not user-submitted.
export const places = pgTable("places", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 150 }).notNull(),
  kind: placeKindEnum("kind").notNull(),
  region: varchar("region", { length: 100 }),
  geom: geometry("geom", { type: "Point" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("places_geom_gist_idx").using("gist", t.geom),
  index("places_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
]);

// --- Road segments (non-paved surface cache) ------------------------------
// Every OSM way whose surface reads as NOT ordinary paved road — gravel,
// cobblestone/sett, or an unpaved-implying track/bridleway with no
// explicit surface tag. Deliberately does not store paved ways: absence
// from this table is itself the "presumed asphalt" signal, which is why
// it's ~140k rows instead of ~500k. Populated by a one-time ETL
// (infra/road-surfaces/), not at request time — see that directory's
// README for the extract → bulk-load pipeline. Used by
// apps/api/src/lib/surface.ts to score how much of a candidate route
// overlaps non-paved segments.
export const roadSegments = pgTable("road_segments", {
  osmWayId: bigint("osm_way_id", { mode: "number" }).primaryKey(),
  highway: varchar("highway", { length: 30 }).notNull(),
  surfaceTag: varchar("surface_tag", { length: 30 }),
  category: roadSurfaceCategoryEnum("category").notNull(),
  geom: geometry("geom", { type: "LineString" }).notNull(),
}, (t) => [
  index("road_segments_geom_gist_idx").using("gist", t.geom),
]);

// --- Pass conditions (NAP cache) -------------------------------------------
// Server-side cache of events fetched from NAP (nap.si, Slovenia's
// National Access Point for transport data) — see apps/api/src/lib/
// napClient.ts. `id` is NAP's own event id, not generated here, so a
// refetch naturally upserts instead of duplicating. Only ever holds
// events near a mountain_pass POI (see passConditions.ts) — this is a
// correlation cache, not a general-purpose traffic-events mirror.
export const passConditions = pgTable("pass_conditions", {
  id: text("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 50 }).notNull(),
  geom: geometry("geom", { type: "Point" }).notNull(),
  raw: jsonb("raw"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("pass_conditions_geom_gist_idx").using("gist", t.geom),
]);

// --- Relations -----------------------------------------------------------
export const usersRelations = relations(users, ({ many }) => ({
  routes: many(routes),
  ratings: many(routeRatings),
  pois: many(pois),
  sessions: many(sessions),
  accounts: many(accounts),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const routesRelations = relations(routes, ({ one, many }) => ({
  owner: one(users, { fields: [routes.ownerId], references: [users.id] }),
  waypoints: many(waypoints),
  ratings: many(routeRatings),
}));

export const waypointsRelations = relations(waypoints, ({ one }) => ({
  route: one(routes, { fields: [waypoints.routeId], references: [routes.id] }),
  poi: one(pois, { fields: [waypoints.poiId], references: [pois.id] }),
}));

export const poisRelations = relations(pois, ({ one, many }) => ({
  createdBy: one(users, { fields: [pois.createdById], references: [users.id] }),
  waypoints: many(waypoints),
}));

export const routeRatingsRelations = relations(routeRatings, ({ one }) => ({
  route: one(routes, { fields: [routeRatings.routeId], references: [routes.id] }),
  user: one(users, { fields: [routeRatings.userId], references: [users.id] }),
}));
