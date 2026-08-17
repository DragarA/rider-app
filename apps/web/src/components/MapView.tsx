import { useEffect, useRef } from "react";
import maplibregl, { type Map as MapLibreMap, type LngLatLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Poi, RouteCandidate } from "../lib/api";

const SLOVENIA_CENTER: LngLatLike = [14.9955, 46.1512];
const DEFAULT_ZOOM = 8;
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const ROUTES_SOURCE_ID = "candidate-routes";
const ROUTES_LAYER_ID = "candidate-routes-layer";
const POIS_SOURCE_ID = "pois";
const POIS_LAYER_ID = "pois-layer";
const POIS_LABEL_LAYER_ID = "pois-label-layer";

type Props = {
  origin: { lat: number; lon: number } | null;
  onPickOrigin: (lat: number, lon: number) => void;
  candidates: RouteCandidate[];
  selectedIndex: number | null;
  pois: Poi[];
};

function candidatesToFeatureCollection(
  candidates: RouteCandidate[],
  selectedIndex: number | null,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: candidates.map((c, i) => ({
      type: "Feature",
      geometry: c.geometry,
      properties: { index: i, selected: i === selectedIndex },
    })),
  };
}

function poisToFeatureCollection(pois: Poi[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: pois.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: { name: p.name, description: p.description ?? "" },
    })),
  };
}

export function MapView({ origin, onPickOrigin, candidates, selectedIndex, pois }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const loadedRef = useRef(false);
  const onPickOriginRef = useRef(onPickOrigin);
  onPickOriginRef.current = onPickOrigin;

  // Map + click-to-set-origin: created once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: SLOVENIA_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("click", (e) => {
      // Ignore clicks that land on a POI marker — its own click handler
      // (popup) takes over instead of moving the origin out from under it.
      const hits = map.queryRenderedFeatures(e.point, { layers: [POIS_LAYER_ID] });
      if (hits.length > 0) return;
      onPickOriginRef.current(e.lngLat.lat, e.lngLat.lng);
    });

    map.on("load", () => {
      map.addSource(ROUTES_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: ROUTES_LAYER_ID,
        type: "line",
        source: ROUTES_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["case", ["get", "selected"], "#C85A2A", "#8B94A3"],
          "line-width": ["case", ["get", "selected"], 5, 3],
          "line-opacity": ["case", ["get", "selected"], 1, 0.55],
        },
      });

      map.addSource(POIS_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: POIS_LAYER_ID,
        type: "circle",
        source: POIS_SOURCE_ID,
        paint: {
          "circle-radius": 6,
          "circle-color": "#2E5D46",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: POIS_LABEL_LAYER_ID,
        type: "symbol",
        source: POIS_SOURCE_ID,
        layout: {
          "text-field": ["get", "name"],
          // Must match a font this style's sprite/glyph set actually
          // bundles (checked via the style JSON) — an unspecified or
          // wrong text-font 404s against /fonts/.../*.pbf and silently
          // drops the labels instead of erroring visibly.
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#2E5D46",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });

      map.on("click", POIS_LAYER_ID, (e) => {
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const [lon, lat] = feature.geometry.coordinates as [number, number];
        const { name, description } = feature.properties as { name: string; description: string };
        new maplibregl.Popup()
          .setLngLat([lon, lat])
          .setHTML(
            `<strong>${name}</strong>${description ? `<br/><span style="font-size:12px">${description}</span>` : ""}`,
          )
          .addTo(map);
      });
      map.on("mouseenter", POIS_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", POIS_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });

      loadedRef.current = true;
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  // Origin marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!origin) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ color: "#C85A2A" });
    }
    markerRef.current.setLngLat([origin.lon, origin.lat]).addTo(map);
  }, [origin]);

  // All known POIs — shown on the map at all times, independent of route
  // generation. There are only a handful seeded (biker cafés + passes), so
  // there's no clutter case for hiding them until a route happens to pass
  // within 2km; "nearbyPois" per candidate (see CandidateList) is a
  // separate, additional signal, not a gate on visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const poiSource = map.getSource(POIS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      poiSource?.setData(poisToFeatureCollection(pois));
    };

    if (loadedRef.current) apply();
    else map.once("load", apply);
  }, [pois]);

  // Candidate routes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const source = map.getSource(ROUTES_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      source?.setData(candidatesToFeatureCollection(candidates, selectedIndex));

      const selected = selectedIndex !== null ? candidates[selectedIndex] : undefined;
      const firstPoint = selected?.geometry.coordinates[0];
      if (selected && firstPoint) {
        const start: [number, number] = [firstPoint[0]!, firstPoint[1]!];
        const bounds = selected.geometry.coordinates.reduce(
          (b, [lon, lat]) => b.extend([lon!, lat!]),
          new maplibregl.LngLatBounds(start, start),
        );
        map.fitBounds(bounds, { padding: 60, duration: 500 });
      }
    };

    if (loadedRef.current) apply();
    else map.once("load", apply);
  }, [candidates, selectedIndex]);

  return <div ref={containerRef} className="h-full w-full" />;
}
