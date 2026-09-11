import type { ExpoConfig } from "expo/config";

// The public web app. Also the hosts the app claims as universal links: a web share URL
// (https://www.ovlive.nl/?v=<id>) opens in the app when installed and in the browser
// otherwise. The bare domain redirects to www, so both are claimed. Overridable per build so
// a self-hosted instance can ship its own binary.
const WEB_HOST = process.env.OVLIVE_WEB_HOST ?? "www.ovlive.nl";
const WEB_HOSTS = WEB_HOST.startsWith("www.") ? [WEB_HOST, WEB_HOST.slice(4)] : [WEB_HOST];

const config: ExpoConfig = {
  name: "OVLive",
  slug: "ovlive",
  version: "0.1.0",
  scheme: "ovlive",
  orientation: "portrait",
  // Light/dark follows the OS; the app has no theme picker of its own.
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: "nl.ovlive.app",
    // Signing team for device builds (`expo run:ios --device`); Xcode's automatic signing
    // does the rest. Env so a fork's team never lands in the repo.
    ...(process.env.OVLIVE_APPLE_TEAM_ID ? { appleTeamId: process.env.OVLIVE_APPLE_TEAM_ID } : {}),
    supportsTablet: true,
    // Universal links. Personal (free) Apple teams cannot sign this capability, so a build for
    // one drops it — such a build still opens `ovlive://` links, just not the https ones.
    ...(process.env.OVLIVE_PERSONAL_TEAM ? {} : { associatedDomains: WEB_HOSTS.map((h) => `applinks:${h}`) }),
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSLocationWhenInUseUsageDescription:
        "OVLive gebruikt je locatie alleen om de kaart op jouw omgeving te centreren.",
    },
  },
  android: {
    package: "nl.ovlive.app",
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#0071e3" },
    permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: WEB_HOSTS.flatMap((host) => [
          { scheme: "https", host, pathPrefix: "/vehicle" },
          { scheme: "https", host, path: "/" },
        ]),
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  plugins: [
    "expo-router",
    ["expo-splash-screen", { image: "./assets/splash-icon.png", resizeMode: "contain", backgroundColor: "#0071e3" }],
    "expo-status-bar",
    ["expo-location", { locationWhenInUsePermission: "OVLive centreert de kaart op jouw locatie." }],
    "@maplibre/maplibre-react-native",
    [
      "expo-build-properties",
      {
        // Development builds talk to the Mac over plain http://<LAN IP>:8080 (see lib/config.ts).
        // Release builds must not: production is https://ovlive.nl.
        android: { usesCleartextTraffic: process.env.EXPO_PUBLIC_ENV !== "production" },
      },
    ],
  ],
  experiments: { typedRoutes: true },
};

export default config;
