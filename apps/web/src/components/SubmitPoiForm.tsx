import { useState } from "react";
import { POI_CATEGORIES, submitPoi } from "../lib/api";

type Props = {
  location: { lat: number; lon: number } | null;
};

const CATEGORY_LABELS: Record<(typeof POI_CATEGORIES)[number], string> = {
  viewpoint: "Viewpoint",
  fuel: "Fuel",
  biker_cafe: "Biker café",
  repair_shop: "Repair shop",
  mountain_pass: "Mountain pass",
  border_crossing: "Border crossing",
  photo_spot: "Photo spot",
  hazard: "Hazard",
};

export function SubmitPoiForm({ location }: Props) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof POI_CATEGORIES)[number]>("viewpoint");
  const [description, setDescription] = useState("");
  const [isBikerFriendly, setIsBikerFriendly] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!location) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitPoi({
        name,
        category,
        lat: location.lat,
        lon: location.lon,
        description: description || undefined,
        isBikerFriendly,
      });
      setSubmitted(true);
      setName("");
      setDescription("");
      setIsBikerFriendly(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Add a POI</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Click the map to place it. Submissions are reviewed before they show up for everyone.
        </p>
      </div>

      {location ? (
        <p className="rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-600">
          {location.lat.toFixed(4)}, {location.lon.toFixed(4)}
        </p>
      ) : (
        <p className="text-xs text-amber-700">Click a spot on the map first.</p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <input
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as (typeof POI_CATEGORIES)[number])}
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
        >
          {POI_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <textarea
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isBikerFriendly} onChange={(e) => setIsBikerFriendly(e.target.checked)} />
          Biker-friendly
        </label>

        {error && <p className="text-xs text-red-600">{error}</p>}
        {submitted && <p className="text-xs text-emerald-700">Submitted — pending review.</p>}

        <button
          type="submit"
          disabled={!location || submitting || name.trim().length === 0}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit POI"}
        </button>
      </form>
    </div>
  );
}
