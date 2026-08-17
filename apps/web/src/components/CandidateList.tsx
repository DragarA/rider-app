import type { RouteCandidate } from "../lib/api";
import { downloadGpx } from "../lib/api";
import { openInGoogleMaps } from "../lib/googleMaps";

type Props = {
  candidates: RouteCandidate[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
};

function formatDuration(seconds: number): string {
  // Round to whole minutes first, then split — rounding h/m separately can
  // produce "1h 60m" when the seconds remainder rounds up to a full hour.
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function CandidateList({ candidates, selectedIndex, onSelect }: Props) {
  if (candidates.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-neutral-200 p-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        Candidates ({candidates.length})
      </h2>
      <ul className="flex flex-col gap-2">
        {candidates.map((c, i) => {
          const selected = i === selectedIndex;
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onSelect(i)}
                className={
                  "w-full rounded border px-3 py-2 text-left text-sm transition-colors " +
                  (selected
                    ? "border-orange-600 bg-orange-50"
                    : "border-neutral-200 hover:border-neutral-300")
                }
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{(c.distanceMeters / 1000).toFixed(1)} km</span>
                  <span className="font-mono text-xs text-neutral-500">
                    {formatDuration(c.estDurationSeconds)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
                    <div
                      className="h-full rounded-full bg-orange-600"
                      style={{ width: `${Math.round(c.curvinessScore * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-neutral-500">curviness</span>
                </div>
                {(() => {
                  const nonAsphalt = c.surfaceBreakdown.gravel + c.surfaceBreakdown.cobblestone;
                  if (nonAsphalt < 0.02) return null;
                  return (
                    <p className="mt-1 text-xs text-amber-700">
                      {Math.round(c.surfaceBreakdown.gravel * 100)}% gravel
                      {c.surfaceBreakdown.cobblestone >= 0.02 &&
                        `, ${Math.round(c.surfaceBreakdown.cobblestone * 100)}% cobblestone`}
                    </p>
                  );
                })()}
                {c.nearbyPois.length > 0 && (
                  <p className="mt-1 text-xs text-emerald-700">
                    Passes near {c.nearbyPois.map((p) => p.name).join(", ")}
                  </p>
                )}
              </button>
              {selected && (
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => downloadGpx(`Route ${i + 1}`, c.geometry)}
                    className="flex-1 rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
                  >
                    Download GPX
                  </button>
                  <button
                    type="button"
                    onClick={() => openInGoogleMaps(c.geometry)}
                    className="flex-1 rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
                  >
                    Open in Google Maps
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
