// What a vehicle "reads as": the header identity, the meta grid, the freshness line and the
// upcoming-stops list. Shared verbatim by the map's vehicle panel (VehiclePanel) and the
// standalone vehicle page (routes/vehicle.tsx), so the two can never drift into showing the
// same vehicle differently.
//
// Everything here derives from state the client already holds — the live WS frame, the polled
// detail and the once-fetched trip plan — see `vehicleView` for which side wins per field.

import type { TripStop, Vehicle, VehicleDetail, VehicleTripPlan } from "@ovlive/api-types";
import { etaLabel } from "../lib/clock";
import {
  distanceMeters,
  etaSeconds,
  formatDelay,
  isoToClock,
  resolveOperator,
  secsToClock,
  typeKeyOf,
  updateAge,
  type Operator,
} from "../lib/format";
import { expectedTime, upcomingFromIndex } from "../lib/trip";
import type { TFn } from "../lib/i18n";

const TYPE_KEYS = ["type.vehicle", "type.bus", "type.tram", "type.metro", "type.train", "type.ferry"];

// Max distance (m) from the first upcoming stop for the vehicle to count as "at" it —
// guards against a stale at_stop flag labelling a stop the vehicle isn't actually near.
const AT_STOP_RADIUS_M = 150;

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

/**
 * Line badge, operator + type, punctuality and destination. A fragment, not a wrapper: the
 * mobile sheet lays `.vpanel-head` out as a grid whose items are exactly these, so an extra
 * element here would break that layout (`.vpanel-title` is `display: contents` there).
 */
export function VehicleIdentity({ view, showDelay = true }: { view: VehicleView; showDelay?: boolean }) {
  return (
    <>
      <div className="vpanel-title">
        <span className="vpanel-line" style={{ background: view.badgeBg, color: view.badgeFg }}>
          {view.line}
        </span>
        <div className="vpanel-meta">
          <div className="vpanel-sub">
            {view.op.label} · {view.typeText}
          </div>
          {showDelay && <span className={`delay-badge delay-${view.delayKind}`}>{view.delayText}</span>}
        </div>
      </div>
      <div className="vpanel-dest">{view.destination}</div>
    </>
  );
}

/** Operator, vehicle number, block and journey — the identifiers, none of which move. */
export function VehicleMeta({ view, t }: { view: VehicleView; t: TFn }) {
  return (
    <div className="meta-grid">
      <div>
        <div className="k">{t("meta.operator")}</div>
        <div className="v">{view.operatorName || "—"}</div>
      </div>
      <div>
        <div className="k">{t("meta.vehicle")}</div>
        <div className="v">{view.vehicleNumber || "—"}</div>
      </div>
      <div>
        <div className="k">{t("meta.block")}</div>
        <div className="v">{view.blockCode || "—"}</div>
      </div>
      <div>
        <div className="k">{t("meta.journey")}</div>
        <div className="v">{view.journeyNumber || "—"}</div>
      </div>
    </div>
  );
}

/**
 * How old the vehicle's last position fix is, so the user can tell live data from a vehicle
 * that has gone quiet.
 */
export function LastUpdate({ iso, now, t }: { iso: string; now: number; t: TFn }) {
  const age = updateAge(iso, now);
  if (!age) return null;
  const { secs, kind } = age;
  const text =
    secs < 10
      ? t("age.now")
      : secs < 60
        ? t("age.secs", { n: secs })
        : secs < 3600
          ? t("age.mins", { n: Math.floor(secs / 60) })
          : t("age.hours", { n: Math.floor(secs / 3600) });

  return (
    <div className={`last-update age-${kind}`} title={t("age.at", { time: isoToClock(iso) })}>
      <span className="age-dot" />
      <span className="age-label">{t("age.label")}</span>
      <span className="age-value">{text}</span>
    </div>
  );
}

/**
 * The live measurements that sit between the identifiers and the stop list: how fast the
 * vehicle is going, and how old its last fix is.
 *
 * Speed is here rather than in `VehicleMeta` because it moves — and it appears at all only
 * for vehicles whose feed measures it. That is NS trains only: KV6 has no speed element, so
 * a bus or metro shows nothing here rather than a fabricated 0.
 */
export function VehicleTelemetry({ view, now, t }: { view: VehicleView; now: number; t: TFn }) {
  const speed = view.speedKmh;
  if (speed == null && !view.lastUpdate) return null;
  return (
    <div className="telemetry">
      {speed != null && (
        <div className="speed-stat">
          <span className="speed-label">{t("speed.label")}</span>
          {/* Whole km/h. The GPS resolves hundredths — a standing train reports 0.03 — which
              is noise at this granularity, and the stream only bothers to re-send a speed
              once it has moved by a whole unit. */}
          <span className="speed-value">{t("speed.value", { n: Math.round(speed) })}</span>
        </div>
      )}
      {view.lastUpdate && <LastUpdate iso={view.lastUpdate} now={now} t={t} />}
    </div>
  );
}

/**
 * Arrival and departure as one clock label: `"10:04"` when they land on the same minute,
 * `"10:04–10:06"` when the scheduled dwell is long enough to show at that resolution.
 */
function clockRange(arrive: number, depart: number): string {
  const a = secsToClock(arrive);
  const d = secsToClock(depart);
  return a === d ? a : `${a}–${d}`;
}

/** The calls still ahead, each with its countdown and its delay-adjusted clock times. */
export function UpcomingStops({
  view,
  loading,
  now,
  t,
}: {
  view: VehicleView;
  /** The trip plan hasn't arrived yet — distinct from a trip that matched no schedule. */
  loading: boolean;
  now: number;
  t: TFn;
}) {
  return (
    <>
      <h3 className="section-title">{t("stops.next")}</h3>
      {loading && <div className="vpanel-sub">{t("stops.loading")}</div>}
      {!loading && view.stops.length === 0 && <div className="vpanel-sub">{t("stops.none")}</div>}
      <ul className="stops">
        {view.stops.map((s, i) => {
          const current = view.atStop && i === 0; // vehicle is at the first not-yet-departed stop
          // Counted from the trip's first call, not from this list — the stops behind the
          // vehicle keep their numbers, so "stop 4" means the same thing here, on the map and
          // an hour into the trip. (GTFS `stop_sequence` can't be it: it only has to increase
          // along the trip, so it is not a position.)
          const number = view.upcomingFrom + i + 1;
          // Expected is the schedule shifted by the vehicle's live delay — the endpoint
          // sends schedule only, precisely so it doesn't have to be re-sent as the delay
          // moves. One trip-level delay shifts arrival and departure alike: these feeds carry
          // no per-stop realtime to tell them apart (see the UserStopCode note in CLAUDE.md).
          const arrival = expectedTime(s.scheduled_arrival, view.delay);
          const departure = expectedTime(s.scheduled_departure, view.delay);
          // Arrival and departure are the same instant for ~91% of the feed's calls (measured
          // on gtfs-nl: 94% of bus calls, 68% of train calls, and 100.0% of every trip's first
          // and last call), and where they differ the dwell is often shorter than the minute
          // this renders at — 5% of all calls actually land on two different clock times. So
          // the pair is shown as a range only where it reads as one, rather than printing the
          // same number twice at nearly every stop.
          const planned = clockRange(s.scheduled_arrival, s.scheduled_departure);
          const expected = clockRange(arrival, departure);
          const differ = planned !== expected; // only distinct once the delay moves it a minute
          // Countdown against the delay-adjusted *arrival*: the question it answers is when
          // the vehicle gets here, so a scheduled dwell must not push it forward.
          const eta = etaSeconds(arrival, now);
          return (
            <li key={s.stop_id + s.stop_sequence} className={current ? "current" : ""}>
              <span className="stop-num" title={t("stops.nth", { n: number })}>
                {number}
              </span>
              <span className="stop-name">
                {current && <span className="stop-now">{t("atStop.badge")}</span>}
                <span className="stop-label">{s.name}</span>
              </span>
              <span className="stop-time">
                <span
                  className={`eta eta-${differ ? view.delayKind : "ontime"}`}
                  title={
                    departure > arrival
                      ? t("eta.titleDwell", {
                          arrive: secsToClock(arrival),
                          depart: secsToClock(departure),
                        })
                      : t("eta.title", { time: secsToClock(arrival) })
                  }
                >
                  {current ? t("eta.now") : etaLabel(eta, t)}
                </span>
                <span className="stop-clock">
                  {differ && <span className="planned">{planned}</span>}
                  <span className="expected">{expected}</span>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
