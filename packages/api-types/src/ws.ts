// WebSocket live client: opens the protobuf stream, sends viewport + filters, and
// surfaces normalized ENTER / MOVE / LEAVE updates. Auto-reconnects.

import { decodeServer, encodeClient } from "./proto";
import type { BBox, FilterState, MoveDelta, NormalizedUpdate, Vehicle } from "./types";

export type ConnStatus = "connecting" | "open" | "closed";

interface Handlers {
  onUpdate: (u: NormalizedUpdate) => void;
  onStatus?: (s: ConnStatus) => void;
  /**
   * Liveness watchdog, off by default. A quiet tick sends no frame at all, so silence is a
   * normal steady state and a half-open socket (a phone hopping from Wi-Fi to cellular) is
   * otherwise undetectable: after `heartbeatMs` without a frame the client pings, and closes
   * — triggering the normal reconnect — if nothing comes back within HEARTBEAT_GRACE_MS.
   * Browsers don't need it; the mobile app turns it on.
   */
  heartbeatMs?: number;
}

const HEARTBEAT_GRACE_MS = 10_000;
const RETRY_MAX_MS = 30_000;

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
    // Guarded by speed_known, not by truthiness: a standing train sends a real 0.
    speedKmh: s.speed_known ? s.speed_kmh || 0 : null,
    delay: s.delay_seconds || 0,
    delayKnown: !!s.delay_known,
    destination: s.destination || "",
    block: s.block_code || "",
    journey: s.journey_number || "",
    atStop: !!s.at_stop,
    currentStopId: s.current_stop_id || "",
    schedulePositioned: !!s.schedule_positioned,
    lineColor: s.line_color || "",
    lineTextColor: s.line_text_color || "",
  };
}

function toMove(m: any): MoveDelta {
  return {
    id: m.id,
    lat: m.lat,
    lon: m.lon,
    bearing: Number.isFinite(m.bearing) ? m.bearing : null,
    speedKmh: m.speed_known ? m.speed_kmh || 0 : null,
    delay: m.delay_seconds || 0,
    delayKnown: !!m.delay_known,
    atStop: !!m.at_stop,
    currentStopId: m.current_stop_id || "",
    schedulePositioned: !!m.schedule_positioned,
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
  private retryTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setTimeout>;

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
      this.armHeartbeat();
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
      this.armHeartbeat();
      const obj = decodeServer(new Uint8Array(ev.data as ArrayBuffer));
      // Pongs and server errors only count as liveness; there is nothing to render.
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
      this.clearHeartbeat();
      // A stale socket's close must not reconnect: after suspend() the current socket is gone,
      // and after resume() a late close from the old one would open a second connection.
      if (this.ws !== ws) return;
      this.handlers.onStatus?.("closed");
      if (!this.closedByUser) {
        this.retryTimer = setTimeout(() => this.open(), this.retry);
        this.retry = Math.min(this.retry * 2, RETRY_MAX_MS);
      }
    };
    ws.onerror = () => ws.close();
  }

  private armHeartbeat() {
    this.clearHeartbeat();
    const idle = this.handlers.heartbeatMs;
    if (!idle) return;
    this.heartbeatTimer = setTimeout(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(encodeClient({ ping: true }));
      this.heartbeatTimer = setTimeout(() => ws.close(), HEARTBEAT_GRACE_MS);
    }, idle);
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
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

  /**
   * Drop the connection without reconnecting, keeping the subscription (viewport, filters,
   * pinned) for `resume()`. For an app going to the background: a socket held open there is
   * either killed by the OS or streams to nobody.
   */
  suspend() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.clearHeartbeat();
    this.closedByUser = true;
    const ws = this.ws;
    this.ws = undefined;
    ws?.close();
    this.handlers.onStatus?.("closed");
  }

  /**
   * Reopen after `suspend()` (or a `close()`). Re-subscribes with the stored view; the server
   * answers every Subscribe with a full snapshot, so callers rebuild their state from the
   * `isSnapshot` frame rather than patching what they had before the pause.
   */
  resume() {
    if (this.ws || !this.view) return;
    this.closedByUser = false;
    this.retry = 500;
    this.open();
  }

  close() {
    this.suspend();
  }
}
