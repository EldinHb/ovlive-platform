import { useRef, useState } from "react";
import type { Vehicle, VehicleDetail } from "@ovlive/api-types";
import { etaLabel, useNow } from "../lib/clock";
import {
  distanceMeters,
  etaSeconds,
  formatDelay,
  isoToClock,
  resolveOperator,
  secsToClock,
  unixToClock,
  updateAge,
} from "../lib/format";
import { useI18n, type TFn } from "../lib/i18n";

/** Shareable deep link to a vehicle: current page + `?v=<id>`. */
function vehicleShareUrl(id: string): string {
  return `${location.origin}${location.pathname}?v=${encodeURIComponent(id)}`;
}

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
  return (
    <button
      className={`follow-chip ${copied ? "active" : ""}`}
      onClick={copy}
      title={t("action.share")}
    >
      {copied ? `✓ ${t("action.copied")}` : `🔗 ${t("action.share")}`}
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
  loading: boolean;
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
  loading,
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

  // Predicted next line this vehicle becomes (KV78Turbo block/omloop chaining). Prefer the
  // REST detail's next_trip; fall back to the WS VehicleState fields carried on `basic`.
  const next =
    detail?.next_trip && detail.next_trip.line_public_number
      ? {
          line: detail.next_trip.line_public_number,
          dest: detail.next_trip.destination,
          start: detail.next_trip.start_unix,
        }
      : basic?.nextLine
        ? { line: basic.nextLine, dest: basic.nextDestination, start: basic.nextStart }
        : null;

  // "At stop" only when the vehicle both reports at-stop AND is actually next to the first
  // upcoming stop (which, server-side, is the stop nearest the vehicle).
  const stops = detail?.upcoming_stops ?? [];
  const vehLat = basic?.lat ?? v?.lat;
  const vehLon = basic?.lon ?? v?.lon;
  const reportsAtStop = basic?.atStop ?? v?.at_stop ?? false;
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
    <aside
      className="vpanel panel"
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
                <span className="live-dot" /> {t("follow.following")}
              </span>
            ) : (
              <button className="follow-chip" onClick={onFollow}>◎ {t("follow.follow")}</button>
            )}
            <button
              className={`follow-chip ${isolate ? "active" : ""}`}
              aria-pressed={isolate}
              onClick={onToggleIsolate}
              title={isolate ? t("isolate.showAll") : t("isolate.only")}
            >
              {isolate ? `◉ ${t("isolate.showAll")}` : `○ ${t("isolate.only")}`}
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

        {next && (
          <div className="next-trip">
            <div className="next-trip-label">→ {t("next.title")}</div>
            <div className="next-trip-row">
              <span className="vpanel-line sm" style={{ background: op.style.bg, color: op.style.fg }}>
                {next.line}
              </span>
              <span className="next-trip-dest">{next.dest || "—"}</span>
              {next.start ? (
                <span className="next-trip-time">{t("next.at", { time: unixToClock(next.start) })}</span>
              ) : null}
            </div>
          </div>
        )}

        <h3 className="section-title">{t("stops.next")}</h3>
        {loading && !detail && <div className="vpanel-sub">{t("stops.loading")}</div>}
        {detail && detail.upcoming_stops.length === 0 && (
          <div className="vpanel-sub">{t("stops.none")}</div>
        )}
        <ul className="stops">
          {detail?.upcoming_stops.map((s, i) => {
            const current = atStop && i === 0; // vehicle is at the first not-yet-departed stop
            const planned = secsToClock(s.scheduled_arrival);
            const expected = secsToClock(s.scheduled_arrival + liveDelay);
            const differ = planned !== expected; // only distinct once they differ by a minute
            // Countdown against the delay-adjusted arrival — that's the time the vehicle is
            // actually expected, so the number tracks the live delay as it changes.
            const eta = etaSeconds(s.scheduled_arrival + liveDelay, now);
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
    </aside>
  );
}
