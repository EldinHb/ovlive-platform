// Where the app talks to, and the persisted preferences — the mobile counterpart of
// apps/web/app/lib/config.ts with MMKV in place of localStorage. Keys and validation match the
// web so a preference means the same thing on both.
import Constants from "expo-constants";
import { NativeModules, TurboModuleRegistry } from "react-native";
import { VehicleType, type FilterState } from "@ovlive/api-types";
import { getItem, removeItem, setItem } from "./storage";

// The API is its own host; the web app lives on www (the bare domain redirects there).
const PROD_API = "https://api.ovlive.nl";
const PROD_WEB = "https://www.ovlive.nl";

/**
 * API base, in order: an explicit build-time override, then — in development only — the Mac
 * running Metro with the port swapped to the backend's 8080, then production.
 *
 * The Metro host is what makes the dev loop work on a physical phone with no configuration:
 * 127.0.0.1 is the phone itself, so the backend has to be reached at the Mac's LAN address,
 * which is exactly the address the phone already loaded the bundle from.
 */
function resolveApiBase(): string {
  const explicit = process.env.EXPO_PUBLIC_API_BASE;
  if (explicit) return explicit.replace(/\/+$/, "");
  if (__DEV__) {
    const host = devServerHost();
    if (host) return `http://${host}:8080`;
  }
  return PROD_API;
}

/**
 * The host the JS bundle was loaded from. Taken from the bundle URL itself rather than
 * `expoConfig.hostUri`, which a dev client launched straight from the launcher (or simctl)
 * doesn't carry. This also resolves to what each platform can actually reach: the LAN IP on a
 * phone, `localhost` on the iOS simulator, `10.0.2.2` on the Android emulator.
 */
function devServerHost(): string | undefined {
  const url: string | undefined =
    NativeModules.SourceCode?.scriptURL ?? TurboModuleRegistry.get<any>("SourceCode")?.getConstants?.().scriptURL;
  const m = url?.match(/^https?:\/\/([^/:]+)/);
  if (m) return m[1];
  return Constants.expoConfig?.hostUri?.split(":")[0];
}

export const API_BASE = resolveApiBase();
if (__DEV__) console.log("[ovlive] API_BASE", API_BASE);
/** Share links are web URLs, so a recipient without the app still lands somewhere. */
export const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN ?? PROD_WEB;

export const NL_CENTER: [number, number] = [4.9041, 52.3676];
export const DEFAULT_ZOOM = 12;

const KEY_VIEW = "ovlive_view";
const KEY_APPEARANCE = "ovlive_appearance";
const KEY_MULTI = "ovlive_multiselect";
const KEY_STOPS = "ovlive_stops";
const KEY_STOP_NUMBERS = "ovlive_stop_numbers";
const KEY_FILTERS = "ovlive_filters";

export interface SavedView {
  lng: number;
  lat: number;
  zoom: number;
}

export function getSavedView(): SavedView | null {
  try {
    const raw = getItem(KEY_VIEW);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v.lng !== "number" || typeof v.lat !== "number" || typeof v.zoom !== "number") return null;
    if (v.lng < -180 || v.lng > 180 || v.lat < -90 || v.lat > 90 || v.zoom < 0 || v.zoom > 24) return null;
    return v;
  } catch {
    return null;
  }
}
export function setSavedView(v: SavedView) {
  setItem(KEY_VIEW, JSON.stringify(v));
}

export type Appearance = "system" | "light" | "dark";

/** Light/dark for the whole app (chrome and basemap). Default: follow the OS. */
export function getSavedAppearance(): Appearance {
  const v = getItem(KEY_APPEARANCE);
  return v === "light" || v === "dark" ? v : "system";
}
export function setSavedAppearance(a: Appearance) {
  setItem(KEY_APPEARANCE, a);
}

/** Off by default: multi-select is a power-user mode. */
export function getSavedMultiSelect(): boolean {
  return getItem(KEY_MULTI) === "1";
}
export function setSavedMultiSelect(on: boolean) {
  setItem(KEY_MULTI, on ? "1" : "0");
}

/** On by default. */
export function getSavedShowStops(): boolean {
  return getItem(KEY_STOPS) !== "0";
}
export function setSavedShowStops(on: boolean) {
  setItem(KEY_STOPS, on ? "1" : "0");
}

/** On by default. */
export function getSavedStopNumbers(): boolean {
  return getItem(KEY_STOP_NUMBERS) !== "0";
}
export function setSavedStopNumbers(on: boolean) {
  setItem(KEY_STOP_NUMBERS, on ? "1" : "0");
}

const VALID_TYPES = new Set<number>([
  VehicleType.BUS,
  VehicleType.TRAM,
  VehicleType.METRO,
  VehicleType.TRAIN,
  VehicleType.FERRY,
]);

/**
 * Persisted type/operator chips. The free-text search is deliberately not persisted: it is a
 * momentary question, not a preference, and restoring it would hide the fleet behind a stale
 * query on the next launch.
 */
export function getSavedFilters(): Pick<FilterState, "types" | "owners"> | null {
  try {
    const raw = getItem(KEY_FILTERS);
    if (!raw) return null;
    const v = JSON.parse(raw);
    const types = Array.isArray(v.types)
      ? (v.types as unknown[]).filter((t): t is VehicleType => typeof t === "number" && VALID_TYPES.has(t))
      : [];
    const owners = Array.isArray(v.owners)
      ? (v.owners as unknown[])
          .filter((o): o is string => typeof o === "string" && o.length > 0 && o.length <= 16)
          .slice(0, 64)
      : [];
    return { types, owners };
  } catch {
    return null;
  }
}
export function setSavedFilters(f: Pick<FilterState, "types" | "owners">) {
  if (!f.types.length && !f.owners.length) {
    removeItem(KEY_FILTERS);
    return;
  }
  setItem(KEY_FILTERS, JSON.stringify({ types: f.types, owners: f.owners }));
}
