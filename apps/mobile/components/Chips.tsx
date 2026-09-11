// The pill-shaped actions (`.follow-chip` on the web) and the icons they carry — the same
// paths as apps/web/app/components/Chips.tsx, drawn with react-native-svg.
import type { ReactNode } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useTheme, type Tokens } from "../theme/tokens";

function ChipIcon({ children, filled = false, color, size = 15 }: { children: ReactNode; filled?: boolean; color: string; size?: number }) {
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size} fill={filled ? color : "none"} stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  );
}

export const IconFollow = (color: string) => (
  <ChipIcon color={color} size={18}>
    <Circle cx={12} cy={12} r={7} />
    <Path d="M12 2.4v3.1M12 18.5v3.1M2.4 12h3.1M18.5 12h3.1" />
    <Circle cx={12} cy={12} r={2.5} fill={color} stroke="none" />
  </ChipIcon>
);
export const IconIsolate = (color: string, filled: boolean) => (
  <ChipIcon color={color} filled={filled} size={18}>
    <Path d="M3.6 5h16.8l-6.7 7.7v5.7l-3.4 2.1v-7.8L3.6 5Z" />
  </ChipIcon>
);
export const IconShare = (color: string) => (
  <ChipIcon color={color} size={18}>
    <Path d="M10.2 13.8a4.2 4.2 0 0 0 6 0l2.4-2.4a4.2 4.2 0 0 0-6-6l-1.2 1.2" />
    <Path d="M13.8 10.2a4.2 4.2 0 0 0-6 0l-2.4 2.4a4.2 4.2 0 0 0 6 6l1.2-1.2" />
  </ChipIcon>
);
export const IconExternal = (color: string) => (
  <ChipIcon color={color} size={18}>
    <Path d="M13.5 4.5H19.5V10.5" />
    <Path d="M19.5 4.5 11.4 12.6" />
    <Path d="M18 14.4v3.9a1.8 1.8 0 0 1-1.8 1.8H5.7a1.8 1.8 0 0 1-1.8-1.8V7.8A1.8 1.8 0 0 1 5.7 6h3.9" />
  </ChipIcon>
);
export const IconBack = (color: string, size = 18) => (
  <ChipIcon color={color} size={size}>
    <Path d="M19 12H5" />
    <Path d="m11 6-6 6 6 6" />
  </ChipIcon>
);
export const IconInfo = (color: string) => (
  <ChipIcon color={color} size={17}>
    <Circle cx={12} cy={12} r={9} />
    <Path d="M12 11v5.5" />
    <Circle cx={12} cy={7.7} r={1.1} fill={color} stroke="none" />
  </ChipIcon>
);
export const IconGear = (color: string) => (
  <ChipIcon color={color} size={22}>
    <Circle cx={12} cy={12} r={3} />
    <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </ChipIcon>
);
export const IconLocate = (color: string) => (
  <ChipIcon color={color} size={22}>
    <Circle cx={12} cy={12} r={6.5} />
    <Circle cx={12} cy={12} r={2} fill={color} stroke="none" />
    <Path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
  </ChipIcon>
);
export const IconClose = (color: string) => (
  <ChipIcon color={color} size={14}>
    <Path d="M6 6l12 12M18 6 6 18" />
  </ChipIcon>
);
export const IconCoffee = (color: string) => (
  <ChipIcon color={color} size={16}>
    <Path d="M4 9h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9Z" />
    <Path d="M16 10.5h1.8a2.7 2.7 0 0 1 0 5.4H16" />
    <Path d="M7.5 5.6c.7-.7.7-1.4 0-2.1M11.5 5.6c.7-.7.7-1.4 0-2.1" />
  </ChipIcon>
);

export type ChipTone = "plain" | "live" | "active";

/** A chip: icon + label, in the panel's three tones (neutral, live-green, pressed-blue). */
export function Chip({ icon, label, tone = "plain", onPress, grow }: { icon?: (color: string) => ReactNode; label: string; tone?: ChipTone; onPress?: () => void; grow?: boolean }) {
  const th = useTheme();
  const c = chipColors(th, tone);
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.chip, { backgroundColor: c.bg, borderColor: c.border }, grow && styles.grow, pressed && onPress ? { opacity: 0.7 } : null]}>
      {icon?.(c.fg)}
      <Text style={[styles.label, { color: c.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function chipColors(th: Tokens, tone: ChipTone) {
  if (tone === "live") return { bg: "rgba(52,199,89,.14)", border: "transparent", fg: th.ontime };
  // Darker than the accent: white on brand blue only reaches ~4.7:1.
  if (tone === "active") return { bg: "#0058c4", border: "transparent", fg: "#ffffff" };
  return { bg: "transparent", border: th.border, fg: th.text };
}

/**
 * The compact form: icon only, the label as accessibility text. The web hides chip labels on
 * phones for the same reason — the header is the fixed cost of every sheet snap, and four
 * labelled chips wrap to two rows.
 */
export function IconChip({ icon, label, tone = "plain", onPress }: { icon: (color: string) => ReactNode; label: string; tone?: ChipTone; onPress?: () => void }) {
  const th = useTheme();
  const c = chipColors(th, tone);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: tone !== "plain" }}
      hitSlop={4}
      style={({ pressed }) => [styles.iconChip, { backgroundColor: c.bg, borderColor: c.border }, pressed && onPress ? { opacity: 0.7 } : null]}
    >
      {icon(c.fg)}
    </Pressable>
  );
}

/** Hands the URL to the system share sheet. */
export function ShareChip({ url, label }: { url: () => string; label: string }) {
  return <Chip icon={IconShare} label={label} onPress={() => void Share.share({ message: url(), url: url() })} />;
}

/** The round frosted button used for the HUD controls. */
export function IconButton({ icon, onPress, label, size = 48 }: { icon: (color: string) => ReactNode; onPress: () => void; label: string; size?: number }) {
  const th = useTheme();
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.iconBtn, { width: size, height: size, borderRadius: size / 2, backgroundColor: th.panel, borderColor: th.border }, pressed && { opacity: 0.7 }]}>
      <View>{icon(th.text)}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1 },
  grow: { flex: 1, justifyContent: "center" },
  iconChip: { width: 40, height: 36, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 13, fontWeight: "600" },
  iconBtn: { alignItems: "center", justifyContent: "center", borderWidth: 1, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
});
