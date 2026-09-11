// Turning a vehicle's static trip plan into what the panel and the maps show: the calls still
// ahead, where they sit in the trip, and the time each is actually expected.
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
 * Index, in the whole trip plan, of the first stop the vehicle still has to visit.
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
 *
 * It is the *index* rather than the slice because a stop is numbered by its place in the whole
 * trip ("the 4th stop" stays the 4th once the first three are behind us), and because the maps
 * draw the stops already visited too, in a muted style. Every surface that splits a trip into
 * done/ahead goes through here, so the panel and the two maps can't disagree about where the
 * vehicle is in its trip.
 */
export function upcomingFromIndex(stops: TripStop[], veh: VehicleProgress, nowMs: number): number {
  if (stops.length === 0) return 0;
  const departed = (s: TripStop) => etaSeconds(s.scheduled_departure + veh.delay, nowMs) <= 0;
  const near = nearestStopIndex(stops, veh.lat, veh.lon);
  if (near == null) {
    const i = stops.findIndex((s) => !departed(s));
    return i < 0 ? 0 : i;
  }
  return veh.atStop || !departed(stops[near]) ? near : near + 1;
}

/**
 * The trip's calls as map features, carrying the two things both maps' layers switch on: `n`,
 * the stop's number in the trip, and `upcoming`, whether the vehicle has yet to call there.
 *
 * The whole trip is emitted, not just the tail: the stops already served are what make the
 * numbering legible ("this is the 4th stop" reads as an answer only when 1–3 are visible behind
 * the vehicle), so they are drawn muted rather than dropped.
 */
export function tripStopFeatures(stops: TripStop[], upcomingFrom: number): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: stops.map((s, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: {
        stopId: s.stop_id,
        // gtfs-nl names stops "<place>, <stop>"; the place is obvious from the basemap at the
        // zoom where labels appear, and repeating it wraps most of them onto two lines.
        name: s.name.replace(/^[^,]+,\s*/, ""),
        // A string, because that is what a symbol layer's text-field needs.
        n: String(i + 1),
        upcoming: i >= upcomingFrom,
      },
    })),
  };
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
