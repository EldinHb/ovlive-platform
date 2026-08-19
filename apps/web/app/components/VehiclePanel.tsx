import { useRef } from "react";
import type { Vehicle, VehicleDetail, VehicleTripPlan } from "@ovlive/api-types";
import { useNow } from "../lib/clock";
import { resolveOperator } from "../lib/format";
import { useI18n } from "../lib/i18n";
import {
  IconExternal,
  IconFollow,
  IconIsolate,
  ShareButton,
  vehiclePagePath,
} from "./Chips";
import {
  UpcomingStops,
  VehicleIdentity,
  VehicleMeta,
  VehicleTelemetry,
  vehicleView,
} from "./VehicleInfo";
import { Sheet } from "./Sheet";

/** Shareable deep link to a vehicle on the map: current page + `?v=<id>`. */
function vehicleShareUrl(id: string): string {
  return `${location.origin}/?v=${encodeURIComponent(id)}`;
}

export interface Selected {
  id: string;
  basic?: Vehicle;
  /** The trip we were watching ended (vehicle removed from the live stream). */
  ended?: boolean;
  /** If the same vehicle is live again on a *different* trip, its new state — offer to switch. */
  replacement?: Vehicle;
}

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
  const id = activeId;
  const view = vehicleView({ id, basic, detail, trip, ended, now, t });

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
        <VehicleIdentity view={view} showDelay={!ended} />

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
            <ShareButton url={() => vehicleShareUrl(id)} t={t} />
            {/* A plain link, not a router navigation: the whole point is a second tab, so the
                map (and its stream) stays open behind it. */}
            <a
              className="follow-chip"
              href={vehiclePagePath(id, isolate)}
              target="_blank"
              rel="noopener noreferrer"
              title={t("detail.openTitle")}
            >
              {IconExternal}
              <span className="chip-label">{t("detail.open")}</span>
            </a>
          </div>
        )}
      </div>

      {ended ? (
        <div className="vpanel-body">
          <div className="ended-banner">
            <div className="ended-title">⚠ {t("ended.title")}</div>
            <div className="ended-sub">
              {t("ended.sub", { veh: view.vehicleNumber || id.split(":")[1] || "" })}
            </div>
          </div>

          {replacement ? (
            <div className="replacement-card">
              <div className="replacement-label">{t("ended.nowRunning")}</div>
              <div className="replacement-trip">
                <span
                  className="vpanel-line sm"
                  style={{
                    background: replacement.lineColor ? `#${replacement.lineColor}` : view.op.style.bg,
                    color: replacement.lineTextColor ? `#${replacement.lineTextColor}` : view.op.style.fg,
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
            <ShareButton url={() => vehicleShareUrl(id)} t={t} />
          </div>
        </div>
      ) : (
        <div className="vpanel-body">
          {view.atStop && <div className="at-stop">● {t("atStop.banner")}</div>}

          <VehicleMeta view={view} t={t} />

          <VehicleTelemetry view={view} now={now} t={t} />

          <UpcomingStops view={view} loading={!trip} now={now} t={t} />
        </div>
      )}
    </Sheet>
  );
}
