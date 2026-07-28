// WebSocket live client: opens the protobuf stream, sends viewport + filters, and
// surfaces normalized ENTER / MOVE / LEAVE updates. Auto-reconnects.

import { decodeServer, encodeClient } from "./proto";
import type { BBox, FilterState, MoveDelta, NormalizedUpdate, Vehicle } from "./types";

export type ConnStatus = "connecting" | "open" | "closed";

interface Handlers {
  onUpdate: (u: NormalizedUpdate) => void;
  onStatus?: (s: ConnStatus) => void;
}

function toVehicle(s: any): Vehicle {
  return {
    id: s.id,
    dataowner: s.dataowner,
    vehicleNumber: s.vehicle_number,
    line: s.line_public_number || "",
    type: s.vehicle_type ?? 0,
    operator: s.operator_name || "",
    lat: s.lat,
    lon: s.lon,
    bearing: Number.isFinite(s.bearing) ? s.bearing : null,
    delay: s.delay_seconds || 0,
    delayKnown: !!s.delay_known,
    destination: s.destination || "",
    block: s.block_code || "",
    journey: s.journey_number || "",
    atStop: !!s.at_stop,
    currentStopId: s.current_stop_id || "",
    lineColor: s.line_color || "",
    lineTextColor: s.line_text_color || "",
    nextLine: s.next_line_public_number || "",
    nextDestination: s.next_destination || "",
    nextStart: Number(s.next_start_unix) || 0,
  };
}

function toMove(m: any): MoveDelta {
  return {
    id: m.id,
    lat: m.lat,
    lon: m.lon,
    bearing: Number.isFinite(m.bearing) ? m.bearing : null,
    delay: m.delay_seconds || 0,
    delayKnown: !!m.delay_known,
    atStop: !!m.at_stop,
    currentStopId: m.current_stop_id || "",
  };
}

function viewportMsg(b: BBox, zoom: number, f: FilterState, pinned: string[]) {
  return {
    viewport: { min_lat: b.minLat, min_lon: b.minLon, max_lat: b.maxLat, max_lon: b.maxLon, zoom },
    filters: { vehicle_types: f.types, dataowners: f.owners, search: f.search },
    pinned,
  };
}

export class LiveClient {
  private ws?: WebSocket;
  private wsUrl: string;
  private view?: { bbox: BBox; zoom: number; filters: FilterState };
  private pinned: string[] = [];
  private closedByUser = false;
  private retry = 500;

  /**
   * `apiKey` is optional — the official web app streams without one. A key is only for
   * third-party API consumers (higher, attributable per-key limits).
   */
  constructor(baseUrl: string, apiKey: string | undefined, private handlers: Handlers) {
    const wsBase = baseUrl.replace(/^http/, "ws");
    this.wsUrl = apiKey
      ? `${wsBase}/v1/stream?key=${encodeURIComponent(apiKey)}`
      : `${wsBase}/v1/stream`;
  }

  connect(bbox: BBox, zoom: number, filters: FilterState) {
    this.view = { bbox, zoom, filters };
    this.closedByUser = false;
    this.open();
  }

  private open() {
    this.handlers.onStatus?.("connecting");
    const ws = new WebSocket(this.wsUrl);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 500;
      this.handlers.onStatus?.("open");
      if (this.view) {
        ws.send(
          encodeClient({
            subscribe: viewportMsg(this.view.bbox, this.view.zoom, this.view.filters, this.pinned),
          }),
        );
      }
    };
    ws.onmessage = (ev) => {
      const obj = decodeServer(new Uint8Array(ev.data as ArrayBuffer));
      if (obj.update) {
        const u = obj.update;
        this.handlers.onUpdate({
          entered: (u.entered || []).map(toVehicle),
          moved: (u.moved || []).map(toMove),
          left: u.left || [],
          isSnapshot: !!u.is_snapshot,
        });
      }
    };
    ws.onclose = () => {
      this.handlers.onStatus?.("closed");
      if (!this.closedByUser) {
        setTimeout(() => this.open(), this.retry);
        this.retry = Math.min(this.retry * 2, 10_000);
      }
    };
    ws.onerror = () => ws.close();
  }

  /** Update the viewport/filters (called on map move / filter change). */
  update(bbox: BBox, zoom: number, filters: FilterState) {
    this.view = { bbox, zoom, filters };
    this.send();
  }

  /**
   * Set the vehicle ids to stream unconditionally (the current selection), so they stay on
   * the map even after the user pans them out of view. Resends immediately if connected.
   */
  setPinned(ids: string[]) {
    this.pinned = ids;
    this.send();
  }

  private send() {
    if (this.view && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        encodeClient({
          update_viewport: viewportMsg(this.view.bbox, this.view.zoom, this.view.filters, this.pinned),
        }),
      );
    }
  }

  close() {
    this.closedByUser = true;
    this.ws?.close();
  }
}
