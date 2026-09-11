// The chrome palette, ported from apps/web/app/app.css (light on :root, dark under
// prefers-color-scheme). The map's own overlay palettes come from @ovlive/shared.
import { useColorScheme } from "react-native";
import { useSettingsOptional } from "../lib/settings";

export interface Tokens {
  dark: boolean;
  bg: string;
  panel: string;
  panelSolid: string;
  text: string;
  textDim: string;
  border: string;
  accent: string;
  late: string;
  early: string;
  ontime: string;
  radius: number;
}

export const LIGHT: Tokens = {
  dark: false,
  bg: "#f5f5f7",
  panel: "rgba(255,255,255,0.86)",
  panelSolid: "#ffffff",
  text: "#1d1d1f",
  textDim: "#6e6e73",
  border: "rgba(0,0,0,0.08)",
  accent: "#0071e3",
  late: "#ff3b30",
  early: "#007aff",
  ontime: "#34c759",
  radius: 16,
};

export const DARK: Tokens = {
  ...LIGHT,
  dark: true,
  bg: "#000000",
  panel: "rgba(28,28,30,0.86)",
  panelSolid: "#1c1c1e",
  text: "#f5f5f7",
  textDim: "#98989d",
  border: "rgba(255,255,255,0.1)",
};

/** The active palette: the appearance setting, falling back to the OS scheme on "system". */
export function useTheme(): Tokens {
  const os = useColorScheme();
  const pref = useSettingsOptional()?.appearance ?? "system";
  const dark = pref === "system" ? os === "dark" : pref === "dark";
  return dark ? DARK : LIGHT;
}
