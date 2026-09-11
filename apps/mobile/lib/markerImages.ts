// Vehicle markers baked as whole images — the web's `makeMarker`, on Skia. Operator code and
// line number are drawn *into* the pill rather than laid over it as a text layer: MapLibre
// draws a symbol layer's icons in one pass and its text in another, so with separate text two
// overlapping markers get both pills first and then both labels, and the labels bleed across
// each other's backgrounds. One bitmap per (operator, line, tone, selected) stacks as a unit,
// exactly like the DOM canvas version. Baked at 2× and drawn at icon-size 0.5.
import { Platform } from "react-native";
import { PaintStyle, Skia, matchFont } from "@shopify/react-native-skia";
import { markerPalette, type MarkerPalette } from "@ovlive/shared";

export interface MarkerImage {
  uri: string;
  width: number;
  height: number;
}

/** Icon key: the pill's content plus the tone it was baked for, `|sel` for the ring variant. */
export function markerKey(owner: string, line: string, dark: boolean, selected = false): string {
  return `m|${owner}|${line}|${dark ? "d" : "l"}${selected ? "|sel" : ""}`;
}

export function parseMarkerKey(key: string): { owner: string; line: string; dark: boolean; selected: boolean } | null {
  const parts = key.split("|");
  if (parts[0] !== "m" || parts.length < 4) return null;
  return { owner: parts[1], line: parts[2], dark: parts[3] === "d", selected: parts[4] === "sel" };
}

const DPR = 2;
const ACCENT = "#0071e3";
const FAMILY = Platform.select({ ios: "Helvetica Neue", android: "sans-serif", default: "sans-serif" })!;

let fonts: { owner: ReturnType<typeof matchFont>; line: ReturnType<typeof matchFont> } | null = null;
function getFonts() {
  if (!fonts) {
    fonts = {
      owner: matchFont({ fontFamily: FAMILY, fontSize: 11 * DPR, fontWeight: "600" }),
      line: matchFont({ fontFamily: FAMILY, fontSize: 13 * DPR, fontWeight: "700" }),
    };
  }
  return fonts;
}

const cache = new Map<string, MarkerImage>();

/** The image for `key`, baked on first use. Null only if Skia refuses a surface. */
export function bakeMarker(key: string): MarkerImage | null {
  const hit = cache.get(key);
  if (hit) return hit;
  const parsed = parseMarkerKey(key);
  if (!parsed) return null;
  const img = draw(parsed.owner, parsed.line, markerPalette(parsed.dark), parsed.selected ? ACCENT : undefined);
  if (img) cache.set(key, img);
  return img;
}

function draw(owner: string, line: string, pal: MarkerPalette, outline?: string): MarkerImage | null {
  const f = getFonts();
  const wOwner = owner ? f.owner.measureText(owner).width : 0;
  const wLine = line ? f.line.measureText(line).width : 0;
  const padX = 8 * DPR;
  const gap = line && owner ? 5 * DPR : 0;
  const H = 22 * DPR;
  const R = 7 * DPR;
  const W = Math.ceil(padX * 2 + wOwner + gap + wLine);
  const M = outline ? 4 * DPR : 0; // margin for the selection ring

  const surface = Skia.Surface.MakeOffscreen(W + 2 * M, H + 2 * M);
  if (!surface) return null;
  const c = surface.getCanvas();
  c.translate(M, M);

  const fill = Skia.Paint();
  fill.setAntiAlias(true);
  fill.setColor(Skia.Color(pal.bg));
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(0.5 * DPR, 0.5 * DPR, W - DPR, H - DPR), R, R), fill);
  const stroke = Skia.Paint();
  stroke.setAntiAlias(true);
  stroke.setStyle(PaintStyle.Stroke);
  stroke.setStrokeWidth(1 * DPR);
  stroke.setColor(Skia.Color(pal.stroke));
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(0.5 * DPR, 0.5 * DPR, W - DPR, H - DPR), R, R), stroke);

  // Selection ring, just outside the pill's border.
  if (outline) {
    const ring = Skia.Paint();
    ring.setAntiAlias(true);
    ring.setStyle(PaintStyle.Stroke);
    ring.setStrokeWidth(2.5 * DPR);
    ring.setColor(Skia.Color(outline));
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(-1.5 * DPR, -1.5 * DPR, W + 3 * DPR, H + 3 * DPR), R + 1.5 * DPR, R + 1.5 * DPR), ring);
  }

  const text = Skia.Paint();
  text.setAntiAlias(true);
  text.setColor(Skia.Color(pal.fg));
  let x = padX;
  if (owner) {
    const m = f.owner.getMetrics();
    text.setAlphaf(0.8);
    c.drawText(owner, x, H / 2 - (m.ascent + m.descent) / 2, text, f.owner);
    x += wOwner + gap;
    text.setAlphaf(1);
  }
  if (line) {
    const m = f.line.getMetrics();
    c.drawText(line, x, H / 2 - (m.ascent + m.descent) / 2, text, f.line);
  }

  const snapshot = surface.makeImageSnapshot();
  const uri = `data:image/png;base64,${snapshot.encodeToBase64()}`;
  return { uri, width: W + 2 * M, height: H + 2 * M };
}
