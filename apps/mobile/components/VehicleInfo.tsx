// What a vehicle "reads as", rendered: the header identity, the meta grid, the telemetry line
// and the upcoming-stops list. Shared by the map's sheet and the detail screen, over the one
// `vehicleView()` derivation in @ovlive/shared, so the two can never drift.
import { StyleSheet, Text, View } from "react-native";
import { etaLabel, etaSeconds, expectedTime, isoToClock, secsToClock, updateAge, type TFn, type VehicleView } from "@ovlive/shared";
import { useTheme, type Tokens } from "../theme/tokens";

export { vehicleView, type VehicleView, type ViewInput } from "@ovlive/shared";

export function delayColor(th: Tokens, kind: VehicleView["delayKind"]): { fg: string; bg: string } {
  switch (kind) {
    case "late":
      return { fg: th.late, bg: "rgba(255,59,48,.15)" };
    case "early":
      return { fg: th.early, bg: "rgba(0,122,255,.15)" };
    case "ontime":
      return { fg: th.ontime, bg: "rgba(52,199,89,.15)" };
    default:
      return { fg: th.textDim, bg: "rgba(127,140,152,.15)" };
  }
}

/** The line badge used in headers, tabs, departure rows and search results. */
export function LineBadge({ line, bg, fg, small }: { line: string; bg: string; fg: string; small?: boolean }) {
  return (
    <View style={[styles.badge, small && styles.badgeSm, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, small && styles.badgeTextSm, { color: fg }]} numberOfLines={1}>
        {line}
      </Text>
    </View>
  );
}

/** Line badge, operator + type, punctuality and destination. */
export function VehicleIdentity({ view, showDelay = true }: { view: VehicleView; showDelay?: boolean }) {
  const th = useTheme();
  const d = delayColor(th, view.delayKind);
  return (
    <View>
      <View style={styles.titleRow}>
        <LineBadge line={view.line} bg={view.badgeBg} fg={view.badgeFg} />
        <View style={styles.titleMeta}>
          <Text style={[styles.sub, { color: th.textDim }]} numberOfLines={1}>
            {view.op.label} · {view.typeText}
          </Text>
          {showDelay && (
            <View style={[styles.delayPill, { backgroundColor: d.bg }]}>
              <Text style={[styles.delayText, { color: d.fg }]}>{view.delayText}</Text>
            </View>
          )}
        </View>
      </View>
      <Text style={[styles.dest, { color: th.text }]} numberOfLines={2}>
        {view.destination}
      </Text>
    </View>
  );
}

/** Operator, vehicle number, block and journey — the identifiers, none of which move. */
export function VehicleMeta({ view, t }: { view: VehicleView; t: TFn }) {
  const th = useTheme();
  const cell = (k: string, v: string) => (
    <View style={styles.metaCell} key={k}>
      <Text style={[styles.k, { color: th.textDim }]}>{k}</Text>
      <Text style={[styles.v, { color: th.text }]}>{v || "—"}</Text>
    </View>
  );
  return (
    <View style={styles.metaGrid}>
      {cell(t("meta.operator"), view.operatorName)}
      {cell(t("meta.vehicle"), view.vehicleNumber)}
      {cell(t("meta.block"), view.blockCode)}
      {cell(t("meta.journey"), view.journeyNumber)}
    </View>
  );
}

/** How old the vehicle's last position fix is, so live data reads apart from a quiet vehicle. */
export function LastUpdate({ iso, now, t }: { iso: string; now: number; t: TFn }) {
  const th = useTheme();
  const age = updateAge(iso, now);
  if (!age) return null;
  const { secs, kind } = age;
  const text =
    secs < 10 ? t("age.now") : secs < 60 ? t("age.secs", { n: secs }) : secs < 3600 ? t("age.mins", { n: Math.floor(secs / 60) }) : t("age.hours", { n: Math.floor(secs / 3600) });
  const color = kind === "fresh" ? th.ontime : kind === "aging" ? "#ff9f0a" : th.late;
  return (
    <View style={styles.telemetryRow} accessibilityLabel={t("age.at", { time: isoToClock(iso) })}>
      <View style={[styles.ageDot, { backgroundColor: color }]} />
      <Text style={[styles.small, { color: th.textDim }]}>{t("age.label")}</Text>
      <Text style={[styles.small, { color: kind === "fresh" ? th.textDim : color, fontWeight: "500", fontVariant: ["tabular-nums"] }]}>{text}</Text>
    </View>
  );
}

/**
 * Speed (NS trains only — KV6 has no speed element, so a bus shows nothing here rather than a
 * fabricated 0) and the age of the last fix.
 */
export function VehicleTelemetry({ view, now, t }: { view: VehicleView; now: number; t: TFn }) {
  const th = useTheme();
  const speed = view.speedKmh;
  if (speed == null && !view.lastUpdate) return null;
  return (
    <View style={styles.telemetry}>
      {speed != null && (
        <View style={styles.telemetryRow}>
          <View style={{ width: 7 }} />
          <Text style={[styles.small, { color: th.textDim }]}>{t("speed.label")}</Text>
          {/* Whole km/h: the GPS resolves hundredths, noise at this granularity. */}
          <Text style={[styles.small, { color: th.text, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>{t("speed.value", { n: Math.round(speed) })}</Text>
        </View>
      )}
      {view.lastUpdate && <LastUpdate iso={view.lastUpdate} now={now} t={t} />}
    </View>
  );
}

/**
 * Arrival and departure as one clock label: "10:04" when they land on the same minute,
 * "10:04–10:06" when the scheduled dwell is long enough to show at that resolution.
 */
function clockRange(arrive: number, depart: number): string {
  const a = secsToClock(arrive);
  const d = secsToClock(depart);
  return a === d ? a : `${a}–${d}`;
}

export function SectionHeading({ children }: { children: string }) {
  const th = useTheme();
  return <Text style={[styles.section, { color: th.textDim }]}>{children.toUpperCase()}</Text>;
}

export function Note({ children }: { children: string }) {
  const th = useTheme();
  return <Text style={[styles.sub, { color: th.textDim, marginTop: 2 }]}>{children}</Text>;
}

/** The calls still ahead, each with its countdown and its delay-adjusted clock times. */
export function UpcomingStops({ view, loading, numbers, now, t }: { view: VehicleView; loading: boolean; numbers: boolean; now: number; t: TFn }) {
  const th = useTheme();
  return (
    <View>
      <SectionHeading>{t("stops.next")}</SectionHeading>
      {loading && <Note>{t("stops.loading")}</Note>}
      {!loading && view.stops.length === 0 && <Note>{t("stops.none")}</Note>}
      {view.stops.map((s, i) => {
        const current = view.atStop && i === 0;
        // Counted from the trip's first call, so "stop 4" means the same here and on the map.
        const number = view.upcomingFrom + i + 1;
        // Expected = schedule + the vehicle's trip-level delay; no per-stop realtime exists.
        const arrival = expectedTime(s.scheduled_arrival, view.delay);
        const departure = expectedTime(s.scheduled_departure, view.delay);
        const planned = clockRange(s.scheduled_arrival, s.scheduled_departure);
        const expected = clockRange(arrival, departure);
        const differ = planned !== expected;
        const eta = etaSeconds(arrival, now);
        const etaColor = differ ? delayColor(th, view.delayKind).fg : th.text;
        const last = i === view.stops.length - 1;
        return (
          <View key={s.stop_id + s.stop_sequence} style={styles.stopRow}>
            <View style={styles.nodeCol}>
              {numbers ? (
                // The badge is the Text itself: a Text inside a sized View wrapped two-digit
                // numbers onto two lines on Android, whatever width the View was given.
                <Text style={[styles.stopNum, { color: current ? th.ontime : th.accent, backgroundColor: current ? "rgba(52,199,89,.2)" : "rgba(0,113,227,.14)" }]} numberOfLines={1}>
                  {number}
                </Text>
              ) : (
                <View style={[styles.stopDot, { backgroundColor: current ? th.ontime : th.accent }]} />
              )}
              {!last && <View style={[styles.stopLine, { backgroundColor: th.border }]} />}
            </View>
            <View style={styles.stopName}>
              {current && (
                <View style={styles.nowPill}>
                  <Text style={[styles.nowText, { color: th.ontime }]}>{t("atStop.badge")}</Text>
                </View>
              )}
              <Text style={[styles.stopLabel, { color: th.text, fontWeight: current ? "600" : "400" }]}>{s.name}</Text>
            </View>
            <View style={styles.stopTime}>
              <Text style={[styles.eta, { color: etaColor }]}>{current ? t("eta.now") : etaLabel(eta, t)}</Text>
              <View style={styles.clock}>
                {differ && <Text style={[styles.planned, { color: th.textDim }]}>{planned}</Text>}
                <Text style={[styles.expected, { color: th.textDim }]}>{expected}</Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { minWidth: 40, height: 40, paddingHorizontal: 12, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  badgeSm: { minWidth: 30, height: 30, paddingHorizontal: 8, borderRadius: 8 },
  badgeText: { fontWeight: "700", fontSize: 18 },
  badgeTextSm: { fontSize: 15 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  titleMeta: { flex: 1, alignItems: "flex-start", gap: 7 },
  sub: { fontSize: 13 },
  delayPill: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999 },
  delayText: { fontSize: 13, fontWeight: "600" },
  dest: { fontSize: 20, fontWeight: "600", letterSpacing: -0.4, marginTop: 10 },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 4, marginBottom: 14 },
  metaCell: { width: "50%", paddingVertical: 6 },
  k: { fontSize: 12 },
  v: { fontSize: 15, fontWeight: "500", marginTop: 1 },
  telemetry: { gap: 6, marginBottom: 18 },
  telemetryRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  small: { fontSize: 12 },
  ageDot: { width: 7, height: 7, borderRadius: 4 },
  section: { fontSize: 13, letterSpacing: 0.6, marginBottom: 10 },
  stopRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 },
  nodeCol: { width: 32, alignItems: "center" },
  stopNum: { minWidth: 26, height: 22, lineHeight: 22, paddingHorizontal: 7, borderRadius: 11, overflow: "hidden", textAlign: "center", fontSize: 11, fontWeight: "600" },
  stopDot: { width: 9, height: 9, borderRadius: 5 },
  stopLine: { position: "absolute", top: 32, bottom: -32, width: 1 },
  stopName: { flex: 1, gap: 3 },
  stopLabel: { fontSize: 14 },
  nowPill: { alignSelf: "flex-start", backgroundColor: "rgba(52,199,89,.14)", paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999 },
  nowText: { fontSize: 11, fontWeight: "600" },
  stopTime: { alignItems: "flex-end", gap: 1 },
  eta: { fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  clock: { flexDirection: "row", gap: 6, alignItems: "baseline" },
  planned: { fontSize: 11, textDecorationLine: "line-through", opacity: 0.75 },
  expected: { fontSize: 11, fontWeight: "500" },
});
