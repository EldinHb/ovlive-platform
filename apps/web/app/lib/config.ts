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
