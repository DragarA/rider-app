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

export type Poi = {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  description: string | null;
  isBikerFriendly: boolean;
  verified: boolean;
};

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
  const res = await fetch("/api/v1/pois");
  if (!res.ok) throw new Error(`Failed to load POIs (${res.status})`);
  const body = (await res.json()) as { pois: Poi[] };
  return body.pois;
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
