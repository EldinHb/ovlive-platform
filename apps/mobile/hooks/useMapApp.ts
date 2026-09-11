// All of the map screen's state and effects — a port of MapApp in apps/web/app/routes/home.tsx,
// kept separate from the screen so the rules that were paid for on the web (plan refetch keyed
// on the *reported* trip id, snapshot-only "gone", the ended/replacement flow) survive intact.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RestClient,
  RestError,
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
import type { Selected } from "../components/VehiclePanel";
import { MIN_QUERY } from "../components/FiltersSheet";
import { API_BASE, getSavedFilters, setSavedFilters } from "../lib/config";
import { useSettings } from "../lib/settings";

const EMPTY_FILTERS: FilterState = { types: [], owners: [], search: "" };
/** Stable empty list, so a selection without a plan doesn't hand the map a new array every render. */
export const NO_STOPS: TripStop[] = [];
const MAX_SELECTED = 8;
/** Enough hits to choose from, small enough to stay a light request per keystroke. */
const SEARCH_LIMIT = 25;
const DETAIL_POLL_MS = 8000;
const BOARD_POLL_MS = 12_000;

/** Back off a poll after 429/503, so a rate-limited client doesn't keep hammering. */
function backoff(err: unknown, base: number): number {
  return err instanceof RestError && (err.status === 429 || err.status === 503) ? Math.min(base * 4, 60_000) : base;
}

export interface MapActions {
  flyTo: (lon: number, lat: number, zoom?: number) => void;
  panTo: (lon: number, lat: number) => void;
}

export function useMapApp(map: React.RefObject<MapActions | null>) {
  const settings = useSettings();
  const { multiSelect } = settings;
  // Set from a `?v=<id>` deep link; the map recentres on this vehicle once its detail loads.
  const focusIdRef = useRef<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(() => getSavedFilters() ? { ...EMPTY_FILTERS, ...getSavedFilters() } : EMPTY_FILTERS);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VehicleSummary[] | null>(null);
  const [resultTotal, setResultTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [count, setCount] = useState(0);
  const [operators, setOperators] = useState<string[]>([]);

  // Selection is an ordered list; `activeId` is the tab currently shown in the sheet.
  const [selected, setSelected] = useState<Selected[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VehicleDetail | null>(null);
  // Route shape + scheduled stops: fetched apart from `detail` because none of it changes
  // while the vehicle runs the trip, so it doesn't belong in the poll.
  const [trip, setTrip] = useState<VehicleTripPlan | null>(null);
  // The trip id the loaded plan was *asked* for (see the refetch rule below).
  const [planTrip, setPlanTrip] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  // Bumped to force a detail refetch when nothing else changed (resuming onto a new trip).
  const [detailNonce, setDetailNonce] = useState(0);
  const [isolate, setIsolate] = useState(false);
  // Stop whose departure board is open. It replaces the vehicle panel while open, leaving the
  // vehicle selection (and its map highlight) untouched underneath.
  const [stopId, setStopId] = useState<string | null>(null);
  const [board, setBoard] = useState<StopDeparturesResponse | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);

  const rest = useMemo(() => new RestClient(API_BASE), []);

  // Persist the chips on every change (the search is deliberately not persisted).
  useEffect(() => setSavedFilters(filters), [filters]);

  useEffect(() => {
    rest.operators().then((r) => setOperators(r.operators.map((o) => o.dataowner))).catch(() => {});
  }, [rest]);

  // Poll the ACTIVE vehicle's live detail. Deliberately small — the shape and the stop list
  // come from the plan fetch below, so this is the only thing on an 8 s timer.
  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    setDetail(null);
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (initial: boolean) =>
      rest
        .vehicleDetail(activeId)
        .then((d) => {
          if (!alive) return;
          setDetail(d);
          // Deep link: recentre the map on the shared vehicle once (it may be outside the
          // initial viewport, so it isn't on the map until we fly there).
          if (focusIdRef.current === d.vehicle.id) {
            focusIdRef.current = null;
            map.current?.flyTo(d.vehicle.lon, d.vehicle.lat);
          }
          // The WS "entered" state can predate GTFS enrichment (and MOVE deltas don't carry
          // the line), so backfill the tab's line from the richer detail.
          const line = d.vehicle.line_public_number || "";
          if (line) setSelected((prev) => prev.map((s) => (s.id === d.vehicle.id && s.basic ? { ...s, basic: { ...s.basic, line } } : s)));
          if (alive) timer = setTimeout(() => load(false), DETAIL_POLL_MS);
        })
        .catch((err) => {
          if (!alive) return;
          if (initial) setDetail(null);
          timer = setTimeout(() => load(false), backoff(err, DETAIL_POLL_MS));
        });
    load(true);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [activeId, rest, detailNonce, map]);

  // The active vehicle's trip plan, fetched once per trip: a shape is by far the largest thing
  // the vehicle view loads, and it cannot change while the vehicle is running that trip.
  useEffect(() => {
    if (!activeId) {
      setTrip(null);
      return;
    }
    setTrip(null);
    const ctrl = new AbortController();
    rest
      .vehicleTrip(activeId, ctrl.signal)
      .then((p) => !ctrl.signal.aborted && setTrip(p))
      .catch(() => {});
    return () => ctrl.abort();
  }, [activeId, rest, detailNonce, planTrip]);

  // Refetch the plan when the vehicle moves onto a different trip than the one we loaded.
  // Keyed on the trip id the poll *reported*, never on the two merely disagreeing: the plan
  // answers for the vehicle's trip now while `detail` is up to a poll behind it, so a trip
  // change leaves them legitimately mismatched for seconds — re-asking until they agree pulls
  // the whole route shape once per round trip (measured ~15/s on the web) until the poll
  // catches up. Only a known id counts: an unmatched vehicle reports null on every poll.
  useEffect(() => {
    const reported = detail?.trip_id;
    if (reported && trip && trip.trip_id !== reported && reported !== planTrip) setPlanTrip(reported);
  }, [detail?.trip_id, trip, planTrip]);

  // Departure board for the open stop, polled so countdowns and live matches stay current.
  useEffect(() => {
    if (!stopId) {
      setBoard(null);
      return;
    }
    setBoard(null);
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoadingBoard(true);
    const load = (initial: boolean) =>
      rest
        .stopDepartures(stopId)
        .then((b) => {
          if (!alive) return;
          setBoard(b);
          timer = setTimeout(() => load(false), BOARD_POLL_MS);
        })
        .catch((err) => {
          if (!alive) return;
          if (initial) setBoard(null);
          timer = setTimeout(() => load(false), backoff(err, BOARD_POLL_MS));
        })
        .finally(() => initial && alive && setLoadingBoard(false));
    load(true);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [stopId, rest]);

  // Vehicle lookup, debounced and aborted on the next edit; the chips apply too, so the
  // results agree with what the map is showing.
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
        .searchVehicles(q, { types: filters.types, owners: filters.owners, limit: SEARCH_LIMIT }, ctrl.signal)
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

  const selectVehicle = useCallback(
    (id: string, v: Vehicle | undefined) => {
      setStopId(null); // a vehicle selection takes the sheet back from the departure board
      setFollowing(true);
      setActiveId(id);
      setSelected((prev) => {
        if (!multiSelect) return [{ id, basic: v }];
        if (prev.some((s) => s.id === id)) return prev;
        return [...prev, { id, basic: v }].slice(-MAX_SELECTED);
      });
    },
    [multiSelect],
  );

  /**
   * `?v=<id>` opens with that vehicle selected, followed and centred. It does NOT turn isolate
   * on — that is a filter the user sets; `only=1` is the one way it comes on here, carrying the
   * state the map had when the vehicle screen was opened from it.
   */
  const openDeepLink = useCallback(
    (id: string, only: boolean) => {
      focusIdRef.current = id;
      selectVehicle(id, undefined);
      if (only) setIsolate(true);
    },
    [selectVehicle],
  );

  /** A search hit was picked: fly there, select it, drop the list. */
  const openVehicleFromSearch = useCallback(
    (v: VehicleSummary) => {
      map.current?.flyTo(v.lon, v.lat);
      selectVehicle(v.id, undefined);
      setQuery("");
    },
    [map, selectVehicle],
  );

  /** Open a stop's board. Stop following, or the followed vehicle would drag the camera off. */
  const openStop = useCallback((id: string) => {
    setFollowing(false);
    setStopId(id);
  }, []);

  const openVehicleFromDeparture = useCallback(
    (d: StopDeparture) => {
      if (!d.vehicle_id) return;
      if (d.vehicle_lat != null && d.vehicle_lon != null) map.current?.panTo(d.vehicle_lon, d.vehicle_lat);
      else focusIdRef.current = d.vehicle_id;
      selectVehicle(d.vehicle_id, undefined);
    },
    [map, selectVehicle],
  );

  // Live updates for the active vehicle flow into its tab. Keep the previously-known line and
  // operator when the frame lacks them (MOVE deltas don't carry enrichment fields).
  const onSelectedLive = useCallback((v: Vehicle) => {
    setSelected((prev) =>
      prev.map((s) =>
        s.id === v.id && !s.ended ? { ...s, basic: { ...v, line: v.line || s.basic?.line || "", operator: v.operator || s.basic?.operator || "" } } : s,
      ),
    );
  }, []);

  // A selected vehicle left the stream: its trip ended. Because selected vehicles are pinned
  // server-side, this is never just "panned out of view".
  const onSelectedGone = useCallback(
    (id: string) => {
      setSelected((prev) => prev.map((s) => (s.id === id ? { ...s, ended: true } : s)));
      setFollowing((f) => (id === activeId ? false : f));
    },
    [activeId],
  );

  // A selected vehicle (re)appeared: the same journey resuming, or a different one to offer.
  const onSelectedBack = useCallback((v: Vehicle) => {
    setSelected((prev) =>
      prev.map((s) => {
        if (s.id !== v.id) return s;
        if (!s.ended) return { ...s, basic: { ...v, line: v.line || s.basic?.line || "", operator: v.operator || s.basic?.operator || "" } };
        const sameTrip = !!s.basic?.journey && !!v.journey && s.basic.journey === v.journey;
        return sameTrip ? { ...s, ended: false, replacement: undefined, basic: { ...v } } : { ...s, replacement: { ...v } };
      }),
    );
  }, []);

  const resumeTrip = useCallback((id: string) => {
    setSelected((prev) => prev.map((s) => (s.id === id && s.replacement ? { ...s, basic: s.replacement, ended: false, replacement: undefined } : s)));
    setActiveId(id);
    setFollowing(true);
    setDetailNonce((n) => n + 1); // same id → force the detail refetch for the new trip
  }, []);

  const selectTab = useCallback((id: string) => {
    setActiveId(id);
    setFollowing(true);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      const idx = selected.findIndex((s) => s.id === id);
      const remaining = selected.filter((s) => s.id !== id);
      setSelected(remaining);
      if (id === activeId) {
        const next = remaining[Math.min(idx, remaining.length - 1)];
        setActiveId(next ? next.id : null);
      }
    },
    [selected, activeId],
  );

  const closeAll = useCallback(() => {
    setSelected([]);
    setActiveId(null);
    setIsolate(false); // nothing selected → nothing to isolate to
  }, []);

  // Leaving multi-select collapses the selection to just the active vehicle.
  useEffect(() => {
    if (!multiSelect) setSelected((prev) => (prev.length > 1 ? prev.filter((s) => s.id === activeId) : prev));
  }, [multiSelect, activeId]);

  return {
    filters, setFilters, query, setQuery, results, resultTotal, searching, status, setStatus, count, setCount, operators,
    selected, activeId, detail, trip, following, setFollowing, isolate, setIsolate, stopId, setStopId, board, loadingBoard,
    selectVehicle, openDeepLink, openVehicleFromSearch, openStop, openVehicleFromDeparture,
    onSelectedLive, onSelectedGone, onSelectedBack, resumeTrip, selectTab, closeTab, closeAll,
  };
}
