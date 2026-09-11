// What OVLive is, where its data comes from, and what that data can't promise.
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconClose, IconCoffee } from "../components/Chips";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../theme/tokens";

const COFFEE_URL = "https://buymeacoffee.com/ovlive";

export default function AboutScreen() {
  const { t } = useI18n();
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const h3 = (s: string) => <Text style={[styles.h3, { color: th.textDim }]}>{s.toUpperCase()}</Text>;
  const p = (s: string) => <Text style={[styles.p, { color: th.text }]}>{s}</Text>;
  return (
    <View style={[styles.root, { backgroundColor: th.panelSolid, paddingTop: insets.top }]}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: th.text }]}>{t("about.title")}</Text>
          <Text style={[styles.tagline, { color: th.textDim }]}>{t("about.tagline")}</Text>
        </View>
        <Pressable onPress={() => router.back()} style={[styles.close, { backgroundColor: th.border }]} accessibilityLabel={t("action.close")}>
          {IconClose(th.textDim)}
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {p(t("about.what"))}
        {h3(t("about.dataTitle"))}
        {p(t("about.data"))}
        {h3(t("about.limitsTitle"))}
        {p(t("about.limits"))}
      </ScrollView>
      <View style={[styles.foot, { borderTopColor: th.border, paddingBottom: insets.bottom + 20 }]}>
        <Text style={[styles.support, { color: th.textDim }]}>
          {t("about.support")} {t("about.supportAsk")}
        </Text>
        <Pressable onPress={() => void Linking.openURL(COFFEE_URL)} style={styles.coffee}>
          {IconCoffee("#fff")}
          <Text style={styles.coffeeText}>{t("about.coffee")}</Text>
        </Pressable>
        <Text style={[styles.credit, { color: th.textDim }]}>{t("about.credit")}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { flexDirection: "row", alignItems: "flex-start", padding: 22, paddingBottom: 14 },
  title: { fontSize: 22, fontWeight: "700", letterSpacing: -0.4 },
  tagline: { fontSize: 14, marginTop: 5 },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 22, paddingBottom: 18 },
  h3: { marginTop: 20, marginBottom: 6, fontSize: 11, fontWeight: "600", letterSpacing: 0.6 },
  p: { fontSize: 14, lineHeight: 22 },
  foot: { gap: 10, padding: 22, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  support: { fontSize: 14 },
  coffee: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 9, paddingHorizontal: 15, borderRadius: 999, backgroundColor: "#0058c4" },
  coffeeText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  credit: { fontSize: 12 },
});
