function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildGpx(params: { title: string; geometry: GeoJSON.LineString }): string {
  const trkpts = params.geometry.coordinates
    .map(([lon, lat]) => `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="riding-app" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(params.title)}</name>
  </metadata>
  <trk>
    <name>${escapeXml(params.title)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}
