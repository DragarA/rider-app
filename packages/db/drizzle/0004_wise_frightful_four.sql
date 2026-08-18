CREATE TABLE "pass_conditions" (
	"id" text PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"category" varchar(50) NOT NULL,
	"geom" geometry(Point,4326) NOT NULL,
	"raw" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pass_conditions_geom_gist_idx" ON "pass_conditions" USING gist ("geom");