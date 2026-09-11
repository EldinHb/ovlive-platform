// The viewport-driven live map: the WS subscription is keyed to the visible box, vehicles come
// in as ENTER/MOVE/LEAVE diffs at the server tick and are drawn as one GeoJSON source, stops
// come from REST for a padded box, and the selected trip's route and numbered calls sit
// between them. A port of apps/web/app/components/MapView.tsx onto MapLibre Native.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import {
  Camera,
  GeoJSONSource,
  Images,
  Layer,
  Map as MLMap,
  UserLocation,
  type CameraRef,
  type MapRef,
  type ViewState,
  type ViewStateChangeEvent,
} from "@maplibre/maplibre-react-native";
import * as Location from "expo-location";
import {
  LiveClient,
  RestClient,
  type BBox,
  type ConnStatus,
  type FilterState,
  type StopSummary,
  type TripStop,
  type Vehicle,
} from "@ovlive/api-types";
import { COLORFUL_STYLE, ECLIPSE_STYLE, tripStopFeatures, upcomingFromIndex } from "@ovlive/shared";
import { API_BASE, DEFAULT_ZOOM, NL_CENTER, getSavedView, setSavedView } from "../../lib/config";
import { boundsToBBox, covers, emptyFC, padBBox } from "../../lib/geo";
import { HEARTBEAT_MS } from "../../lib/live";
import { markerKey } from "../../lib/markerImages";
import { VehicleStore } from "../../lib/vehicleStore";
import { useMarkerImages } from "../../hooks/useMarkerImages";
import {
  STOPS_LIMIT,
  STOPS_PAD,
  STOPS_ZOOM,
  routeLineLayer,
  stopLayers,
  tripStopLayers,
  vehicleBadgeLayer,
  vehicleDotLayer,
} from "./layers";

export interface MapHandle {
  locate: () => void;
  flyTo: (lon: number, lat: number, zoom?: number) => void;
  /** Recentre on a point at the current zoom, clear of the open sheet. */
  panTo: (lon: number, lat: number) => void;
}

interface Props {
  dark: boolean;
  filters: FilterState;
  activeId: string | null;
  selectedIds: string[];
  isolate: boolean;
  following: boolean;
  showStops: boolean;
  selectedStopId: string | null;
  routeShape: [number, number][] | null;
  tripStops: TripStop[];
  stopNumbers: boolean;
  /** Height of the sheet covering the bottom of the map, so a followed vehicle is centred in
   * the part that is actually visible — the web's `panelAwareOffset`, as camera padding. */
  bottomInset: number;
  /** What `bottomInset` will be once the sheet a tap opens has settled (see index.tsx). */
  sheetDefaultInset: number;
  onSelectStop: (stopId: string) => void;
  onSelectVehicle: (id: string, v: Vehicle | undefined) => void;
  onSelectedLive: (v: Vehicle) => void;
  onSelectedGone: (id: string) => void;
  onSelectedBack: (v: Vehicle) => void;
  onCount: (n: number) => void;
  onStatus: (s: ConnStatus) => void;
}

const VEHICLE_LAYERS = ["vehicles-dot", "vehicles-badge", "vehicles-badge-selected"];
const STOP_LAYERS = ["stops-dot", "stops-label"];

export const LiveMap = forwardRef<MapHandle, Props>(function LiveMap(props, ref) {
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const clientRef = useRef<LiveClient | undefined>(undefined);
  const viewRef = useRef<ViewState | null>(null);
  const stopsBoxRef = useRef<BBox | null>(null);
  const stopsAbortRef = useRef<AbortController | undefined>(undefined);
  const upcomingFromRef = useRef(-1);
  const rest = useMemo(() => new RestClient(API_BASE), []);

  const [vehiclesFC, setVehiclesFC] = useState<GeoJSON.FeatureCollection>(emptyFC);
  const [stopsFC, setStopsFC] = useState<GeoJSON.FeatureCollection>(emptyFC);
  const [tripStopsFC, setTripStopsFC] = useState<GeoJSON.FeatureCollection>(emptyFC);
  const [me, setMe] = useState(false);
  const marker = useMarkerImages();
  // `images` changes as pills get baked; the stream effect must not re-run for that.
  const ensureImages = useRef(marker.ensure);
  ensureImages.current = marker.ensure;

  // The start view. `initialViewState` covers Android; on iOS the camera ignores stops until
  // the map has finished loading (the map sits on the library default, San Francisco, until
  // then), so it is applied once more from `onDidFinishLoadingMap`.
  const [start] = useState(() => {
    const s = getSavedView();
    return { center: (s ? [s.lng, s.lat] : NL_CENTER) as [number, number], zoom: s ? s.zoom : DEFAULT_ZOOM };
  });
  const placed = useRef(false);
  const placeStart = useCallback(() => {
    if (placed.current) return;
    placed.current = true;
    const v = viewRef.current;
    // Only if the map isn't already there — a saved view restored by Android needs no jump.
    if (v && Math.abs(v.center[0] - start.center[0]) < 0.01 && Math.abs(v.center[1] - start.center[1]) < 0.01) return;
    cameraRef.current?.jumpTo({ center: start.center, zoom: start.zoom });
  }, [start]);

  // Always-current copies for the stable handlers below.
  const p = useRef(props);
  p.current = props;

  const store = useMemo(
    () =>
      new VehicleStore({
        onSelectedGone: (id) => p.current.onSelectedGone(id),
        onSelectedBack: (v) => p.current.onSelectedBack(v),
      }),
    [],
  );
  store.selectedIds = props.selectedIds;

  /** Which call the active vehicle is heading for, from its live frame (see shared/trip). */
  const currentUpcomingFrom = useCallback(() => {
    const id = p.current.activeId;
    const v = id ? store.vehicles.get(id) : undefined;
    return upcomingFromIndex(
      p.current.tripStops,
      { lat: v?.lat, lon: v?.lon, atStop: v?.atStop ?? false, delay: v?.delay ?? 0 },
      Date.now(),
    );
  }, [store]);

  const pushTripStops = useCallback(() => {
    upcomingFromRef.current = currentUpcomingFrom();
    setTripStopsFC(tripStopFeatures(p.current.tripStops, upcomingFromRef.current));
  }, [currentUpcomingFrom]);

  const centerOn = useCallback((lon: number, lat: number, duration: number, zoom?: number, inset?: number) => {
    cameraRef.current?.easeTo({
      center: [lon, lat],
      ...(zoom != null ? { zoom } : {}),
      padding: { bottom: inset ?? p.current.bottomInset },
      duration,
    });
  }, []);

  // --- stream + store lifecycle (once) ---
  useEffect(() => {
    store.onFlush = (fc) => {
      // Every pill the frame references must exist before the source updates, or the marker
      // blinks in a frame late (onImageMissing is the safety net, not the plan).
      const dark = p.current.dark;
      const sel = new Set(p.current.selectedIds);
      const keys: string[] = [];
      for (const f of fc.features) {
        const q = f.properties as { id: string; owner: string; line: string };
        keys.push(markerKey(q.owner, q.line, dark));
        if (sel.has(q.id)) keys.push(markerKey(q.owner, q.line, dark, true));
      }
      ensureImages.current(keys);
      setVehiclesFC(fc);
      // Redraw the trip's stops only once the vehicle has actually passed one: the check is a
      // single pass over the calls, the rebuild is a whole FeatureCollection.
      if (currentUpcomingFrom() !== upcomingFromRef.current) pushTripStops();
      p.current.onCount(store.size);
      const id = p.current.activeId;
      if (id) {
        const veh = store.vehicles.get(id);
        if (veh) {
          p.current.onSelectedLive({ ...veh });
          if (p.current.following && !gesture.current) centerOn(veh.lon, veh.lat, 700);
        }
      }
    };
    const client = new LiveClient(API_BASE, undefined, {
      heartbeatMs: HEARTBEAT_MS,
      onStatus: (s) => p.current.onStatus(s),
      onUpdate: (u) => store.apply(u),
    });
    clientRef.current = client;
    const saved = getSavedView();
    const c = saved ? [saved.lng, saved.lat] : NL_CENTER;
    const z = saved ? saved.zoom : DEFAULT_ZOOM;
    // Until the first region event the box is a guess around the saved centre; the first
    // `onRegionDidChange` (fired when the map settles) corrects it.
    const guess = 0.15 / Math.pow(2, z - 12);
    client.connect(
      { minLat: c[1] - guess, minLon: c[0] - guess * 1.6, maxLat: c[1] + guess, maxLon: c[0] + guess * 1.6 },
      Math.round(z),
      p.current.filters,
    );
    // A socket held open in the background either dies or streams to nobody; the server
    // force-snapshots on resubscribe, so the store rebuilds from `isSnapshot`.
    const sub = AppState.addEventListener("change", (s) => (s === "active" ? client.resume() : client.suspend()));
    return () => {
      sub.remove();
      client.close();
      store.dispose();
      stopsAbortRef.current?.abort();
    };
  }, [store, centerOn, currentUpcomingFrom, pushTripStops]);

  // Selection or tone changed: the selected ring variant (and, on a tone change, every pill)
  // must exist before the layer asks for it.
  useEffect(() => {
    const keys: string[] = [];
    for (const f of vehiclesFC.features) {
      const q = f.properties as { id: string; owner: string; line: string };
      keys.push(markerKey(q.owner, q.line, props.dark));
      if (props.selectedIds.includes(q.id)) keys.push(markerKey(q.owner, q.line, props.dark, true));
    }
    ensureImages.current(keys);
  }, [props.selectedIds, props.dark, vehiclesFC]);

  // --- stops (REST, re-fetched only when the view leaves the padded box) ---
  const loadStops = useCallback(
    async (view: ViewState) => {
      if (!p.current.showStops || view.zoom < STOPS_ZOOM) return;
      const box = boundsToBBox(view.bounds);
      if (covers(stopsBoxRef.current, box)) return;
      stopsAbortRef.current?.abort();
      const ac = new AbortController();
      stopsAbortRef.current = ac;
      const padded = padBBox(box, STOPS_PAD);
      try {
        const res = await rest.stopsInViewport(padded, STOPS_LIMIT, ac.signal);
        setStopsFC({ type: "FeatureCollection", features: res.stops.map(stopFeature) });
        // A truncated result holds only the stops nearest the centre, so it cannot be treated
        // as covering the box — leave the coverage unset and re-ask on the next move.
        stopsBoxRef.current = res.truncated ? null : padded;
      } catch {
        // Aborted by a newer request, offline, or the index isn't built yet (503 right after a
        // server restart): keep whatever is drawn and try again on the next move.
      }
    },
    [rest],
  );

  const resync = useCallback(
    (view: ViewState) => {
      viewRef.current = view;

      clientRef.current?.update(boundsToBBox(view.bounds), Math.round(view.zoom), p.current.filters);
      setSavedView({ lng: view.center[0], lat: view.center[1], zoom: view.zoom });
      void loadStops(view);
    },
    [loadStops],
  );

  // Following is a toggle, not something a pan switches off (unlike the web). The camera still
  // doesn't fight a finger: while a gesture is in progress the tick skips its recentre, and the
  // first tick after release brings the vehicle back.
  const gesture = useRef(false);
  const onRegionWillChange = useCallback((e: { nativeEvent: ViewStateChangeEvent }) => {
    if (e.nativeEvent.userInteraction) gesture.current = true;
  }, []);
  const onRegionDidChange = useCallback(
    (e: { nativeEvent: ViewStateChangeEvent }) => {
      const wasGesture = gesture.current;
      gesture.current = false;
      resync(e.nativeEvent);
      if (wasGesture && p.current.following && p.current.activeId) {
        const veh = store.vehicles.get(p.current.activeId);
        if (veh) centerOn(veh.lon, veh.lat, 500);
      }
    },
    [resync, store, centerOn],
  );

  // Tap: vehicles win over stops, whatever order the layers report in.
  const onPress = useCallback(
    async (e: { nativeEvent: { point: [number, number] } }) => {
      const map = mapRef.current;
      if (!map) return;
      const point = e.nativeEvent.point;
      const hit = await map.queryRenderedFeatures([[point[0] - 10, point[1] - 10], [point[0] + 10, point[1] + 10]], {
        layers: VEHICLE_LAYERS,
      });
      // A tap opens a sheet: pad for the height it will have, not the (zero) one it has now.
      const inset = p.current.bottomInset || p.current.sheetDefaultInset;
      const id = hit[0]?.properties?.id as string | undefined;
      if (id) {
        const veh = store.vehicles.get(id);
        if (veh) centerOn(veh.lon, veh.lat, 500, undefined, inset);
        p.current.onSelectVehicle(id, veh);
        return;
      }
      if (!p.current.showStops) return;
      const stops = await map.queryRenderedFeatures([[point[0] - 12, point[1] - 12], [point[0] + 12, point[1] + 12]], {
        layers: STOP_LAYERS,
      });
      const s = stops[0];
      const stopId = s?.properties?.stopId as string | undefined;
      if (!stopId) return;
      if (s.geometry.type === "Point") {
        const [lon, lat] = s.geometry.coordinates as [number, number];
        centerOn(lon, lat, 400, undefined, inset);
      }
      p.current.onSelectStop(stopId);
    },
    [store, centerOn],
  );

  useImperativeHandle(ref, () => ({
    async locate() {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setMe(true);
        centerOn(pos.coords.longitude, pos.coords.latitude, 800, 14);
      } catch {
        // Location services off, or no fix (an emulator): nothing to centre on, as on the web.
      }
    },
    flyTo(lon, lat, zoom) {
      cameraRef.current?.flyTo({ center: [lon, lat], zoom: zoom ?? 15, padding: { bottom: p.current.bottomInset }, duration: 900 });
    },
    panTo(lon, lat) {
      centerOn(lon, lat, 600);
    },
  }));

  // Filters change → tell the server.
  useEffect(() => {
    const v = viewRef.current;
    if (v) clientRef.current?.update(boundsToBBox(v.bounds), Math.round(v.zoom), props.filters);
  }, [props.filters]);

  // Keep selected vehicles streaming even when panned out of view (server-side pin).
  useEffect(() => {
    clientRef.current?.setPinned(props.selectedIds);
  }, [props.selectedIds]);

  // Stops toggled on: fill the layer for the current view (the data stays cached when off).
  useEffect(() => {
    if (props.showStops && viewRef.current) void loadStops(viewRef.current);
  }, [props.showStops, loadStops]);

  // The active vehicle's plan arrived, or the selection moved to another vehicle.
  useEffect(() => {
    pushTripStops();
  }, [props.tripStops, props.activeId, pushTripStops]);

  // Re-attach: when following (re-)activates for a selection, recentre immediately.
  useEffect(() => {
    if (props.following && props.activeId) {
      const veh = store.vehicles.get(props.activeId);
      if (veh) centerOn(veh.lon, veh.lat, 500);
    }
  }, [props.following, props.activeId, store, centerOn]);

  const routeFC = useMemo<GeoJSON.GeoJSON>(() => {
    const shape = props.routeShape;
    if (!shape || shape.length < 2) return emptyFC();
    // The API sends [lat, lon]; GeoJSON wants [lon, lat].
    return { type: "Feature", geometry: { type: "LineString", coordinates: shape.map(([lat, lon]) => [lon, lat]) }, properties: {} };
  }, [props.routeShape]);

  const selFilter = useMemo(() => ["in", ["get", "id"], ["literal", props.selectedIds]] as any, [props.selectedIds]);
  // Isolate mode: hide every non-selected vehicle by filtering the base marker layers — a
  // GPU-side filter, no per-frame JS. The selected layer draws them as usual on top.
  const isoFilter = props.isolate && props.selectedIds.length > 0 ? selFilter : undefined;
  const dark = props.dark;

  return (
    <View style={styles.root}>
      <MLMap
        ref={mapRef}
        style={styles.root}
        mapStyle={dark ? ECLIPSE_STYLE : COLORFUL_STYLE}
        attribution
        // Bottom-right: the Filter button owns the bottom-left corner.
        attributionPosition={{ bottom: props.bottomInset + 8, right: 8 }}
        logo={false}
        compass={false}
        touchPitch={false}
        onPress={onPress}
        onRegionWillChange={onRegionWillChange}
        onRegionDidChange={onRegionDidChange}
        onDidFinishLoadingMap={placeStart}
      >
        <Camera ref={cameraRef} initialViewState={start} minZoom={6} maxZoom={19} />
        <Images images={marker.images} onImageMissing={marker.onImageMissing} />

        {/* Order is reading order: stops under the route, the route under its numbered calls,
            and every vehicle on top. */}
        <GeoJSONSource id="stops" data={stopsFC}>
          {stopLayers("stops", dark, props.selectedStopId, props.showStops).map((l) => (
            <Layer key={l.id} {...l} />
          ))}
        </GeoJSONSource>
        <GeoJSONSource id="route" data={routeFC}>
          <Layer {...routeLineLayer("route")} />
        </GeoJSONSource>
        <GeoJSONSource id="trip-stops" data={tripStopsFC}>
          {tripStopLayers("trip-stops", dark, props.stopNumbers).map((l) => (
            <Layer key={l.id} {...l} />
          ))}
        </GeoJSONSource>
        <GeoJSONSource id="vehicles" data={vehiclesFC} buffer={0} tolerance={0}>
          <Layer {...vehicleDotLayer("vehicles", dark, isoFilter)} />
          <Layer {...vehicleBadgeLayer("vehicles", dark, { filter: isoFilter })} />
          <Layer {...vehicleBadgeLayer("vehicles", dark, { selected: true, filter: selFilter })} />
        </GeoJSONSource>
        {me && <UserLocation />}
      </MLMap>
    </View>
  );
});

function stopFeature(s: StopSummary): GeoJSON.Feature {
  // gtfs-nl names stops "<place>, <stop>". At label zoom the place is obvious from the
  // basemap, so it is dropped; the platform code is what tells quays of one station apart.
  const short = s.name.replace(/^[^,]+,\s*/, "");
  const name = s.platform_code ? `${short} ${s.platform_code}` : short;
  return { type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] }, properties: { stopId: s.stop_id, name } };
}

const styles = StyleSheet.create({ root: { flex: 1 } });
