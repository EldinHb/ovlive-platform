// What a vehicle "reads as": the header identity, the meta grid, the freshness line and the
// upcoming-stops list — resolved once from the three sources every client holds (the live WS
// frame, the polled detail and the once-fetched trip plan), so the web's map panel, its
// standalone vehicle page and the mobile app can never drift into showing the same vehicle
// differently. See `vehicleView` for which side wins per field.

import type { TripStop, Vehicle, VehicleDetail, VehicleTripPlan } from "@ovlive/api-types";
import { distanceMeters, formatDelay, resolveOperator, typeKeyOf, type Operator } from "./format";
import { upcomingFromIndex } from "./trip";
import type { TFn } from "./i18n";

const TYPE_KEYS = ["type.vehicle", "type.bus", "type.tram", "type.metro", "type.train", "type.ferry"];

// Max distance (m) from the first upcoming stop for the vehicle to count as "at" it —
// guards against a stale at_stop flag labelling a stop the vehicle isn't actually near.
export const AT_STOP_RADIUS_M = 150;

/** Everything both views render, resolved once from the three sources that feed them. */
export interface VehicleView {
  id: string;
  /** The trip we were watching ended; live fields are frozen on their last known values. */
  ended: boolean;
  op: Operator;
  /** Line badge colours: the line's own GTFS colours, else the operator brand. */
  badgeBg: string;
  badgeFg: string;
  line: string;
  destination: string;
  typeText: string;
  delayKind: "late" | "early" | "ontime" | "unknown";
  delayText: string;
  /** Trip delay in seconds; only meaningful when `delayKind` isn't "unknown". */
  delay: number;
  /**
   * Ground speed in km/h, or null when this vehicle's feed doesn't measure it.
   *
   * Only NS trains do (KV6 carries no speed element), so this is null for every bus, tram,
   * metro and ferry — and a standing train reports a real 0, which is why "no speed" is null
   * rather than 0.
   */
  speedKmh: number | null;
  operatorName: string;
  vehicleNumber: string;
  blockCode: string;
  journeyNumber: string;
  lastUpdate: string | null;
  lat?: number;
  lon?: number;
  /** The vehicle is standing at the first upcoming stop (reported *and* actually near it). */
  atStop: boolean;
  /** The calls still ahead, from the trip plan; empty until the plan has loaded. */
  stops: TripStop[];
  /**
   * Where `stops` starts within the trip's whole call list. Stops are numbered from the trip's
   * first call, not from the vehicle's next one, so the first entry of `stops` is number
   * `upcomingFrom + 1`. The maps take the same index to decide what to mute.
   */
  upcomingFrom: number;
}

export interface ViewInput {
  id: string;
  /** Live WS frame for the vehicle, when the stream has one. */
  basic?: Vehicle;
  /** Polled REST detail — the only source of operator name, vehicle number and last update. */
  detail?: VehicleDetail | null;
  trip?: VehicleTripPlan | null;
  ended?: boolean;
  now: number;
  t: TFn;
}

export function vehicleView({ id, basic, detail, trip, ended = false, now, t }: ViewInput): VehicleView {
  // When the watched trip has ended, ignore live detail (it may already have moved on to the
  // vehicle's next trip) and freeze on the last-known info for this trip.
  const v = ended ? undefined : detail?.vehicle;
  const dataowner = v?.dataowner ?? basic?.dataowner ?? id.split(":")[0];
  // The public operator to show (GTFS brand over the raw dataowner code), matching the marker.
  const op = resolveOperator(dataowner, v?.operator_name ?? basic?.operator);
  // Prefer the line's official GTFS colour for its number badge; fall back to operator brand.
  const lineColor = v?.line_color ?? basic?.lineColor;
  const lineTextColor = v?.line_text_color ?? basic?.lineTextColor;
  const delay = basic?.delay ?? v?.delay_seconds ?? 0;
  // Trains take punctuality from a different feed than their positions, so "we don't know" is
  // a real state here — distinct from on time. Prefer the WS flag, then the REST one.
  const delayKnown = basic?.delayKnown ?? v?.delay_known ?? false;
  const d = formatDelay(delay, delayKnown);

  const lat = basic?.lat ?? v?.lat;
  const lon = basic?.lon ?? v?.lon;
  const reportsAtStop = basic?.atStop ?? v?.at_stop ?? false;

  // The trip plan holds every scheduled stop; which of them are still ahead depends on where
  // the vehicle is now, so it's derived here rather than asked of the server on every poll.
  // Recomputed as the clock ticks, so a stop drops off the list the moment it's behind us
  // instead of at the next poll.
  const upcomingFrom = trip
    ? upcomingFromIndex(trip.stops, { lat, lon, atStop: reportsAtStop, delay }, now)
    : 0;
  const stops = trip ? trip.stops.slice(upcomingFrom) : [];

  return {
    id,
    ended,
    op,
    badgeBg: lineColor ? `#${lineColor}` : op.style.bg,
    badgeFg: lineTextColor ? `#${lineTextColor}` : op.style.fg,
    line: v?.line_public_number ?? basic?.line ?? "?",
    destination: v?.destination ?? basic?.destination ?? "—",
    // The WS enum is the richer source, but it is 0 (unspecified) until the vehicle has been
    // enriched — and on a cold page open there is no WS frame at all, only the REST string.
    typeText: t(basic?.type ? TYPE_KEYS[basic.type] ?? "type.vehicle" : typeKeyOf(v?.vehicle_type ?? "")),
    delayKind: d.kind,
    delayText:
      d.kind === "ontime" ? t("delay.onTime") : d.kind === "unknown" ? t("delay.unknown") : d.text,
    delay,
    speedKmh: basic?.speedKmh ?? v?.speed_kmh ?? null,
    operatorName: v?.operator_name ?? basic?.operator ?? "",
    vehicleNumber: v?.vehicle_number ?? basic?.vehicleNumber ?? "",
    blockCode: v?.block_code ?? basic?.block ?? "",
    journeyNumber: v?.journey_number ?? basic?.journey ?? "",
    lastUpdate: v?.last_update ?? null,
    lat,
    lon,
    // "At stop" only when the vehicle both reports at-stop AND is actually next to the first
    // upcoming stop (which is the stop nearest the vehicle).
    atStop:
      reportsAtStop &&
      stops.length > 0 &&
      lat != null &&
      lon != null &&
      distanceMeters(lat, lon, stops[0].lat, stops[0].lon) <= AT_STOP_RADIUS_M,
    stops,
    upcomingFrom,
  };
}
