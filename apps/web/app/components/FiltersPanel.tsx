import { useState } from "react";
import { VehicleType, type FilterState } from "@ovlive/api-types";
import { useI18n } from "../lib/i18n";

const TYPES: { t: VehicleType; key: string }[] = [
  { t: VehicleType.BUS, key: "type.bus" },
  { t: VehicleType.TRAM, key: "type.tram" },
  { t: VehicleType.METRO, key: "type.metro" },
  { t: VehicleType.TRAIN, key: "type.train" },
  { t: VehicleType.FERRY, key: "type.ferry" },
];

interface Props {
  filters: FilterState;
  operators: string[];
  onChange: (f: FilterState) => void;
  onSearch: (q: string) => void;
}

export function FiltersPanel({ filters, operators, onChange, onSearch }: Props) {
  const { t } = useI18n();
  // Collapsed by default on small screens, open on desktop.
  const [open, setOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth > 640 : true,
  );

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

  const activeCount = filters.types.length + filters.owners.length + (filters.search ? 1 : 0);

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
          <input
            className="search"
            placeholder={t("filter.search")}
            defaultValue={filters.search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
