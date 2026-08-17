import { useState, type FormEvent } from "react";
import type { CurvinessPref, RouteConstraints, SurfacePref } from "../lib/api";

type Props = {
  origin: { lat: number; lon: number } | null;
  loading: boolean;
  onSubmit: (constraints: RouteConstraints) => void;
};

export function ConstraintForm({ origin, loading, onSubmit }: Props) {
  const [maxDurationMinutes, setMaxDurationMinutes] = useState(90);
  const [curvinessPref, setCurvinessPref] = useState<CurvinessPref>("twisty");
  const [surfacePref, setSurfacePref] = useState<SurfacePref>("asphalt_preferred");
  const [avoidHighways, setAvoidHighways] = useState(true);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!origin) return;
    onSubmit({ origin, maxDurationMinutes, curvinessPref, surfacePref, avoidHighways });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">
          Starting point
        </label>
        <p className="mt-1 text-sm">
          {origin ? (
            <span className="font-mono">
              {origin.lat.toFixed(4)}, {origin.lon.toFixed(4)}
            </span>
          ) : (
            <span className="text-neutral-400">Click the map to set a starting point</span>
          )}
        </p>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          Max ride duration
        </span>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={15}
            max={720}
            step={15}
            value={maxDurationMinutes}
            onChange={(e) => setMaxDurationMinutes(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-16 text-right font-mono text-sm">
            {(maxDurationMinutes / 60).toFixed(maxDurationMinutes % 60 === 0 ? 0 : 1)}h
          </span>
        </div>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Curviness</span>
        <select
          value={curvinessPref}
          onChange={(e) => setCurvinessPref(e.target.value as CurvinessPref)}
          className="rounded border border-neutral-300 px-2 py-1.5"
        >
          <option value="relaxed">Relaxed</option>
          <option value="twisty">Twisty</option>
          <option value="very_twisty">Very twisty</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Surface</span>
        <select
          value={surfacePref}
          onChange={(e) => setSurfacePref(e.target.value as SurfacePref)}
          className="rounded border border-neutral-300 px-2 py-1.5"
        >
          <option value="asphalt_only">Asphalt only</option>
          <option value="asphalt_preferred">Asphalt preferred</option>
          <option value="any">Any surface</option>
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={avoidHighways}
          onChange={(e) => setAvoidHighways(e.target.checked)}
        />
        Avoid motorways / trunk roads
      </label>

      <button
        type="submit"
        disabled={!origin || loading}
        className="mt-2 rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? "Generating…" : "Generate route"}
      </button>
    </form>
  );
}
