import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "nl" | "en";
const STORAGE = "ovlive_lang";

type Dict = Record<string, string>;

// Dutch is the default; English is the fallback for any missing key.
const NL: Dict = {
  "app.title": "OVLive — Realtime OV in Nederland",
  "hud.inView": "{n} in beeld",
  "settings.title": "Instellingen",
  "settings.theme": "Kaartthema",
  "settings.map": "Kaart",
  "settings.stops": "Haltes tonen",
  "settings.stopsHint": "Zichtbaar vanaf zoomniveau 14",
  "settings.selection": "Selectie",
  "settings.multi": "Meervoudige selectie",
  "settings.multiHint": "Selecteer meerdere voertuigen tegelijk",
  "settings.language": "Taal",
  "locate": "Mijn locatie tonen",
  "filter.title": "Filter",
  "filter.search": "Zoek lijn, voertuig of omloopnummer",
  "search.searching": "Zoeken…",
  "search.none": "Geen rijdende voertuigen gevonden",
  "search.more": "{shown} van {total} resultaten",
  "search.open": "Toon op de kaart",
  "search.clear": "Zoekopdracht wissen",
  "search.noDest": "Bestemming onbekend",
  "type.bus": "Bus",
  "type.tram": "Tram",
  "type.metro": "Metro",
  "type.train": "Trein",
  "type.ferry": "Veerboot",
  "type.vehicle": "Voertuig",
  "follow.following": "Wordt gevolgd",
  "follow.follow": "Voertuig volgen",
  "isolate.only": "Alleen selectie",
  "isolate.showAll": "Toon alles",
  "ended.title": "Deze rit is beëindigd",
  "ended.sub": "Voertuig {veh} is niet langer live beschikbaar.",
  "ended.nowRunning": "Dit voertuig rijdt nu:",
  "ended.viewCurrent": "Toon huidige rit",
  "ended.noReplacement": "Dit voertuig is momenteel niet actief op een andere rit.",
  "detail.open": "Eigen pagina",
  "detail.openTitle": "Open dit voertuig op een eigen pagina (nieuw tabblad)",
  "detail.back": "Terug naar de kaart",
  "detail.notLive": "Dit voertuig rijdt nu niet",
  "detail.notLiveSub": "Voertuig {id} is op dit moment niet live beschikbaar.",
  "atStop.banner": "Nu bij een halte",
  "atStop.badge": "Bij halte",
  "meta.operator": "Vervoerder",
  "meta.vehicle": "Voertuig #",
  "meta.block": "Omloop / blok",
  "meta.journey": "Rit",
  "stops.next": "Volgende haltes",
  "stops.loading": "Laden…",
  "stops.none": "Geen dienstregeling gevonden voor deze rit.",
  "stop.title": "Halte",
  "stop.departures": "Vertrektijden",
  "stop.none": "Geen vertrektijden in de komende 90 minuten.",
  "stop.live": "Voertuig rijdt nu",
  "stop.openVehicle": "Toon dit voertuig op de kaart",
  "stop.liveHint": "Ritten met een groene stip rijden nu — tik erop om het voertuig te volgen.",
  "eta.now": "nu",
  "eta.secs": "{n} sec",
  "eta.minsSecs": "{n} min {s} sec",
  "eta.hoursMinsSecs": "{h} u {n} min {s} sec",
  "eta.title": "Verwachte aankomst om {time}",
  "delay.onTime": "op tijd",
  "delay.unknown": "geen vertragingsdata",
  "age.label": "Laatste update",
  "age.now": "zojuist",
  "age.secs": "{n} sec geleden",
  "age.mins": "{n} min geleden",
  "age.hours": "{n} uur geleden",
  "age.at": "Laatste positiemelding om {time}",
  "action.close": "Sluiten",
  "action.removeSel": "Verwijderen uit selectie",
  "action.share": "Link delen",
  "action.copied": "Gekopieerd",
  "action.resize": "Paneelhoogte aanpassen",
};

const EN: Dict = {
  "app.title": "OVLive — Realtime NL transit",
  "hud.inView": "{n} in view",
  "settings.title": "Settings",
  "settings.theme": "Map theme",
  "settings.map": "Map",
  "settings.stops": "Show stops",
  "settings.stopsHint": "Visible from zoom level 14",
  "settings.selection": "Selection",
  "settings.multi": "Multi-select",
  "settings.multiHint": "Select several vehicles at once",
  "settings.language": "Language",
  "locate": "Show my location",
  "filter.title": "Filter",
  "filter.search": "Search line, vehicle or omloop #",
  "search.searching": "Searching…",
  "search.none": "No vehicles running match",
  "search.more": "{shown} of {total} results",
  "search.open": "Show on the map",
  "search.clear": "Clear search",
  "search.noDest": "Destination unknown",
  "type.bus": "Bus",
  "type.tram": "Tram",
  "type.metro": "Metro",
  "type.train": "Train",
  "type.ferry": "Ferry",
  "type.vehicle": "Vehicle",
  "follow.following": "Following",
  "follow.follow": "Follow vehicle",
  "isolate.only": "Only selected",
  "isolate.showAll": "Show all",
  "ended.title": "This trip has ended",
  "ended.sub": "Vehicle {veh} is no longer available live.",
  "ended.nowRunning": "This vehicle is now running:",
  "ended.viewCurrent": "View current trip",
  "ended.noReplacement": "This vehicle isn't currently active on another trip.",
  "detail.open": "Own page",
  "detail.openTitle": "Open this vehicle on its own page (new tab)",
  "detail.back": "Back to the map",
  "detail.notLive": "This vehicle isn't running now",
  "detail.notLiveSub": "Vehicle {id} isn't available live at the moment.",
  "atStop.banner": "Currently at a stop",
  "atStop.badge": "At stop",
  "meta.operator": "Operator",
  "meta.vehicle": "Vehicle #",
  "meta.block": "Omloop / block",
  "meta.journey": "Journey",
  "stops.next": "Next stops",
  "stops.loading": "Loading…",
  "stops.none": "No schedule matched for this trip.",
  "stop.title": "Stop",
  "stop.departures": "Departures",
  "stop.none": "No departures in the next 90 minutes.",
  "stop.live": "Vehicle is running now",
  "stop.openVehicle": "Show this vehicle on the map",
  "stop.liveHint": "Trips with a green dot are running now — tap one to follow the vehicle.",
  "eta.now": "now",
  "eta.secs": "{n}s",
  "eta.minsSecs": "{n} min {s}s",
  "eta.hoursMinsSecs": "{h} h {n} min {s}s",
  "eta.title": "Expected arrival at {time}",
  "delay.onTime": "on time",
  "delay.unknown": "no delay data",
  "age.label": "Last update",
  "age.now": "just now",
  "age.secs": "{n}s ago",
  "age.mins": "{n} min ago",
  "age.hours": "{n} h ago",
  "age.at": "Last position report at {time}",
  "action.close": "Close",
  "action.removeSel": "Remove from selection",
  "action.share": "Share link",
  "action.copied": "Copied",
  "action.resize": "Resize panel",
};

const DICTS: Record<Lang, Dict> = { nl: NL, en: EN };

export function getSavedLang(): Lang {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE) : null;
  return v === "en" || v === "nl" ? v : "nl";
}

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

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

  const t: TFn = (key, vars) => {
    let s = DICTS[lang][key] ?? EN[key] ?? key;
    if (vars) for (const k in vars) s = s.replace(`{${k}}`, String(vars[k]));
    return s;
  };

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
