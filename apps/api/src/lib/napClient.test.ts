import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFeatureCollection } from "./napClient.js";

// Fixture matches this file's documented best-effort NapFeatureProperties
// shape, NOT a real captured NAP response (no working token this session
// — see napClient.ts's file header and PROJECT_SPEC.md §0.1). This test
// verifies the normalization logic is internally consistent; it does not
// verify NAP's actual property names.
const FIXTURE: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [13.7478, 46.4331] },
      properties: {
        id: "evt-1",
        title: "Vršič pass closed",
        description: "Closed for winter maintenance",
        category: "closure",
      },
    },
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[13.75, 46.43], [13.76, 46.44]] },
      properties: {
        id: 42,
        category: "roadworks",
      },
    },
    {
      // No id — should be skipped, since pass_conditions is keyed by id.
      type: "Feature",
      geometry: { type: "Point", coordinates: [14.0, 46.0] },
      properties: { title: "Untitled event" },
    },
  ],
};

test("normalizes a Point feature with full properties", () => {
  const [first] = normalizeFeatureCollection(FIXTURE);
  assert.deepEqual(first, {
    id: "evt-1",
    title: "Vršič pass closed",
    description: "Closed for winter maintenance",
    category: "closure",
    point: { lat: 46.4331, lon: 13.7478 },
    raw: FIXTURE.features[0],
  });
});

test("falls back to category as title and takes the first LineString coordinate as the representative point", () => {
  const [, second] = normalizeFeatureCollection(FIXTURE);
  assert.equal(second?.id, "42");
  assert.equal(second?.title, "roadworks");
  assert.equal(second?.description, null);
  assert.deepEqual(second?.point, { lat: 46.43, lon: 13.75 });
});

test("skips features with no id — the cache can't upsert them", () => {
  const events = normalizeFeatureCollection(FIXTURE);
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.title !== "Untitled event"));
});
