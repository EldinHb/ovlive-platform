// The pill-shaped actions (`.follow-chip`) used by the vehicle panel and the vehicle page,
// and the icons they carry.

import { useRef, useState } from "react";
import type { TFn } from "../lib/i18n";

/**
 * The header chips carry icons because on mobile their labels are visually hidden
 * (`.vpanel-head` in the `max-width: 640px` block): labelled chips wrap to a second row, and the
 * header is the fixed cost of every sheet snap. The icon has to say what the label did,
 * so these are the conventional ones — crosshair for tracking, funnel for narrowing the
 * map down to one vehicle, chain link for the copyable URL — sized to sit on the text
 * baseline at 15px.
 */
export function ChipIcon({ children, filled = false }: { children: React.ReactNode; filled?: boolean }) {
  return (
    <svg
      className="chip-icon"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconFollow = (
  <ChipIcon>
    <circle cx="12" cy="12" r="7" />
    <path d="M12 2.4v3.1M12 18.5v3.1M2.4 12h3.1M18.5 12h3.1" />
    <circle className="chip-icon-dot" cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
  </ChipIcon>
);
export const IconIsolate = (filled: boolean) => (
  <ChipIcon filled={filled}>
    <path d="M3.6 5h16.8l-6.7 7.7v5.7l-3.4 2.1v-7.8L3.6 5Z" />
  </ChipIcon>
);
export const IconShare = (
  <ChipIcon>
    <path d="M10.2 13.8a4.2 4.2 0 0 0 6 0l2.4-2.4a4.2 4.2 0 0 0-6-6l-1.2 1.2" />
    <path d="M13.8 10.2a4.2 4.2 0 0 0-6 0l-2.4 2.4a4.2 4.2 0 0 0 6 6l1.2-1.2" />
  </ChipIcon>
);
export const IconCheck = (
  <ChipIcon>
    <path d="M4.8 12.6 9.6 17.4 19.2 6.8" />
  </ChipIcon>
);
/** Box with an arrow leaving it — the conventional "opens in a new tab". */
export const IconExternal = (
  <ChipIcon>
    <path d="M13.5 4.5H19.5V10.5" />
    <path d="M19.5 4.5 11.4 12.6" />
    <path d="M18 14.4v3.9a1.8 1.8 0 0 1-1.8 1.8H5.7a1.8 1.8 0 0 1-1.8-1.8V7.8A1.8 1.8 0 0 1 5.7 6h3.9" />
  </ChipIcon>
);
/** Arrow back to the map. */
export const IconBack = (
  <ChipIcon>
    <path d="M19 12H5" />
    <path d="m11 6-6 6 6 6" />
  </ChipIcon>
);

/** A chip that copies `url` to the clipboard, briefly confirming "Copied". */
export function ShareButton({ url, t }: { url: () => string; t: TFn }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  async function copy() {
    const text = url();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-secure contexts / browsers without the async clipboard API.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {}
      ta.remove();
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }
  const label = copied ? t("action.copied") : t("action.share");
  return (
    <button className={`follow-chip ${copied ? "active" : ""}`} onClick={copy} title={label}>
      {copied ? IconCheck : IconShare}
      <span className="chip-label">{label}</span>
    </button>
  );
}

/**
 * Path of a vehicle's own page. Vehicle ids contain `:`, so the segment must be encoded.
 *
 * `only=1` carries the map's isolate state through the page and back out of its return link,
 * so a user who had "only selected" on gets it back and one who didn't never has it imposed.
 * The page itself doesn't read it for anything else — it has no fleet to filter.
 */
export function vehiclePagePath(id: string, isolate = false): string {
  return `/vehicle/${encodeURIComponent(id)}${isolate ? "?only=1" : ""}`;
}
