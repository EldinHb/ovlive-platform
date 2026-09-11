// Departure board for the stop the user tapped. Rows whose trip has a live vehicle hand off
// to the vehicle panel; the rest are schedule-only, because a vehicle only appears in the feed
// once its journey has started. A port of apps/web/app/components/StopPanel.tsx.
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StopDeparture, StopDeparturesResponse } from "@ovlive/api-types";
import { etaSeconds, formatDelay, resolveOperator, secsToClock, typeKeyOf } from "@ovlive/shared";
import { etaLabel, useNow } from "../lib/clock";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../theme/tokens";
import { Sheet } from "./Sheet";
import { LineBadge, Note, SectionHeading, delayColor } from "./VehicleInfo";

interface Props {
  board: StopDeparturesResponse | null;
  loading: boolean;
  onSelectVehicle: (d: StopDeparture) => void;
  onClose: () => void;
  onHeight: (px: number) => void;
}

export function StopPanel({ board, loading, onSelectVehicle, onClose, onHeight }: Props) {
  const { t } = useI18n();
  const th = useTheme();
  const now = useNow();
  const stop = board?.stop;
  // gtfs-nl names stops "<place>, <stop>"; show the place as the quieter second line.
  const [place, name] = splitStopName(stop?.name ?? "");

  const header = (
    <View style={styles.head}>
      <Text style={[styles.pin, { color: th.accent }]}>◉</Text>
      <View style={{ flex: 1 }}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: th.text }]}>{name || t("stop.title")}</Text>
          {stop?.platform_code && (
            <View style={[styles.platform, { backgroundColor: th.border }]}>
              <Text style={[styles.platformText, { color: th.textDim }]}>{stop.platform_code}</Text>
            </View>
          )}
        </View>
        {place && <Text style={[styles.place, { color: th.textDim }]}>{place}</Text>}
      </View>
    </View>
  );

  return (
    <Sheet header={header} onClose={onClose} onHeight={onHeight}>
      <SectionHeading>{t("stop.departures")}</SectionHeading>
      {loading && !board && <Note>{t("stops.loading")}</Note>}
      {board && board.departures.length === 0 && <Note>{t("stop.none")}</Note>}
      {board?.departures.map((d) => <DepartureRow key={`${d.trip_id}:${d.stop_sequence}`} d={d} now={now} onSelect={onSelectVehicle} />)}
      {board && board.departures.length > 0 && (
        <View style={{ marginTop: 12 }}>
          <Note>{t("stop.liveHint")}</Note>
        </View>
      )}
    </Sheet>
  );
}

function DepartureRow({ d, now, onSelect }: { d: StopDeparture; now: number; onSelect: (d: StopDeparture) => void }) {
  const { t } = useI18n();
  const th = useTheme();
  // Same operator resolution as the map markers, so badge colours match the vehicle there.
  const op = resolveOperator(d.realtime_trip_id?.split(":")[0] ?? "", d.operator);
  const bg = d.line_color ? `#${d.line_color}` : op.style.bg;
  const fg = d.line_text_color ? `#${d.line_text_color}` : op.style.fg;
  const live = !!d.vehicle_id;
  // `delay_seconds` is null when the running vehicle hasn't reported punctuality (trains whose
  // RitInfo we haven't seen), which must not read as on time.
  const delayKnown = d.delay_seconds != null;
  const delay = formatDelay(d.delay_seconds ?? 0, delayKnown);
  const planned = secsToClock(d.scheduled_departure);
  const expected = secsToClock(d.expected_departure);
  const differ = planned !== expected;
  const eta = etaLabel(etaSeconds(d.expected_departure, now), t);
  const etaColor = live && differ && delayKnown ? delayColor(th, delay.kind).fg : th.text;

  return (
    <Pressable disabled={!live} onPress={() => onSelect(d)} style={({ pressed }) => [styles.row, { borderBottomColor: th.border }, pressed && { opacity: 0.6 }]}>
      <LineBadge line={d.line || "?"} bg={bg} fg={fg} small />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.dest, { color: th.text }]} numberOfLines={1}>
          {d.headsign || "—"}
        </Text>
        <View style={styles.subRow}>
          {live && <View style={[styles.liveDot, { backgroundColor: th.ontime }]} />}
          <Text style={[styles.sub, { color: th.textDim }]} numberOfLines={1}>
            {op.label} · {t(typeKeyOf(d.vehicle_type))}
          </Text>
          {live && delayKnown && d.delay_seconds !== 0 && <Text style={[styles.sub, { color: delayColor(th, delay.kind).fg, fontWeight: "600" }]}>{delay.text}</Text>}
        </View>
      </View>
      <View style={styles.time}>
        <Text style={[styles.eta, { color: etaColor }]}>{eta}</Text>
        <View style={styles.clock}>
          {differ && <Text style={[styles.planned, { color: th.textDim }]}>{planned}</Text>}
          <Text style={[styles.expected, { color: th.textDim }]}>{expected}</Text>
        </View>
      </View>
      {live && <Text style={[styles.chevron, { color: th.textDim }]}>›</Text>}
    </Pressable>
  );
}

/** "Amsterdam, Rokin" -> ["Amsterdam", "Rokin"]; a name without a comma stays whole. */
export function splitStopName(full: string): [string, string] {
  const i = full.indexOf(", ");
  return i < 0 ? ["", full] : [full.slice(0, i), full.slice(i + 2)];
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", gap: 12, paddingRight: 30 },
  pin: { fontSize: 20, lineHeight: 24 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  title: { fontSize: 19, fontWeight: "600", letterSpacing: -0.4 },
  platform: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  platformText: { fontSize: 12, fontWeight: "600" },
  place: { fontSize: 13, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  dest: { fontSize: 15, fontWeight: "500" },
  subRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  sub: { fontSize: 12 },
  time: { alignItems: "flex-end", gap: 1 },
  eta: { fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  clock: { flexDirection: "row", gap: 6 },
  planned: { fontSize: 11, textDecorationLine: "line-through", opacity: 0.75 },
  expected: { fontSize: 11, fontWeight: "500" },
  chevron: { fontSize: 20 },
});
