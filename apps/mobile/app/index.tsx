// The map screen: the live map, the HUD, and whichever sheet is open — the departure board when
// a stop is selected, else the vehicle panel when a vehicle is. The two are mutually exclusive.
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, StyleSheet, View, useWindowDimensions } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { FiltersSheet } from "../components/FiltersSheet";
import { Hud } from "../components/Hud";
import { LiveMap, type MapHandle } from "../components/map/LiveMap";
import { DEFAULT_SNAP, SNAPS } from "../components/Sheet";
import { StopPanel } from "../components/StopPanel";
import { VehiclePanel } from "../components/VehiclePanel";
import { NO_STOPS, useMapApp } from "../hooks/useMapApp";
import { useSettings } from "../lib/settings";
import { useTheme } from "../theme/tokens";

export default function MapScreen() {
  const th = useTheme();
  const settings = useSettings();
  const mapRef = useRef<MapHandle>(null);
  const filtersRef = useRef<BottomSheetModal>(null);
  const app = useMapApp(mapRef);
  // Height of the open sheet, for the map's camera padding. 0 when nothing is open.
  const [sheetPx, setSheetPx] = useState(0);
  const params = useLocalSearchParams<{ v?: string; only?: string }>();

  // Deep link (`ovlive:///?v=<id>[&only=1]`, or the web URL through the universal-link claim).
  // Runs when the param arrives — on a cold open that is the first render, on a warm one the
  // moment the link is delivered.
  const lastLink = useRef<string | null>(null);
  useEffect(() => {
    const id = typeof params.v === "string" ? params.v : undefined;
    if (!id) return;
    const key = `${id}|${params.only ?? ""}`;
    if (lastLink.current === key) return;
    lastLink.current = key;
    app.openDeepLink(id, params.only === "1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.v, params.only]);

  const sheetOpen = !!app.stopId || !!app.activeId;
  useEffect(() => {
    if (!sheetOpen) setSheetPx(0);
  }, [sheetOpen]);
  // The sheet reports its height only once it has settled, a few hundred ms after it opens.
  // Until then the map must already pad for it, or the tapped vehicle is centred on the whole
  // screen and then sits under the sheet — so assume the snap it opens at.
  const { height } = useWindowDimensions();
  const defaultSheetPx = Math.round(SNAPS[DEFAULT_SNAP] * height);
  const bottomInset = sheetOpen ? sheetPx || defaultSheetPx : 0;

  // Android back closes whatever sheet is open before it may leave the app: the board first
  // (it sits over the vehicle selection), then the vehicle panel.
  useEffect(() => {
    if (!sheetOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (app.stopId) app.setStopId(null);
      else app.closeAll();
      return true;
    });
    return () => sub.remove();
  }, [sheetOpen, app.stopId, app.setStopId, app.closeAll]);

  const openDetail = useCallback(
    (id: string) => router.push({ pathname: "/vehicle/[id]", params: { id, ...(app.isolate ? { only: "1" } : {}) } }),
    [app.isolate],
  );

  return (
    <View style={[styles.root, { backgroundColor: th.bg }]}>
      <LiveMap
        ref={mapRef}
        dark={th.dark}
        filters={app.filters}
        activeId={app.activeId}
        selectedIds={app.selected.map((s) => s.id)}
        isolate={app.isolate}
        following={app.following}
        showStops={settings.showStops}
        selectedStopId={app.stopId}
        routeShape={app.trip?.route_shape ?? null}
        tripStops={app.trip?.stops ?? NO_STOPS}
        stopNumbers={settings.stopNumbers}
        bottomInset={bottomInset}
        sheetDefaultInset={defaultSheetPx}
        onSelectStop={app.openStop}
        onSelectVehicle={app.selectVehicle}
        onSelectedLive={app.onSelectedLive}
        onSelectedGone={app.onSelectedGone}
        onSelectedBack={app.onSelectedBack}
        onCount={app.setCount}
        onStatus={app.setStatus}
      />

      <Hud
        status={app.status}
        count={app.count}
        activeFilters={app.filters.types.length + app.filters.owners.length}
        showFilters={!sheetOpen}
        onAbout={() => router.push("/about")}
        onSettings={() => router.push("/settings")}
        onLocate={() => mapRef.current?.locate()}
        onFilters={() => filtersRef.current?.present()}
      />

      <FiltersSheet
        ref={filtersRef}
        filters={app.filters}
        operators={app.operators}
        onChange={app.setFilters}
        query={app.query}
        onQueryChange={app.setQuery}
        results={app.results}
        total={app.resultTotal}
        searching={app.searching}
        onPick={(v) => {
          filtersRef.current?.dismiss();
          app.openVehicleFromSearch(v);
        }}
      />

      {app.stopId ? (
        <StopPanel board={app.board} loading={app.loadingBoard} onSelectVehicle={app.openVehicleFromDeparture} onClose={() => app.setStopId(null)} onHeight={setSheetPx} />
      ) : app.activeId ? (
        <VehiclePanel
          selected={app.selected}
          activeId={app.activeId}
          detail={app.detail}
          trip={app.trip}
          following={app.following}
          isolate={app.isolate}
          stopNumbers={settings.stopNumbers}
          onToggleIsolate={() => app.setIsolate((v) => !v)}
          onToggleFollow={() => app.setFollowing((f) => !f)}
          onSelectTab={app.selectTab}
          onCloseTab={app.closeTab}
          onClose={app.closeAll}
          onResume={app.resumeTrip}
          onOpenDetail={openDetail}
          onHeight={setSheetPx}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
