# @ovlive/mobile

The OVLive app for iOS and Android: the same flow as `apps/web`, on MapLibre Native.

## Run

Native modules (MapLibre, MMKV, reanimated) mean **no Expo Go** — build a dev client once:

```bash
pnpm install
pnpm --filter @ovlive/mobile run ios       # Xcode + an iOS simulator runtime
pnpm --filter @ovlive/mobile run android   # Android Studio (SDK + emulator) and JDK 17
```

Afterwards `pnpm --filter @ovlive/mobile run start` just serves Metro to the installed build.

Toolchain notes from the first setup (macOS, September 2026):

- **Android needs JDK 17**, not the Java 25 runtime bundled with Android Studio — the CMake
  configure steps of reanimated/screens fail on it with "A restricted method in
  java.lang.System has been called". `brew install openjdk@17` and export
  `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`,
  `ANDROID_HOME=~/Library/Android/sdk`.
- If `xcode-select -p` still points at the Command Line Tools, either
  `sudo xcode-select -s /Applications/Xcode.app` or export
  `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. With only the env var,
  `expo run:ios` insists on code signing; build the simulator app with xcodebuild instead:

  ```bash
  cd apps/mobile/ios && pod install
  xcodebuild -workspace OVLive.xcworkspace -scheme OVLive -configuration Debug \
    -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17' \
    -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
  xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/OVLive.app
  xcrun simctl launch booted nl.ovlive.app
  ```
- The Android dev client may not apply Fast Refresh; force a fresh bundle with
  `adb shell am force-stop nl.ovlive.app` and reopen it through
  `ovlive://expo-development-client/?url=http%3A%2F%2F<LAN IP>%3A8081`.

The backend must be up and listening on all interfaces (`BIND_ADDR=0.0.0.0:8080`, see the
`/run` skill). In development the app derives the API base from Metro's host — the Mac's LAN
address with the port swapped to 8080 — so a phone on the same Wi-Fi works with no config.
Override with `EXPO_PUBLIC_API_BASE=http://host:8080`. Release builds use `https://api.ovlive.nl`.

## On a real iPhone

Signing needs an Apple team. Xcode's automatic signing creates the certificate and profile
when it is allowed to; Expo's `run:ios --device` doesn't pass those flags, so drive xcodebuild:

```bash
xcrun devicectl list devices                       # the phone's identifier (a 25-char UDID)
export OVLIVE_APPLE_TEAM_ID=<team id> OVLIVE_PERSONAL_TEAM=1   # PERSONAL_TEAM only for a free Apple ID
pnpm exec expo prebuild --platform ios --clean && (cd ios && pod install)
cd ios && xcodebuild -workspace OVLive.xcworkspace -scheme OVLive -configuration Release \
  -destination 'id=<udid>' -derivedDataPath build \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration DEVELOPMENT_TEAM=<team id> build
xcrun devicectl device install app --device <udid> build/Build/Products/Release-iphoneos/OVLive.app
```

`Release` embeds the JavaScript and defaults to the production API — no Mac needed afterwards.
`Debug` loads from Metro instead (same Wi-Fi); with `EXPO_PUBLIC_API_BASE` unset it then talks
to the backend next to Metro. A free personal team cannot sign Associated Domains, so
`OVLIVE_PERSONAL_TEAM=1` drops that entitlement: `ovlive://` links work, `https://` ones don't,
and the install expires after 7 days. An iOS 27 beta phone worked with Xcode 26.6.

## Layout

| Path | Mirrors (web) | What |
|---|---|---|
| `app/index.tsx`, `hooks/useMapApp.ts` | `routes/home.tsx` | map screen and all its state |
| `components/map/LiveMap.tsx`, `layers.ts` | `components/MapView.tsx` | the live map, layer for layer |
| `components/map/VehicleMap.tsx` | `components/VehicleMap.tsx` | the detail screen's map |
| `app/vehicle/[id].tsx` | `routes/vehicle.tsx` | pushed vehicle screen (`ovlive:///vehicle/<id>`) |
| `components/{VehiclePanel,StopPanel,Sheet}.tsx` | same names | bottom sheet (32/56/92 %) |
| `components/FiltersSheet.tsx` | `FiltersPanel.tsx` | filters + lookup, as a modal sheet |
| `app/settings.tsx`, `app/about.tsx` | `SettingsMenu.tsx`, `About.tsx` | modals |
| `lib/config.ts`, `lib/storage.ts` | `lib/config.ts` | same keys, MMKV instead of localStorage |

Everything pure comes from `@ovlive/shared`; the wire clients from `@ovlive/api-types`.

## Deep links

`ovlive:///?v=<id>[&only=1]` selects (and isolates with `only=1`); `ovlive:///vehicle/<id>`
opens the detail screen. Ids contain `:` and must be percent-encoded. Try one on a simulator:

```bash
npx uri-scheme open "ovlive:///?v=IFF%3A8743" --ios
```

The `https://www.ovlive.nl/...` forms need the web server to publish the association files
(`/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json`).

## Assets

`assets/icon.png`, `adaptive-icon.png` and `splash-icon.png` are generated placeholders
(brand blue, a white pill mark) — replace before a store release. Vehicle pills are not assets:
they are baked at runtime with Skia (`lib/markerImages.ts`). `@shopify/react-native-skia`
needs its prebuilt binaries once per checkout: `npx install-skia` in `apps/mobile` before
`pod install` / the Gradle build, or both fail with "Skia prebuilt binaries not found".
