// Filters and vehicle lookup, as a modal sheet behind the bottom-left button (the web's
// FiltersPanel opens collapsed on a phone for the same reason: it competes with the map).
// The chips narrow the map; the search is a lookup and never does.
import { forwardRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetScrollView, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { VehicleType, type FilterState, type VehicleSummary } from "@ovlive/api-types";
import { resolveOperator, typeKeyOf } from "@ovlive/shared";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../theme/tokens";
import { IconClose } from "./Chips";
import { LineBadge, Note } from "./VehicleInfo";

const TYPES: { t: VehicleType; key: string }[] = [
  { t: VehicleType.BUS, key: "type.bus" },
  { t: VehicleType.TRAM, key: "type.tram" },
  { t: VehicleType.METRO, key: "type.metro" },
  { t: VehicleType.TRAIN, key: "type.train" },
  { t: VehicleType.FERRY, key: "type.ferry" },
];

/** Below this, a query matches so much of the country that the list is noise. */
export const MIN_QUERY = 2;

interface Props {
  filters: FilterState;
  operators: string[];
  onChange: (f: FilterState) => void;
  query: string;
  onQueryChange: (q: string) => void;
  results: VehicleSummary[] | null;
  total: number;
  searching: boolean;
  onPick: (v: VehicleSummary) => void;
}

export const FiltersSheet = forwardRef<BottomSheetModal, Props>(function FiltersSheet({ filters, operators, onChange, query, onQueryChange, results, total, searching, onPick }, ref) {
  const { t } = useI18n();
  const th = useTheme();

  const toggleType = (vt: VehicleType) =>
    onChange({ ...filters, types: filters.types.includes(vt) ? filters.types.filter((x) => x !== vt) : [...filters.types, vt] });
  const toggleOwner = (o: string) =>
    onChange({ ...filters, owners: filters.owners.includes(o) ? filters.owners.filter((x) => x !== o) : [...filters.owners, o] });
  const searched = query.trim().length >= MIN_QUERY;

  const chip = (label: string, on: boolean, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} style={[styles.chip, { borderColor: on ? "transparent" : th.border, backgroundColor: on ? th.accent : "transparent" }]}>
      <Text style={[styles.chipText, { color: on ? "#fff" : th.text }]}>{label}</Text>
    </Pressable>
  );

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={["45%", "60%"]}
      enableDynamicSizing={false}
      enablePanDownToClose
      keyboardBehavior="extend"
      backgroundStyle={{ backgroundColor: th.panelSolid, borderRadius: th.radius }}
      handleIndicatorStyle={{ backgroundColor: th.textDim, opacity: 0.5 }}
    >
      <BottomSheetScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: th.textDim }]}>{t("filter.title").toUpperCase()}</Text>
        <View style={styles.row}>{TYPES.map(({ t: vt, key }) => chip(t(key), filters.types.includes(vt), () => toggleType(vt)))}</View>
        {operators.length > 0 && <View style={styles.row}>{operators.map((o) => chip(o, filters.owners.includes(o), () => toggleOwner(o)))}</View>}

        <View style={styles.searchWrap}>
          <BottomSheetTextInput
            style={[styles.search, { borderColor: th.border, backgroundColor: th.bg, color: th.text }]}
            placeholder={t("filter.search")}
            placeholderTextColor={th.textDim}
            value={query}
            onChangeText={onQueryChange}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            // Return picks the top hit, which is the one the ranking put there.
            onSubmitEditing={() => results?.length && onPick(results[0])}
          />
          {!!query && (
            <Pressable onPress={() => onQueryChange("")} style={styles.clear} hitSlop={8} accessibilityLabel={t("search.clear")}>
              {IconClose(th.textDim)}
            </Pressable>
          )}
        </View>

        {searched && (
          <View style={{ marginTop: 10 }}>
            {searching && !results && <Note>{t("search.searching")}</Note>}
            {results?.length === 0 && !searching && <Note>{t("search.none")}</Note>}
            {results?.map((v) => <ResultRow key={v.id} v={v} onPick={onPick} />)}
            {!!results?.length && total > results.length && <Note>{t("search.more", { shown: results.length, total })}</Note>}
          </View>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function ResultRow({ v, onPick }: { v: VehicleSummary; onPick: (v: VehicleSummary) => void }) {
  const { t } = useI18n();
  const th = useTheme();
  // Same resolution as the markers and the board, so a hit is recognisably the vehicle you'll
  // be looking at once the map pans there.
  const op = resolveOperator(v.dataowner, v.operator_name);
  const bg = v.line_color ? `#${v.line_color}` : op.style.bg;
  const fg = v.line_text_color ? `#${v.line_text_color}` : op.style.fg;
  return (
    <Pressable onPress={() => onPick(v)} style={({ pressed }) => [styles.res, { borderBottomColor: th.border }, pressed && { opacity: 0.6 }]}>
      <LineBadge line={v.line_public_number || "?"} bg={bg} fg={fg} small />
      <View style={{ flex: 1 }}>
        <Text style={[styles.resDest, { color: th.text }]} numberOfLines={1}>
          {v.destination || t("search.noDest")}
        </Text>
        <Text style={[styles.resSub, { color: th.textDim }]} numberOfLines={1}>
          {op.label} · {t(typeKeyOf(v.vehicle_type))} · {v.vehicle_number}
        </Text>
      </View>
      <Text style={{ color: th.textDim, fontSize: 20 }}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 13, fontWeight: "600", letterSpacing: 0.6, marginBottom: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13 },
  searchWrap: { position: "relative" },
  search: { paddingVertical: 10, paddingHorizontal: 12, paddingRight: 36, borderRadius: 12, borderWidth: 1, fontSize: 14 },
  clear: { position: "absolute", right: 10, top: 0, bottom: 0, justifyContent: "center" },
  res: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  resDest: { fontSize: 15, fontWeight: "500" },
  resSub: { fontSize: 12, marginTop: 1 },
});
