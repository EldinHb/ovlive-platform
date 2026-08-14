import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import {
  LiveClient,
  RestClient,
  type BBox,
  type ConnStatus,
  type FilterState,
  type StopSummary,
  type Vehicle,
} from "@ovlive/api-types";
import { markerPalette, type MapTheme, type MarkerPalette } from "../lib/styles";
import { resolveOperator } from "../lib/format";
import { API_BASE, DEFAULT_ZOOM, NL_CENTER, getSavedView, setSavedView } from "../lib/config";

export interface MapHandle {
  locate: () => void;
  flyTo: (lon: number, lat: number, zoom?: number) => void;
  /** Recentre on a point at the current zoom, clear of whichever panel is open. */
  panTo: (lon: number, lat: number) => void;
}

interface Props {
  theme: MapTheme;
  filters: FilterState;
  activeId: string | null;
  selectedIds: string[];
  isolate: boolean;
  following: boolean;
  /** Draw the GTFS stop layer (only visible from STOPS_ZOOM); off hides it entirely. */
  showStops: boolean;
  /** Stop whose departure board is open — highlighted on the map. */
  selectedStopId: string | null;
  routeShape: [number, number][] | null;
  onSelectStop: (stopId: string) => void;
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
// Fontstack served by GLYPHS — and by the remote VersaTiles styles, which use the same
// endpoint, so one name works on every theme.
const LABEL_FONT = ["noto_sans_regular"];
// Zoom at which markers switch from a coloured dot to the boxed operator+line pill.
const LOGO_ZOOM = 11;

// Stops only appear once the viewport is small enough for them to be legible (and for the
// bbox query to stay cheap — the server rejects boxes over 1 deg²). Names come in later still.
const STOPS_ZOOM = 14;
const STOP_LABEL_ZOOM = 15.5;
const STOPS_LIMIT = 800;
// Fetch a box 35% larger than the view on each side, so small pans need no new request.
const STOPS_PAD = 0.35;

function boundsToBBox(map: maplibregl.Map): BBox {
  const b = map.getBounds();
  return {
    minLat: b.getSouth(),
    minLon: b.getWest(),
    maxLat: b.getNorth(),
    maxLon: b.getEast(),
  };
}

function padBBox(b: BBox, f: number): BBox {
  const dLat = (b.maxLat - b.minLat) * f;
  const dLon = (b.maxLon - b.minLon) * f;
  return {
    minLat: b.minLat - dLat,
    minLon: b.minLon - dLon,
    maxLat: b.maxLat + dLat,
    maxLon: b.maxLon + dLon,
  };
}

/** Is `view` fully inside the already-fetched box `have`? */
function covers(have: BBox | null, view: BBox): boolean {
  return (
    !!have &&
    have.minLat <= view.minLat &&
    have.minLon <= view.minLon &&
    have.maxLat >= view.maxLat &&
    have.maxLon >= view.maxLon
  );
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
  // Stop layer: the last fetched features, the box they cover, and the in-flight request.
  const stopsRef = useRef<GeoJSON.FeatureCollection>(emptyFC());
  const stopsBoxRef = useRef<BBox | null>(null);
  const stopsAbortRef = useRef<AbortController>();
  const rest = useMemo(() => new RestClient(API_BASE), []);
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
  const showStopsRef = useRef(props.showStops);
  showStopsRef.current = props.showStops;
  const selectedStopRef = useRef(props.selectedStopId);
  selectedStopRef.current = props.selectedStopId;
  const onSelectStopRef = useRef(props.onSelectStop);
  onSelectStopRef.current = props.onSelectStop;
  const themeRef = useRef(props.theme);
  themeRef.current = props.theme;
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
    panTo(lon, lat) {
      const map = mapRef.current;
      if (map) map.easeTo({ center: [lon, lat], offset: panelAwareOffset(map), duration: 600 });
    },
  }));

  // Build the (empty) stop + vehicle + route layers. Re-run after every style load.
  // Stops go in first so vehicles always draw on top of them.
  function ensureLayers(map: maplibregl.Map) {
    ensureStopLayers(map);
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
    // Low zoom (below LOGO_ZOOM): a neutral dot, the same for every vehicle, tinted to the
    // theme (see markerPalette).
    if (!map.getLayer("veh-dot")) {
      const pal = markerPalette(themeRef.current.dark);
      map.addLayer({
        id: "veh-dot",
        type: "circle",
        source: "vehicles",
        maxzoom: LOGO_ZOOM,
        paint: {
          // Stops must be ascending in zoom; keep radius growing up to the pill threshold.
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 3, LOGO_ZOOM, 8],
          "circle-color": pal.bg,
          // The pill's translucent border, scaled down to a few pixels, leaves the dot looking
          // washed out — a dot gets the full-strength text tone as its ring instead.
          "circle-stroke-color": pal.fg,
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.96,
        },
      });
    } else {
      // The layer outlived the style swap — re-tint it in place.
      const pal = markerPalette(themeRef.current.dark);
      map.setPaintProperty("veh-dot", "circle-color", pal.bg);
      map.setPaintProperty("veh-dot", "circle-stroke-color", pal.fg);
    }
    // (No plain-text label layer: line numbers only ever appear inside a boxed pill.)

    // High zoom: one baked pill image per (operator, line, theme tone) — operator code + line
    // number in a single neutral box. Baking the text into the icon (rather than a separate
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

  // --- Stop layer ---
  // Stops are static (they change only when the daily GTFS feed swaps), so they come from a
  // plain REST bbox query rather than the live stream, and are re-fetched only when the user
  // pans outside the padded box already loaded.
  function ensureStopLayers(map: maplibregl.Map) {
    const dark = themeRef.current.dark;
    if (!map.getSource("stops")) {
      map.addSource("stops", { type: "geojson", data: stopsRef.current });
    }
    // Halo behind the stop whose board is open, so the panel and the map agree on which of
    // several quays sharing a name is being shown.
    if (!map.getLayer("stops-selected")) {
      map.addLayer({
        id: "stops-selected",
        type: "circle",
        source: "stops",
        minzoom: STOPS_ZOOM,
        // Set immediately after, from the ref — this closure may predate the current selection.
        filter: ["==", ["get", "stopId"], "__none__"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], STOPS_ZOOM, 8, 17, 13],
          "circle-color": "#0071e3",
          "circle-opacity": 0.28,
        },
      });
    }
    if (!map.getLayer("stops-dot")) {
      map.addLayer({
        id: "stops-dot",
        type: "circle",
        source: "stops",
        minzoom: STOPS_ZOOM,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], STOPS_ZOOM, 2.5, 17, 5],
          // A hollow ring, so a stop never reads as a (solid) vehicle dot.
          "circle-color": dark ? "#12161b" : "#ffffff",
          "circle-stroke-color": dark ? "#9aa3ad" : "#4a5561",
          "circle-stroke-width": 1.4,
        },
      });
    }
    if (!map.getLayer("stops-label")) {
      map.addLayer({
        id: "stops-label",
        type: "symbol",
        source: "stops",
        minzoom: STOP_LABEL_ZOOM,
        layout: {
          "text-field": ["get", "name"],
          "text-font": LABEL_FONT,
          "text-size": 11,
          "text-anchor": "left",
          "text-offset": [0.6, 0],
          "text-max-width": 12,
          // Default collision handling applies: where stops crowd together the surplus labels
          // are simply not placed, while every dot stays drawn (dots are their own layer).
          "text-padding": 3,
        },
        paint: {
          "text-color": dark ? "#e6e9ee" : "#2b3038",
          "text-halo-color": dark ? "rgba(0,0,0,.75)" : "rgba(255,255,255,.9)",
          "text-halo-width": 1.2,
        },
      });
    }
    applyStopsVisibility(map);
    applyStopSelection(map);
  }

  function applyStopsVisibility(map: maplibregl.Map) {
    const vis = showStopsRef.current ? "visible" : "none";
    for (const layer of ["stops-selected", "stops-dot", "stops-label"]) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", vis);
    }
  }

  function applyStopSelection(map: maplibregl.Map) {
    if (map.getLayer("stops-selected")) {
      map.setFilter("stops-selected", ["==", ["get", "stopId"], selectedStopRef.current ?? "__none__"]);
    }
  }

  function pushStops(map: maplibregl.Map) {
    const src = map.getSource("stops") as maplibregl.GeoJSONSource | undefined;
    src?.setData(stopsRef.current);
  }

  async function loadStops(map: maplibregl.Map) {
    if (!showStopsRef.current || map.getZoom() < STOPS_ZOOM) return;
    const view = boundsToBBox(map);
    if (covers(stopsBoxRef.current, view)) return;

    stopsAbortRef.current?.abort();
    const ac = new AbortController();
    stopsAbortRef.current = ac;
    const box = padBBox(view, STOPS_PAD);
    try {
      const res = await rest.stopsInViewport(box, STOPS_LIMIT, ac.signal);
      stopsRef.current = {
        type: "FeatureCollection",
        features: res.stops.map(stopFeature),
      };
      // A truncated result holds only the stops nearest the centre, so it cannot be treated
      // as covering the box — leave the coverage unset and re-ask on the next move.
      stopsBoxRef.current = res.truncated ? null : box;
      pushStops(map);
    } catch {
      // Aborted by a newer request, offline, or the index isn't built yet (503 right after a
      // server restart): keep whatever is drawn and try again on the next move.
    }
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
    const pal = markerPalette(themeRef.current.dark);
    ensureMarkerImages(map, featuresRef.current.values(), pal);
    ensureSelectedImages(map, selectedIdsRef.current, pal);
    src.setData(fc());
  }
  // Bake the outlined variant for the currently-selected marker(s), on demand.
  function ensureSelectedImages(map: maplibregl.Map, ids: string[], pal: MarkerPalette) {
    for (const id of ids) {
      const f = featuresRef.current.get(id);
      const p = f?.properties as any;
      if (p?.iconSel && !map.hasImage(p.iconSel)) {
        map.addImage(p.iconSel, makeMarker(p.owner ?? "", p.line ?? "", pal, SELECT_OUTLINE), {
          pixelRatio: MARKER_DPR,
        });
      }
    }
  }

  /**
   * Re-point every marker feature at the icon variant for the current theme. Marker images are
   * baked per theme tone and keyed by it, so a light↔dark switch has to rewrite the feature's
   * icon name — the images themselves are then baked lazily by pushData.
   */
  function retintMarkers() {
    const dark = themeRef.current.dark;
    for (const f of featuresRef.current.values()) {
      const p = f.properties as any;
      const icon = markerId(p.owner ?? "", p.line ?? "", dark);
      p.icon = icon;
      p.iconSel = `${icon}|sel`;
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

    // Declared before the "style.load" handler that calls it: an inline style object (the raster
    // OSM theme) is current almost immediately, so that handler can run far earlier than the old
    // "load" one ever did — early enough to hit this binding's temporal dead zone.
    const resync = () => {
      clientRef.current?.update(boundsToBBox(map), Math.round(map.getZoom()), filtersRef.current);
      const c = map.getCenter();
      setSavedView({ lng: c.lng, lat: c.lat, zoom: map.getZoom() });
      void loadStops(map);
    };

    // Add vehicle layers as soon as the style is current, then re-sync the viewport.
    //
    // "style.load", never "load". `load` waits for the stylesheet *and* for the basemap's own
    // tile source to report ready; it also fires at most once. So when the third-party basemap
    // host is slow or unreachable — a browser content blocker filtering tiles.versatiles.org is
    // the common case — it never arrives, ensureLayers never runs, and the vehicle/stop/route
    // layers are never created at all. That turns a degraded basemap into a total blackout and
    // makes the promise two lines below ("data flows even if tiles are slow") false: the stream
    // kept filling featuresRef and the header kept counting, with nothing to draw into.
    // `style.load` needs only the stylesheet, which is all ensureLayers depends on, and is the
    // signal the theme swap already trusted — so a theme change re-adds the layers through here.
    map.on("style.load", () => {
      ensureLayers(map);
      resync();
    });

    // The live WS is independent of the basemap — connect immediately so data flows
    // even if tiles are slow. Updates buffer into featuresRef and render on style load.
    const client = new LiveClient(
      API_BASE,
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
            featuresRef.current.set(v.id, vehicleFeature(v, themeRef.current.dark));
            if (selectedIdsRef.current.includes(v.id)) onSelectedBackRef.current(v);
          }
          for (const m of u.moved) {
            const f = featuresRef.current.get(m.id);
            if (f && f.geometry.type === "Point") {
              f.geometry.coordinates = [m.lon, m.lat];
              (f.properties as any).delay = m.delay;
              (f.properties as any).delayKnown = m.delayKnown;
              (f.properties as any).bearing = m.bearing ?? 0;
            }
            const veh = vehiclesRef.current.get(m.id);
            if (veh)
              Object.assign(veh, {
                lat: m.lat,
                lon: m.lon,
                delay: m.delay,
                delayKnown: m.delayKnown,
                atStop: m.atStop,
              });
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

    // Click a stop → open its departure board. Vehicle markers draw above the stop layer, so
    // a marker sitting on top of a stop must win the click rather than firing both handlers.
    const VEHICLE_LAYERS = ["veh-dot", "veh-badge", "veh-badge-hover", "veh-badge-selected"];
    const onPickStop = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const id = f?.properties?.stopId as string | undefined;
      if (!id) return;
      const layers = VEHICLE_LAYERS.filter((l) => map.getLayer(l));
      if (map.queryRenderedFeatures(e.point, { layers }).length > 0) return;
      if (f?.geometry.type === "Point") {
        const [lon, lat] = f.geometry.coordinates as [number, number];
        map.easeTo({ center: [lon, lat], offset: panelAwareOffset(map), duration: 400 });
      }
      onSelectStopRef.current(id);
    };
    for (const layer of ["stops-dot", "stops-label"]) {
      map.on("click", layer, onPickStop);
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
      stopsAbortRef.current?.abort();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme change → swap style, then re-add layers + data. Markers are tinted to the theme, so
  // they have to be re-keyed onto the new tone's icon variant before the layers come back.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    retintMarkers();
    // `diff: false` forces a full style reload, and with it exactly one "style.load" — the only
    // signal that reliably means "the new style is now current, add your layers to it".
    // Diffing (the default) removes our sources and layers, because they are in the outgoing
    // style and in no incoming one, and then fires neither "style.load" nor a usable
    // "styledata" — leaving a fresh basemap with no vehicles, stops or route until a reload.
    // The persistent "style.load" handler registered on mount re-adds the layers, so there is
    // no per-swap listener here — one handler, one place that builds them.
    map.setStyle(withGlyphs(props.theme.style), { diff: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.theme.id]);

  // Stops toggled: hide/show the layers (the data stays cached), and fill them on first use.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyStopsVisibility(map);
    if (props.showStops) void loadStops(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.showStops]);

  // Highlight the stop whose board is open.
  useEffect(() => {
    const map = mapRef.current;
    if (map) applyStopSelection(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedStopId]);

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
      ensureSelectedImages(map, props.selectedIds, markerPalette(props.theme.dark));
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

/** Icon key: the pill's content plus the theme tone it was baked for. */
function markerId(owner: string, line: string, dark: boolean): string {
  return `m|${owner}|${line || ""}|${dark ? "d" : "l"}`;
}

function vehicleFeature(v: Vehicle, dark: boolean): GeoJSON.Feature {
  // Resolve the operator to display (GTFS brand over the raw dataowner code) so the
  // marker/dot show the public operator, not a masking subcontractor code.
  const op = resolveOperator(v.dataowner, v.operator);
  // No brand colour here: line/operator colours are for the panels, markers are uniform.
  const icon = markerId(op.label, v.line, dark);
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [v.lon, v.lat] },
    properties: {
      id: v.id,
      line: v.line,
      owner: op.label,
      type: v.type,
      delay: v.delay,
      delayKnown: v.delayKnown,
      bearing: v.bearing ?? 0,
      icon,
      iconSel: `${icon}|sel`,
    },
  };
}

function stopFeature(s: StopSummary): GeoJSON.Feature {
  // gtfs-nl names stops "<place>, <stop>" ("Amsterdam, Rokin"). At the zoom where labels
  // appear the place is obvious from the basemap, and repeating it on every dot wraps most
  // labels onto two lines — so drop it. Station names carry no comma and are left alone.
  const short = s.name.replace(/^[^,]+,\s*/, "");
  // Big interchanges have many quays sharing one name; the platform code is what actually
  // distinguishes them, when the feed has one.
  const name = s.platform_code ? `${short} ${s.platform_code}` : short;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    properties: { stopId: s.stop_id, name },
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
 * Bake a whole marker into one image: a neutral rounded pill with the operator code (dimmed)
 * and the line number (bold) side by side. Because the text lives inside the icon, overlapping
 * markers stack cleanly instead of their labels bleeding together. When `outline` is set, an
 * accent ring is drawn hugging the pill (the selected variant).
 */
function makeMarker(owner: string, line: string, pal: MarkerPalette, outline?: string): ImageData {
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
  ctx.fillStyle = pal.bg;
  ctx.fill();
  ctx.strokeStyle = pal.stroke;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Selection ring, just outside the pill's border.
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
    ctx.fillStyle = pal.fg;
    ctx.fillText(owner, x, H / 2 + 0.5);
    x += wOwner + gap;
    ctx.globalAlpha = 1;
  }
  if (line) {
    ctx.font = fontLine;
    ctx.fillStyle = pal.fg;
    ctx.fillText(line, x, H / 2 + 0.5);
  }

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Lazily create any marker images referenced by the given features (idempotent). */
function ensureMarkerImages(
  map: maplibregl.Map,
  features: Iterable<GeoJSON.Feature>,
  pal: MarkerPalette,
) {
  for (const f of features) {
    const p = f.properties as any;
    if (p?.icon && !map.hasImage(p.icon)) {
      map.addImage(p.icon, makeMarker(p.owner ?? "", p.line ?? "", pal), {
        pixelRatio: MARKER_DPR,
      });
    }
  }
}
