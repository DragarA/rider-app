# GraphHopper (local dev routing engine)

One-time setup, then it's just `docker compose --profile routing up -d graphhopper`.

## 1. Download the Slovenia OSM extract

GraphHopper needs a `.osm.pbf` file to build its road graph from. Grab the
Slovenia extract from Geofabrik (updated daily, a few hundred MB):

```bash
mkdir -p infra/graphhopper/data
curl -fL -o infra/graphhopper/data/slovenia-latest.osm.pbf \
  https://download.geofabrik.de/europe/slovenia-latest.osm.pbf
```

If test routes near the border (e.g. toward Trieste, Klagenfurt, or
Rijeka) matter, consider a slightly larger extract that includes bordering
regions instead — GraphHopper only routes within the imported area.

## 2. Start it

```bash
docker compose --profile routing up -d graphhopper
```

First boot builds the road graph from the `.pbf` (`graph.location` in
`config.yml`, cached under `infra/graphhopper/data/graph-cache/`) — this
can take a few minutes for a country-sized extract. Subsequent restarts
reuse the cache and start in seconds. Delete `data/graph-cache/` to force
a rebuild after changing `profiles` in `config.yml`.

## 3. Verify round_trip works

This is the Phase 0 checkpoint from `PROJECT_SPEC.md`: confirm the
round-trip algorithm behaves as expected via a raw curl call *before*
writing any application code against it. Example — a ~25km loop starting
near Rakitna, heading roughly south:

```bash
curl -s "http://localhost:8989/route" \
  --get \
  --data-urlencode "point=45.9339,14.5914" \
  --data-urlencode "profile=car" \
  --data-urlencode "algorithm=round_trip" \
  --data-urlencode "round_trip.distance=25000" \
  --data-urlencode "round_trip.seed=1" \
  --data-urlencode "points_encoded=false" \
  | python3 -m json.tool | head -50
```

Check that the response's `paths[0].distance` is in the right ballpark
and that `paths[0].points.coordinates` traces a closed-ish loop back
near the start point. Try a few different `round_trip.seed` values —
each should produce a different loop shape, which is how the app will
generate multiple candidates per request (see `PROJECT_SPEC.md` §1.3 and
§4.2 Step 3).
