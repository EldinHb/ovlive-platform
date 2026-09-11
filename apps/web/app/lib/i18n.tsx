import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { makeT, type Lang, type TFn } from "@ovlive/shared";

export type { Lang, TFn } from "@ovlive/shared";

const STORAGE = "ovlive_lang";

export function getSavedLang(): Lang {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE) : null;
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
    try {
      localStorage.setItem(STORAGE, l);
    } catch {}
  };

  const t: TFn = makeT(lang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t("app.title");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18nContext);
  if (!c) throw new Error("useI18n must be used within I18nProvider");
  return c;
}
