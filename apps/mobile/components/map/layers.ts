// The layer definitions both maps draw, ported from the web's MapView/VehicleMap so the same
// thresholds and palettes hold everywhere. Expressed in MapLibre style-spec form, which is what
// @maplibre/maplibre-react-native's <Layer> takes verbatim.
import type { LayerProps } from "@maplibre/maplibre-react-native";
import { LABEL_FONT, markerPalette, tripStopPalette, tripStopRadius } from "@ovlive/shared";

/** Zoom at which markers switch from a neutral dot to the operator+line pill. */
export const LOGO_ZOOM = 11;
/** Stops appear once the viewport is small enough for them to be legible (and for the bbox
 * query to stay cheap — the server rejects boxes over 1 deg²). Names come in later still. */
export const STOPS_ZOOM = 14;
export const STOP_LABEL_ZOOM = 15.5;
export const STOPS_LIMIT = 800;
/** Fetch a box 35% larger than the view on each side, so small pans need no new request. */
export const STOPS_PAD = 0.35;
/** The selected trip's stops carry their number from this zoom up; below it consecutive city
 * stops would smear into each other, so only the (highlighted) dots are drawn. */
export const TRIP_NUM_ZOOM = 12.5;

export const ACCENT = "#0071e3";

/**
 * Icon key of a feature's baked pill (see lib/markerImages.ts): content plus tone, so a
 * light/dark switch re-points every marker at the other tone's image by changing the layer.
 */
function pillKey(dark: boolean, selected: boolean): any {
  return ["concat", "m|", ["get", "owner"], "|", ["get", "line"], dark ? "|d" : "|l", selected ? "|sel" : ""];
}

/** Low zoom: a neutral dot, the same for every vehicle, tinted to the basemap tone. */
export function vehicleDotLayer(source: string, dark: boolean, filter?: any): LayerProps {
  const pal = markerPalette(dark);
  return {
    id: `${source}-dot`,
    type: "circle",
    source,
    maxzoom: LOGO_ZOOM,
    ...(filter ? { filter } : {}),
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 3, LOGO_ZOOM, 8] as any,
      "circle-color": pal.bg,
      // A dot's ring is the full text tone: the pill's translucent border scaled down to a
      // few pixels leaves the dot looking washed out.
      "circle-stroke-color": pal.fg,
      "circle-stroke-width": 1.5,
      "circle-opacity": 0.96,
    },
  } as LayerProps;
}

/** High zoom: the operator+line pill. `selected` draws the accent ring variant, always on top. */
export function vehicleBadgeLayer(source: string, dark: boolean, opts: { selected?: boolean; filter?: any } = {}): LayerProps {
  return {
    id: `${source}-badge${opts.selected ? "-selected" : ""}`,
    type: "symbol",
    source,
    minzoom: LOGO_ZOOM,
    ...(opts.filter ? { filter: opts.filter } : {}),
    layout: {
      "icon-image": pillKey(dark, !!opts.selected),
      // Baked at 2× (lib/markerImages.ts), so drawn at half size for a crisp pill.
      "icon-size": 0.5,
      // Overlapping markers stack as whole pills, never culled: a hidden vehicle would be a
      // vehicle the count says is there but the map doesn't show.
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  } as LayerProps;
}

export function routeLineLayer(source: string): LayerProps {
  return {
    id: `${source}-line`,
    type: "line",
    source,
    paint: { "line-color": ACCENT, "line-width": 5, "line-opacity": 0.7 },
    layout: { "line-cap": "round", "line-join": "round" },
  } as LayerProps;
}

/**
 * The numbered dots along a selected vehicle's trip: solid accent for the calls still ahead,
 * a hollow muted dot for the ones already served. `numbered` is the "stop numbers" setting —
 * off, the number layer is hidden and the dot shrinks back to a plain marker.
 */
export function tripStopLayers(source: string, dark: boolean, numbered: boolean, numZoom = TRIP_NUM_ZOOM): LayerProps[] {
  const pal = tripStopPalette(dark);
  return [
    {
      id: `${source}-dot`,
      type: "circle",
      source,
      paint: {
        "circle-radius": tripStopRadius(numbered, numZoom) as any,
        "circle-color": ["case", ["get", "upcoming"], pal.accent, pal.bg] as any,
        "circle-stroke-color": ["case", ["get", "upcoming"], pal.bg, pal.muted] as any,
        "circle-stroke-width": 1.5,
        "circle-opacity": ["case", ["get", "upcoming"], 1, 0.85] as any,
      },
    } as LayerProps,
    {
      id: `${source}-num`,
      type: "symbol",
      source,
      minzoom: numZoom,
      layout: {
        "text-field": ["get", "n"] as any,
        "text-font": LABEL_FONT,
        "text-size": ["interpolate", ["linear"], ["zoom"], numZoom, 9, 16, 11] as any,
        // The number belongs to its dot: dropping it on collision would leave blank dots
        // among numbered ones, reading as two kinds of stop rather than one crowded label.
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        visibility: numbered ? "visible" : "none",
      },
      paint: { "text-color": ["case", ["get", "upcoming"], pal.onAccent, pal.muted] as any },
    } as LayerProps,
  ];
}

/** Stop names beside the trip dots, on the detail map only (the live map has the stop layer). */
export function tripStopNameLayer(source: string, dark: boolean): LayerProps {
  return {
    id: `${source}-name`,
    type: "symbol",
    source,
    minzoom: STOP_LABEL_ZOOM,
    layout: {
      "text-field": ["get", "name"] as any,
      "text-font": LABEL_FONT,
      "text-size": 11,
      "text-anchor": "left",
      "text-offset": [1.1, 0],
      "text-max-width": 12,
      "text-padding": 3,
    },
    paint: {
      "text-color": dark ? "#e6e9ee" : "#2b3038",
      "text-halo-color": dark ? "rgba(0,0,0,.75)" : "rgba(255,255,255,.9)",
      "text-halo-width": 1.2,
    },
  } as LayerProps;
}

/** The GTFS stop layer: a halo for the stop whose board is open, hollow rings, then names. */
export function stopLayers(source: string, dark: boolean, selectedStopId: string | null, visible: boolean): LayerProps[] {
  const visibility = visible ? "visible" : "none";
  return [
    {
      id: `${source}-selected`,
      type: "circle",
      source,
      minzoom: STOPS_ZOOM,
      filter: ["==", ["get", "stopId"], selectedStopId ?? "__none__"] as any,
      layout: { visibility },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], STOPS_ZOOM, 8, 17, 13] as any,
        "circle-color": ACCENT,
        "circle-opacity": 0.28,
      },
    } as LayerProps,
    {
      id: `${source}-dot`,
      type: "circle",
      source,
      minzoom: STOPS_ZOOM,
      layout: { visibility },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], STOPS_ZOOM, 2.5, 17, 5] as any,
        // A hollow ring, so a stop never reads as a (solid) vehicle dot.
        "circle-color": dark ? "#12161b" : "#ffffff",
        "circle-stroke-color": dark ? "#9aa3ad" : "#4a5561",
        "circle-stroke-width": 1.4,
      },
    } as LayerProps,
    {
      id: `${source}-label`,
      type: "symbol",
      source,
      minzoom: STOP_LABEL_ZOOM,
      layout: {
        visibility,
        "text-field": ["get", "name"] as any,
        "text-font": LABEL_FONT,
        "text-size": 11,
        "text-anchor": "left",
        "text-offset": [0.6, 0],
        "text-max-width": 12,
        // Default collision handling: where stops crowd together the surplus labels are simply
        // not placed, while every dot stays drawn (dots are their own layer).
        "text-padding": 3,
      },
      paint: {
        "text-color": dark ? "#e6e9ee" : "#2b3038",
        "text-halo-color": dark ? "rgba(0,0,0,.75)" : "rgba(255,255,255,.9)",
        "text-halo-width": 1.2,
      },
    } as LayerProps,
  ];
}
