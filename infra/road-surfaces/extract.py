#!/usr/bin/env python3
"""
Extracts non-paved road segments from the Slovenia OSM extract into a TSV
file for bulk-loading into the `road_segments` table (see
packages/db/src/schema.ts).

Only stores segments the app actually needs to know about: ways whose
surface is NOT asphalt/paved/concrete (or, for track/bridleway ways with
no explicit surface tag, presumed unpaved). Anything not in this table is
treated as ordinary paved road — that's the overwhelming majority of
Slovenia's classified road network, so storing only the exceptions keeps
this a lean ~140k rows instead of ~500k.

Skips highway classes GraphHopper's car profile never routes on
(infra/graphhopper/config.yml's import.osm.ignored_highways) — a
generated route can never touch those ways, so there's no point storing
them here.

Usage:
    python3 extract.py <path-to-slovenia-latest.osm.pbf> <output.tsv>
"""
import sys
from typing import Optional
import osmium
import osmium.geom
import osmium.index

GOOD_SURFACES = {"asphalt", "paved", "concrete", "concrete:plates", "concrete:lanes"}
COBBLESTONE_SURFACES = {"sett", "paving_stones", "cobblestone"}
TRACK_LIKE_HIGHWAYS = {"track", "bridleway"}
EXCLUDED_HIGHWAYS = {"footway", "cycleway", "path", "pedestrian", "steps"}


def classify(surface: Optional[str], highway: str) -> Optional[str]:
    if highway in EXCLUDED_HIGHWAYS:
        return None
    if surface in COBBLESTONE_SURFACES:
        return "cobblestone"
    if surface in GOOD_SURFACES:
        return None
    if surface:
        return "gravel"
    if highway in TRACK_LIKE_HIGHWAYS:
        return "gravel"
    return None


class Extractor(osmium.SimpleHandler):
    def __init__(self, out):
        super().__init__()
        self.wktfab = osmium.geom.WKTFactory()
        self.out = out
        self.count = 0
        self.skipped_geom_errors = 0

    def way(self, w):
        highway = w.tags.get("highway")
        if not highway:
            return
        surface = w.tags.get("surface")
        category = classify(surface, highway)
        if category is None:
            return
        try:
            wkt = self.wktfab.create_linestring(w)
        except Exception:
            # A handful of ways fail geometry creation (single distinct
            # node, self-intersecting edge case, etc.) — not worth failing
            # the whole import over.
            self.skipped_geom_errors += 1
            return
        surface_col = surface if surface else "\\N"
        self.out.write(f"{w.id}\t{highway}\t{surface_col}\t{category}\t{wkt}\n")
        self.count += 1


def main():
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input.osm.pbf> <output.tsv>", file=sys.stderr)
        sys.exit(1)

    input_path, output_path = sys.argv[1], sys.argv[2]

    with open(output_path, "w") as out:
        idx = osmium.index.create_map("flex_mem")
        location_handler = osmium.NodeLocationsForWays(idx)
        extractor = Extractor(out)
        osmium.apply(osmium.io.Reader(input_path), location_handler, extractor)

    print(f"Wrote {extractor.count} road segments to {output_path}")
    if extractor.skipped_geom_errors:
        print(f"Skipped {extractor.skipped_geom_errors} ways with geometry errors")


if __name__ == "__main__":
    main()
