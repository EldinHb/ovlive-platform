import type { StyleSpecification } from "maplibre-gl";

// Raster OSM fallback style (no external style.json needed).
export const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "raster-tiles": {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm-tiles", type: "raster", source: "raster-tiles", minzoom: 0, maxzoom: 19 }],
};

export const ECLIPSE_STYLE = "https://tiles.versatiles.org/assets/styles/eclipse/style.json";
export const COLORFUL_STYLE = "https://tiles.versatiles.org/assets/styles/colorful/style.json";
export const GRAYBEARD_STYLE = "https://tiles.versatiles.org/assets/styles/graybeard/style.json";
export const NEUTRINO_STYLE = "https://tiles.versatiles.org/assets/styles/neutrino/style.json";

export interface MapTheme {
  id: string;
  label: string;
  style: string | StyleSpecification;
  /** Basemap is dark — the overlays we draw ourselves (markers, stops) invert on this. */
  dark: boolean;
}

export const THEMES: MapTheme[] = [
  { id: "colorful", label: "Colorful", style: COLORFUL_STYLE, dark: false },
  { id: "neutrino", label: "Neutrino", style: NEUTRINO_STYLE, dark: false },
  // Graybeard is monochrome but light (a near-white canvas), not a dark style.
  { id: "graybeard", label: "Graybeard", style: GRAYBEARD_STYLE, dark: false },
  { id: "eclipse", label: "Eclipse", style: ECLIPSE_STYLE, dark: true },
  { id: "osm", label: "OSM", style: OSM_STYLE, dark: false },
];

export const DEFAULT_THEME = THEMES[0];

/** Fill, text and border of a vehicle marker (dot at low zoom, pill at high zoom). */
export interface MarkerPalette {
  bg: string;
  fg: string;
  stroke: string;
}

/**
 * Vehicle markers are one neutral colour for every vehicle — no per-line/operator brand
 * colours — and take their tone from the basemap: a near-white pill on a light style, a
 * near-black one on a dark style, so the marker layer reads as part of the map rather than
 * fighting it. Legibility then comes from the text and the border, not from the fill, which is
 * why the border is a firm mid-tone in both directions instead of a faint tint.
 */
export function markerPalette(dark: boolean): MarkerPalette {
  return dark
    ? { bg: "#171b21", fg: "#e8ebef", stroke: "rgba(232,235,239,0.45)" }
    : { bg: "#fbfbfc", fg: "#22262c", stroke: "rgba(34,38,44,0.45)" };
}
