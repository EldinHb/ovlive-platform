import { VehicleType, type FilterState } from "@ovlive/api-types";

declare global {
  interface Window {
    __OVLIVE_CONFIG__?: { apiBase?: string };
  }
}

/**
 * Where the backend lives. Resolved at *runtime* from `/config.js`, which the container
 * entrypoint rewrites on every start — Vite would otherwise inline `VITE_API_BASE` into the
 * bundle, so one published image could only ever serve one deployment.
 *
 * An empty `apiBase` means "same origin": the production nginx proxies `/v1` to the server
 * itself, so the browser makes no cross-origin request and CORS/WS-origin never come up.
 * Falls back to the build-time env var, then to a local backend for `pnpm dev`.
 */
function resolveApiBase(): string {
  const runtime = typeof window !== "undefined" ? window.__OVLIVE_CONFIG__?.apiBase : undefined;
  if (typeof runtime === "string") {
    return runtime === "" ? window.location.origin : runtime.replace(/\/+$/, "");
  }
  const buildTime = import.meta.env.VITE_API_BASE as string | undefined;
  return buildTime ? buildTime.replace(/\/+$/, "") : "http://127.0.0.1:8080";
}

export const API_BASE = resolveApiBase();

// Center of the Netherlands, zoomed to a city region by default.
export const NL_CENTER: [number, number] = [4.9041, 52.3676]; // Amsterdam
export const DEFAULT_ZOOM = 12;

// --- Persisted UI preferences (localStorage) ---
const THEME_KEY = "ovlive_theme";
const VIEW_KEY = "ovlive_view";

export function getSavedThemeId(): string | null {
  return typeof localStorage !== "undefined" ? localStorage.getItem(THEME_KEY) : null;
}
export function setSavedThemeId(id: string) {
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {}
}

const MULTI_KEY = "ovlive_multiselect";
export function getSavedMultiSelect(): boolean {
  return typeof localStorage !== "undefined" && localStorage.getItem(MULTI_KEY) === "1";
}
export function setSavedMultiSelect(on: boolean) {
  try {
    localStorage.setItem(MULTI_KEY, on ? "1" : "0");
  } catch {}
}

// Stops are on by default; the key stores "0" only once the user has turned them off.
const STOPS_KEY = "ovlive_stops";
export function getSavedShowStops(): boolean {
  return typeof localStorage === "undefined" || localStorage.getItem(STOPS_KEY) !== "0";
}
export function setSavedShowStops(on: boolean) {
  try {
    localStorage.setItem(STOPS_KEY, on ? "1" : "0");
  } catch {}
}

/**
 * The filter chips (vehicle types + operators). Restored before the first WS connect, so the
 * stream opens already filtered rather than flashing every vehicle for a tick.
 *
 * `FilterState.search` is deliberately NOT persisted, and the web app no longer sets it at
 * all: the search box is a vehicle *lookup* that pans to what you pick, not a map filter, so
 * there is nothing about it worth restoring a day later.
 */
const FILTERS_KEY = "ovlive_filters";
const VALID_TYPES: number[] = [
  VehicleType.BUS,
  VehicleType.TRAM,
  VehicleType.METRO,
  VehicleType.TRAIN,
  VehicleType.FERRY,
];

export function getSavedFilters(): FilterState | null {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    // Validate rather than trust: a stale or hand-edited value must not reach the WS
    // viewport message, and an unknown type code would filter every vehicle out with no
    // chip to switch it back off.
    const types = Array.isArray(v?.types)
      ? (v.types.filter((t: unknown) => VALID_TYPES.includes(t as number)) as VehicleType[])
      : [];
    const owners = Array.isArray(v?.owners)
      ? (v.owners.filter((o: unknown) => typeof o === "string" && o.length > 0 && o.length <= 16) as string[])
      : [];
    if (!types.length && !owners.length) return null;
    return { types: [...new Set(types)], owners: [...new Set(owners)].slice(0, 64), search: "" };
  } catch {}
  return null;
}

export function setSavedFilters(f: FilterState) {
  try {
    if (!f.types.length && !f.owners.length) localStorage.removeItem(FILTERS_KEY);
    else localStorage.setItem(FILTERS_KEY, JSON.stringify({ types: f.types, owners: f.owners }));
  } catch {}
}

export interface SavedView {
  lng: number;
  lat: number;
  zoom: number;
}
export function getSavedView(): SavedView | null {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v.lng === "number" && typeof v.lat === "number" && typeof v.zoom === "number") return v;
  } catch {}
  return null;
}
export function setSavedView(v: SavedView) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {}
}
