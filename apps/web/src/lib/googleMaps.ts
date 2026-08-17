// Opens a generated candidate in Google Maps as a turn-by-turn preview.
// This is an approximation, not a replay: Google's directions URL scheme
// caps waypoints at 9 on desktop and just 3 on mobile browsers (confirmed
// against Google's own docs — no official API key needed, but no way
// around the cap either), while a candidate's geometry can have 1000+
// points. Google's own routing engine also re-routes between whichever
// waypoints survive, so the exact road choices GraphHopper made aren't
// guaranteed to reappear — GPX export is the only way to get the precise
// generated route onto a device.
const MAX_INTERMEDIATE_WAYPOINTS = 8;

function pickEvenlySpaced(points: GeoJSON.Position[], count: number): GeoJSON.Position[] {
  if (points.length <= count) return points;
  const step = (points.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => points[Math.round(i * step)]!);
}

export function buildGoogleMapsUrl(geometry: GeoJSON.LineString): string {
  const coords = geometry.coordinates;
  const origin = coords[0]!;
  const destination = coords[coords.length - 1]!;
  // Excludes origin/destination themselves — only the points between them
  // are candidates for the waypoints param.
  const interior = coords.slice(1, -1);
  const waypoints = pickEvenlySpaced(interior, MAX_INTERMEDIATE_WAYPOINTS);

  const params = new URLSearchParams({
    api: "1",
    origin: `${origin[1]},${origin[0]}`,
    destination: `${destination[1]},${destination[0]}`,
    travelmode: "driving",
  });
  if (waypoints.length > 0) {
    params.set("waypoints", waypoints.map(([lon, lat]) => `${lat},${lon}`).join("|"));
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function openInGoogleMaps(geometry: GeoJSON.LineString): void {
  window.open(buildGoogleMapsUrl(geometry), "_blank", "noopener,noreferrer");
}
