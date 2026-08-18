import { parseSSE } from "./sse";

export type CurvinessPref = "relaxed" | "twisty" | "very_twisty";
export type SurfacePref = "asphalt_only" | "asphalt_preferred" | "any";

export type RouteConstraints = {
  origin: { lat: number; lon: number; label?: string };
  maxDurationMinutes: number;
  curvinessPref: CurvinessPref;
  surfacePref: SurfacePref;
  avoidHighways: boolean;
};

export type SurfaceBreakdown = { gravel: number; cobblestone: number; asphalt: number };

export type PoiMetadata = {
  openingHours?: string;
  elevationMeters?: number;
  passClosedInWinter?: boolean;
  externalUrl?: string;
};

export type Poi = {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  description: string | null;
  isBikerFriendly: boolean;
  verified: boolean;
  createdById: string | null;
  metadata: PoiMetadata | null;
};

export const POI_CATEGORIES = [
  "viewpoint",
  "fuel",
  "biker_cafe",
  "repair_shop",
  "mountain_pass",
  "border_crossing",
  "photo_spot",
  "hazard",
] as const;

export type RouteCandidate = {
  geometry: GeoJSON.LineString;
  distanceMeters: number;
  estDurationSeconds: number;
  curvinessScore: number;
  surfaceBreakdown: SurfaceBreakdown;
  nearbyPois: Poi[];
  rankScore: number;
};

export type GenerateResponse = {
  constraints: RouteConstraints;
  targetDistanceMeters: number;
  candidates: RouteCandidate[];
};

export type ResolvedPlace = { name: string; lat: number; lon: number };

export type ConstraintsEvent = {
  constraints: RouteConstraints;
  mustPassNear: ResolvedPlace | null;
  unresolvedMustPassNearQuery: string | null;
};

export type CandidatesEvent = {
  targetDistanceMeters: number;
  candidates: RouteCandidate[];
};

export async function generateRoutes(constraints: RouteConstraints): Promise<GenerateResponse> {
  const res = await fetch("/api/v1/routes/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(constraints),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Route generation failed (${res.status})`);
  }
  return res.json();
}

export async function generateFromPrompt(
  prompt: string,
  handlers: {
    onConstraints?: (data: ConstraintsEvent) => void;
    onCandidates?: (data: CandidatesEvent) => void;
    onError?: (message: string) => void;
    onDone?: () => void;
  },
): Promise<void> {
  const res = await fetch("/api/v1/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    handlers.onError?.(body?.error ?? `Request failed (${res.status})`);
    return;
  }

  for await (const { event, data } of parseSSE(res)) {
    if (event === "constraints") handlers.onConstraints?.(JSON.parse(data));
    else if (event === "candidates") handlers.onCandidates?.(JSON.parse(data));
    else if (event === "error") handlers.onError?.(JSON.parse(data).message);
    else if (event === "done") handlers.onDone?.();
  }
}

export async function fetchAllPois(): Promise<Poi[]> {
  // verified=true explicitly — the API's default (filter omitted) returns
  // every POI regardless of moderation status, which is the right default
  // for flexible querying but wrong for "what shows on the public map":
  // a brand-new community submission would otherwise appear immediately,
  // before any admin has reviewed it (Phase 5).
  const res = await fetch("/api/v1/pois?verified=true");
  if (!res.ok) throw new Error(`Failed to load POIs (${res.status})`);
  const body = (await res.json()) as { pois: Poi[] };
  return body.pois;
}

export type RouteVisibility = "private" | "unlisted" | "public";

export type SavedRoute = {
  id: string;
  ownerId: string | null;
  title: string;
  description: string | null;
  geometry: GeoJSON.LineString;
  distanceMeters: number;
  estDurationSeconds: number;
  curvinessScore: number | null;
  surfaceBreakdown: Record<string, number> | null;
  visibility: RouteVisibility;
  generatedFromPrompt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RatingSummary = {
  count: number;
  avgScenicScore: number | null;
  avgSurfaceScore: number | null;
  avgFunScore: number | null;
};

export type Rating = {
  id: string;
  userId: string;
  scenicScore: number;
  surfaceScore: number;
  funScore: number;
  comment: string | null;
  riddenAt: string | null;
  createdAt: string;
};

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `${fallback} (${res.status})`);
  }
  return res.json();
}

export async function saveRoute(
  candidate: RouteCandidate,
  opts: { title: string; description?: string; visibility?: RouteVisibility; generatedFromPrompt?: string },
): Promise<SavedRoute> {
  const res = await fetch("/api/v1/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: opts.title,
      description: opts.description ?? null,
      visibility: opts.visibility ?? "private",
      generatedFromPrompt: opts.generatedFromPrompt ?? null,
      geometry: candidate.geometry,
      distanceMeters: candidate.distanceMeters,
      estDurationSeconds: candidate.estDurationSeconds,
      curvinessScore: candidate.curvinessScore,
      surfaceBreakdown: candidate.surfaceBreakdown,
    }),
  });
  const body = await jsonOrThrow<{ route: SavedRoute }>(res, "Saving route failed");
  return body.route;
}

export async function listMyRoutes(): Promise<SavedRoute[]> {
  const res = await fetch("/api/v1/routes?mine=true");
  const body = await jsonOrThrow<{ routes: SavedRoute[] }>(res, "Failed to load your routes");
  return body.routes;
}

export async function listPublicRoutes(filters?: {
  near?: { lat: number; lon: number };
  radiusKm?: number;
  maxDurationMinutes?: number;
}): Promise<SavedRoute[]> {
  const params = new URLSearchParams();
  if (filters?.near) params.set("near", `${filters.near.lon},${filters.near.lat}`);
  if (filters?.radiusKm) params.set("radiusKm", String(filters.radiusKm));
  if (filters?.maxDurationMinutes) params.set("maxDurationMinutes", String(filters.maxDurationMinutes));

  const res = await fetch(`/api/v1/routes?${params.toString()}`);
  const body = await jsonOrThrow<{ routes: SavedRoute[] }>(res, "Failed to load public routes");
  return body.routes;
}

export async function getRoute(id: string): Promise<{ route: SavedRoute; ratingSummary: RatingSummary }> {
  const res = await fetch(`/api/v1/routes/${id}`);
  return jsonOrThrow(res, "Failed to load route");
}

export async function updateRoute(
  id: string,
  patch: { title?: string; description?: string | null; visibility?: RouteVisibility },
): Promise<SavedRoute> {
  const res = await fetch(`/api/v1/routes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await jsonOrThrow<{ route: SavedRoute }>(res, "Failed to update route");
  return body.route;
}

export async function deleteRoute(id: string): Promise<void> {
  const res = await fetch(`/api/v1/routes/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Failed to delete route (${res.status})`);
  }
}

export async function rateRoute(
  id: string,
  rating: { scenicScore: number; surfaceScore: number; funScore: number; comment?: string },
): Promise<RatingSummary> {
  const res = await fetch(`/api/v1/routes/${id}/ratings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rating),
  });
  const body = await jsonOrThrow<{ ratingSummary: RatingSummary }>(res, "Failed to submit rating");
  return body.ratingSummary;
}

export async function downloadSavedRouteGpx(id: string, title: string): Promise<void> {
  const res = await fetch(`/api/v1/routes/${id}/gpx`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `GPX export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^a-z0-9-_]+/gi, "_")}.gpx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function submitPoi(input: {
  name: string;
  category: string;
  lat: number;
  lon: number;
  description?: string;
  isBikerFriendly?: boolean;
  metadata?: PoiMetadata;
}): Promise<Poi> {
  const res = await fetch("/api/v1/pois", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await jsonOrThrow<{ poi: Poi }>(res, "Submitting POI failed");
  return body.poi;
}

export async function listPendingPois(): Promise<Poi[]> {
  const res = await fetch("/api/v1/pois?verified=false");
  const body = await jsonOrThrow<{ pois: Poi[] }>(res, "Failed to load pending POIs");
  return body.pois;
}

export async function verifyPoi(id: string, verified: boolean): Promise<Poi> {
  const res = await fetch(`/api/v1/pois/${id}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verified }),
  });
  const body = await jsonOrThrow<{ poi: Poi }>(res, "Failed to update POI status");
  return body.poi;
}

export async function deletePoiEntry(id: string): Promise<void> {
  const res = await fetch(`/api/v1/pois/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Failed to delete POI (${res.status})`);
  }
}

export async function checkAdminStatus(): Promise<boolean> {
  const res = await fetch("/api/v1/admin/status");
  if (!res.ok) return false;
  const body = (await res.json()) as { isAdmin: boolean };
  return body.isAdmin;
}

export type PassConditionSummary = {
  poiId: string;
  name: string;
  lat: number;
  lon: number;
  passClosedInWinter: boolean;
  liveEvents: { id: string; title: string; description: string | null; category: string }[];
};

export async function fetchPassConditions(): Promise<{ configured: boolean; passes: PassConditionSummary[] }> {
  const res = await fetch("/api/v1/conditions/passes");
  if (!res.ok) throw new Error(`Failed to load pass conditions (${res.status})`);
  return res.json();
}

export async function downloadGpx(title: string, geometry: GeoJSON.LineString): Promise<void> {
  const res = await fetch("/api/v1/routes/gpx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, geometry }),
  });
  if (!res.ok) throw new Error(`GPX export failed (${res.status})`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^a-z0-9-_]+/gi, "_")}.gpx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
