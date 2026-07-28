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
  dark: boolean;
}

export const THEMES: MapTheme[] = [
  { id: "colorful", label: "Colorful", style: COLORFUL_STYLE, dark: false },
  { id: "neutrino", label: "Neutrino", style: NEUTRINO_STYLE, dark: false },
  { id: "graybeard", label: "Graybeard", style: GRAYBEARD_STYLE, dark: true },
  { id: "eclipse", label: "Eclipse", style: ECLIPSE_STYLE, dark: true },
  { id: "osm", label: "OSM", style: OSM_STYLE, dark: false },
];

export const DEFAULT_THEME = THEMES[0];
