import { useEffect, useRef, useState } from "react";
import { THEMES, type MapTheme } from "../lib/styles";
import { useI18n, type Lang } from "../lib/i18n";

interface Props {
  value: MapTheme;
  onChange: (t: MapTheme) => void;
  showStops: boolean;
  onShowStopsChange: (on: boolean) => void;
  multiSelect: boolean;
  onMultiSelectChange: (on: boolean) => void;
}

const LANGS: { id: Lang; label: string }[] = [
  { id: "nl", label: "Nederlands" },
  { id: "en", label: "English" },
];

/** A gear button that opens a popover with map-theme options and app settings. */
export function SettingsMenu({
  value,
  onChange,
  showStops,
  onShowStopsChange,
  multiSelect,
  onMultiSelectChange,
}: Props) {
  const { t, lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="settings" ref={ref}>
      <button
        className="icon-btn"
        title={t("settings.title")}
        aria-label={t("settings.title")}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {/* gear glyph */}
        ⚙
      </button>

      {open && (
        <div className="settings-pop panel" role="menu">
          <div className="settings-title">{t("settings.theme")}</div>
          <div className="theme-list">
            {THEMES.map((t) => (
              <button
                key={t.id}
                role="menuitemradio"
                aria-checked={t.id === value.id}
                className={`theme-opt ${t.id === value.id ? "active" : ""}`}
                onClick={() => {
                  onChange(t);
                  setOpen(false);
                }}
              >
                <span>{t.label}</span>
                {t.id === value.id && <span className="check">✓</span>}
              </button>
            ))}
          </div>

          <div className="settings-title" style={{ marginTop: 10 }}>{t("settings.map")}</div>
          <button
            className="setting-toggle"
            role="menuitemcheckbox"
            aria-checked={showStops}
            onClick={() => onShowStopsChange(!showStops)}
          >
            <span>
              <span className="setting-label">{t("settings.stops")}</span>
              <span className="setting-hint">{t("settings.stopsHint")}</span>
            </span>
            <span className={`switch ${showStops ? "on" : ""}`} aria-hidden>
              <span className="knob" />
            </span>
          </button>

          <div className="settings-title" style={{ marginTop: 10 }}>{t("settings.selection")}</div>
          <button
            className="setting-toggle"
            role="menuitemcheckbox"
            aria-checked={multiSelect}
            onClick={() => onMultiSelectChange(!multiSelect)}
          >
            <span>
              <span className="setting-label">{t("settings.multi")}</span>
              <span className="setting-hint">{t("settings.multiHint")}</span>
            </span>
            <span className={`switch ${multiSelect ? "on" : ""}`} aria-hidden>
              <span className="knob" />
            </span>
          </button>

          <div className="settings-title" style={{ marginTop: 10 }}>{t("settings.language")}</div>
          <div className="lang-seg">
            {LANGS.map((l) => (
              <button
                key={l.id}
                className={l.id === lang ? "active" : ""}
                aria-pressed={l.id === lang}
                onClick={() => setLang(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
