// Language provider: the React half of @ovlive/shared's dictionaries, with the choice
// persisted under the web's key so a preference means the same thing on both clients.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { makeT, type Lang, type TFn } from "@ovlive/shared";
import { getItem, setItem } from "./storage";

export type { Lang, TFn } from "@ovlive/shared";

const STORAGE = "ovlive_lang";

export function getSavedLang(): Lang {
  const v = getItem(STORAGE);
  return v === "en" || v === "nl" ? v : "nl";
}

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
}

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => getSavedLang());
  const setLang = (l: Lang) => {
    setLangState(l);
    setItem(STORAGE, l);
  };
  const value = useMemo(() => ({ lang, setLang, t: makeT(lang) }), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18nContext);
  if (!c) throw new Error("useI18n must be used within I18nProvider");
  return c;
}
