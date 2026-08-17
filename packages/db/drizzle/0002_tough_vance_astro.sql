CREATE TYPE "public"."road_surface_category" AS ENUM('gravel', 'cobblestone', 'unknown');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "road_segments" (
	"osm_way_id" bigint PRIMARY KEY NOT NULL,
	"highway" varchar(30) NOT NULL,
	"surface_tag" varchar(30),
	"category" "road_surface_category" NOT NULL,
	"geom" geometry(LineString,4326) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "road_segments_geom_gist_idx" ON "road_segments" USING gist ("geom");