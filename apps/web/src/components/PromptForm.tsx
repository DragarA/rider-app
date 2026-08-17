import { useState, type FormEvent } from "react";

type Props = {
  loading: boolean;
  status: string | null;
  onSubmit: (prompt: string) => void;
};

const EXAMPLE = "3-hour twisty route from Ljubljana around Rakitna with smooth asphalt";

export function PromptForm({ loading, status, onSubmit }: Props) {
  const [prompt, setPrompt] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    onSubmit(prompt.trim());
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          Describe your ride
        </span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={EXAMPLE}
          rows={4}
          className="resize-none rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
      </label>

      <button
        type="submit"
        disabled={!prompt.trim() || loading}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? "Planning…" : "Plan my ride"}
      </button>

      {status && <p className="text-xs text-neutral-500">{status}</p>}
    </form>
  );
}
