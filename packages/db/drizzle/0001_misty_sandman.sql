CREATE TYPE "public"."place_kind" AS ENUM('town', 'region', 'mountain_pass', 'natural_feature');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"kind" "place_kind" NOT NULL,
	"region" varchar(100),
	"geom" geometry(Point,4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "places_geom_gist_idx" ON "places" USING gist ("geom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "places_name_trgm_idx" ON "places" USING gin ("name" gin_trgm_ops);