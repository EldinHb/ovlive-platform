// The controls floating over the map: brand + about + connection state + count top-left,
// settings + locate top-right, the filters button bottom-left.
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ConnStatus } from "@ovlive/api-types";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../theme/tokens";
import { IconButton, IconGear, IconInfo, IconLocate } from "./Chips";

interface Props {
  status: ConnStatus;
  count: number;
  activeFilters: number;
  /** Hidden while a sheet is open: the button would sit under it. */
  showFilters: boolean;
  onAbout: () => void;
  onSettings: () => void;
  onLocate: () => void;
  onFilters: () => void;
}

export function Hud({ status, count, activeFilters, showFilters, onAbout, onSettings, onLocate, onFilters }: Props) {
  const { t, lang } = useI18n();
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const statusColor = status === "open" ? th.ontime : status === "connecting" ? "#ff9f0a" : th.textDim;
  return (
    <View pointerEvents="box-none" style={[styles.root, { top: insets.top + 12, bottom: insets.bottom + 16 }]}>
      <Panel style={styles.topLeft}>
        <Text style={[styles.brand, { color: th.text }]}>OVLive</Text>
        <Pressable onPress={onAbout} hitSlop={8} accessibilityLabel={t("about.open")}>
          {IconInfo(th.textDim)}
        </Pressable>
        <View style={[styles.dot, { backgroundColor: statusColor }]} />
        <Text style={[styles.count, { color: th.textDim }]}>{t("hud.inView", { n: count.toLocaleString(lang === "nl" ? "nl-NL" : "en-US") })}</Text>
      </Panel>
      <View style={styles.right}>
        <IconButton icon={IconGear} onPress={onSettings} label={t("settings.title")} />
        <IconButton icon={IconLocate} onPress={onLocate} label={t("locate")} />
      </View>
      {showFilters && (
        <Pressable onPress={onFilters} style={({ pressed }) => [styles.filters, { backgroundColor: th.panel, borderColor: th.border }, pressed && { opacity: 0.7 }]}>
          <Text style={[styles.filtersText, { color: th.text }]}>{t("filter.title")}</Text>
          {activeFilters > 0 && (
            <View style={[styles.badge, { backgroundColor: th.accent }]}>
              <Text style={styles.badgeText}>{activeFilters}</Text>
            </View>
          )}
        </Pressable>
      )}
    </View>
  );
}

function Panel({ children, style }: { children: ReactNode; style?: object }) {
  const th = useTheme();
  return <View style={[styles.panel, { backgroundColor: th.panel, borderColor: th.border }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { position: "absolute", left: 0, right: 0 },
  panel: { borderWidth: 1, borderRadius: 16, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  topLeft: { position: "absolute", top: 0, left: 16, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 14 },
  brand: { fontWeight: "700", letterSpacing: -0.3, fontSize: 17 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  count: { fontSize: 13, fontVariant: ["tabular-nums"] },
  right: { position: "absolute", top: 0, right: 16, gap: 10, alignItems: "flex-end" },
  filters: { position: "absolute", bottom: 0, left: 16, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1 },
  filtersText: { fontSize: 13, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  badge: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "600" },
});
