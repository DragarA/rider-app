import { useState } from "react";
import { signIn, signOut, signUp, useSession } from "../lib/authClient";

// Sign-in/up/out UI only — the "My Routes" view toggle lives in App.tsx's
// header directly, always visible, since Public route browsing (unlike
// Mine) doesn't require a session (PROJECT_SPEC.md §3.2's "public route
// browsing" is explicitly anonymous-accessible).
export function AuthPanel() {
  const { data: session, isPending } = useSession();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (isPending) return null;

  if (session?.user) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-neutral-400">{session.user.name}</span>
        <button
          type="button"
          onClick={() => signOut()}
          className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: authError } =
        mode === "sign-up" ? await signUp.email({ email, password, name }) : await signIn.email({ email, password });
      if (authError) {
        setError(authError.message ?? "Something went wrong");
        return;
      }
      setOpen(false);
      setEmail("");
      setPassword("");
      setName("");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-neutral-300 px-3 py-1 text-sm font-medium hover:bg-neutral-50"
      >
        Sign in
      </button>
    );
  }

  return (
    <div className="relative">
      <form
        onSubmit={handleSubmit}
        className="absolute right-0 top-9 z-10 flex w-64 flex-col gap-2 rounded border border-neutral-200 bg-white p-3 shadow-lg"
      >
        <div className="flex text-xs">
          <button
            type="button"
            onClick={() => setMode("sign-in")}
            className={"flex-1 pb-1 font-medium " + (mode === "sign-in" ? "border-b-2 border-neutral-900" : "text-neutral-400")}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("sign-up")}
            className={"flex-1 pb-1 font-medium " + (mode === "sign-up" ? "border-b-2 border-neutral-900" : "text-neutral-400")}
          >
            Sign up
          </button>
        </div>
        {mode === "sign-up" && (
          <input
            type="text"
            placeholder="Display name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {mode === "sign-up" ? "Create account" : "Sign in"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
