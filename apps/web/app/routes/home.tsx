import { useEffect, useMemo, useRef, useState } from "react";
import {
  RestClient,
  type ConnStatus,
  type FilterState,
  type StopDeparture,
  type StopDeparturesResponse,
  type Vehicle,
  type VehicleDetail,
} from "@ovlive/api-types";
import { MapView, type MapHandle } from "../components/MapView";
import { SettingsMenu } from "../components/SettingsMenu";
import { FiltersPanel } from "../components/FiltersPanel";
import { StopPanel } from "../components/StopPanel";
import { VehiclePanel, type Selected } from "../components/VehiclePanel";
import { DEFAULT_THEME, THEMES, type MapTheme } from "../lib/styles";
import {
  API_BASE,
  getSavedMultiSelect,
  getSavedShowStops,
  getSavedThemeId,
  setSavedMultiSelect,
  setSavedShowStops,
  setSavedThemeId,
} from "../lib/config";
import { I18nProvider, useI18n } from "../lib/i18n";

export function meta() {
  return [{ title: "OVLive" }];
}

// The official web app is open to everyone — no API key required. Keys exist only for
// third-party consumers of the public API.
export default function Home() {
  return (
    <I18nProvider>
      <MapApp />
    </I18nProvider>
  );
}

const EMPTY_FILTERS: FilterState = { types: [], owners: [], search: "" };
const MAX_SELECTED = 8;

function MapApp() {
  const { t, lang } = useI18n();
  const mapRef = useRef<MapHandle>(null);
  // Set from a `?v=<id>` deep link; the map recentres on this vehicle once its detail loads.
  const focusIdRef = useRef<string | null>(null);
  const [theme, setThemeState] = useState<MapTheme>(
    () => THEMES.find((t) => t.id === getSavedThemeId()) ?? DEFAULT_THEME,
  );
  const setTheme = (t: MapTheme) => {
    setThemeState(t);
    setSavedThemeId(t.id);
  };
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [count, setCount] = useState(0);
  const [operators, setOperators] = useState<string[]>([]);
  const [multiSelect, setMultiSelect] = useState<boolean>(() => getSavedMultiSelect());
  const [showStops, setShowStopsState] = useState<boolean>(() => getSavedShowStops());
  const setShowStops = (on: boolean) => {
    setShowStopsState(on);
    setSavedShowStops(on);
  };

  // Selection is an ordered list; `activeId` is the tab currently shown in the popup.
  const [selected, setSelected] = useState<Selected[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VehicleDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [following, setFollowing] = useState(false);
  // Bumped to force a detail refetch when nothing else in the deps changed (e.g. resuming
  // onto a vehicle's new trip, where the id — and thus activeId — stays the same).
  const [detailNonce, setDetailNonce] = useState(0);
  // Isolate mode: hide every non-selected vehicle on the map (client-side only).
  const [isolate, setIsolate] = useState(false);
  // Stop whose departure board is open. It replaces the vehicle panel while open, leaving the
  // vehicle selection (and its map highlight) untouched underneath.
  const [stopId, setStopId] = useState<string | null>(null);
  const [board, setBoard] = useState<StopDeparturesResponse | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);

  const rest = useMemo(() => new RestClient(API_BASE), []);

  // Operator list for the filter chips.
  useEffect(() => {
    rest.operators().then((r) => setOperators(r.operators.map((o) => o.dataowner))).catch(() => {});
  }, [rest]);

  // Fetch detail for the ACTIVE vehicle, then poll so the upcoming-stops list stays current.
  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    setDetail(null); // clear stale detail from the previously active tab
    let alive = true;
    setLoadingDetail(true);
    const load = (initial: boolean) =>
      rest
        .vehicleDetail(activeId)
        .then((d) => {
          if (!alive) return;
          setDetail(d);
          // Deep link (`?v=`): recentre the map on the shared vehicle once (it may be
          // outside the initial viewport, so it isn't on the map until we fly there).
          if (focusIdRef.current === d.vehicle.id) {
            focusIdRef.current = null;
            mapRef.current?.flyTo(d.vehicle.lon, d.vehicle.lat);
          }
          // The WS "entered" state can predate GTFS enrichment (and "moved" deltas don't
          // carry the line), so backfill the tab's line/operator from the richer detail.
          const line = d.vehicle.line_public_number || "";
          if (line) {
            setSelected((prev) =>
              prev.map((s) => (s.id === d.vehicle.id && s.basic ? { ...s, basic: { ...s.basic, line } } : s)),
            );
          }
        })
        .catch(() => initial && alive && setDetail(null))
        .finally(() => initial && alive && setLoadingDetail(false));
    load(true);
    const t = setInterval(() => load(false), 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [activeId, rest, detailNonce]);

  // Departure board for the open stop, polled so countdowns and live matches stay current.
  // 12 s: the board's realtime content is the trip delay of the vehicles running it, which
  // only moves on KV6 passages, so this is far below the useful resolution already.
  useEffect(() => {
    if (!stopId) {
      setBoard(null);
      return;
    }
    setBoard(null); // clear the previous stop's board rather than showing it under a new title
    let alive = true;
    setLoadingBoard(true);
    const load = (initial: boolean) =>
      rest
        .stopDepartures(stopId)
        .then((b) => alive && setBoard(b))
        .catch(() => initial && alive && setBoard(null))
        .finally(() => initial && alive && setLoadingBoard(false));
    load(true);
    const t = setInterval(() => load(false), 12_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [stopId, rest]);

  // Deep link: `?v=<id>` opens with that vehicle selected and followed (selectVehicle sets
  // following), isolated so only it shows, and centred (focusIdRef → the detail fetch flies
  // to it). Runs once on mount.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("v");
    if (id) {
      focusIdRef.current = id;
      selectVehicle(id, undefined);
      setIsolate(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced free-text search.
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  function onSearch(q: string) {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setFilters((f) => ({ ...f, search: q })), 300);
  }

  function selectVehicle(id: string, v: Vehicle | undefined) {
    setStopId(null); // a vehicle selection takes the panel back from the departure board
    setFollowing(true);
    setActiveId(id);
    setSelected((prev) => {
      if (!multiSelect) return [{ id, basic: v }];
      if (prev.some((s) => s.id === id)) return prev; // already selected → just activate
      return [...prev, { id, basic: v }].slice(-MAX_SELECTED);
    });
  }

  /** Open a stop's board. Stop following, or the followed vehicle would drag the camera off. */
  function openStop(id: string) {
    setFollowing(false);
    setStopId(id);
  }

  /** A departure row was clicked: pan to the vehicle running it and select it. */
  function openVehicleFromDeparture(d: StopDeparture) {
    if (!d.vehicle_id) return;
    if (d.vehicle_lat != null && d.vehicle_lon != null) {
      mapRef.current?.panTo(d.vehicle_lon, d.vehicle_lat);
    } else {
      // No position on the board (shouldn't happen for a live row) — let the detail fetch pan.
      focusIdRef.current = d.vehicle_id;
    }
    selectVehicle(d.vehicle_id, undefined);
  }

  // Live updates for the active vehicle (delay, position, at-stop) flow into its tab.
  // Keep the previously-known line/operator when the live frame lacks them (MOVE deltas
  // don't carry those enrichment fields).
  function onSelectedLive(v: Vehicle) {
    setSelected((prev) =>
      prev.map((s) =>
        // While ended, the tab is frozen on its last trip; a re-appearing vehicle is handled
        // as a replacement (offered via a button), not by silently overwriting the header.
        s.id === v.id && !s.ended
          ? {
              ...s,
              basic: { ...v, line: v.line || s.basic?.line || "", operator: v.operator || s.basic?.operator || "" },
            }
          : s,
      ),
    );
  }

  // A selected vehicle left the live stream: its trip ended (or was pruned as stale). Because
  // selected vehicles are pinned server-side, this is never just "panned out of view". Flag
  // the tab as ended and stop following if it was the active one.
  function onSelectedGone(id: string) {
    setSelected((prev) => prev.map((s) => (s.id === id ? { ...s, ended: true } : s)));
    if (id === activeId) setFollowing(false);
  }

  // A selected vehicle (re)appeared in the stream. If its tab had ended, decide whether it's
  // the same journey resuming (seamless) or a different one to offer as a replacement;
  // otherwise just refresh its last-known info.
  function onSelectedBack(v: Vehicle) {
    setSelected((prev) =>
      prev.map((s) => {
        if (s.id !== v.id) return s;
        if (!s.ended) {
          return {
            ...s,
            basic: { ...v, line: v.line || s.basic?.line || "", operator: v.operator || s.basic?.operator || "" },
          };
        }
        const sameTrip = !!s.basic?.journey && !!v.journey && s.basic.journey === v.journey;
        return sameTrip
          ? { ...s, ended: false, replacement: undefined, basic: { ...v } }
          : { ...s, replacement: { ...v } };
      }),
    );
  }

  // Switch a tab from its ended trip to the vehicle's current (replacement) trip.
  function resumeTrip(id: string) {
    setSelected((prev) =>
      prev.map((s) =>
        s.id === id && s.replacement ? { ...s, basic: s.replacement, ended: false, replacement: undefined } : s,
      ),
    );
    setActiveId(id);
    setFollowing(true);
    setDetailNonce((n) => n + 1); // id is unchanged, so force a detail refetch for the new trip
  }

  function selectTab(id: string) {
    setActiveId(id);
    setFollowing(true);
  }

  function closeTab(id: string) {
    const idx = selected.findIndex((s) => s.id === id);
    const remaining = selected.filter((s) => s.id !== id);
    setSelected(remaining);
    if (id === activeId) {
      const next = remaining[Math.min(idx, remaining.length - 1)];
      setActiveId(next ? next.id : null);
    }
  }

  function closeAll() {
    setSelected([]);
    setActiveId(null);
    setIsolate(false); // nothing selected → nothing to isolate to
  }

  function changeMultiSelect(on: boolean) {
    setMultiSelect(on);
    setSavedMultiSelect(on);
    // Leaving multi-select collapses the selection to just the active vehicle.
    if (!on) setSelected((prev) => prev.filter((s) => s.id === activeId));
  }

  return (
    <div className="map-root">
      <MapView
        ref={mapRef}
        theme={theme}
        filters={filters}
        activeId={activeId}
        selectedIds={selected.map((s) => s.id)}
        isolate={isolate}
        following={following}
        showStops={showStops}
        selectedStopId={stopId}
        routeShape={detail?.route_shape ?? null}
        onSelectStop={openStop}
        onSelectVehicle={selectVehicle}
        onSelectedLive={onSelectedLive}
        onSelectedGone={onSelectedGone}
        onSelectedBack={onSelectedBack}
        onDetach={() => setFollowing(false)}
        onCount={setCount}
        onStatus={setStatus}
      />

      <div className="hud-top panel">
        <span className="brand">OVLive</span>
        <span className={`status-dot ${status}`} title={status} />
        <span className="count">
          {t("hud.inView", { n: count.toLocaleString(lang === "nl" ? "nl-NL" : "en-US") })}
        </span>
      </div>

      <div className="hud-right">
        <SettingsMenu
          value={theme}
          onChange={setTheme}
          showStops={showStops}
          onShowStopsChange={setShowStops}
          multiSelect={multiSelect}
          onMultiSelectChange={changeMultiSelect}
        />
        <button className="icon-btn" title={t("locate")} onClick={() => mapRef.current?.locate()}>
          ◎
        </button>
      </div>

      <FiltersPanel filters={filters} operators={operators} onChange={setFilters} onSearch={onSearch} />

      {stopId ? (
        <StopPanel
          board={board}
          loading={loadingBoard}
          onSelectVehicle={openVehicleFromDeparture}
          onClose={() => setStopId(null)}
        />
      ) : activeId ? (
        <VehiclePanel
          selected={selected}
          activeId={activeId}
          detail={detail}
          loading={loadingDetail}
          following={following}
          isolate={isolate}
          onToggleIsolate={() => setIsolate((v) => !v)}
          onFollow={() => setFollowing(true)}
          onSelectTab={selectTab}
          onCloseTab={closeTab}
          onClose={closeAll}
          onResume={resumeTrip}
        />
      ) : null}
    </div>
  );
}
