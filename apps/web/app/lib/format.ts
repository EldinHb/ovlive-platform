import { VehicleType } from "@ovlive/api-types";

export interface OpStyle {
  bg: string;
  fg: string;
}

/** A resolved operator: how we label and colour it on the map + in the panel. */
export interface Operator {
  key: string; // canonical id — used for marker-image caching
  label: string; // short text shown on the marker pill / badge
  style: OpStyle;
}

interface OpDef {
  label: string;
  style: OpStyle;
  // Every signal that should resolve to this operator, UPPERCASED: KV6 dataowner
  // codes AND GTFS agency names (`operator_name`). The canonical key is always an
  // alias too, so it never needs repeating here.
  aliases?: string[];
}

// Curated colours for the operators whose huisstijl we know, chosen to stay visually
// distinct on the map. This is an *override* table: any operator NOT listed here still gets
// a stable, distinct colour derived from its name (see `hashStyle`), so every transporter
// is handled — the table just pins the exact brand hue for the ones we care to get right.
// Replace any `bg`/`fg` with an operator's exact brand hex when you have their style guide.
//
// `aliases` is what makes a *subcontractor* collapse into the public brand it runs under.
// KV6 reports the operational operator (e.g. dataowner `KEOLIS`), but GTFS names the
// concession (e.g. `U-OV`). Because `resolveOperator` prefers the GTFS name, a Keolis-run
// U-OV vehicle resolves here via the "U-OV" alias, so the marker and the detail panel agree.
// Add a brand's GTFS `operator_name` variants as aliases as new concessions appear.
const OPERATORS: Record<string, OpDef> = {
  ARR: { label: "ARR", style: { bg: "#00A1DE", fg: "#ffffff" }, aliases: ["ARRIVA"] }, // Arriva — aqua blue
  CXX: { label: "CXX", style: { bg: "#6CB33F", fg: "#ffffff" }, aliases: ["CONNEXXION"] }, // Connexxion — green
  EBS: { label: "EBS", style: { bg: "#F58220", fg: "#ffffff" } }, // EBS — orange
  GVB: { label: "GVB", style: { bg: "#005CA9", fg: "#ffffff" } }, // GVB Amsterdam — blue
  HTM: { label: "HTM", style: { bg: "#E4002B", fg: "#ffffff" }, aliases: ["HTMBUZZ"] }, // HTM Den Haag — red
  RET: { label: "RET", style: { bg: "#00857C", fg: "#ffffff" } }, // RET Rotterdam — teal
  QBUZZ: { label: "QBUZZ", style: { bg: "#7A2E8E", fg: "#ffffff" } }, // Qbuzz — purple
  KEOLIS: { label: "KEOLIS", style: { bg: "#E6007E", fg: "#ffffff" }, aliases: ["KEOLIS NEDERLAND"] }, // Keolis — magenta
  UOV: { label: "U-OV", style: { bg: "#2E8B57", fg: "#ffffff" }, aliases: ["U-OV"] }, // U-OV (Utrecht) — green (approx.)
  IFF: { label: "IFF", style: { bg: "#003082", fg: "#FFC917" }, aliases: ["NS", "NS INTERNATIONAL"] }, // NS / trains — blue + yellow
  DELIJN: { label: "DELIJN", style: { bg: "#FFE600", fg: "#1d1d1f" }, aliases: ["DE LIJN"] }, // De Lijn (BE) — yellow
};

export const DEFAULT_OP: OpStyle = { bg: "#5b6470", fg: "#ffffff" };
export const KNOWN_OPERATORS = Object.keys(OPERATORS);

// alias (uppercased) -> canonical operator, built once from the table above.
const BY_ALIAS: Record<string, Operator> = (() => {
  const m: Record<string, Operator> = {};
  for (const [key, def] of Object.entries(OPERATORS)) {
    const op: Operator = { key, label: def.label, style: def.style };
    for (const a of [key, ...(def.aliases ?? [])]) m[a.toUpperCase()] = op;
  }
  return m;
})();

/**
 * Deterministic, distinct colour for any operator we don't have a curated brand hue for.
 * Same name → same colour every render. Saturation/lightness are pinned dark enough that
 * white marker text stays legible, so uncurated concessions look intentional, not "unknown".
 */
function hashStyle(seed: string): OpStyle {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const hue = ((h % 360) + 360) % 360;
  return { bg: hslToHex(hue, 58, 40), fg: "#ffffff" };
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Resolve the operator to *display* for a vehicle. Prefers the GTFS agency
 * (`operator_name`) — the concession/brand behind the vehicle — so a subcontractor's
 * own dataowner code (e.g. `KEOLIS`) never masks the public operator (e.g. `U-OV`).
 * Falls back to the raw KV6 dataowner code when there's no GTFS match yet.
 *
 * Works for *every* transporter: curated brands (above) get their exact hue; any other
 * concession gets a stable colour derived from its name — never a generic grey.
 */
export function resolveOperator(dataowner: string, operator?: string | null): Operator {
  // The GTFS brand, when present, is the source of truth — it names the concession behind
  // the vehicle. Resolve from it FIRST and never let the (operational) dataowner code
  // override it; only fall back to the code when GTFS gave us no brand at all. Curated
  // brands get their exact hue; anything else gets a stable colour derived from its name.
  const name = cleanName(operator ?? "");
  if (name) return BY_ALIAS[name.toUpperCase()] ?? make(name);
  const code = (dataowner ?? "").trim();
  if (code) return BY_ALIAS[code.toUpperCase()] ?? make(code);
  return { key: "", label: "", style: DEFAULT_OP };
}

// GTFS agency names often tack the operator on in parentheses, e.g. "allGo (Keolis)" or
// "Bravo (Arriva)". We only want the concession brand, so drop a trailing "(…)".
function cleanName(s: string): string {
  return s.replace(/\s*\([^()]*\)\s*$/, "").trim();
}

function make(label: string): Operator {
  return { key: label.toUpperCase(), label, style: hashStyle(label.toUpperCase()) };
}

export function operatorStyle(dataowner: string): OpStyle {
  return (BY_ALIAS[dataowner?.toUpperCase()] ?? { style: DEFAULT_OP }).style;
}

export function operatorColor(dataowner: string): string {
  return operatorStyle(dataowner).bg;
}

export function typeLabel(t: VehicleType): string {
  return ["", "Bus", "Tram", "Metro", "Train", "Ferry"][t] || "Vehicle";
}

export function typeIcon(t: VehicleType): string {
  const m: Record<number, string> = { 1: "🚌", 2: "🚋", 3: "🚇", 4: "🚆", 5: "⛴️" };
  return m[t] || "🚍";
}

/** Format a delay in seconds as "+2:30" / "−0:45" / "on time" (only exactly 0 is on time). */
export function formatDelay(sec: number): { text: string; kind: "late" | "early" | "ontime" } {
  if (sec === 0) return { text: "on time", kind: "ontime" };
  const late = sec > 0;
  const a = Math.abs(sec);
  const m = Math.floor(a / 60);
  const s = a % 60;
  return { text: `${late ? "+" : "−"}${m}:${String(s).padStart(2, "0")}`, kind: late ? "late" : "early" };
}

/** Rough distance in metres between two lat/lon points (fine for short, in-city spans). */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dlat = lat2 - lat1;
  const dlon = (lon2 - lon1) * Math.cos((lat1 * Math.PI) / 180);
  return 111_320 * Math.sqrt(dlat * dlat + dlon * dlon);
}

/** Unix seconds -> "HH:MM" in Dutch local time (matches the schedule clock). "" if 0. */
export function unixToClock(unix: number): string {
  if (!unix) return "";
  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(unix * 1000));
}

/** How stale a vehicle's last position fix is, for colouring the freshness indicator. */
export type Freshness = "fresh" | "aging" | "stale";

/**
 * Age of a vehicle's last known update. `iso` is the KV6-reported timestamp, so it comes off
 * the operator's clock, not ours — a skewed vehicle clock can put it slightly in the future,
 * which we clamp to 0 rather than render as a negative age.
 *
 * Thresholds are tuned to KV6 reporting behaviour: vehicles emit on stop arrival/departure and
 * roughly every 30 s in between, so under a minute is normal and only a couple of minutes of
 * silence actually means the feed has gone quiet for that vehicle.
 */
export function updateAge(iso: string, nowMs: number): { secs: number; kind: Freshness } | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const secs = Math.max(0, Math.round((nowMs - t) / 1000));
  const kind: Freshness = secs < 60 ? "fresh" : secs < 180 ? "aging" : "stale";
  return { secs, kind };
}

/** ISO timestamp -> "HH:MM:SS" in Dutch local time. "" if unparseable. */
export function isoToClock(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(t));
}

// Wall clock on the *Dutch* schedule axis. GTFS stop times are seconds since local
// (Europe/Amsterdam) midnight, so a viewer in another timezone must still be compared
// against Dutch local time, not their own.
const NL_HMS = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Amsterdam",
});

/** Seconds since local (Europe/Amsterdam) midnight — the axis GTFS stop times live on. */
export function secsSinceMidnightNL(nowMs: number): number {
  const parts = NL_HMS.formatToParts(new Date(nowMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get("hour") * 3600 + get("minute") * 60 + get("second");
}

/**
 * Seconds from now until a schedule time given as seconds-since-local-midnight.
 *
 * The service day those seconds belong to is not in the payload, and after-midnight service
 * runs past 24:00 (so the value can exceed 86400 while our clock has already wrapped to ~0).
 * Wrapping the difference into ±12 h resolves both cases, and is always right for a stop a
 * live vehicle still has to reach — nothing upcoming is half a day away.
 */
export function etaSeconds(scheduleSecs: number, nowMs: number): number {
  const diff = scheduleSecs - secsSinceMidnightNL(nowMs);
  return (((diff + 43_200) % 86_400 + 86_400) % 86_400) - 43_200;
}

/** Seconds-since-midnight -> "HH:MM". */
export function secsToClock(sec: number): string {
  const s = ((sec % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
