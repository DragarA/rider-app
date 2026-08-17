import { test } from "node:test";
import assert from "node:assert/strict";
import { curvatureScore } from "./curvature.js";

function straightLine(): GeoJSON.LineString {
  // Due east along a fixed latitude — zero heading change.
  return {
    type: "LineString",
    coordinates: [
      [14.0, 46.0],
      [14.01, 46.0],
      [14.02, 46.0],
      [14.03, 46.0],
      [14.04, 46.0],
    ],
  };
}

function hairpinZigzag(): GeoJSON.LineString {
  // A true switchback pattern: alternating east/west direction (~170°
  // reversals) with a small steady northward drift, the shape a
  // mountain-pass road climbing via hairpins traces. Should saturate the
  // score at (or near) 1.
  const coords: [number, number][] = [];
  let lat = 46.0;
  const lon0 = 14.0;
  const dLon = 0.0015; // ~115m of east/west swing at 46°N
  const dLat = 0.0004; // ~45m of net climb per switchback
  for (let i = 0; i < 40; i++) {
    coords.push([lon0 + (i % 2 === 0 ? 0 : dLon), lat]);
    lat += dLat;
  }
  return { type: "LineString", coordinates: coords };
}

test("a straight road scores 0", () => {
  assert.equal(curvatureScore(straightLine()), 0);
});

test("a road with only two points scores 0 (no turns possible)", () => {
  const line: GeoJSON.LineString = {
    type: "LineString",
    coordinates: [
      [14.0, 46.0],
      [14.1, 46.1],
    ],
  };
  assert.equal(curvatureScore(line), 0);
});

test("a tight hairpin switchback scores near the top of the scale", () => {
  const score = curvatureScore(hairpinZigzag());
  assert.ok(score > 0.9, `expected score > 0.9, got ${score}`);
});

test("a hairpin road scores higher than a straight one", () => {
  assert.ok(curvatureScore(hairpinZigzag()) > curvatureScore(straightLine()));
});

test("sub-noise-floor jitter does not register as curvature", () => {
  // Heading wobbles by ~1° each step — GPS/graph noise, not a real turn.
  const coords: [number, number][] = [];
  let lon = 14.0;
  for (let i = 0; i < 20; i++) {
    coords.push([lon, 46.0 + (i % 2 === 0 ? 0 : 0.000005)]);
    lon += 0.001;
  }
  const score = curvatureScore({ type: "LineString", coordinates: coords });
  assert.equal(score, 0);
});
