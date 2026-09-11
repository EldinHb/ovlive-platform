// The selected vehicle(s) in the bottom sheet: tabs when several are selected (swipe the
// header to move between them), identity + chips, then either the ended flow or the live body.
// A port of apps/web/app/components/VehiclePanel.tsx.
import { useCallback, type ReactNode } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import type { Vehicle, VehicleDetail, VehicleTripPlan } from "@ovlive/api-types";
import { resolveOperator } from "@ovlive/shared";
import { useNow } from "../lib/clock";
import { useI18n } from "../lib/i18n";
import { vehicleShareUrl } from "../lib/links";
import { useTheme } from "../theme/tokens";
import { Chip, IconChip, IconClose, IconExternal, IconFollow, IconIsolate, IconShare, ShareChip } from "./Chips";
import { Sheet } from "./Sheet";
import { LineBadge, Note, UpcomingStops, VehicleIdentity, VehicleMeta, VehicleTelemetry, vehicleView } from "./VehicleInfo";

export interface Selected {
  id: string;
  basic?: Vehicle;
  /** The trip we were watching ended (vehicle removed from the live stream). */
  ended?: boolean;
  /** The same vehicle is live again on a *different* trip — offer to switch. */
  replacement?: Vehicle;
}

interface Props {
  selected: Selected[];
  activeId: string;
  detail: VehicleDetail | null;
  trip: VehicleTripPlan | null;
  following: boolean;
  isolate: boolean;
  stopNumbers: boolean;
  onToggleIsolate: () => void;
  /** Follow is a toggle: it stays on through pans and zooms until the user turns it off. */
  onToggleFollow: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onClose: () => void;
  onResume: (id: string) => void;
  /** Push the vehicle's own screen. */
  onOpenDetail: (id: string) => void;
  onHeight: (px: number) => void;
}

export function VehiclePanel(props: Props) {
  const { selected, activeId, detail, trip, following, isolate, stopNumbers } = props;
  const { t } = useI18n();
  const th = useTheme();
  const now = useNow();
  const activeSel = selected.find((s) => s.id === activeId);
  const basic = activeSel?.basic;
  const ended = !!activeSel?.ended;
  const replacement = activeSel?.replacement;
  const id = activeId;
  const view = vehicleView({ id, basic, detail, trip, ended, now, t });

  // Swipe the header sideways to move between selected vehicles. Only clearly horizontal
  // pulls count, so the sheet keeps its vertical drag and a tap stays a tap.
  const step = useCallback(
    (dir: 1 | -1) => {
      const idx = selected.findIndex((x) => x.id === activeId);
      const n = selected.length;
      props.onSelectTab(selected[(idx + dir + n) % n].id);
    },
    [selected, activeId, props],
  );
  const swipe = Gesture.Pan()
    .enabled(selected.length > 1)
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onEnd((e) => {
      if (Math.abs(e.translationX) < 45) return;
      runOnJS(step)(e.translationX < 0 ? 1 : -1);
    });
  const headerWrap = (node: ReactNode) => <GestureDetector gesture={swipe}>{node}</GestureDetector>;

  const header = (
    <View>
      {selected.length > 1 && (
        <View style={styles.tabs}>
          {selected.map((s) => {
            const o = s.basic?.dataowner ?? s.id.split(":")[0];
            const color = s.basic?.lineColor ? `#${s.basic.lineColor}` : resolveOperator(o, s.basic?.operator).style.bg;
            const active = s.id === activeId;
            return (
              <Pressable key={s.id} onPress={() => props.onSelectTab(s.id)} style={[styles.tab, { borderColor: active ? th.accent : th.border, opacity: s.ended ? 0.55 : 1 }]}>
                <LineBadge line={s.basic?.line || "?"} bg={color} fg="#fff" small />
                <Pressable onPress={() => props.onCloseTab(s.id)} hitSlop={8} accessibilityLabel={t("action.removeSel")}>
                  {IconClose(th.textDim)}
                </Pressable>
              </Pressable>
            );
          })}
        </View>
      )}
      <View style={{ opacity: ended ? 0.6 : 1, paddingRight: 30 }}>
        <VehicleIdentity view={view} showDelay={!ended} />
      </View>
      {!ended && (
        <View style={styles.chips}>
          <IconChip icon={IconFollow} label={following ? t("follow.stop") : t("follow.follow")} tone={following ? "live" : "plain"} onPress={props.onToggleFollow} />
          <IconChip icon={(c) => IconIsolate(c, isolate)} label={isolate ? t("isolate.showAll") : t("isolate.only")} tone={isolate ? "active" : "plain"} onPress={props.onToggleIsolate} />
          <IconChip icon={IconShare} label={t("action.share")} onPress={() => void Share.share({ message: vehicleShareUrl(id), url: vehicleShareUrl(id) })} />
          <IconChip icon={IconExternal} label={t("detail.open")} onPress={() => props.onOpenDetail(id)} />
        </View>
      )}
    </View>
  );

  return (
    <Sheet header={header} headerWrap={headerWrap} onClose={props.onClose} onHeight={props.onHeight}>
      {ended ? (
        <View>
          <View style={styles.endedBanner}>
            <Text style={[styles.endedTitle, { color: th.text }]}>⚠ {t("ended.title")}</Text>
            <Text style={[styles.endedSub, { color: th.textDim }]}>{t("ended.sub", { veh: view.vehicleNumber || id.split(":")[1] || "" })}</Text>
          </View>
          {replacement ? (
            <View style={[styles.replacement, { borderColor: th.border }]}>
              <Text style={[styles.replacementLabel, { color: th.textDim }]}>{t("ended.nowRunning").toUpperCase()}</Text>
              <View style={styles.replacementTrip}>
                <LineBadge line={replacement.line || "?"} bg={replacement.lineColor ? `#${replacement.lineColor}` : view.op.style.bg} fg={replacement.lineTextColor ? `#${replacement.lineTextColor}` : view.op.style.fg} small />
                <Text style={[styles.replacementDest, { color: th.text }]} numberOfLines={1}>
                  {replacement.destination || "—"}
                </Text>
              </View>
              <Chip label={t("ended.viewCurrent")} tone="active" onPress={() => props.onResume(id)} grow />
            </View>
          ) : (
            <Note>{t("ended.noReplacement")}</Note>
          )}
          <View style={[styles.chips, { marginTop: 14 }]}>
            <ShareChip url={() => vehicleShareUrl(id)} label={t("action.share")} />
          </View>
        </View>
      ) : (
        <View>
          {view.atStop && <Text style={[styles.atStop, { color: th.ontime }]}>● {t("atStop.banner")}</Text>}
          <VehicleMeta view={view} t={t} />
          <VehicleTelemetry view={view} now={now} t={t} />
          <UpcomingStops view={view} loading={!trip} numbers={stopNumbers} now={now} t={t} />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12, paddingRight: 30 },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, padding: 3, paddingRight: 6, borderRadius: 10, borderWidth: 1.5 },
  chips: { flexDirection: "row", gap: 8, marginTop: 10 },
  endedBanner: { gap: 4, padding: 14, borderRadius: 12, backgroundColor: "rgba(255,149,0,0.14)", borderWidth: 1, borderColor: "rgba(255,149,0,0.35)" },
  endedTitle: { fontWeight: "600", fontSize: 15 },
  endedSub: { fontSize: 13 },
  replacement: { marginTop: 16, padding: 14, borderRadius: 12, borderWidth: 1 },
  replacementLabel: { fontSize: 12, letterSpacing: 0.6, marginBottom: 10 },
  replacementTrip: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  replacementDest: { fontSize: 16, fontWeight: "600", flex: 1 },
  atStop: { fontWeight: "600", fontSize: 13, marginBottom: 8 },
});
