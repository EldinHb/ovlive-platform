import { THEMES, type MapTheme } from "../lib/styles";

export function ThemeSwitcher({ value, onChange }: { value: MapTheme; onChange: (t: MapTheme) => void }) {
  return (
    <div className="seg panel" role="tablist" aria-label="Map theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          className={t.id === value.id ? "active" : ""}
          onClick={() => onChange(t)}
          role="tab"
          aria-selected={t.id === value.id}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
