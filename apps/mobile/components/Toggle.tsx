import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useTheme } from "../theme/tokens";

/** A settings row: label + hint on the left, a switch on the right. */
export function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const th = useTheme();
  return (
    <Pressable onPress={() => onChange(!value)} style={styles.row} accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <View style={styles.text}>
        <Text style={[styles.label, { color: th.text }]}>{label}</Text>
        {hint && <Text style={[styles.hint, { color: th.textDim }]}>{hint}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: th.accent }} />
    </Pressable>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const th = useTheme();
  return <Text style={[styles.section, { color: th.textDim }]}>{children.toUpperCase()}</Text>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  text: { flex: 1 },
  label: { fontSize: 15 },
  hint: { fontSize: 12, marginTop: 2 },
  section: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6, marginTop: 18, marginBottom: 4 },
});
