// Settings, as a modal: the map layer toggles, the selection options, the language. There is
// no theme picker — the map and the chrome follow the OS.
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconClose } from "../components/Chips";
import { SectionTitle, Toggle } from "../components/Toggle";
import { useI18n, type Lang } from "../lib/i18n";
import type { Appearance } from "../lib/config";
import { useSettings } from "../lib/settings";
import { useTheme } from "../theme/tokens";

const APPEARANCES: { id: Appearance; key: string }[] = [
  { id: "system", key: "appearance.system" },
  { id: "light", key: "appearance.light" },
  { id: "dark", key: "appearance.dark" },
];

const LANGS: { id: Lang; label: string }[] = [
  { id: "nl", label: "Nederlands" },
  { id: "en", label: "English" },
];

export default function SettingsScreen() {
  const { t, lang, setLang } = useI18n();
  const th = useTheme();
  const s = useSettings();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { backgroundColor: th.panelSolid, paddingTop: insets.top }]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: th.text }]}>{t("settings.title")}</Text>
        <Pressable onPress={() => router.back()} style={[styles.close, { backgroundColor: th.border }]} accessibilityLabel={t("action.close")}>
          {IconClose(th.textDim)}
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        <SectionTitle>{t("settings.appearance")}</SectionTitle>
        <View style={[styles.seg, { backgroundColor: th.bg }]}>
          {APPEARANCES.map((a) => (
            <Pressable key={a.id} onPress={() => s.setAppearance(a.id)} style={[styles.segBtn, a.id === s.appearance && { backgroundColor: th.panelSolid }]}>
              <Text style={{ color: a.id === s.appearance ? th.text : th.textDim, fontSize: 13, fontWeight: "500" }}>{t(a.key)}</Text>
            </Pressable>
          ))}
        </View>

        <SectionTitle>{t("settings.map")}</SectionTitle>
        <Toggle label={t("settings.stops")} hint={t("settings.stopsHint")} value={s.showStops} onChange={s.setShowStops} />

        <SectionTitle>{t("settings.selection")}</SectionTitle>
        <Toggle label={t("settings.multi")} hint={t("settings.multiHint")} value={s.multiSelect} onChange={s.setMultiSelect} />
        {/* The numbers on a selected vehicle's stops, in the list and on both maps at once —
            the same number, so one setting. Off keeps the dots and the ahead/served highlight. */}
        <Toggle label={t("settings.stopNums")} hint={t("settings.stopNumsHint")} value={s.stopNumbers} onChange={s.setStopNumbers} />

        <SectionTitle>{t("settings.language")}</SectionTitle>
        <View style={[styles.seg, { backgroundColor: th.bg }]}>
          {LANGS.map((l) => (
            <Pressable key={l.id} onPress={() => setLang(l.id)} style={[styles.segBtn, l.id === lang && { backgroundColor: th.panelSolid }]}>
              <Text style={{ color: l.id === lang ? th.text : th.textDim, fontSize: 13, fontWeight: "500" }}>{l.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { flexDirection: "row", alignItems: "center", padding: 18, paddingBottom: 6 },
  title: { flex: 1, fontSize: 22, fontWeight: "700", letterSpacing: -0.4 },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 18 },
  seg: { flexDirection: "row", padding: 4, gap: 2, borderRadius: 12, marginTop: 6 },
  segBtn: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 9 },
});
