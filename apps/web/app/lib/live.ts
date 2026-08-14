// Live stream for exactly one vehicle, for the vehicle page (the map gets its stream from
// MapView instead, where the viewport is the subscription).

import { useEffect, useState } from "react";
import { LiveClient, type BBox, type ConnStatus, type FilterState, type Vehicle } from "@ovlive/api-types";
import { API_BASE } from "./config";

/**
 * A degenerate viewport in the Atlantic: the page wants one vehicle, and `pinned` streams it
 * regardless of the box (see `build_update` in crates/api/src/ws.rs). Asking for a real box
 * around the vehicle would put the whole surrounding fleet on the wire — per-connection work
 * the server tick would then do 3×/s for a page that draws none of it.
 */
const NO_VIEWPORT: BBox = { minLat: 0, minLon: 0, maxLat: 0, maxLon: 0 };
const NO_FILTERS: FilterState = { types: [], owners: [], search: "" };

export interface VehicleLive {
  /** Latest live frame, or null before the first one arrives. */
  live: Vehicle | null;
  /** The vehicle left the stream: its trip ended, or it was never running. */
  ended: boolean;
  status: ConnStatus;
}

/**
 * Subscribe to a single vehicle's live position/punctuality. Updates arrive at the server tick
 * rate, the same as on the map, so the page's dot and delay move as smoothly as the panel's —
 * the 8 s REST poll beside it only carries the fields the stream has no room for.
 */
export function useVehicleLive(id: string): VehicleLive {
  const [live, setLive] = useState<Vehicle | null>(null);
  const [ended, setEnded] = useState(false);
  const [status, setStatus] = useState<ConnStatus>("connecting");

  useEffect(() => {
    if (!id) return;
    setLive(null);
    setEnded(false);
    const client = new LiveClient(API_BASE, undefined, {
      onStatus: setStatus,
      onUpdate: (u) => {
        const entered = u.entered.find((v) => v.id === id);
        if (entered) {
          setLive(entered);
          // A vehicle that reappears has started another trip; the page follows it there
          // rather than freezing, since it is keyed on the vehicle, not on one journey.
          setEnded(false);
        }
        const moved = u.moved.find((m) => m.id === id);
        if (moved) {
          setLive((prev) => (prev ? { ...prev, ...moved } : prev));
        }
        // A snapshot (initial or post-reconnect) replaces state wholesale, so absence from it
        // is the only "left" signal we get — there are no per-vehicle LEAVE events in it.
        if (u.left.includes(id) || (u.isSnapshot && !entered)) setEnded(true);
      },
    });
    // Pinned before connecting: the id then rides along in the subscribe frame rather than
    // costing a second round trip once the socket opens.
    client.setPinned([id]);
    client.connect(NO_VIEWPORT, 14, NO_FILTERS);
    return () => client.close();
  }, [id]);

  return { live, ended, status };
}
