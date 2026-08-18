import { useEffect, useState } from "react";
import type { Poi } from "../lib/api";
import { deletePoiEntry, listPendingPois, verifyPoi } from "../lib/api";

export function ModeratePoisPanel() {
  const [pending, setPending] = useState<Poi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    setError(null);
    listPendingPois()
      .then(setPending)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function approve(poi: Poi) {
    await verifyPoi(poi.id, true);
    setPending((ps) => ps.filter((p) => p.id !== poi.id));
  }

  async function reject(poi: Poi) {
    await deletePoiEntry(poi.id);
    setPending((ps) => ps.filter((p) => p.id !== poi.id));
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold">Moderate POIs</h2>

      {loading && <p className="text-sm text-neutral-400">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && !error && pending.length === 0 && (
        <p className="text-sm text-neutral-500">Nothing pending review.</p>
      )}

      <ul className="flex flex-col gap-2">
        {pending.map((poi) => (
          <li key={poi.id} className="rounded border border-neutral-200 p-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{poi.name}</span>
              <span className="text-xs text-neutral-500">{poi.category}</span>
            </div>
            {poi.description && <p className="mt-1 text-xs text-neutral-600">{poi.description}</p>}
            <p className="mt-1 font-mono text-xs text-neutral-400">
              {poi.lat.toFixed(4)}, {poi.lon.toFixed(4)}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => approve(poi)}
                className="flex-1 rounded bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => reject(poi)}
                className="flex-1 rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
