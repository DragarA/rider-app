import { useEffect, useState } from "react";
import { MapView } from "./components/MapView";
import { ConstraintForm } from "./components/ConstraintForm";
import { PromptForm } from "./components/PromptForm";
import { CandidateList } from "./components/CandidateList";
import { AuthPanel } from "./components/AuthPanel";
import { MyRoutesPanel } from "./components/MyRoutesPanel";
import { SubmitPoiForm } from "./components/SubmitPoiForm";
import { ModeratePoisPanel } from "./components/ModeratePoisPanel";
import { useSession } from "./lib/authClient";
import {
  generateRoutes,
  generateFromPrompt,
  fetchAllPois,
  checkAdminStatus,
  fetchPassConditions,
  type ConstraintsEvent,
  type PassConditionSummary,
  type Poi,
  type RouteCandidate,
  type RouteConstraints,
} from "./lib/api";

type ApiHealth = "checking" | "ok" | "error";
type Mode = "prompt" | "advanced";
type View = "planner" | "routes" | "submit-poi" | "moderate-pois";

function App() {
  const { data: session } = useSession();
  const [apiHealth, setApiHealth] = useState<ApiHealth>("checking");
  const [mode, setMode] = useState<Mode>("prompt");
  const [view, setView] = useState<View>("planner");
  const [viewedRoute, setViewedRoute] = useState<RouteCandidate | null>(null);
  const [pendingPoiLocation, setPendingPoiLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [origin, setOrigin] = useState<{ lat: number; lon: number } | null>(null);
  const [candidates, setCandidates] = useState<RouteCandidate[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [promptStatus, setPromptStatus] = useState<string | null>(null);
  const [resolvedInfo, setResolvedInfo] = useState<ConstraintsEvent | null>(null);
  const [pois, setPois] = useState<Poi[]>([]);
  const [poiConditions, setPoiConditions] = useState<Record<string, PassConditionSummary>>({});

  useEffect(() => {
    fetch("/api/v1/health")
      .then((res) => (res.ok ? setApiHealth("ok") : setApiHealth("error")))
      .catch(() => setApiHealth("error"));
  }, []);

  useEffect(() => {
    // Shown on the map at all times (see MapView) — there are only a
    // handful of seeded POIs, so there's no reason to gate visibility on
    // a route happening to pass nearby.
    fetchAllPois()
      .then(setPois)
      .catch(() => setPois([]));
  }, []);

  useEffect(() => {
    // Best-effort — degrades to {} when NAP isn't configured (see
    // apps/api/src/lib/passConditions.ts), which just means no POI popup
    // shows a condition badge, not an error.
    fetchPassConditions()
      .then(({ passes }) => {
        setPoiConditions(Object.fromEntries(passes.map((p) => [p.poiId, p])));
      })
      .catch(() => setPoiConditions({}));
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setIsAdmin(false);
      return;
    }
    checkAdminStatus()
      .then(setIsAdmin)
      .catch(() => setIsAdmin(false));
  }, [session?.user]);

  function resetResults() {
    setError(null);
    setCandidates([]);
    setSelectedIndex(null);
    setResolvedInfo(null);
  }

  async function handleStructuredSubmit(constraints: RouteConstraints) {
    resetResults();
    setLoading(true);
    try {
      const res = await generateRoutes(constraints);
      setCandidates(res.candidates);
      setSelectedIndex(res.candidates.length > 0 ? 0 : null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePromptSubmit(prompt: string) {
    resetResults();
    setLoading(true);
    setPromptStatus("Interpreting your request…");
    try {
      await generateFromPrompt(prompt, {
        onConstraints: (data) => {
          setResolvedInfo(data);
          setOrigin({ lat: data.constraints.origin.lat, lon: data.constraints.origin.lon });
          setPromptStatus("Generating candidates…");
        },
        onCandidates: (data) => {
          setCandidates(data.candidates);
          setSelectedIndex(data.candidates.length > 0 ? 0 : null);
          setPromptStatus(null);
        },
        onError: (message) => {
          setError(message);
          setPromptStatus(null);
        },
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
        <h1 className="text-lg font-semibold">Slovenian Ride Planner</h1>
        <div className="flex items-center gap-4">
          <span
            className={
              "text-xs font-mono " +
              (apiHealth === "ok"
                ? "text-emerald-600"
                : apiHealth === "error"
                  ? "text-red-600"
                  : "text-neutral-400")
            }
          >
            api: {apiHealth}
          </span>
          {view === "planner" ? (
            <>
              <button
                type="button"
                onClick={() => setView("routes")}
                className="text-sm font-medium text-neutral-700 hover:underline"
              >
                My Routes
              </button>
              {session?.user && (
                <button
                  type="button"
                  onClick={() => setView("submit-poi")}
                  className="text-sm font-medium text-neutral-700 hover:underline"
                >
                  Add POI
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setView("moderate-pois")}
                  className="text-sm font-medium text-neutral-700 hover:underline"
                >
                  Moderate POIs
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => setView("planner")}
              className="text-sm font-medium text-neutral-700 hover:underline"
            >
              Back to planner
            </button>
          )}
          <AuthPanel />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {view === "planner" ? (
          <>
            <aside className="flex w-80 flex-shrink-0 flex-col overflow-y-auto border-r border-neutral-200">
              <div className="flex border-b border-neutral-200 text-sm">
                <button
                  type="button"
                  onClick={() => setMode("prompt")}
                  className={
                    "flex-1 px-3 py-2 font-medium " +
                    (mode === "prompt" ? "border-b-2 border-neutral-900" : "text-neutral-400")
                  }
                >
                  Describe
                </button>
                <button
                  type="button"
                  onClick={() => setMode("advanced")}
                  className={
                    "flex-1 px-3 py-2 font-medium " +
                    (mode === "advanced" ? "border-b-2 border-neutral-900" : "text-neutral-400")
                  }
                >
                  Advanced
                </button>
              </div>

              {mode === "prompt" ? (
                <PromptForm loading={loading} status={promptStatus} onSubmit={handlePromptSubmit} />
              ) : (
                <ConstraintForm origin={origin} loading={loading} onSubmit={handleStructuredSubmit} />
              )}

              {resolvedInfo && (
                <div className="mx-4 mb-2 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                  <p>
                    Riding from <strong>{resolvedInfo.constraints.origin.label}</strong>
                    {resolvedInfo.mustPassNear && (
                      <>
                        , passing near <strong>{resolvedInfo.mustPassNear.name}</strong>
                      </>
                    )}
                    .
                  </p>
                  {resolvedInfo.unresolvedMustPassNearQuery && (
                    <p className="mt-1 text-amber-700">
                      Couldn't find "{resolvedInfo.unresolvedMustPassNearQuery}" — ignoring that part of the request.
                    </p>
                  )}
                </div>
              )}

              {error && <p className="px-4 text-sm text-red-600">{error}</p>}
              <CandidateList candidates={candidates} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
            </aside>
            <main className="min-w-0 flex-1">
              <MapView
                origin={origin}
                onPickOrigin={(lat, lon) => setOrigin({ lat, lon })}
                candidates={candidates}
                selectedIndex={selectedIndex}
                pois={pois}
                poiConditions={poiConditions}
              />
            </main>
          </>
        ) : view === "routes" ? (
          <>
            <aside className="flex w-80 flex-shrink-0 flex-col overflow-y-auto border-r border-neutral-200">
              <MyRoutesPanel onViewOnMap={setViewedRoute} />
            </aside>
            <main className="min-w-0 flex-1">
              <MapView
                origin={null}
                onPickOrigin={() => {}}
                candidates={viewedRoute ? [viewedRoute] : []}
                selectedIndex={viewedRoute ? 0 : null}
                pois={[]}
              />
            </main>
          </>
        ) : view === "submit-poi" ? (
          <>
            <aside className="flex w-80 flex-shrink-0 flex-col overflow-y-auto border-r border-neutral-200">
              <SubmitPoiForm location={pendingPoiLocation} />
            </aside>
            <main className="min-w-0 flex-1">
              <MapView
                origin={pendingPoiLocation}
                onPickOrigin={(lat, lon) => setPendingPoiLocation({ lat, lon })}
                candidates={[]}
                selectedIndex={null}
                pois={pois}
              />
            </main>
          </>
        ) : (
          <>
            <aside className="flex w-80 flex-shrink-0 flex-col overflow-y-auto border-r border-neutral-200">
              <ModeratePoisPanel />
            </aside>
            <main className="min-w-0 flex-1">
              <MapView origin={null} onPickOrigin={() => {}} candidates={[]} selectedIndex={null} pois={pois} />
            </main>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
