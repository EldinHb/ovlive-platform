import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { SettingsProvider } from "../lib/settings";
import { I18nProvider } from "../lib/i18n";
import { useTheme } from "../theme/tokens";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <I18nProvider>
          <SettingsProvider>
            <BottomSheetModalProvider>
              <Shell />
            </BottomSheetModalProvider>
          </SettingsProvider>
        </I18nProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Inside the providers, so the theme can honour the appearance setting. */
function Shell() {
  const th = useTheme();
  return (
    <>
      <StatusBar style={th.dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: th.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="vehicle/[id]" />
        <Stack.Screen name="settings" options={{ presentation: "modal" }} />
        <Stack.Screen name="about" options={{ presentation: "modal" }} />
      </Stack>
    </>
  );
}
