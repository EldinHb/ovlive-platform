// The ⓘ next to the logo, and the dialog it opens: what OVLive is, where its data comes from,
// and what that data can't promise.
//
// The dialog is a native <dialog> opened with showModal(), not a div with a high z-index. The
// top layer is the one place in this app immune to the stacking contexts every frosted panel
// creates (see the `.hud-right:has(.settings-pop)` lift in app.css — a `backdrop-filter`
// makes each panel its own context, so "on top" is not a number you can win), and the
// backdrop, the focus trap and Escape come with it.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n, type TFn } from "../lib/i18n";

const COFFEE_URL = "https://buymeacoffee.com/ovlive";

const IconInfo = (
  <svg
    viewBox="0 0 24 24"
    width="17"
    height="17"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <circle cx="12" cy="7.7" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

/** Mug with a rising wisp — the conventional "buy me a coffee". */
const IconCoffee = (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M4 9h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9Z" />
    <path d="M16 10.5h1.8a2.7 2.7 0 0 1 0 5.4H16" />
    <path d="M7.5 5.6c.7-.7.7-1.4 0-2.1M11.5 5.6c.7-.7.7-1.4 0-2.1" />
  </svg>
);

/** The button and its dialog: one unit, so the map only has to place it. */
export function AboutButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // Stable, so the dialog's setup effect isn't re-run (and showModal() re-called) on every
  // render of the map behind it.
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        className="info-btn"
        title={t("about.open")}
        aria-label={t("about.open")}
        onClick={() => setOpen(true)}
      >
        {IconInfo}
      </button>
      {/* Into <body>, not left here: the button lives inside `.hud-top`, which is a `.panel`
          and therefore carries a `backdrop-filter`. That makes it a backdrop root, and an
          ancestor filter is one of the few things that can still reach an element the top
          layer is painting — including the blur on this dialog's own ::backdrop. */}
      {open && createPortal(<AboutDialog t={t} onClose={close} />, document.body)}
    </>
  );
}

function AboutDialog({ t, onClose }: { t: TFn; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  /**
   * Every dismissal goes through here: close the element (which leaves the top layer and hands
   * focus back to the ⓘ), then tell React, rather than waiting for the `close` event to say so.
   *
   * That event is the tidier single exit and it is still listened for below, but it cannot be
   * the only one. It is fired as a queued task, and the Electron/Chromium 148 build this was
   * developed against never delivers it — `close()` closed the element and no listener ever
   * ran, not even one attached to a bare dialog outside React. That leaves the element closed
   * and this component mounted with its state still saying "open", after which the ⓘ does
   * nothing at all. `onClose` is idempotent, so handling a dismissal twice is free.
   */
  const dismiss = () => {
    ref.current?.close();
    onClose();
  };

  // Mounted only while open, and `onClose` is stable, so this runs once.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.showModal();
    // Escape is handled by the browser itself, so it is caught here directly — the same way
    // SettingsMenu catches it — instead of via the `close` event it would otherwise report.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    el.addEventListener("close", onClose);
    document.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("close", onClose);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <dialog
      className="about"
      ref={ref}
      aria-labelledby="about-title"
      // With `padding: 0` the dialog box is exactly its content, so a click that landed on the
      // element itself came from the backdrop around it.
      onClick={(e) => e.target === ref.current && dismiss()}
    >
      <button className="icon-close" onClick={dismiss} aria-label={t("action.close")}>✕</button>

      <header className="about-head">
        <h2 id="about-title">{t("about.title")}</h2>
        <p className="about-tagline">{t("about.tagline")}</p>
      </header>

      <div className="about-body">
        <p>{t("about.what")}</p>

        <h3>{t("about.dataTitle")}</h3>
        <p>{t("about.data")}</p>

        <h3>{t("about.limitsTitle")}</h3>
        <p>{t("about.limits")}</p>
      </div>

      <footer className="about-foot">
        <p className="about-support">
          {t("about.support")} {t("about.supportAsk")}
        </p>
        <a className="coffee-btn" href={COFFEE_URL} target="_blank" rel="noopener noreferrer">
          {IconCoffee}
          {t("about.coffee")}
        </a>
        <p className="about-credit">{t("about.credit")}</p>
      </footer>
    </dialog>
  );
}
