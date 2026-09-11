// The bottom sheet both panels live in — the web's Sheet.tsx (32/56/92 vh, opens at the middle
// snap) on @gorhom/bottom-sheet, which brings the gesture rules the web had to hand-roll:
// drag from the grip or header always, from the body only when it is scrolled to the top.
import { forwardRef, useCallback, useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import BottomSheet, { BottomSheetScrollView, type BottomSheetProps } from "@gorhom/bottom-sheet";
import { useTheme } from "../theme/tokens";
import { IconClose } from "./Chips";

// Two snaps: a peek and a 60% ceiling — the map keeps at least 40% of the screen, so the
// followed vehicle and its surroundings stay in view. Opens at the ceiling.
export const SNAPS = [0.32, 0.6];
export const DEFAULT_SNAP = 1;

interface Props {
  /** Fixed part: identity, chips. Not scrolled. */
  header: ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** The sheet's height in px whenever it settles, for the map's camera padding. */
  onHeight?: (px: number) => void;
  /** Gesture wrapper for the header (the vehicle panel's swipe between tabs). */
  headerWrap?: (node: ReactNode) => ReactNode;
}

export const Sheet = forwardRef<BottomSheet, Props>(function Sheet({ header, children, onClose, onHeight, headerWrap }, ref) {
  const th = useTheme();
  const { height } = useWindowDimensions();
  const snapPoints = useMemo(() => SNAPS.map((f) => Math.round(f * height)), [height]);
  const onChange = useCallback<NonNullable<BottomSheetProps["onChange"]>>(
    (index) => {
      if (index >= 0) onHeight?.(snapPoints[index]);
    },
    [onHeight, snapPoints],
  );
  const head = (
    <View style={[styles.head, { borderBottomColor: th.border }]}>
      {header}
      <Pressable onPress={onClose} style={[styles.close, { backgroundColor: th.border }]} accessibilityRole="button">
        {IconClose(th.textDim)}
      </Pressable>
    </View>
  );
  return (
    <BottomSheet
      ref={ref}
      index={DEFAULT_SNAP}
      snapPoints={snapPoints}
      // Off: gorhom would otherwise size the sheet to its content and ignore the snaps.
      enableDynamicSizing={false}
      enablePanDownToClose
      onClose={onClose}
      onChange={onChange}
      backgroundStyle={{ backgroundColor: th.panelSolid, borderRadius: th.radius }}
      handleIndicatorStyle={{ backgroundColor: th.textDim, opacity: 0.5 }}
    >
      {headerWrap ? headerWrap(head) : head}
      <BottomSheetScrollView contentContainerStyle={styles.body}>{children}</BottomSheetScrollView>
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  head: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  close: { position: "absolute", top: 6, right: 14, width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  body: { padding: 18, paddingBottom: 40 },
});
