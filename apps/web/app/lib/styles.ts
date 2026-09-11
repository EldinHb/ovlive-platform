import type { StyleSpecification } from "maplibre-gl";
import { COLORFUL_STYLE, ECLIPSE_STYLE, GLYPHS, GRAYBEARD_STYLE, NEUTRINO_STYLE } from "@ovlive/shared";

export {
  COLORFUL_STYLE,
  ECLIPSE_STYLE,
  GRAYBEARD_STYLE,
  LABEL_FONT,
  NEUTRINO_STYLE,
  markerPalette,
  tripStopPalette,
  tripStopRadius,
  type MarkerPalette,
} from "@ovlive/shared";

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

export interface MapTheme {
  id: string;
  label: string;
  style: string | StyleSpecification;
  /** Basemap is dark — the overlays we draw ourselves (markers, stops) invert on this. */
  dark: boolean;
}

/** Ensure a glyphs endpoint so text labels render on every theme (incl. raster OSM). */
export function withGlyphs(style: MapTheme["style"]): string | StyleSpecification {
  if (typeof style === "string") return style; // remote styles bring their own glyphs
  return { ...style, glyphs: GLYPHS };
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
