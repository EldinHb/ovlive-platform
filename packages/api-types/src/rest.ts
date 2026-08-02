// REST client for snapshot/detail/filter-metadata endpoints.

import { VEHICLE_TYPE_LABEL, type VehicleType } from "./types";
import type {
  BBox,
  StopDeparturesResponse,
  StopsResponse,
  VehicleDetail,
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

export class RestClient {
  /**
   * `apiKey` is optional. The official web app calls the public data endpoints without
   * one; a key is only needed by third-party API consumers (for higher, per-key limits).
   */
  constructor(private baseUrl: string, private apiKey?: string) {}

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      signal,
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json() as Promise<T>;
  }

  vehicleDetail(id: string): Promise<VehicleDetail> {
    return this.get(`/v1/vehicles/${encodeURIComponent(id)}`);
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
    query: string,
    opts: { types?: VehicleType[]; owners?: string[]; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<VehiclesResponse> {
    const q = new URLSearchParams({ search: query });
    if (opts.types?.length) q.set("types", opts.types.map((t) => VEHICLE_TYPE_LABEL[t]).join(","));
    if (opts.owners?.length) q.set("owners", opts.owners.join(","));
    if (opts.limit) q.set("limit", String(opts.limit));
    return this.get(`/v1/vehicles?${q}`, signal);
  }
  operators(): Promise<{ operators: OperatorInfo[] }> {
    return this.get(`/v1/operators`);
  }
  lines(): Promise<{ lines: LineInfo[] }> {
    return this.get(`/v1/lines`);
  }
  /**
   * Stops inside a viewport, for the map's stop layer. The server rejects boxes larger than
   * 1 deg² (400) and 503s until the stop index is built, so callers must only ask when
   * zoomed in — and tolerate an empty layer right after a server restart.
   */
  stopsInViewport(b: BBox, limit?: number, signal?: AbortSignal): Promise<StopsResponse> {
    const q = new URLSearchParams({ bbox: `${b.minLon},${b.minLat},${b.maxLon},${b.maxLat}` });
    if (limit) q.set("limit", String(limit));
    return this.get(`/v1/stops/viewport?${q}`, signal);
  }
  /** Departure board for one quay. `window` is minutes ahead (server default 90). */
  stopDepartures(
    stopId: string,
    opts: { window?: number; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<StopDeparturesResponse> {
    const q = new URLSearchParams();
    if (opts.window) q.set("window", String(opts.window));
    if (opts.limit) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return this.get(`/v1/stops/${encodeURIComponent(stopId)}/departures${qs ? `?${qs}` : ""}`, signal);
  }
}
