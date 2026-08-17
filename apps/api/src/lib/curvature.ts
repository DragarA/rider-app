import { bearing, length, lineString } from "@turf/turf";

// Degrees of cumulative heading change per kilometre at which a route is
// considered maximally "very_twisty" (score saturates at 1). Calibrated
// against the live GraphHopper instance during Phase 1 (measured via
// this exact function): the Ljubljana–Celje A1 motorway scored ~40°/km
// (curvatureScore 0.03), an ordinary rural road near Rakitna scored
// ~260°/km (0.22), and the Vršič pass switchbacks (Kranjska Gora → Trenta,
// the twistiest road in Slovenia) scored ~860°/km (0.86) — treated here as
// close to the practical ceiling rather than the literal max, leaving
// headroom instead of clipping the single twistiest reference road to 1.0.
const DEGREES_PER_KM_AT_MAX_SCORE = 1000;

// Vertex-to-vertex bearing swings below this are road noise (GPS jitter,
// minor realignments) rather than an intentional turn, and get ignored so
// they don't inflate the score of an essentially straight road.
const NOISE_FLOOR_DEGREES = 3;

function normalizeAngle(degrees: number): number {
  // Wrap into (-180, 180] so a bearing flip from 179° to -179° reads as a
  // 2° turn, not a 358° one.
  let a = degrees % 360;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

/**
 * Scores how twisty a route is, from 0 (straight) to 1 (very twisty),
 * based on cumulative heading change per kilometre.
 */
export function curvatureScore(line: GeoJSON.LineString): number {
  const coords = line.coordinates;
  if (coords.length < 3) return 0;

  let totalTurnDegrees = 0;
  let prevBearing = bearing(coords[0]!, coords[1]!);

  for (let i = 1; i < coords.length - 1; i++) {
    const nextBearing = bearing(coords[i]!, coords[i + 1]!);
    const delta = Math.abs(normalizeAngle(nextBearing - prevBearing));
    if (delta >= NOISE_FLOOR_DEGREES) {
      totalTurnDegrees += delta;
    }
    prevBearing = nextBearing;
  }

  const lengthKm = length(lineString(coords), { units: "kilometers" });
  if (lengthKm === 0) return 0;

  const degreesPerKm = totalTurnDegrees / lengthKm;
  return Math.min(degreesPerKm / DEGREES_PER_KM_AT_MAX_SCORE, 1);
}
