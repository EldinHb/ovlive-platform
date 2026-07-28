import type { StopDeparture, StopDeparturesResponse } from "@ovlive/api-types";
import { etaLabel, useNow } from "../lib/clock";
import { etaSeconds, formatDelay, resolveOperator, secsToClock } from "../lib/format";
import { useI18n } from "../lib/i18n";

const TYPE_KEYS: Record<string, string> = {
  bus: "type.bus",
  tram: "type.tram",
  metro: "type.metro",
  train: "type.train",
  ferry: "type.ferry",
};

interface Props {
  board: StopDeparturesResponse | null;
  loading: boolean;
  /** Open the live vehicle running this departure (selects + pans to it, closing this panel). */
  onSelectVehicle: (d: StopDeparture) => void;
  onClose: () => void;
}

/**
 * Departure board for the stop the user clicked on the map. Rows whose trip has a live
 * vehicle are buttons that hand off to the vehicle panel; the rest are schedule-only, because
 * a vehicle only appears in the feed once its journey has started (so the very next departure
 * is often not yet trackable — that is the feed, not a bug).
 */
export function StopPanel({ board, loading, onSelectVehicle, onClose }: Props) {
  const { t } = useI18n();
  const now = useNow();
  const stop = board?.stop;
  // gtfs-nl names stops "<place>, <stop>"; show the place as the quieter second line.
  const [place, name] = splitStopName(stop?.name ?? "");

  return (
    <aside className="vpanel panel">
      <button className="icon-close" onClick={onClose} aria-label={t("action.close")}>✕</button>

      <div className="vpanel-head">
        <div className="stop-head">
          <span className="stop-pin" aria-hidden>◉</span>
          <div className="stop-head-text">
            <div className="stop-title">
              {name || t("stop.title")}
              {stop?.platform_code && <span className="stop-platform">{stop.platform_code}</span>}
            </div>
            {place && <div className="vpanel-sub">{place}</div>}
          </div>
        </div>
      </div>

      <div className="vpanel-body">
        <h3 className="section-title">{t("stop.departures")}</h3>
        {loading && !board && <div className="vpanel-sub">{t("stops.loading")}</div>}
        {board && board.departures.length === 0 && (
          <div className="vpanel-sub">{t("stop.none")}</div>
        )}

        <ul className="deps">
          {board?.departures.map((d) => (
            <DepartureRow
              key={`${d.trip_id}:${d.stop_sequence}`}
              d={d}
              now={now}
              onSelect={onSelectVehicle}
            />
          ))}
        </ul>

        {board && board.departures.length > 0 && (
          <div className="vpanel-sub stop-foot">{t("stop.liveHint")}</div>
        )}
      </div>
    </aside>
  );
}

function DepartureRow({
  d,
  now,
  onSelect,
}: {
  d: StopDeparture;
  now: number;
  onSelect: (d: StopDeparture) => void;
}) {
  const { t } = useI18n();
  // Resolve the operator the same way the map markers do: the GTFS agency, falling back to
  // the dataowner prefix of the realtime id, so badge colours match the vehicle on the map.
  const op = resolveOperator(d.realtime_trip_id?.split(":")[0] ?? "", d.operator);
  const bg = d.line_color ? `#${d.line_color}` : op.style.bg;
  const fg = d.line_text_color ? `#${d.line_text_color}` : op.style.fg;
  const live = !!d.vehicle_id;
  // `delay_seconds` is null when the running vehicle hasn't reported punctuality (trains
  // whose RitInfo we haven't seen), which must not read as on time.
  const delayKnown = d.delay_seconds != null;
  const delay = formatDelay(d.delay_seconds ?? 0, delayKnown);
  const planned = secsToClock(d.scheduled_departure);
  const expected = secsToClock(d.expected_departure);
  const differ = planned !== expected; // only distinct once the delay moves it by a minute
  const eta = etaLabel(etaSeconds(d.expected_departure, now), t);
  const typeText = t(TYPE_KEYS[d.vehicle_type] ?? "type.vehicle");

  const body = (
    <>
      <span className="dep-line" style={{ background: bg, color: fg }}>{d.line || "?"}</span>
      <span className="dep-text">
        <span className="dep-dest">{d.headsign || "—"}</span>
        <span className="dep-sub">
          {live && <span className="live-dot" title={t("stop.live")} />}
          {op.label} · {typeText}
          {live && delayKnown && d.delay_seconds !== 0 && (
            <span className={`dep-delay delay-${delay.kind}`}>{delay.text}</span>
          )}
        </span>
      </span>
      <span className="stop-time">
        <span className={`eta eta-${live && differ && delayKnown ? delay.kind : "ontime"}`}>{eta}</span>
        <span className="stop-clock">
          {differ && <span className="planned">{planned}</span>}
          <span className="expected">{expected}</span>
        </span>
      </span>
    </>
  );

  if (!live) {
    return <li className="dep static">{body}</li>;
  }
  return (
    <li className="dep">
      <button className="dep-btn" onClick={() => onSelect(d)} title={t("stop.openVehicle")}>
        {body}
        <span className="dep-chevron" aria-hidden>›</span>
      </button>
    </li>
  );
}

/** "Amsterdam, Rokin" -> ["Amsterdam", "Rokin"]; a name without a comma stays whole. */
function splitStopName(full: string): [string, string] {
  const i = full.indexOf(", ");
  return i < 0 ? ["", full] : [full.slice(0, i), full.slice(i + 2)];
}
