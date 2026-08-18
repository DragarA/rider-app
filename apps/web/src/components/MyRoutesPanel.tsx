import { useEffect, useState } from "react";
import type { RatingSummary, RouteCandidate, RouteVisibility, SavedRoute } from "../lib/api";
import { deleteRoute, downloadSavedRouteGpx, listMyRoutes, listPublicRoutes, rateRoute, updateRoute } from "../lib/api";
import { useSession } from "../lib/authClient";
import { openInGoogleMaps } from "../lib/googleMaps";

type Tab = "mine" | "public";

type Props = {
  onViewOnMap: (candidate: RouteCandidate | null) => void;
};

function savedRouteToCandidate(route: SavedRoute): RouteCandidate {
  return {
    geometry: route.geometry,
    distanceMeters: route.distanceMeters,
    estDurationSeconds: route.estDurationSeconds,
    curvinessScore: route.curvinessScore ?? 0,
    surfaceBreakdown: { gravel: 0, cobblestone: 0, asphalt: 1 },
    nearbyPois: [],
    rankScore: 0,
  };
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function StarInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-neutral-500">{label}</span>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={n <= value ? "text-orange-600" : "text-neutral-300"}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

function RatingForm({ routeId, onRated }: { routeId: string; onRated: (summary: RatingSummary) => void }) {
  const [scenicScore, setScenicScore] = useState(4);
  const [surfaceScore, setSurfaceScore] = useState(4);
  const [funScore, setFunScore] = useState(4);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const summary = await rateRoute(routeId, { scenicScore, surfaceScore, funScore, comment: comment || undefined });
      onRated(summary);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 rounded border border-neutral-200 p-2">
      <StarInput label="Scenic" value={scenicScore} onChange={setScenicScore} />
      <StarInput label="Surface" value={surfaceScore} onChange={setSurfaceScore} />
      <StarInput label="Fun" value={funScore} onChange={setFunScore} />
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comment (optional)"
        rows={2}
        className="rounded border border-neutral-300 px-2 py-1 text-xs"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="rounded bg-neutral-900 px-2 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit rating"}
      </button>
    </div>
  );
}

export function MyRoutesPanel({ onViewOnMap }: Props) {
  const { data: session } = useSession();
  const [tab, setTab] = useState<Tab>(session?.user ? "mine" : "public");
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SavedRoute | null>(null);
  const [ratingSummary, setRatingSummary] = useState<RatingSummary | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSelected(null);
    onViewOnMap(null);
    const load = tab === "mine" ? listMyRoutes() : listPublicRoutes();
    load
      .then(setRoutes)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function select(route: SavedRoute) {
    setSelected(route);
    setRatingSummary(null);
    onViewOnMap(savedRouteToCandidate(route));
  }

  async function handleDelete(route: SavedRoute) {
    if (!confirm(`Delete "${route.title}"?`)) return;
    await deleteRoute(route.id);
    setRoutes((rs) => rs.filter((r) => r.id !== route.id));
    setSelected(null);
    onViewOnMap(null);
  }

  async function handleVisibilityChange(route: SavedRoute, visibility: RouteVisibility) {
    const updated = await updateRoute(route.id, { visibility });
    setSelected(updated);
    setRoutes((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
  }

  const isOwner = selected && session?.user && selected.ownerId === session.user.id;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex border-b border-neutral-200 text-sm">
        <button
          type="button"
          onClick={() => setTab("mine")}
          className={"flex-1 px-3 py-2 font-medium " + (tab === "mine" ? "border-b-2 border-neutral-900" : "text-neutral-400")}
        >
          Mine
        </button>
        <button
          type="button"
          onClick={() => setTab("public")}
          className={"flex-1 px-3 py-2 font-medium " + (tab === "public" ? "border-b-2 border-neutral-900" : "text-neutral-400")}
        >
          Public
        </button>
      </div>

      {tab === "mine" && !session?.user && <p className="p-4 text-sm text-neutral-500">Sign in to see your saved routes.</p>}
      {loading && <p className="p-4 text-sm text-neutral-400">Loading…</p>}
      {error && <p className="p-4 text-sm text-red-600">{error}</p>}
      {!loading && !error && routes.length === 0 && tab === "mine" && session?.user && (
        <p className="p-4 text-sm text-neutral-500">No saved routes yet — generate one and hit "Save route".</p>
      )}
      {!loading && !error && routes.length === 0 && tab === "public" && (
        <p className="p-4 text-sm text-neutral-500">No public routes yet.</p>
      )}

      <ul className="flex flex-col gap-2 p-4">
        {routes.map((route) => {
          const isSelected = selected?.id === route.id;
          return (
            <li key={route.id}>
              <button
                type="button"
                onClick={() => select(route)}
                className={
                  "w-full rounded border px-3 py-2 text-left text-sm transition-colors " +
                  (isSelected ? "border-orange-600 bg-orange-50" : "border-neutral-200 hover:border-neutral-300")
                }
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{route.title}</span>
                  <span className="font-mono text-xs text-neutral-500">{formatDuration(route.estDurationSeconds)}</span>
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  {(route.distanceMeters / 1000).toFixed(1)} km · {route.visibility}
                </div>
              </button>

              {isSelected && selected && (
                <div className="mt-1 flex flex-col gap-2 rounded border border-neutral-200 p-2">
                  {selected.description && <p className="text-xs text-neutral-600">{selected.description}</p>}

                  {isOwner && (
                    <select
                      value={selected.visibility}
                      onChange={(e) => handleVisibilityChange(selected, e.target.value as RouteVisibility)}
                      className="rounded border border-neutral-300 px-2 py-1 text-xs"
                    >
                      <option value="private">Private</option>
                      <option value="unlisted">Unlisted (link only)</option>
                      <option value="public">Public</option>
                    </select>
                  )}

                  {ratingSummary && ratingSummary.count > 0 && (
                    <p className="text-xs text-neutral-500">
                      {ratingSummary.count} rating{ratingSummary.count === 1 ? "" : "s"} · scenic{" "}
                      {ratingSummary.avgScenicScore?.toFixed(1)} · surface {ratingSummary.avgSurfaceScore?.toFixed(1)} · fun{" "}
                      {ratingSummary.avgFunScore?.toFixed(1)}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => downloadSavedRouteGpx(selected.id, selected.title)}
                      className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs font-medium hover:bg-neutral-50"
                    >
                      Download GPX
                    </button>
                    <button
                      type="button"
                      onClick={() => openInGoogleMaps(selected.geometry)}
                      className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs font-medium hover:bg-neutral-50"
                    >
                      Open in Google Maps
                    </button>
                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => handleDelete(selected)}
                        className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    )}
                  </div>

                  {session?.user && <RatingForm routeId={selected.id} onRated={setRatingSummary} />}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
