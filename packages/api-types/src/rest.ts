// REST client for snapshot/detail/filter-metadata endpoints.

import { VEHICLE_TYPE_LABEL, type VehicleType } from "./types";
import type {
  BBox,
  StopDeparturesResponse,
  StopsResponse,
  VehicleDetail,
  VehicleTripPlan,
  VehiclesResponse,
} from "./types";

export interface OperatorInfo {
  dataowner: string;
  vehicles: number;
}
export interface LineInfo {
  line: string;
  type: string;
  vehicles: number;
}

/** A non-2xx response. `status` lets callers back off on 429/503 instead of retrying blindly. */
export class RestError extends Error {
  constructor(public readonly status: number, path: string) {
    super(`${path} -> ${status}`);
    this.name = "RestError";
  }
}

export interface RestOptions {
  apiKey?: string;
  /** Per-request deadline; default 10 s. Mobile networks can hang a fetch indefinitely. */
  timeoutMs?: number;
}

/**
 * Query string builder on `encodeURIComponent`, not `URLSearchParams`: React Native's shim
 * of the latter implements only `append`/`toString`, so `.set()` throws at runtime there.
 * Undefined and empty values are skipped; the result is "" or "?a=b&c=d".
 */
function query(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const k in params) {
    const v = params[k];
    if (v === undefined || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export class RestClient {
  private apiKey?: string;
  private timeoutMs: number;

  /**
   * `apiKey` is optional. The official clients call the public data endpoints without one;
   * a key is only needed by third-party API consumers (for higher, per-key limits).
   */
  constructor(private baseUrl: string, opts?: string | RestOptions) {
    const o = typeof opts === "string" ? { apiKey: opts } : opts ?? {};
    this.apiKey = o.apiKey;
    this.timeoutMs = o.timeoutMs ?? 10_000;
  }

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    // One controller merges the caller's signal with the deadline. Done by hand rather than
    // with AbortSignal.any / AbortSignal.timeout, which Hermes lacks.
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (signal?.aborted) ac.abort();
    else signal?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        signal: ac.signal,
      });
      if (!res.ok) throw new RestError(res.status, path);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Live half of the vehicle view — poll this. The route shape and stop list are constant
   * for the trip and come from {@link vehicleTrip}; refetch that only when `trip_id` here
   * changes.
   */
  vehicleDetail(id: string, signal?: AbortSignal): Promise<VehicleDetail> {
    return this.get(`/v1/vehicles/${encodeURIComponent(id)}`, signal);
  }
  /** Schedule half of the vehicle view: route shape + every scheduled call. Fetch once per trip. */
  vehicleTrip(id: string, signal?: AbortSignal): Promise<VehicleTripPlan> {
    return this.get(`/v1/vehicles/${encodeURIComponent(id)}/trip`, signal);
  }
  /**
   * Find live vehicles by number, public line, or omloop/journey number, nationwide.
   *
   * Always pass a `limit`: a one- or two-character query matches thousands of vehicles
   * (measured: "1" hits ~2 800, 1.4 MB), and the server ranks by relevance before truncating,
   * so a small slice is the *best* matches rather than an arbitrary set. `total` in the
   * response says how many there were.
   */
  searchVehicles(
    search: string,
    opts: { types?: VehicleType[]; owners?: string[]; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<VehiclesResponse> {
    const qs = query({
      search,
      types: opts.types?.length ? opts.types.map((t) => VEHICLE_TYPE_LABEL[t]).join(",") : undefined,
      owners: opts.owners?.length ? opts.owners.join(",") : undefined,
      limit: opts.limit,
    });
    return this.get(`/v1/vehicles${qs}`, signal);
  }
  operators(signal?: AbortSignal): Promise<{ operators: OperatorInfo[] }> {
    return this.get(`/v1/operators`, signal);
  }
  lines(signal?: AbortSignal): Promise<{ lines: LineInfo[] }> {
    return this.get(`/v1/lines`, signal);
  }
  /**
   * Stops inside a viewport, for the map's stop layer. The server rejects boxes larger than
   * 1 deg² (400) and 503s until the stop index is built, so callers must only ask when
   * zoomed in — and tolerate an empty layer right after a server restart.
   */
  stopsInViewport(b: BBox, limit?: number, signal?: AbortSignal): Promise<StopsResponse> {
    const qs = query({ bbox: `${b.minLon},${b.minLat},${b.maxLon},${b.maxLat}`, limit });
    return this.get(`/v1/stops/viewport${qs}`, signal);
  }
  /** Departure board for one quay. `window` is minutes ahead (server default 90). */
  stopDepartures(
    stopId: string,
    opts: { window?: number; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<StopDeparturesResponse> {
    const qs = query({ window: opts.window, limit: opts.limit });
    return this.get(`/v1/stops/${encodeURIComponent(stopId)}/departures${qs}`, signal);
  }
}
