// The persisted preferences, shared between the map screen and the settings modal (which are
// different routes, so a context rather than the map screen's own state). Same keys as the web.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  getSavedAppearance,
  setSavedAppearance,
  type Appearance,
  getSavedMultiSelect,
  getSavedShowStops,
  getSavedStopNumbers,
  setSavedMultiSelect,
  setSavedShowStops,
  setSavedStopNumbers,
} from "./config";

interface Settings {
  /** Light, dark, or follow the OS. */
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
  showStops: boolean;
  setShowStops: (on: boolean) => void;
  /** The numbers on a selected vehicle's stops, in the list and on both maps at once. */
  stopNumbers: boolean;
  setStopNumbers: (on: boolean) => void;
  multiSelect: boolean;
  setMultiSelect: (on: boolean) => void;
}

const Ctx = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState(getSavedAppearance);
  const [showStops, setShowStopsState] = useState(getSavedShowStops);
  const [stopNumbers, setStopNumbersState] = useState(getSavedStopNumbers);
  const [multiSelect, setMultiSelectState] = useState(getSavedMultiSelect);
  const value = useMemo<Settings>(
    () => ({
      appearance,
      setAppearance: (a) => {
        setAppearanceState(a);
        setSavedAppearance(a);
      },
      showStops,
      setShowStops: (on) => {
        setShowStopsState(on);
        setSavedShowStops(on);
      },
      stopNumbers,
      setStopNumbers: (on) => {
        setStopNumbersState(on);
        setSavedStopNumbers(on);
      },
      multiSelect,
      setMultiSelect: (on) => {
        setMultiSelectState(on);
        setSavedMultiSelect(on);
      },
    }),
    [appearance, showStops, stopNumbers, multiSelect],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The settings, or null outside the provider (the root layout reads the appearance before it). */
export function useSettingsOptional(): Settings | null {
  return useContext(Ctx);
}

export function useSettings(): Settings {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSettings must be used within SettingsProvider");
  return c;
}
