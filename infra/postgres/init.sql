-- The postgis/postgis image normally enables this automatically, but doing
-- it explicitly here means the schema still works against a plain
-- postgres:16 image (e.g. on a managed host that adds PostGIS separately).
CREATE EXTENSION IF NOT EXISTS postgis;

-- Trigram fuzzy matching for the places gazetteer (GET /places/search and
-- the AI grounding step's place-name lookup).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Diacritic-insensitive matching — "Vrsic" needs to find "Vršič" without the
-- caller typing š/č. Verified empirically: similarity('vrsic','Vršič') is
-- only 0.2 without this (fails any reasonable threshold), 1.0 with it.
CREATE EXTENSION IF NOT EXISTS unaccent;
