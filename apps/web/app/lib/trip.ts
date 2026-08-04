// Turning a vehicle's static trip plan into what the panel shows: the calls still ahead, and
// the time each is actually expected.
//
// Both used to come off the detail endpoint, which meant re-sending the trip's stops (and the
// route shape beside them) on every poll to express a delay addition and a position
// comparison. The plan is now fetched once per trip and these derive the rest from the live
// vehicle, which the client already has from the stream.

import type { TripStop } from "@ovlive/api-types";
import { distanceMeters, etaSeconds } from "./format";

/** The live vehicle state these derivations need — all of it is on the WS frame. */
export interface VehicleProgress {
  lat?: number | null;
  lon?: number | null;
  /** The vehicle reports standing at a stop (KV6 passage; never set for trains). */
  atStop: boolean;
  /** Trip delay in seconds. 0 both when on time and when unknown, which is fine here. */
  delay: number;
}

/**
 * The stops a vehicle still has to visit, from its whole trip plan.
 *
 * Anchored to the vehicle's *physical position*: the current/next stop is the one nearest the
 * vehicle. If the vehicle is at a stop we start there (it hasn't left yet); if it's moving we
 * additionally consult the delay-adjusted schedule to decide whether it has already *departed*
 * that nearest stop. Position-anchoring avoids dropping the stop a vehicle is physically
 * dwelling at just because schedule+delay says it "should" have gone.
 *
 * With no usable position this falls back to the first stop not yet departed, and to the whole
 * trip if they all have — a live vehicle always reports a position, so this is a safety net
 * rather than a real path.
 */
export function upcomingStops(stops: TripStop[], veh: VehicleProgress, nowMs: number): TripStop[] {
  if (stops.length === 0) return stops;
  const departed = (s: TripStop) => etaSeconds(s.scheduled_departure + veh.delay, nowMs) <= 0;
  const near = nearestStopIndex(stops, veh.lat, veh.lon);
  let start: number;
  if (near == null) {
    const i = stops.findIndex((s) => !departed(s));
    start = i < 0 ? 0 : i;
  } else {
    start = veh.atStop || !departed(stops[near]) ? near : near + 1;
  }
  return stops.slice(start);
}

/** Time a stop is actually expected, on the same seconds-since-local-midnight axis. */
export function expectedTime(scheduled: number, delay: number): number {
  return scheduled + delay;
}

/** Index of the stop nearest a position, or null if the position is unusable. */
function nearestStopIndex(stops: TripStop[], lat?: number | null, lon?: number | null): number | null {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i < stops.length; i++) {
    const d = distanceMeters(lat, lon, stops[i].lat, stops[i].lon);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
