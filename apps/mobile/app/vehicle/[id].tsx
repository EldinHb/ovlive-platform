// A vehicle on its own screen: everything the sheet shows, plus a map of the vehicle and its
// route. Pushed from the sheet's "open" chip and reachable by link (`/vehicle/<id>`). Data is
// the same two halves the sheet uses — the 8 s poll and the once-per-trip plan — plus a
// single-vehicle live subscription standing in for the map's stream.
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RestClient, type TripStop, type VehicleDetail, type VehicleTripPlan } from "@ovlive/api-types";
import { Chip, IconBack, IconFollow, ShareChip } from "../../components/Chips";
import { VehicleMap } from "../../components/map/VehicleMap";
import { UpcomingStops, VehicleIdentity, VehicleMeta, VehicleTelemetry, vehicleView } from "../../components/VehicleInfo";
import { useNow } from "../../lib/clock";
import { API_BASE } from "../../lib/config";
import { useI18n } from "../../lib/i18n";
import { vehiclePageUrl } from "../../lib/links";
import { useVehicleLive } from "../../lib/live";
import { useSettings } from "../../lib/settings";
import { useTheme } from "../../theme/tokens";

const NO_STOPS: TripStop[] = [];

export default function VehicleScreen() {
  const { t } = useI18n();
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const { stopNumbers } = useSettings();
  const params = useLocalSearchParams<{ id: string; only?: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const rest = useMemo(() => new RestClient(API_BASE), []);

  const [detail, setDetail] = useState<VehicleDetail | null>(null);
  const [trip, setTrip] = useState<VehicleTripPlan | null>(null);
  const [planTrip, setPlanTrip] = useState<string | null>(null);
  /** The first REST answer said this vehicle isn't running — as opposed to a trip that ended. */
  const [missing, setMissing] = useState(false);
  const [following, setFollowing] = useState(true);
  const { live, ended, status } = useVehicleLive(id);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = (initial: boolean) =>
      rest
        .vehicleDetail(id)
        .then((d) => {
          if (!alive) return;
          setDetail(d);
          setMissing(false);
        })
        // Only the first failure means "not running": once a trip has ended the endpoint 404s
        // forever, and the ended banner (from the stream) is the better thing to show then.
        .catch(() => alive && initial && setMissing(true));
    load(true);
    const timer = setInterval(() => load(false), 8000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, rest]);

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    rest
      .vehicleTrip(id, ctrl.signal)
      .then((p) => !ctrl.signal.aborted && setTrip(p))
      .catch(() => {});
    return () => ctrl.abort();
  }, [id, rest, planTrip]);

  // Same rule as the map screen: keyed on the reported id, never on plan/poll disagreement.
  useEffect(() => {
    const reported = detail?.trip_id;
    if (reported && trip && trip.trip_id !== reported && reported !== planTrip) setPlanTrip(reported);
  }, [detail?.trip_id, trip, planTrip]);

  const view = vehicleView({ id, basic: live ?? undefined, detail, trip, ended, now, t });
  const line = view.line;
  const owner = view.op.label;
  const { lat, lon } = view;
  const mapVehicle = useMemo(() => (lat != null && lon != null ? { lat, lon, owner, line: line === "?" ? "" : line } : null), [lat, lon, owner, line]);

  // Back to the map with this vehicle selected. On a warm open the map screen is still there
  // with its own state; on a cold open (a link) it has to be told, `only` included, so the
  // user gets their own isolate setting back rather than ours.
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: "/", params: { v: id, ...(params.only === "1" ? { only: "1" } : {}) } });
  };

  return (
    <View style={[styles.root, { backgroundColor: th.bg, paddingTop: insets.top }]}>
      <View style={[styles.bar, { borderBottomColor: th.border }]}>
        <Pressable onPress={back} style={styles.back} hitSlop={8}>
          {IconBack(th.accent)}
          <Text style={[styles.backText, { color: th.accent }]}>{t("detail.back")}</Text>
        </Pressable>
        <Text style={[styles.brand, { color: th.text }]}>OVLive</Text>
        <View style={[styles.dot, { backgroundColor: status === "open" ? th.ontime : status === "connecting" ? "#ff9f0a" : th.textDim }]} />
      </View>

      {missing && !live ? (
        <View style={styles.content}>
          <View style={styles.banner}>
            <Text style={[styles.bannerTitle, { color: th.text }]}>⚠ {t("detail.notLive")}</Text>
            <Text style={[styles.bannerSub, { color: th.textDim }]}>{t("detail.notLiveSub", { id })}</Text>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.map}>
            <VehicleMap dark={th.dark} vehicle={mapVehicle} routeShape={trip?.route_shape ?? null} stops={trip?.stops ?? NO_STOPS} upcomingFrom={view.upcomingFrom} stopNumbers={stopNumbers} following={following} />
          </View>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
            <VehicleIdentity view={view} showDelay={!ended} />
            <View style={styles.chips}>
              <Chip icon={IconFollow} label={following ? t("follow.following") : t("follow.follow")} tone={following ? "live" : "plain"} onPress={() => setFollowing((f) => !f)} />
              <ShareChip url={() => vehiclePageUrl(id)} label={t("action.share")} />
            </View>
            {ended && (
              <View style={[styles.banner, { marginTop: 14 }]}>
                <Text style={[styles.bannerTitle, { color: th.text }]}>⚠ {t("ended.title")}</Text>
                <Text style={[styles.bannerSub, { color: th.textDim }]}>{t("ended.sub", { veh: view.vehicleNumber || id.split(":")[1] || "" })}</Text>
              </View>
            )}
            <View style={{ height: 16 }} />
            {view.atStop && <Text style={[styles.atStop, { color: th.ontime }]}>● {t("atStop.banner")}</Text>}
            <VehicleMeta view={view} t={t} />
            <VehicleTelemetry view={view} now={now} t={t} />
            <UpcomingStops view={view} loading={!trip} numbers={stopNumbers} now={now} t={t} />
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { flexDirection: "row", alignItems: "center", gap: 4, flex: 1 },
  backText: { fontSize: 15, fontWeight: "500" },
  brand: { fontWeight: "700", fontSize: 17, letterSpacing: -0.3 },
  dot: { width: 8, height: 8, borderRadius: 4, marginLeft: 4 },
  map: { height: "42%" },
  content: { padding: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  banner: { gap: 4, padding: 14, borderRadius: 12, backgroundColor: "rgba(255,149,0,0.14)", borderWidth: 1, borderColor: "rgba(255,149,0,0.35)" },
  bannerTitle: { fontWeight: "600", fontSize: 15 },
  bannerSub: { fontSize: 13 },
  atStop: { fontWeight: "600", fontSize: 13, marginBottom: 8 },
});
