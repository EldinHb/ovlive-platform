// Live stream for exactly one vehicle, for the detail screen (the map screen gets its stream
// from LiveMap instead, where the viewport is the subscription). A port of the web's
// apps/web/app/lib/live.ts with the app-lifecycle handling a phone needs.
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { LiveClient, type BBox, type ConnStatus, type FilterState, type Vehicle } from "@ovlive/api-types";
import { API_BASE } from "./config";

/**
 * A degenerate viewport in the Atlantic: the screen wants one vehicle, and `pinned` streams it
 * regardless of the box. Asking for a real box around the vehicle would put the surrounding
 * fleet on the wire — per-connection work the server tick would do 3×/s for a screen that
 * draws none of it.
 */
const NO_VIEWPORT: BBox = { minLat: 0, minLon: 0, maxLat: 0, maxLon: 0 };
const NO_FILTERS: FilterState = { types: [], owners: [], search: "" };

/** Silence this long on a phone means a dead socket often enough to ask (see LiveClient). */
export const HEARTBEAT_MS = 20_000;

export interface VehicleLive {
  live: Vehicle | null;
  /** The vehicle left the stream: its trip ended, or it was never running. */
  ended: boolean;
  status: ConnStatus;
}

export function useVehicleLive(id: string): VehicleLive {
  const [live, setLive] = useState<Vehicle | null>(null);
  const [ended, setEnded] = useState(false);
  const [status, setStatus] = useState<ConnStatus>("connecting");

  useEffect(() => {
    if (!id) return;
    setLive(null);
    setEnded(false);
    const client = new LiveClient(API_BASE, undefined, {
      heartbeatMs: HEARTBEAT_MS,
      onStatus: setStatus,
      onUpdate: (u) => {
        const entered = u.entered.find((v) => v.id === id);
        if (entered) {
          setLive(entered);
          // A vehicle that reappears has started another trip; the screen follows it there
          // rather than freezing, since it is keyed on the vehicle, not on one journey.
          setEnded(false);
        }
        const moved = u.moved.find((m) => m.id === id);
        if (moved) setLive((prev) => (prev ? { ...prev, ...moved } : prev));
        // A snapshot (initial or post-reconnect) replaces state wholesale, so absence from it
        // is the only "left" signal we get — there are no per-vehicle LEAVE events in it.
        if (u.left.includes(id) || (u.isSnapshot && !entered)) setEnded(true);
      },
    });
    // Pinned before connecting: the id rides along in the subscribe frame.
    client.setPinned([id]);
    client.connect(NO_VIEWPORT, 14, NO_FILTERS);
    const sub = AppState.addEventListener("change", (s) => (s === "active" ? client.resume() : client.suspend()));
    return () => {
      sub.remove();
      client.close();
    };
  }, [id]);

  return { live, ended, status };
}
