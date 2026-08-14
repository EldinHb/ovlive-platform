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
import { expectedTime, upcomingStops } from "../lib/trip";
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
  const stops = trip ? upcomingStops(trip.stops, { lat, lon, atStop: reportsAtStop, delay }, now) : [];

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

/** The calls still ahead, each with its countdown and its delay-adjusted clock time. */
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
          // Expected is the schedule shifted by the vehicle's live delay — the endpoint
          // sends schedule only, precisely so it doesn't have to be re-sent as the delay
          // moves.
          const arrival = expectedTime(s.scheduled_arrival, view.delay);
          const planned = secsToClock(s.scheduled_arrival);
          const expected = secsToClock(arrival);
          const differ = planned !== expected; // only distinct once they differ by a minute
          // Countdown against the delay-adjusted arrival — that's the time the vehicle is
          // actually expected, so the number tracks the live delay as it changes.
          const eta = etaSeconds(arrival, now);
          return (
            <li key={s.stop_id + s.stop_sequence} className={current ? "current" : ""}>
              <span className="stop-name">
                {current && <span className="stop-now">{t("atStop.badge")}</span>}
                <span className="stop-label">{s.name}</span>
              </span>
              <span className="stop-time">
                <span
                  className={`eta eta-${differ ? view.delayKind : "ontime"}`}
                  title={t("eta.title", { time: expected })}
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
