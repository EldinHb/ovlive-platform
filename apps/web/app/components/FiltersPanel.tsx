import { useState } from "react";
import { VehicleType, type FilterState, type VehicleSummary } from "@ovlive/api-types";
import { resolveOperator, typeKeyOf } from "../lib/format";
import { useI18n } from "../lib/i18n";

const TYPES: { t: VehicleType; key: string }[] = [
  { t: VehicleType.BUS, key: "type.bus" },
  { t: VehicleType.TRAM, key: "type.tram" },
  { t: VehicleType.METRO, key: "type.metro" },
  { t: VehicleType.TRAIN, key: "type.train" },
  { t: VehicleType.FERRY, key: "type.ferry" },
];

/** Below this, a query matches so much of the country that the list is noise. */
export const MIN_QUERY = 2;

interface Props {
  filters: FilterState;
  operators: string[];
  onChange: (f: FilterState) => void;
  /** The search box is a lookup, not a filter — the map keeps showing everything. */
  query: string;
  onQueryChange: (q: string) => void;
  /** Matches for `query`; null while nothing has been searched yet. */
  results: VehicleSummary[] | null;
  /** How many matched in total — more than `results.length` when the server capped it. */
  total: number;
  searching: boolean;
  /** Pan to this vehicle and select it. */
  onPick: (v: VehicleSummary) => void;
}

export function FiltersPanel({
  filters,
  operators,
  onChange,
  query,
  onQueryChange,
  results,
  total,
  searching,
  onPick,
}: Props) {
  const { t } = useI18n();
  // Collapsed by default on small screens, open on desktop — but always open when filters were
  // restored from a previous visit, so a partly-empty map is explained by visible active chips
  // rather than only by the count badge on the collapsed header.
  const [open, setOpen] = useState(() => {
    if (filters.types.length || filters.owners.length) return true;
    return typeof window !== "undefined" ? window.innerWidth > 640 : true;
  });

  function toggleType(t: VehicleType) {
    const types = filters.types.includes(t)
      ? filters.types.filter((x) => x !== t)
      : [...filters.types, t];
    onChange({ ...filters, types });
  }
  function toggleOwner(o: string) {
    const owners = filters.owners.includes(o)
      ? filters.owners.filter((x) => x !== o)
      : [...filters.owners, o];
    onChange({ ...filters, owners });
  }

  // The chips filter the map; the query does not, so it isn't counted here.
  const activeCount = filters.types.length + filters.owners.length;
  const searched = query.trim().length >= MIN_QUERY;

  return (
    <div className={`filters panel ${open ? "open" : "collapsed"}`}>
      <button className="filters-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{t("filter.title")}</span>
        {activeCount > 0 && <span className="filters-count">{activeCount}</span>}
        <span className="chev" aria-hidden>{open ? "▼" : "▶"}</span>
      </button>

      {open && (
        <div className="filters-body">
          <div className="chip-row">
            {TYPES.map(({ t: vt, key }) => (
              <button
                key={vt}
                className={`chip ${filters.types.includes(vt) ? "on" : ""}`}
                onClick={() => toggleType(vt)}
              >
                {t(key)}
              </button>
            ))}
          </div>
          {operators.length > 0 && (
            <div className="chip-row">
              {operators.map((o) => (
                <button
                  key={o}
                  className={`chip ${filters.owners.includes(o) ? "on" : ""}`}
                  onClick={() => toggleOwner(o)}
                >
                  {o}
                </button>
              ))}
            </div>
          )}

          <div className="search-wrap">
            <input
              className="search"
              placeholder={t("filter.search")}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              // Enter picks the top hit, which is the one the ranking put there.
              onKeyDown={(e) => {
                if (e.key === "Enter" && results?.length) onPick(results[0]);
              }}
              aria-label={t("filter.search")}
            />
            {query && (
              <button
                className="search-clear"
                onClick={() => onQueryChange("")}
                aria-label={t("search.clear")}
                title={t("search.clear")}
              >
                ✕
              </button>
            )}
          </div>

          {searched && (
            <div className="results">
              {searching && !results && <div className="results-note">{t("search.searching")}</div>}
              {results?.length === 0 && !searching && (
                <div className="results-note">{t("search.none")}</div>
              )}
              {!!results?.length && (
                <>
                  <ul className="results-list">
                    {results.map((v) => (
                      <ResultRow key={v.id} v={v} onPick={onPick} />
                    ))}
                  </ul>
                  {total > results.length && (
                    <div className="results-note">
                      {t("search.more", { shown: results.length, total })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultRow({ v, onPick }: { v: VehicleSummary; onPick: (v: VehicleSummary) => void }) {
  const { t } = useI18n();
  // Same resolution as the map markers and the departure board, so a hit is recognisably the
  // vehicle you'll be looking at once the map pans there.
  const op = resolveOperator(v.dataowner, v.operator_name);
  const bg = v.line_color ? `#${v.line_color}` : op.style.bg;
  const fg = v.line_text_color ? `#${v.line_text_color}` : op.style.fg;

  return (
    <li className="res">
      <button className="res-btn" onClick={() => onPick(v)} title={t("search.open")}>
        <span className="dep-line" style={{ background: bg, color: fg }}>
          {v.line_public_number || "?"}
        </span>
        <span className="dep-text">
          <span className="dep-dest">{v.destination || t("search.noDest")}</span>
          <span className="dep-sub">
            {op.label} · {t(typeKeyOf(v.vehicle_type))} · {v.vehicle_number}
          </span>
        </span>
        <span className="dep-chevron" aria-hidden>›</span>
      </button>
    </li>
  );
}
