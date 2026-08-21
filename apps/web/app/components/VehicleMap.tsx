// The vehicle page's map: one vehicle, its route and its scheduled calls.
//
// Deliberately not MapView. That component's job is the viewport — a live bbox subscription,
// baked marker images per (operator, line, theme), a stop layer fetched per pan, isolate/hover
// filters — and none of it applies to a page that draws a single known vehicle. This draws the
// three things the page has and nothing else, and keeps the map's remembered view untouched
// (`setSavedView` is MapView's, so opening a vehicle page can't move where the map opens next).

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { TripStop } from "@ovlive/api-types";
import { NL_CENTER } from "../lib/config";
import {
  LABEL_FONT,
  markerPalette,
  tripStopPalette,
  tripStopRadius,
  withGlyphs,
  type MapTheme,
} from "../lib/styles";
import { tripStopFeatures } from "../lib/trip";

/** Close enough to read the street the vehicle is on, wide enough to see the next stops. */
const DETAIL_ZOOM = 14;
/** Stop names would pile up on a long-distance route below this. */
const STOP_LABEL_ZOOM = 12.5;

export interface MapVehicle {
  lat: number;
  lon: number;
  /** Operator code and line number, as they appear on the map's own markers. */
  owner: string;
  line: string;
}

interface Props {
  theme: MapTheme;
  /** Null until the first position (live frame or REST detail) arrives. */
  vehicle: MapVehicle | null;
  routeShape: [number, number][] | null;
  /** Every scheduled call on the trip, drawn as numbered dots along the route. */
  stops: TripStop[];
  /**
   * Index of the first call the vehicle still has to make (`vehicleView().upcomingFrom`) —
   * those are highlighted, the ones behind it are muted. Passed in rather than derived so the
   * page's panel and its map always agree on where the vehicle is in its trip.
   */
  upcomingFrom: number;
  /** Number those dots (see `settings.stopNums`); off leaves the dots and their highlight. */
  stopNumbers: boolean;
  /** Keep the camera on the vehicle. Cleared by `onDetach` as soon as the user pans away. */
  following: boolean;
  onDetach: () => void;
}

export function VehicleMap({
  theme,
  vehicle,
  routeShape,
  stops,
  upcomingFrom,
  stopNumbers,
  following,
  onDetach,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map>();
  const markerRef = useRef<maplibregl.Marker>();
  const markerElRef = useRef<HTMLDivElement>();
  /** Has the camera been put on the vehicle at least once? The first fix jumps, the rest ease. */
  const centeredRef = useRef(false);
  // Always-current copies, for the map event handlers and the style.load closure.
  const vehicleRef = useRef(vehicle);
  vehicleRef.current = vehicle;
  const routeRef = useRef(routeShape);
  routeRef.current = routeShape;
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  const upcomingFromRef = useRef(upcomingFrom);
  upcomingFromRef.current = upcomingFrom;
  const stopNumbersRef = useRef(stopNumbers);
  stopNumbersRef.current = stopNumbers;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const followingRef = useRef(following);
  followingRef.current = following;
  const onDetachRef = useRef(onDetach);
  onDetachRef.current = onDetach;

  /** (Re)build our layers on top of whichever basemap style is current. */
  function ensureLayers(map: maplibregl.Map) {
    const dark = themeRef.current.dark;
    if (!map.getSource("route")) map.addSource("route", { type: "geojson", data: emptyFC() });
    if (!map.getSource("trip-stops")) map.addSource("trip-stops", { type: "geojson", data: emptyFC() });
    if (!map.getLayer("route-line")) {
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-color": "#0071e3", "line-width": 5, "line-opacity": 0.7 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
    }
    // Numbered dots: solid accent for the calls still ahead, hollow and muted for the ones
    // already served. Same palette and thresholds as the map's own trip-stop layer.
    const pal = tripStopPalette(dark);
    if (!map.getLayer("trip-stops-dot")) {
      map.addLayer({
        id: "trip-stops-dot",
        type: "circle",
        source: "trip-stops",
        paint: {
          // Big enough from STOP_LABEL_ZOOM up to hold two digits; a plain dot below it. The
          // preference may shrink it again — applyStopNumbers owns that.
          "circle-radius": tripStopRadius(true, STOP_LABEL_ZOOM) as any,
          "circle-color": ["case", ["get", "upcoming"], pal.accent, pal.bg],
          "circle-stroke-color": ["case", ["get", "upcoming"], pal.bg, pal.muted],
          "circle-stroke-width": 1.5,
          "circle-opacity": ["case", ["get", "upcoming"], 1, 0.85],
        },
      });
    }
    if (!map.getLayer("trip-stops-num")) {
      map.addLayer({
        id: "trip-stops-num",
        type: "symbol",
        source: "trip-stops",
        minzoom: STOP_LABEL_ZOOM,
        layout: {
          "text-field": ["get", "n"],
          "text-font": LABEL_FONT,
          "text-size": ["interpolate", ["linear"], ["zoom"], STOP_LABEL_ZOOM, 9, 16, 11],
          // The number belongs to its dot — a dropped one would read as a different kind of
          // stop rather than as a crowded label.
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": ["case", ["get", "upcoming"], pal.onAccent, pal.muted],
        },
      });
    }
    if (!map.getLayer("trip-stops-label")) {
      map.addLayer({
        id: "trip-stops-label",
        type: "symbol",
        source: "trip-stops",
        minzoom: STOP_LABEL_ZOOM,
        layout: {
          "text-field": ["get", "name"],
          "text-font": LABEL_FONT,
          "text-size": 11,
          "text-anchor": "left",
          // Clear of the dot, which is wide enough to hold the stop's number — unless the
          // numbers are off, which applyStopNumbers takes back in.
          "text-offset": [1.3, 0],
          "text-max-width": 12,
          "text-padding": 3,
        },
        paint: {
          // Stops already served step back so the ones still to come lead the eye.
          "text-color": ["case", ["get", "upcoming"], dark ? "#e6e9ee" : "#2b3038", pal.muted],
          "text-halo-color": dark ? "rgba(0,0,0,.75)" : "rgba(255,255,255,.9)",
          "text-halo-width": 1.2,
        },
      });
    }
    applyStopNumbers(map);
    pushRoute(map);
    pushStops(map);
  }

  /**
   * The numbers are a preference, shared with the map's own trip-stop layer (see the identical
   * function in MapView): with them off the number layer goes, the dot shrinks to a plain
   * marker, and the stop's name moves back in beside it. The ahead/served highlight stays —
   * that is where the vehicle is, not how the stops are labelled.
   */
  function applyStopNumbers(map: maplibregl.Map) {
    const on = stopNumbersRef.current;
    if (map.getLayer("trip-stops-dot")) {
      map.setPaintProperty("trip-stops-dot", "circle-radius", tripStopRadius(on, STOP_LABEL_ZOOM));
    }
    if (map.getLayer("trip-stops-num")) {
      map.setLayoutProperty("trip-stops-num", "visibility", on ? "visible" : "none");
    }
    if (map.getLayer("trip-stops-label")) {
      map.setLayoutProperty("trip-stops-label", "text-offset", on ? [1.3, 0] : [0.7, 0]);
    }
  }

  function pushRoute(map: maplibregl.Map) {
    const src = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const shape = routeRef.current;
    if (!shape || shape.length < 2) return src.setData(emptyFC());
    src.setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates: shape.map(([lat, lon]) => [lon, lat]) },
      properties: {},
    });
  }

  function pushStops(map: maplibregl.Map) {
    const src = map.getSource("trip-stops") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(tripStopFeatures(stopsRef.current, upcomingFromRef.current));
  }

  // --- Map lifecycle (once) ---
  useEffect(() => {
    const start = vehicleRef.current;
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: withGlyphs(themeRef.current.style),
      center: start ? [start.lon, start.lat] : NL_CENTER,
      zoom: DETAIL_ZOOM,
      attributionControl: { compact: true },
    });
    if (start) centeredRef.current = true;
    mapRef.current = map;
    if (import.meta.env.DEV) (window as any).__map = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("error", (e) => console.warn("map error", e?.error?.message ?? e));

    // "style.load", not "load": `load` also waits for the basemap's tiles, so a blocked or slow
    // tile host would mean the route and the vehicle are never drawn at all. See MapView.
    map.on("style.load", () => ensureLayers(map));

    // A genuine user gesture sets `originalEvent`; our own easeTo/jumpTo do not — so following
    // is only dropped when the user actually takes the camera somewhere.
    map.on("movestart", (e: any) => {
      if (e.originalEvent && followingRef.current) onDetachRef.current();
    });

    return () => {
      markerRef.current?.remove();
      markerRef.current = undefined;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme swap → full style reload; the persistent "style.load" handler re-adds our layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    map.setStyle(withGlyphs(theme.style), { diff: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme.id]);

  // The vehicle marker is a DOM element rather than a symbol layer: there is exactly one, so
  // there is nothing to batch, and it survives style swaps untouched.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !vehicle) return;
    if (!markerElRef.current) {
      const el = document.createElement("div");
      el.className = "vmark";
      markerElRef.current = el;
    }
    const pal = markerPalette(theme.dark);
    const el = markerElRef.current;
    el.style.background = pal.bg;
    el.style.color = pal.fg;
    el.style.borderColor = pal.stroke;
    el.textContent = "";
    if (vehicle.owner) {
      const owner = document.createElement("span");
      owner.className = "vmark-owner";
      owner.textContent = vehicle.owner;
      el.append(owner);
    }
    if (vehicle.line) {
      const line = document.createElement("span");
      line.className = "vmark-line";
      line.textContent = vehicle.line;
      el.append(line);
    }
    if (!markerRef.current) markerRef.current = new maplibregl.Marker({ element: el });
    markerRef.current.setLngLat([vehicle.lon, vehicle.lat]).addTo(map);

    if (!centeredRef.current) {
      // First fix: the map opened on the country centre, and flying there from Amsterdam to
      // Groningen would be a several-second animation over nothing.
      map.jumpTo({ center: [vehicle.lon, vehicle.lat], zoom: DETAIL_ZOOM });
      centeredRef.current = true;
    } else if (following) {
      map.easeTo({ center: [vehicle.lon, vehicle.lat], duration: 700 });
    }
  }, [vehicle, following, theme.dark]);

  // Re-centre the moment following is switched back on, without waiting for the next fix.
  useEffect(() => {
    const map = mapRef.current;
    const v = vehicleRef.current;
    if (map && following && v) map.easeTo({ center: [v.lon, v.lat], zoom: DETAIL_ZOOM, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following]);

  // Route + stops arrive once the trip plan loads (and again if the vehicle changes trip).
  // Not gated on isStyleLoaded(): it flakes false during tile loads, and both pushers no-op
  // until ensureLayers has created their sources.
  useEffect(() => {
    const map = mapRef.current;
    if (map) pushRoute(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeShape]);
  // `upcomingFrom` is a number, so this redraws when the vehicle passes a stop — not on every
  // one of the page's per-second re-renders.
  useEffect(() => {
    const map = mapRef.current;
    if (map) pushStops(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, upcomingFrom]);
  useEffect(() => {
    const map = mapRef.current;
    if (map) applyStopNumbers(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopNumbers]);

  return <div ref={containerRef} className="maplibregl-map" />;
}

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
