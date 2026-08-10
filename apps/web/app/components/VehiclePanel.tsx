import { useRef, useState } from "react";
import type { Vehicle, VehicleDetail, VehicleTripPlan } from "@ovlive/api-types";
import { etaLabel, useNow } from "../lib/clock";
import {
  distanceMeters,
  etaSeconds,
  formatDelay,
  isoToClock,
  resolveOperator,
  secsToClock,
  updateAge,
} from "../lib/format";
import { expectedTime, upcomingStops } from "../lib/trip";
import { useI18n, type TFn } from "../lib/i18n";
import { Sheet } from "./Sheet";

/** Shareable deep link to a vehicle: current page + `?v=<id>`. */
function vehicleShareUrl(id: string): string {
  return `${location.origin}${location.pathname}?v=${encodeURIComponent(id)}`;
}

/**
 * The header chips carry icons because on mobile their labels are visually hidden
 * (`.vpanel-head` in the `max-width: 640px` block): three labelled chips wrap to a second row, and the
 * header is the fixed cost of every sheet snap. The icon has to say what the label did,
 * so these are the conventional ones — crosshair for tracking, funnel for narrowing the
 * map down to one vehicle, chain link for the copyable URL — sized to sit on the text
 * baseline at 15px.
 */
function ChipIcon({ children, filled = false }: { children: React.ReactNode; filled?: boolean }) {
  return (
    <svg
      className="chip-icon"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const IconFollow = (
  <ChipIcon>
    <circle cx="12" cy="12" r="7" />
    <path d="M12 2.4v3.1M12 18.5v3.1M2.4 12h3.1M18.5 12h3.1" />
    <circle className="chip-icon-dot" cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
  </ChipIcon>
);
const IconIsolate = (filled: boolean) => (
  <ChipIcon filled={filled}>
    <path d="M3.6 5h16.8l-6.7 7.7v5.7l-3.4 2.1v-7.8L3.6 5Z" />
  </ChipIcon>
);
const IconShare = (
  <ChipIcon>
    <path d="M10.2 13.8a4.2 4.2 0 0 0 6 0l2.4-2.4a4.2 4.2 0 0 0-6-6l-1.2 1.2" />
    <path d="M13.8 10.2a4.2 4.2 0 0 0-6 0l-2.4 2.4a4.2 4.2 0 0 0 6 6l1.2-1.2" />
  </ChipIcon>
);
const IconCheck = (
  <ChipIcon>
    <path d="M4.8 12.6 9.6 17.4 19.2 6.8" />
  </ChipIcon>
);

/** A chip that copies a deep link to the active vehicle, briefly confirming "Copied". */
function ShareButton({ id, t }: { id: string; t: TFn }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  async function copy() {
    const url = vehicleShareUrl(id);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for non-secure contexts / browsers without the async clipboard API.
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {}
      ta.remove();
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }
  const label = copied ? t("action.copied") : t("action.share");
  return (
    <button
      className={`follow-chip ${copied ? "active" : ""}`}
      onClick={copy}
      title={label}
    >
      {copied ? IconCheck : IconShare}
      <span className="chip-label">{label}</span>
    </button>
  );
}

/**
 * How old the vehicle's last position fix is, so the user can tell live data from a vehicle
 * that has gone quiet.
 */
function LastUpdate({ iso, now, t }: { iso: string; now: number; t: TFn }) {
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

export interface Selected {
  id: string;
  basic?: Vehicle;
  /** The trip we were watching ended (vehicle removed from the live stream). */
  ended?: boolean;
  /** If the same vehicle is live again on a *different* trip, its new state — offer to switch. */
  replacement?: Vehicle;
}

const TYPE_KEYS = ["type.vehicle", "type.bus", "type.tram", "type.metro", "type.train", "type.ferry"];

// Max distance (m) from the first upcoming stop for the vehicle to count as "at" it —
// guards against a stale at_stop flag labelling a stop the vehicle isn't actually near.
const AT_STOP_RADIUS_M = 150;

interface Props {
  selected: Selected[];
  activeId: string;
  detail: VehicleDetail | null;
  /** Static half of the detail: route shape + the trip's scheduled stops. Null while loading. */
  trip: VehicleTripPlan | null;
  following: boolean;
  isolate: boolean;
  onToggleIsolate: () => void;
  onFollow: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onClose: () => void;
  /** Switch this tab to the vehicle's current (replacement) trip. */
  onResume: (id: string) => void;
}

export function VehiclePanel({
  selected,
  activeId,
  detail,
  trip,
  following,
  isolate,
  onToggleIsolate,
  onFollow,
  onSelectTab,
  onCloseTab,
  onClose,
  onResume,
}: Props) {
  const { t } = useI18n();
  const now = useNow();
  const activeSel = selected.find((s) => s.id === activeId);
  const basic = activeSel?.basic;
  const ended = !!activeSel?.ended;
  const replacement = activeSel?.replacement;
  // When the watched trip has ended, ignore live detail (it may already have moved on to the
  // vehicle's next trip) and freeze on the last-known info for this trip.
  const v = ended ? undefined : detail?.vehicle;
  const id = activeId;
  const dataowner = v?.dataowner ?? basic?.dataowner ?? id.split(":")[0];
  // The public operator to show (GTFS brand over the raw dataowner code), matching the marker.
  const op = resolveOperator(dataowner, v?.operator_name ?? basic?.operator);
  // Prefer the line's official GTFS colour for its number badge; fall back to operator brand.
  const lineColor = v?.line_color ?? basic?.lineColor;
  const lineTextColor = v?.line_text_color ?? basic?.lineTextColor;
  const badgeBg = lineColor ? `#${lineColor}` : op.style.bg;
  const badgeFg = lineTextColor ? `#${lineTextColor}` : op.style.fg;
  const line = v?.line_public_number ?? basic?.line ?? "?";
  const destination = v?.destination ?? basic?.destination ?? "—";
  const liveDelay = basic?.delay ?? v?.delay_seconds ?? 0;
  // Trains take punctuality from a different feed than their positions, so "we don't know" is
  // a real state here — distinct from on time. Prefer the WS flag, then the REST one.
  const delayKnown = basic?.delayKnown ?? v?.delay_known ?? false;
  const delay = formatDelay(liveDelay, delayKnown);
  const delayText =
    delay.kind === "ontime"
      ? t("delay.onTime")
      : delay.kind === "unknown"
        ? t("delay.unknown")
        : delay.text;
  const type = basic?.type ?? 0;
  const typeText = t(TYPE_KEYS[type] ?? "type.vehicle");

  const vehLat = basic?.lat ?? v?.lat;
  const vehLon = basic?.lon ?? v?.lon;
  const reportsAtStop = basic?.atStop ?? v?.at_stop ?? false;

  // The trip plan holds every scheduled stop; which of them are still ahead depends on where
  // the vehicle is now, so it's derived here rather than asked of the server on every poll.
  // Recomputed as the clock ticks, so a stop drops off the list the moment it's behind us
  // instead of at the next poll.
  const stops = trip
    ? upcomingStops(trip.stops, { lat: vehLat, lon: vehLon, atStop: reportsAtStop, delay: liveDelay }, now)
    : [];

  // "At stop" only when the vehicle both reports at-stop AND is actually next to the first
  // upcoming stop (which is the stop nearest the vehicle).
  const atStop =
    reportsAtStop &&
    stops.length > 0 &&
    vehLat != null &&
    vehLon != null &&
    distanceMeters(vehLat, vehLon, stops[0].lat, stops[0].lon) <= AT_STOP_RADIUS_M;

  // Swipe left/right (touch or mouse drag) to move between selected vehicles. We only
  // capture the pointer once the gesture is clearly horizontal, so vertical scrolling of
  // the stops list still works (the container has `touch-action: pan-y`).
  const down = useRef<{ x: number; y: number; capturing: boolean } | null>(null);
  function onPointerDown(e: React.PointerEvent) {
    if (selected.length < 2 || (e.target as HTMLElement).closest("button, a, input")) {
      down.current = null;
      return;
    }
    down.current = { x: e.clientX, y: e.clientY, capturing: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    const s = down.current;
    if (!s || s.capturing) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
      s.capturing = true;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    const s = down.current;
    down.current = null;
    if (!s || !s.capturing) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) < 45) return;
    const idx = selected.findIndex((x) => x.id === activeId);
    const n = selected.length;
    const nextIdx = dx < 0 ? (idx + 1) % n : (idx - 1 + n) % n;
    onSelectTab(selected[nextIdx].id);
  }

  return (
    <Sheet
      onClose={onClose}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <button className="icon-close" onClick={onClose} aria-label={t("action.close")}>✕</button>

      {selected.length > 1 && (
        <div className="vtabs" role="tablist">
          {selected.map((s) => {
            const o = s.basic?.dataowner ?? s.id.split(":")[0];
            const l = s.basic?.line || "?";
            const tabColor = s.basic?.lineColor
              ? `#${s.basic.lineColor}`
              : resolveOperator(o, s.basic?.operator).style.bg;
            const active = s.id === activeId;
            return (
              <div
                key={s.id}
                role="tab"
                aria-selected={active}
                className={`vtab ${active ? "active" : ""} ${s.ended ? "ended" : ""}`}
                onClick={() => onSelectTab(s.id)}
              >
                <span className="vtab-badge" style={{ background: tabColor }}>{l}</span>
                <button
                  className="vtab-close"
                  aria-label={t("action.removeSel")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(s.id);
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className={`vpanel-head ${ended ? "ended" : ""}`}>
        <div className="vpanel-title">
          <span className="vpanel-line" style={{ background: badgeBg, color: badgeFg }}>{line}</span>
          <div className="vpanel-meta">
            <div className="vpanel-sub">{op.label} · {typeText}</div>
            {!ended && <span className={`delay-badge delay-${delay.kind}`}>{delayText}</span>}
          </div>
        </div>
        <div className="vpanel-dest">{destination}</div>

        {!ended && (
          <div className="follow-row">
            {following ? (
              <span className="follow-chip live" title={t("follow.following")}>
                {IconFollow}
                <span className="chip-label">{t("follow.following")}</span>
              </span>
            ) : (
              <button
                className="follow-chip"
                onClick={onFollow}
                title={t("follow.follow")}
              >
                {IconFollow}
                <span className="chip-label">{t("follow.follow")}</span>
              </button>
            )}
            <button
              className={`follow-chip ${isolate ? "active" : ""}`}
              aria-pressed={isolate}
              onClick={onToggleIsolate}
              title={isolate ? t("isolate.showAll") : t("isolate.only")}
            >
              {IconIsolate(isolate)}
              <span className="chip-label">{isolate ? t("isolate.showAll") : t("isolate.only")}</span>
            </button>
            <ShareButton id={id} t={t} />
          </div>
        )}
      </div>

      {ended ? (
        <div className="vpanel-body">
          <div className="ended-banner">
            <div className="ended-title">⚠ {t("ended.title")}</div>
            <div className="ended-sub">
              {t("ended.sub", { veh: basic?.vehicleNumber || id.split(":")[1] || "" })}
            </div>
          </div>

          {replacement ? (
            <div className="replacement-card">
              <div className="replacement-label">{t("ended.nowRunning")}</div>
              <div className="replacement-trip">
                <span
                  className="vpanel-line sm"
                  style={{
                    background: replacement.lineColor ? `#${replacement.lineColor}` : op.style.bg,
                    color: replacement.lineTextColor ? `#${replacement.lineTextColor}` : op.style.fg,
                  }}
                >
                  {replacement.line || "?"}
                </span>
                <span className="replacement-dest">{replacement.destination || "—"}</span>
              </div>
              <button className="follow-chip active" onClick={() => onResume(id)}>
                {t("ended.viewCurrent")}
              </button>
            </div>
          ) : (
            <div className="vpanel-sub">{t("ended.noReplacement")}</div>
          )}

          <div className="follow-row">
            <ShareButton id={id} t={t} />
          </div>
        </div>
      ) : (
      <div className="vpanel-body">
        {atStop && <div className="at-stop">● {t("atStop.banner")}</div>}

        <div className="meta-grid">
          <div><div className="k">{t("meta.operator")}</div><div className="v">{v?.operator_name ?? "—"}</div></div>
          <div><div className="k">{t("meta.vehicle")}</div><div className="v">{v?.vehicle_number ?? basic?.vehicleNumber ?? "—"}</div></div>
          <div><div className="k">{t("meta.block")}</div><div className="v">{v?.block_code ?? basic?.block ?? "—"}</div></div>
          <div><div className="k">{t("meta.journey")}</div><div className="v">{v?.journey_number ?? basic?.journey ?? "—"}</div></div>
        </div>

        {v?.last_update && <LastUpdate iso={v.last_update} now={now} t={t} />}

        <h3 className="section-title">{t("stops.next")}</h3>
        {!trip && <div className="vpanel-sub">{t("stops.loading")}</div>}
        {trip && stops.length === 0 && <div className="vpanel-sub">{t("stops.none")}</div>}
        <ul className="stops">
          {stops.map((s, i) => {
            const current = atStop && i === 0; // vehicle is at the first not-yet-departed stop
            // Expected is the schedule shifted by the vehicle's live delay — the endpoint
            // sends schedule only, precisely so it doesn't have to be re-sent as the delay
            // moves.
            const arrival = expectedTime(s.scheduled_arrival, liveDelay);
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
                    className={`eta eta-${differ ? delay.kind : "ontime"}`}
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
      </div>
      )}
    </Sheet>
  );
}
