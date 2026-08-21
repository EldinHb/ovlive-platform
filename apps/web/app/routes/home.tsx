import { useEffect, useMemo, useRef, useState } from "react";
import {
  RestClient,
  type ConnStatus,
  type FilterState,
  type StopDeparture,
  type StopDeparturesResponse,
  type TripStop,
  type Vehicle,
  type VehicleDetail,
  type VehicleSummary,
  type VehicleTripPlan,
} from "@ovlive/api-types";
import { MapView, type MapHandle } from "../components/MapView";
import { SettingsMenu } from "../components/SettingsMenu";
import { FiltersPanel, MIN_QUERY } from "../components/FiltersPanel";
import { StopPanel } from "../components/StopPanel";
import { VehiclePanel, type Selected } from "../components/VehiclePanel";
import { DEFAULT_THEME, THEMES, type MapTheme } from "../lib/styles";
import {
  API_BASE,
  getSavedFilters,
  getSavedMultiSelect,
  getSavedShowStops,
  getSavedStopNumbers,
  getSavedThemeId,
  setSavedFilters,
  setSavedMultiSelect,
  setSavedShowStops,
  setSavedStopNumbers,
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
/** Stable empty list, so a selection without a plan doesn’t hand the map a new array every render. */
const NO_STOPS: TripStop[] = [];
const MAX_SELECTED = 8;
/** Enough hits to choose from, small enough to stay a light request per keystroke. */
const SEARCH_LIMIT = 25;

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
  // Restored from localStorage on mount, so a refresh keeps the user's filter chips.
  const [filters, setFilters] = useState<FilterState>(() => getSavedFilters() ?? EMPTY_FILTERS);
  // Vehicle lookup. Deliberately separate from `filters`: it produces a result list to pick
  // from and never narrows the map, so it is neither sent to the stream nor persisted.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VehicleSummary[] | null>(null);
  const [resultTotal, setResultTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [count, setCount] = useState(0);
  const [operators, setOperators] = useState<string[]>([]);
  const [multiSelect, setMultiSelect] = useState<boolean>(() => getSavedMultiSelect());
  const [showStops, setShowStopsState] = useState<boolean>(() => getSavedShowStops());
  const setShowStops = (on: boolean) => {
    setShowStopsState(on);
    setSavedShowStops(on);
  };
  const [stopNumbers, setStopNumbersState] = useState<boolean>(() => getSavedStopNumbers());
  const setStopNumbers = (on: boolean) => {
    setStopNumbersState(on);
    setSavedStopNumbers(on);
  };

  // Selection is an ordered list; `activeId` is the tab currently shown in the popup.
  const [selected, setSelected] = useState<Selected[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VehicleDetail | null>(null);
  // Route shape + the trip's scheduled stops. Fetched separately from `detail` because none of
  // it changes while the vehicle runs the trip, so it doesn't belong in the poll.
  const [trip, setTrip] = useState<VehicleTripPlan | null>(null);
  // The trip id the loaded plan was *asked* for. Null before the first ask, so selecting a
  // vehicle fetches the plan immediately (in parallel with the first poll) rather than a round
  // trip later; set to the poll's trip id when the vehicle turns out to be on a different one.
  const [planTrip, setPlanTrip] = useState<string | null>(null);
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

  // Persist the filters on every change. An effect rather than a wrapped setter because
  // filters are mutated from two places (the panel's chips and the debounced search), one of
  // them with a functional update that has no resulting value to hand to the writer.
  useEffect(() => setSavedFilters(filters), [filters]);

  // Operator list for the filter chips.
  useEffect(() => {
    rest.operators().then((r) => setOperators(r.operators.map((o) => o.dataowner))).catch(() => {});
  }, [rest]);

  // Poll the ACTIVE vehicle's live detail: position, delay, predicted next trip. Deliberately
  // small — the route shape and the stop list are static for the trip and come from the plan
  // fetch below, so this is the only thing on an 8 s timer.
  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    setDetail(null); // clear stale detail from the previously active tab
    let alive = true;
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
        .catch(() => initial && alive && setDetail(null));
    load(true);
    const t = setInterval(() => load(false), 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [activeId, rest, detailNonce]);

  // The active vehicle's trip plan (route shape + every scheduled stop). Fetched once per
  // trip: a shape is by far the largest thing the vehicle view loads — thousands of points on
  // a rail trip — and it cannot change while the vehicle is running that trip.
  useEffect(() => {
    if (!activeId) {
      setTrip(null);
      return;
    }
    setTrip(null); // the previous vehicle's shape must not linger on the map
    const ctrl = new AbortController();
    rest
      .vehicleTrip(activeId, ctrl.signal)
      .then((p) => !ctrl.signal.aborted && setTrip(p))
      .catch(() => {});
    return () => ctrl.abort();
  }, [activeId, rest, detailNonce, planTrip]);

  // Refetch the plan when the vehicle moves onto a different trip than the one we loaded.
  // Only a *known* trip id counts: an unmatched vehicle reports null on every poll, and
  // treating that as a change would refetch the plan forever.
  //
  // The ask is keyed on the trip id the poll reported, not merely on the two disagreeing,
  // because the two sides move at different rates: the plan answers for the vehicle's trip
  // *now*, while `detail` is up to one poll (8 s) behind it. A trip change therefore leaves
  // them legitimately mismatched for seconds, and re-asking until they agree spins — each
  // answer re-arms the comparison, so it pulls the whole route shape once per round trip
  // (measured ~15/s) until the poll catches up. Keyed this way it asks once per reported id,
  // and a plan that can never match (a vehicle whose live trip has no GTFS match) settles.
  useEffect(() => {
    const reported = detail?.trip_id;
    if (reported && trip && trip.trip_id !== reported && reported !== planTrip) {
      setPlanTrip(reported);
    }
  }, [detail?.trip_id, trip, planTrip]);

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
  // following) and centred (focusIdRef → the detail fetch flies to it). Runs once on mount.
  //
  // It deliberately does NOT turn isolate on. Isolate is a filter the user sets, and forcing
  // it on arrival hides every other vehicle for someone who never asked — which is what a
  // return from a vehicle page looked like. `&only=1` is the one way it comes on here: the
  // vehicle page's link back hands over the isolate state the map had when it was opened, so
  // the user gets their own setting back rather than ours.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("v");
    if (id) {
      focusIdRef.current = id;
      selectVehicle(id, undefined);
      if (q.get("only") === "1") setIsolate(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vehicle lookup, debounced so typing doesn't fire a request per keystroke and aborted on
  // the next edit, so a slow earlier response can't land on top of a newer query. The active
  // chips are applied too, so the results agree with what the map is showing.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setResults(null);
      setResultTotal(0);
      setSearching(false);
      return;
    }
    setSearching(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      rest
        .searchVehicles(
          q,
          { types: filters.types, owners: filters.owners, limit: SEARCH_LIMIT },
          ctrl.signal,
        )
        .then((r) => {
          setResults(r.vehicles);
          setResultTotal(r.total);
        })
        .catch(() => {
          if (ctrl.signal.aborted) return; // superseded, not failed
          setResults([]);
          setResultTotal(0);
        })
        .finally(() => !ctrl.signal.aborted && setSearching(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, filters.types, filters.owners, rest]);

  /** A search hit was picked: fly to that vehicle and select it, then drop the result list. */
  function openVehicleFromSearch(v: VehicleSummary) {
    mapRef.current?.flyTo(v.lon, v.lat);
    selectVehicle(v.id, undefined);
    // The vehicle panel now covers this ground; a stale list under it would just be in the way.
    setQuery("");
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
        routeShape={trip?.route_shape ?? null}
        tripStops={trip?.stops ?? NO_STOPS}
        stopNumbers={stopNumbers}
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
          stopNumbers={stopNumbers}
          onStopNumbersChange={setStopNumbers}
        />
        <button className="icon-btn" title={t("locate")} onClick={() => mapRef.current?.locate()}>
          ◎
        </button>
      </div>

      <FiltersPanel
        filters={filters}
        operators={operators}
        onChange={setFilters}
        query={query}
        onQueryChange={setQuery}
        results={results}
        total={resultTotal}
        searching={searching}
        onPick={openVehicleFromSearch}
      />

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
          trip={trip}
          following={following}
          isolate={isolate}
          stopNumbers={stopNumbers}
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
