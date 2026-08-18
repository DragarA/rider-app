// Client for NAP (nap.si), Slovenia's EU-mandated National Access Point for
// transport data — publisher DARS/PIC, same org behind promet.si. Confirmed
// live this session via curl (see PROJECT_SPEC.md §0.1 for the exact
// requests/responses):
//   - POST https://b2b.nap.si/uc/user/token returns
//     {"error":"invalid_client"} (400) when unauthenticated — a real OAuth2
//     password-grant token endpoint, not a guess.
//   - GET  https://b2b.nap.si/data/b2b.events.geojson.en_US returns 401
//     without a bearer token — a real, gated GeoJSON data endpoint.
// What's NOT confirmed: whether the token endpoint also needs
// NAP_CLIENT_SECRET (some OAuth2 password-grant deployments do, some
// don't — depends on how NAP issued this account's credentials, which
// only shows up in the user's own NAP dashboard), and the exact property
// names on returned GeoJSON Features (no working token to sample against
// this session). Both are called out below at the point they matter.

export type NapEvent = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  point: { lat: number; lon: number } | null;
  raw: unknown;
};

const NAP_BASE_URL = process.env.NAP_BASE_URL ?? "https://b2b.nap.si";
const TOKEN_REFRESH_SLACK_MS = 30_000;

type CachedToken = { accessToken: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

export function napConfigured(): boolean {
  return Boolean(process.env.NAP_USERNAME && process.env.NAP_PASSWORD && process.env.NAP_CLIENT_ID);
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  const username = process.env.NAP_USERNAME;
  const password = process.env.NAP_PASSWORD;
  const clientId = process.env.NAP_CLIENT_ID;
  const clientSecret = process.env.NAP_CLIENT_SECRET; // unconfirmed whether required — see file header
  if (!username || !password || !clientId) {
    throw new Error("NAP credentials not configured (NAP_USERNAME/NAP_PASSWORD/NAP_CLIENT_ID)");
  }

  const body = new URLSearchParams({
    grant_type: "password",
    username,
    password,
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
  });

  const res = await fetch(`${NAP_BASE_URL}/uc/user/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`NAP token request failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - TOKEN_REFRESH_SLACK_MS,
  };
  return cachedToken.accessToken;
}

// Best-effort shape for a NAP GeoJSON Feature's `properties`, based on
// typical DATEX II-derived GeoJSON conversions from other European
// national traffic portals — UNCONFIRMED against NAP's actual response
// (see file header). Adjust field names here once real data is available;
// everything downstream of normalizeFeatureCollection is unaffected.
type NapFeatureProperties = {
  id?: string | number;
  title?: string;
  description?: string;
  category?: string;
  subcategory?: string;
};

function representativePoint(geometry: GeoJSON.Geometry | null): { lat: number; lon: number } | null {
  if (!geometry) return null;
  if (geometry.type === "Point") {
    const [lon, lat] = geometry.coordinates;
    return lon !== undefined && lat !== undefined ? { lat, lon } : null;
  }
  if (geometry.type === "LineString" || geometry.type === "MultiPoint") {
    const [lon, lat] = geometry.coordinates[0] ?? [];
    return lon !== undefined && lat !== undefined ? { lat, lon } : null;
  }
  if (geometry.type === "Polygon" || geometry.type === "MultiLineString") {
    const [lon, lat] = geometry.coordinates[0]?.[0] ?? [];
    return lon !== undefined && lat !== undefined ? { lat, lon } : null;
  }
  if (geometry.type === "MultiPolygon") {
    const [lon, lat] = geometry.coordinates[0]?.[0]?.[0] ?? [];
    return lon !== undefined && lat !== undefined ? { lat, lon } : null;
  }
  return null;
}

export function normalizeFeatureCollection(fc: GeoJSON.FeatureCollection): NapEvent[] {
  const events: NapEvent[] = [];
  for (const feature of fc.features) {
    const props = (feature.properties ?? {}) as NapFeatureProperties;
    // Skip features with no id — the pass_conditions cache is keyed by
    // NAP's own event id (see schema.ts), so an id-less feature can't be
    // upserted meaningfully.
    if (props.id === undefined || props.id === null) continue;

    events.push({
      id: String(props.id),
      title: props.title ?? props.category ?? "Traffic event",
      description: props.description ?? null,
      category: props.category ?? props.subcategory ?? "unknown",
      point: representativePoint(feature.geometry),
      raw: feature,
    });
  }
  return events;
}

async function fetchGeoJson(path: string): Promise<GeoJSON.FeatureCollection> {
  const token = await getAccessToken();
  const res = await fetch(`${NAP_BASE_URL}/data/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`NAP data request failed (${path}): ${res.status} ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as GeoJSON.FeatureCollection;
}

// Both datasets recommended for this feature (see PROJECT_SPEC.md §0.1):
// general traffic events (closures, incidents) and planned roadworks.
export async function fetchPassEvents(): Promise<NapEvent[]> {
  const [events, roadworks] = await Promise.all([
    fetchGeoJson("b2b.events.geojson.en_US"),
    fetchGeoJson("b2b.roadworks.geojson.en_US"),
  ]);
  return [...normalizeFeatureCollection(events), ...normalizeFeatureCollection(roadworks)];
}
