CREATE TYPE "public"."poi_category" AS ENUM('viewpoint', 'fuel', 'biker_cafe', 'repair_shop', 'mountain_pass', 'border_crossing', 'photo_spot', 'hazard');--> statement-breakpoint
CREATE TYPE "public"."route_visibility" AS ENUM('private', 'unlisted', 'public');--> statement-breakpoint
CREATE TYPE "public"."surface_type" AS ENUM('asphalt_good', 'asphalt_worn', 'gravel', 'cobblestone', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."waypoint_kind" AS ENUM('start', 'via', 'end', 'poi_stop');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pois" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_id" uuid,
	"name" varchar(150) NOT NULL,
	"category" "poi_category" NOT NULL,
	"geom" geometry(Point,4326) NOT NULL,
	"description" text,
	"is_biker_friendly" boolean DEFAULT false NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "route_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scenic_score" integer NOT NULL,
	"surface_score" integer NOT NULL,
	"fun_score" integer NOT NULL,
	"comment" text,
	"ridden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_ratings_route_user_unique" UNIQUE("route_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"title" varchar(150) NOT NULL,
	"description" text,
	"geom" geometry(LineString,4326) NOT NULL,
	"distance_meters" integer NOT NULL,
	"est_duration_seconds" integer NOT NULL,
	"elevation_gain_meters" integer,
	"curviness_score" real,
	"surface_breakdown" jsonb,
	"visibility" "route_visibility" DEFAULT 'private' NOT NULL,
	"generated_from_prompt" text,
	"generation_constraints" jsonb,
	"source_routing_engine" varchar(30),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"home_base_geom" geometry(Point,4326),
	"preferences" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "waypoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"geom" geometry(Point,4326) NOT NULL,
	"label" varchar(120),
	"kind" "waypoint_kind" DEFAULT 'via' NOT NULL,
	"poi_id" uuid
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pois" ADD CONSTRAINT "pois_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_ratings" ADD CONSTRAINT "route_ratings_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_ratings" ADD CONSTRAINT "route_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "routes" ADD CONSTRAINT "routes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "waypoints" ADD CONSTRAINT "waypoints_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "waypoints" ADD CONSTRAINT "waypoints_poi_id_pois_id_fk" FOREIGN KEY ("poi_id") REFERENCES "public"."pois"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pois_geom_gist_idx" ON "pois" USING gist ("geom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pois_category_idx" ON "pois" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routes_geom_gist_idx" ON "routes" USING gist ("geom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routes_owner_idx" ON "routes" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waypoints_route_seq_idx" ON "waypoints" USING btree ("route_id","sequence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waypoints_geom_gist_idx" ON "waypoints" USING gist ("geom");