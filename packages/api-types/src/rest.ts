// REST client for snapshot/detail/filter-metadata endpoints.

import type { VehicleDetail } from "./types";

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

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json() as Promise<T>;
  }

  vehicleDetail(id: string): Promise<VehicleDetail> {
    return this.get(`/v1/vehicles/${encodeURIComponent(id)}`);
  }
  operators(): Promise<{ operators: OperatorInfo[] }> {
    return this.get(`/v1/operators`);
  }
  lines(): Promise<{ lines: LineInfo[] }> {
    return this.get(`/v1/lines`);
  }
}
