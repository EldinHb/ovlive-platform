// The map styling every OVLive client shares: the VersaTiles basemap styles, the label font
// they serve, and the palettes of the overlays we draw ourselves (vehicle markers, trip stops).
// The web's theme picker and its MapLibre-typed style objects stay in apps/web/app/lib/styles.ts.

export const ECLIPSE_STYLE = "https://tiles.versatiles.org/assets/styles/eclipse/style.json";
export const COLORFUL_STYLE = "https://tiles.versatiles.org/assets/styles/colorful/style.json";
export const GRAYBEARD_STYLE = "https://tiles.versatiles.org/assets/styles/graybeard/style.json";
export const NEUTRINO_STYLE = "https://tiles.versatiles.org/assets/styles/neutrino/style.json";

export const GLYPHS = "https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf";
/**
 * Fontstack served by GLYPHS — and by the remote VersaTiles styles, which use the same
 * endpoint, so one name works on every theme.
 */
export const LABEL_FONT = ["noto_sans_regular"];

/**
 * The numbered stop dots drawn along a selected vehicle's trip, on both maps: solid accent for
 * the calls still ahead, a hollow muted dot for the ones already served. Shared so the map's
 * panel view and the vehicle page can't end up disagreeing about what "still to come" looks
 * like. `bg` doubles as the fill of a served stop and as the separating ring of an upcoming
 * one, so a dot never blends into the route line under it.
 */
export function tripStopPalette(dark: boolean) {
  return {
    accent: "#0071e3",
    onAccent: "#ffffff",
    bg: dark ? "#12161b" : "#ffffff",
    muted: dark ? "#7c858f" : "#98a1ab",
  };
}

/**
 * Radius of those dots, which is the one thing the "stop numbers" preference changes about the
 * map: a dot only has to be wide enough to hold two digits while it carries them, so with the
 * numbers off it shrinks back to a plain marker. `numZoom` is the zoom the numbers appear at,
 * where the dot has to have reached its full size. Shared so both maps shrink alike.
 */
export function tripStopRadius(numbered: boolean, numZoom: number) {
  return numbered
    ? ["interpolate", ["linear"], ["zoom"], 9, 3.5, numZoom, 9, 16, 11]
    : ["interpolate", ["linear"], ["zoom"], 9, 3, 16, 6];
}

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
