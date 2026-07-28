import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import maplibregl from "maplibre-gl";
import {
  LiveClient,
  type BBox,
  type ConnStatus,
  type FilterState,
  type Vehicle,
} from "@ovlive/api-types";
import type { MapTheme } from "../lib/styles";
import { resolveOperator, type OpStyle } from "../lib/format";
import { DEFAULT_ZOOM, NL_CENTER, getSavedView, setSavedView } from "../lib/config";

export interface MapHandle {
  locate: () => void;
  flyTo: (lon: number, lat: number, zoom?: number) => void;
}

interface Props {
  theme: MapTheme;
  filters: FilterState;
  activeId: string | null;
  selectedIds: string[];
  isolate: boolean;
  following: boolean;
  routeShape: [number, number][] | null;
  onSelectVehicle: (id: string, v: Vehicle | undefined) => void;
  onSelectedLive: (v: Vehicle) => void;
  /** A selected vehicle left the live stream (its trip ended / was pruned). */
  onSelectedGone: (id: string) => void;
  /** A selected vehicle (re)entered the live stream — carries its current trip's state. */
  onSelectedBack: (v: Vehicle) => void;
  onDetach: () => void;
  onCount: (n: number) => void;
  onStatus: (s: ConnStatus) => void;
}

const GLYPHS = "https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf";
// Zoom at which markers switch from a coloured dot to the boxed operator+line pill.
const LOGO_ZOOM = 11;

function boundsToBBox(map: maplibregl.Map): BBox {
  const b = map.getBounds();
  return {
    minLat: b.getSouth(),
    minLon: b.getWest(),
    maxLat: b.getNorth(),
    maxLon: b.getEast(),
  };
}

export const MapView = forwardRef<MapHandle, Props>(function MapView(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map>();
  const clientRef = useRef<LiveClient>();
  const featuresRef = useRef<Map<string, GeoJSON.Feature>>(new Map());
  const vehiclesRef = useRef<Map<string, Vehicle>>(new Map());
  const dirtyRef = useRef(false);
  const rafRef = useRef<number>();
  const meMarkerRef = useRef<maplibregl.Marker>();
  const hoveredRef = useRef<string | null>(null);
  // Always-current copies for use inside stable map event handlers.
  const filtersRef = useRef(props.filters);
  filtersRef.current = props.filters;
  const activeIdRef = useRef(props.activeId);
  activeIdRef.current = props.activeId;
  const selectedIdsRef = useRef(props.selectedIds);
  selectedIdsRef.current = props.selectedIds;
  const isolateRef = useRef(props.isolate);
  isolateRef.current = props.isolate;
  const followingRef = useRef(props.following);
  followingRef.current = props.following;
  const routeShapeRef = useRef(props.routeShape);
  routeShapeRef.current = props.routeShape;
  const onDetachRef = useRef(props.onDetach);
  onDetachRef.current = props.onDetach;
  const onSelectRef = useRef(props.onSelectVehicle);
  onSelectRef.current = props.onSelectVehicle;
  const onSelectedGoneRef = useRef(props.onSelectedGone);
  onSelectedGoneRef.current = props.onSelectedGone;
  const onSelectedBackRef = useRef(props.onSelectedBack);
  onSelectedBackRef.current = props.onSelectedBack;

  useImperativeHandle(ref, () => ({
    locate() {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition((pos) => {
        const { longitude, latitude } = pos.coords;
        const map = mapRef.current!;
        if (!meMarkerRef.current) {
          const el = document.createElement("div");
          el.style.cssText =
            "width:16px;height:16px;border-radius:50%;background:#0071e3;border:3px solid #fff;box-shadow:0 0 0 4px rgba(0,113,227,.3)";
          meMarkerRef.current = new maplibregl.Marker({ element: el });
        }
        meMarkerRef.current.setLngLat([longitude, latitude]).addTo(map);
        map.flyTo({ center: [longitude, latitude], zoom: 14, offset: panelAwareOffset(map) });
      });
    },
    flyTo(lon, lat, zoom) {
      mapRef.current?.flyTo({ center: [lon, lat], zoom: zoom ?? 15 });
    },
  }));

  // Build the (empty) vehicle + route layers. Re-run after every style load.
  function ensureLayers(map: maplibregl.Map) {
    if (!map.getSource("vehicles")) {
      map.addSource("vehicles", { type: "geojson", data: emptyFC() });
    }
    if (!map.getSource("route")) {
      map.addSource("route", { type: "geojson", data: emptyFC() });
    }
    if (!map.getLayer("route-line")) {
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-color": "#0071e3", "line-width": 5, "line-opacity": 0.7 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
    }
    if (!map.getLayer("veh-selected")) {
      map.addLayer({
        id: "veh-selected",
        type: "circle",
        source: "vehicles",
        filter: ["in", ["get", "id"], ["literal", props.selectedIds]],
        paint: {
          "circle-radius": 16,
          "circle-color": "#0071e3",
          "circle-opacity": 0.25,
        },
      });
    }
    // Low zoom (below LOGO_ZOOM): a coloured dot in the operator's brand colour.
    if (!map.getLayer("veh-dot")) {
      map.addLayer({
        id: "veh-dot",
        type: "circle",
        source: "vehicles",
        maxzoom: LOGO_ZOOM,
        paint: {
          // Stops must be ascending in zoom; keep radius growing up to the pill threshold.
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 3, LOGO_ZOOM, 8],
          "circle-color": ["get", "color"] as any,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.96,
        },
      });
    }
    // (No plain-text label layer: line numbers only ever appear inside a boxed pill.)

    // High zoom: one baked pill image per (operator, line) — operator code + line number
    // in a single brand-coloured box. Baking the text into the icon (rather than a separate
    // text layer) means overlapping markers stack as whole units instead of their text
    // bleeding across neighbouring boxes.
    if (!map.getLayer("veh-badge")) {
      map.addLayer({
        id: "veh-badge",
        type: "symbol",
        source: "vehicles",
        minzoom: LOGO_ZOOM,
        layout: {
          "icon-image": ["get", "icon"],
          "icon-size": 1,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });
    }
    // Hover layer: redraws just the hovered marker on top (slightly enlarged) so it comes
    // to the front and is fully readable when markers overlap.
    if (!map.getLayer("veh-badge-hover")) {
      map.addLayer({
        id: "veh-badge-hover",
        type: "symbol",
        source: "vehicles",
        minzoom: LOGO_ZOOM,
        filter: ["==", ["get", "id"], hoveredRef.current ?? "__none__"],
        layout: {
          "icon-image": ["get", "icon"],
          "icon-size": 1.14,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });
    }
    // Selected layer: redraws the open-popup marker(s) with an outline, always on top of
    // every other marker (it's the last layer) and never hidden by collision — so a
    // selected marker stays visible and above overlaps until its popup closes.
    if (!map.getLayer("veh-badge-selected")) {
      map.addLayer({
        id: "veh-badge-selected",
        type: "symbol",
        source: "vehicles",
        minzoom: LOGO_ZOOM,
        filter: ["in", ["get", "id"], ["literal", props.selectedIds]],
        layout: {
          "icon-image": ["get", "iconSel"],
          "icon-size": 1,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });
    }

    pushData(map);
    pushRoute(map);
    applyIsolation(map);
  }

  // Isolate mode: hide every non-selected vehicle by filtering the base marker layers
  // down to the selected ids. Purely a GPU-side layer filter — no per-frame JS, so it
  // costs nothing on the hot path. The selection/hover overlays draw the selected
  // marker(s) as usual on top. Off (or with an empty selection) → no filter, all shown.
  function applyIsolation(map: maplibregl.Map) {
    const ids = selectedIdsRef.current;
    const filter =
      isolateRef.current && ids.length > 0
        ? (["in", ["get", "id"], ["literal", ids]] as any)
        : null;
    for (const layer of ["veh-dot", "veh-badge"]) {
      if (map.getLayer(layer)) map.setFilter(layer, filter);
    }
  }

  function pushData(map: maplibregl.Map) {
    const src = map.getSource("vehicles") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    ensureMarkerImages(map, featuresRef.current.values());
    ensureSelectedImages(map, selectedIdsRef.current);
    src.setData(fc());
  }
  // Bake the outlined variant for the currently-selected marker(s), on demand.
  function ensureSelectedImages(map: maplibregl.Map, ids: string[]) {
    for (const id of ids) {
      const f = featuresRef.current.get(id);
      const p = f?.properties as any;
      if (p?.iconSel && !map.hasImage(p.iconSel)) {
        const style: OpStyle = { bg: p.color ?? "#5b6470", fg: p.fg ?? "#ffffff" };
        map.addImage(p.iconSel, makeMarker(p.owner ?? "", p.line ?? "", style, SELECT_OUTLINE), {
          pixelRatio: MARKER_DPR,
        });
      }
    }
  }
  function pushRoute(map: maplibregl.Map) {
    const src = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    // Read from the ref, not props: the map "load" handler that first draws the route
    // captured this function from the first render (routeShape=null then). On a cold
    // shared-link open the shape arrives before the style loads, so the props value in
    // that stale closure would be null — the ref is always current.
    const shape = routeShapeRef.current;
    if (!shape || shape.length < 2) return src.setData(emptyFC());
    src.setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates: shape.map(([lat, lon]) => [lon, lat]) },
      properties: {},
    });
  }

  function fc(): GeoJSON.FeatureCollection {
    return { type: "FeatureCollection", features: [...featuresRef.current.values()] };
  }
  function scheduleFlush() {
    if (dirtyRef.current) return;
    dirtyRef.current = true;
    rafRef.current = requestAnimationFrame(() => {
      dirtyRef.current = false;
      const map = mapRef.current;
      if (map) pushData(map);
      props.onCount(featuresRef.current.size);
      // Push the selected vehicle's latest live data (delay, at-stop, position) to the
      // popup, and follow it if following. A fresh object forces the panel to re-render.
      if (activeIdRef.current) {
        const veh = vehiclesRef.current.get(activeIdRef.current);
        if (veh) {
          props.onSelectedLive({ ...veh });
          if (map && followingRef.current) centerOn(map, veh, 700);
        }
      }
    });
  }

  // --- Map + WS lifecycle (once) ---
  useEffect(() => {
    const saved = getSavedView();
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: withGlyphs(props.theme.style),
      center: saved ? [saved.lng, saved.lat] : NL_CENTER,
      zoom: saved ? saved.zoom : DEFAULT_ZOOM,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as any).__map = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("error", (e) => console.warn("map error", e?.error?.message ?? e));

    // Add vehicle layers once the basemap style is ready, then re-sync the viewport.
    map.on("load", () => {
      ensureLayers(map);
      resync();
    });

    // The live WS is independent of the basemap — connect immediately so data flows
    // even if tiles are slow. Updates buffer into featuresRef and render on style load.
    const client = new LiveClient(
      (import.meta.env.VITE_API_BASE as string) || "http://127.0.0.1:8080",
      undefined,
      {
        onStatus: props.onStatus,
        onUpdate: (u) => {
          if (u.isSnapshot) {
            featuresRef.current.clear();
            vehiclesRef.current.clear();
          }
          for (const v of u.entered) {
            vehiclesRef.current.set(v.id, v);
            featuresRef.current.set(v.id, vehicleFeature(v));
            if (selectedIdsRef.current.includes(v.id)) onSelectedBackRef.current(v);
          }
          for (const m of u.moved) {
            const f = featuresRef.current.get(m.id);
            if (f && f.geometry.type === "Point") {
              f.geometry.coordinates = [m.lon, m.lat];
              (f.properties as any).delay = m.delay;
              (f.properties as any).bearing = m.bearing ?? 0;
            }
            const veh = vehiclesRef.current.get(m.id);
            if (veh) Object.assign(veh, { lat: m.lat, lon: m.lon, delay: m.delay, atStop: m.atStop });
          }
          for (const id of u.left) {
            featuresRef.current.delete(id);
            vehiclesRef.current.delete(id);
            if (selectedIdsRef.current.includes(id)) onSelectedGoneRef.current(id);
          }
          // A snapshot (initial or post-reconnect) replaces state wholesale — no per-vehicle
          // LEAVE events — so reconcile: any selected vehicle absent from it has ended.
          if (u.isSnapshot) {
            for (const id of selectedIdsRef.current) {
              if (!vehiclesRef.current.has(id)) onSelectedGoneRef.current(id);
            }
          }
          scheduleFlush();
        },
      },
    );
    clientRef.current = client;
    if (import.meta.env.DEV) (window as any).__live = client;
    client.connect(boundsToBBox(map), Math.round(map.getZoom()), filtersRef.current);

    // Re-sync viewport when the user pans/zooms or the map is resized; persist location.
    const resync = () => {
      clientRef.current?.update(boundsToBBox(map), Math.round(map.getZoom()), filtersRef.current);
      const c = map.getCenter();
      setSavedView({ lng: c.lng, lat: c.lat, zoom: map.getZoom() });
    };
    map.on("moveend", resync);
    map.on("resize", resync);

    // Click a vehicle → select it. Bound to both marker layers (dot at low zoom,
    // badge at high zoom) so clicks work at every zoom level.
    const onPick = (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (!id) return;
      const veh = vehiclesRef.current.get(id);
      if (veh) centerOn(map, veh, 500);
      onSelectRef.current(id, veh);
    };
    for (const layer of ["veh-dot", "veh-badge", "veh-badge-hover"]) {
      map.on("click", layer, onPick);
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }

    // A genuine user gesture (drag/scroll/pinch) sets `originalEvent`; our own camera
    // moves (easeTo/flyTo while following) do not — so this only detaches on user pans.
    map.on("movestart", (e: any) => {
      if (e.originalEvent && followingRef.current) onDetachRef.current();
    });

    // Bring the hovered badge to the front by redrawing it in the hover layer.
    const setHover = (id: string | null) => {
      if (hoveredRef.current === id) return;
      hoveredRef.current = id;
      if (map.getLayer("veh-badge-hover")) {
        map.setFilter("veh-badge-hover", ["==", ["get", "id"], id ?? "__none__"]);
      }
    };
    map.on("mousemove", "veh-badge", (e) => setHover((e.features?.[0]?.properties?.id as string) ?? null));
    map.on("mouseleave", "veh-badge", () => setHover(null));

    return () => {
      clientRef.current?.close();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme change → swap style, then re-add layers + data.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    map.setStyle(withGlyphs(props.theme.style));
    map.once("styledata", () => ensureLayers(map));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.theme.id]);

  // Filters change → tell the server.
  useEffect(() => {
    const map = mapRef.current;
    if (map && clientRef.current) {
      clientRef.current.update(boundsToBBox(map), Math.round(map.getZoom()), props.filters);
    }
  }, [props.filters]);

  // Selection highlight.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const filter = ["in", ["get", "id"], ["literal", props.selectedIds]] as any;
    if (map.getLayer("veh-selected")) map.setFilter("veh-selected", filter);
    if (map.getLayer("veh-badge-selected")) {
      ensureSelectedImages(map, props.selectedIds);
      map.setFilter("veh-badge-selected", filter);
    }
    applyIsolation(map);
    // Keep selected vehicles streaming even when panned out of view (server-side pin).
    clientRef.current?.setPinned(props.selectedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedIds, props.isolate]);

  // Route shape change. Don't gate on isStyleLoaded() — it flakes false during tile
  // loads/camera moves and would silently drop updates. pushRoute already no-ops if the
  // source isn't there yet (it gets drawn by ensureLayers once the style loads).
  useEffect(() => {
    const map = mapRef.current;
    if (map) pushRoute(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.routeShape]);

  // Re-attach: when following (re-)activates for a selection, recentre immediately.
  useEffect(() => {
    const map = mapRef.current;
    if (map && props.following && props.activeId) {
      const veh = vehiclesRef.current.get(props.activeId);
      if (veh) centerOn(map, veh, 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.following, props.activeId]);

  return <div ref={containerRef} className="maplibregl-map" />;
});

/** Ease the camera to a vehicle, centring it in the map area not covered by the panel. */
function centerOn(map: maplibregl.Map, veh: Vehicle, duration: number) {
  map.easeTo({ center: [veh.lon, veh.lat], offset: panelAwareOffset(map), duration });
}

/**
 * Pixel offset that recentres a target into the portion of the map NOT covered by the open
 * detail panel, so the followed vehicle (or the user's location) isn't hidden behind it.
 * The panel docks to the right on desktop and to the bottom (a sheet) on mobile; we measure
 * whichever is open and shift by half the covered strip. Returns [0,0] when no panel is
 * open — then the target centres on the whole viewport as usual.
 */
function panelAwareOffset(map: maplibregl.Map): [number, number] {
  const panel = document.querySelector<HTMLElement>(".vpanel");
  if (!panel) return [0, 0];
  const c = map.getContainer().getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  // Bottom sheet: spans (nearly) the full width → free area is above it, shift up.
  if (p.width >= c.width * 0.9) {
    const visibleCenterY = (c.top + p.top) / 2; // free area is [c.top, p.top]
    return [0, visibleCenterY - (c.top + c.height / 2)];
  }
  // Right-docked panel → free area is [c.left, p.left], shift left.
  const visibleCenterX = (c.left + p.left) / 2;
  return [visibleCenterX - (c.left + c.width / 2), 0];
}

// --- helpers ---
function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function markerId(owner: string, line: string, color: string): string {
  return `m|${owner}|${line || ""}|${color}`;
}

/** A GTFS 6-hex colour (no '#') → CSS hex; "" / undefined → null. */
function hex(c: string | undefined | null): string | null {
  return c ? `#${c}` : null;
}

function vehicleFeature(v: Vehicle): GeoJSON.Feature {
  // Resolve the operator to display (GTFS brand over the raw dataowner code) so the
  // marker/dot show the public operator, not a masking subcontractor code.
  const op = resolveOperator(v.dataowner, v.operator);
  // Prefer the line's official GTFS colour; fall back to the operator's brand colour.
  const bg = hex(v.lineColor) ?? op.style.bg;
  const fg = hex(v.lineTextColor) ?? op.style.fg;
  const icon = markerId(op.key, v.line, bg);
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [v.lon, v.lat] },
    properties: {
      id: v.id,
      line: v.line,
      owner: op.label,
      color: bg,
      fg,
      type: v.type,
      delay: v.delay,
      bearing: v.bearing ?? 0,
      icon,
      iconSel: `${icon}|sel`,
    },
  };
}

/** Ensure a glyphs endpoint so text labels render on every theme (incl. raster OSM). */
function withGlyphs(style: MapTheme["style"]): any {
  if (typeof style === "string") return style; // remote styles bring their own glyphs
  return { ...style, glyphs: GLYPHS };
}

const MARKER_DPR = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 2;
// Accent ring drawn around a selected (open-popup) marker.
const SELECT_OUTLINE = "#0071e3";

/**
 * Bake a whole marker into one image: a brand-coloured rounded pill with the operator
 * code (dimmed) and the line number (bold) side by side. Because the text lives inside
 * the icon, overlapping markers stack cleanly instead of their labels bleeding together.
 * When `outline` is set, an accent ring is drawn hugging the pill (the selected variant).
 */
function makeMarker(owner: string, line: string, style: OpStyle, outline?: string): ImageData {
  const dpr = MARKER_DPR;
  const fontOwner = `600 11px -apple-system, system-ui, "Segoe UI", sans-serif`;
  const fontLine = `700 13px -apple-system, system-ui, "Segoe UI", sans-serif`;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = fontOwner;
  const wOwner = measure.measureText(owner).width;
  measure.font = fontLine;
  const wLine = line ? measure.measureText(line).width : 0;

  const padX = 8;
  const gap = line && owner ? 5 : 0;
  const H = 22;
  const R = 7;
  const W = Math.ceil(padX * 2 + wOwner + gap + wLine);
  const M = outline ? 4 : 0; // margin for the selection ring

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((W + 2 * M) * dpr);
  canvas.height = Math.ceil((H + 2 * M) * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.translate(M, M);

  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, W - 1, H - 1, R);
  ctx.fillStyle = style.bg;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Selection ring, just outside the pill's white border (its own white stroke keeps it
  // legible against any pill colour).
  if (outline) {
    ctx.beginPath();
    ctx.roundRect(-1.5, -1.5, W + 3, H + 3, R + 1.5);
    ctx.strokeStyle = outline;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let x = padX;
  if (owner) {
    ctx.globalAlpha = 0.8;
    ctx.font = fontOwner;
    ctx.fillStyle = style.fg;
    ctx.fillText(owner, x, H / 2 + 0.5);
    x += wOwner + gap;
    ctx.globalAlpha = 1;
  }
  if (line) {
    ctx.font = fontLine;
    ctx.fillStyle = style.fg;
    ctx.fillText(line, x, H / 2 + 0.5);
  }

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Lazily create any marker images referenced by the given features (idempotent). */
function ensureMarkerImages(map: maplibregl.Map, features: Iterable<GeoJSON.Feature>) {
  for (const f of features) {
    const p = f.properties as any;
    if (p?.icon && !map.hasImage(p.icon)) {
      const style: OpStyle = { bg: p.color ?? "#5b6470", fg: p.fg ?? "#ffffff" };
      map.addImage(p.icon, makeMarker(p.owner ?? "", p.line ?? "", style), {
        pixelRatio: MARKER_DPR,
      });
    }
  }
}
