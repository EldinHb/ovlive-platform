import { useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";

/**
 * Snap heights, as a percentage of the viewport, for the mobile bottom sheet. Kept in `vh` so a
 * rotation or a browser chrome change re-resolves them without a resize listener; the drag
 * itself works in px and is converted back on release.
 */
const SNAPS = [32, 56, 92];
/** Opens at the middle snap: enough of the list to be useful, enough map to keep context. */
const DEFAULT_SNAP = 1;
/** Drag past this fraction of the smallest snap and releasing dismisses the sheet. */
const DISMISS_AT = 0.62;
/** A gesture counts as a sheet drag (rather than a tap or a horizontal swipe) past this. */
const DRAG_SLOP = 8;
/** Past this, a release moves at least one snap in the drag direction rather than snapping back. */
const FLICK_PX = 55;

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

interface Props {
  children: React.ReactNode;
  /** Pull-down-to-dismiss, and the grip's collapse target once the sheet is at its smallest. */
  onClose: () => void;
  /** Extra pointer handlers layered on top of the drag (VehiclePanel's horizontal tab swipe). */
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
}

/**
 * The `.vpanel` shell shared by the vehicle and stop panels: a right-hand dock on desktop, a
 * bottom sheet on mobile. On mobile it can be dragged between three heights, because the
 * content it holds (a stop list that can run to dozens of rows) is the reason the panel is
 * open, and a fixed half-screen sheet gives most of the phone to the map instead.
 *
 * The gesture starts from the grip or the header at any time, and from the scrolling body only
 * when that body is already at the top and the pull is downward — otherwise a downward flick
 * meant to scroll the list back up would collapse the sheet instead.
 */
export function Sheet({ children, onClose, onPointerDown, onPointerMove, onPointerUp }: Props) {
  const { t } = useI18n();
  const mobile = useIsMobile();
  const ref = useRef<HTMLElement>(null);
  const [snap, setSnap] = useState(DEFAULT_SNAP);
  /** Live height while dragging (px); null when settled on a snap. */
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    h: number;
    active: boolean;
    scroller: HTMLElement | null;
  } | null>(null);

  // Back to the default height whenever the sheet stops being a sheet, so returning to a
  // narrow window doesn't restore a height the user set for a different layout.
  useEffect(() => {
    if (!mobile) {
      setSnap(DEFAULT_SNAP);
      setDragH(null);
      drag.current = null;
    }
  }, [mobile]);

  function pointerDown(e: React.PointerEvent) {
    onPointerDown?.(e);
    const el = ref.current;
    if (!mobile || !el) return;
    const target = e.target as HTMLElement;
    // Controls keep their own gestures; the grip is a button but is the drag surface itself.
    if (!target.closest(".sheet-grip") && target.closest("button, a, input")) {
      drag.current = null;
      return;
    }
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      h: el.getBoundingClientRect().height,
      active: false,
      scroller: target.closest<HTMLElement>(".vpanel-body"),
    };
  }

  function pointerMove(e: React.PointerEvent) {
    onPointerMove?.(e);
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    const dy = e.clientY - d.y;
    if (!d.active) {
      if (Math.abs(dy) < DRAG_SLOP || Math.abs(dy) <= Math.abs(e.clientX - d.x)) return;
      if (d.scroller && !(d.scroller.scrollTop <= 0 && dy > 0)) {
        drag.current = null; // the list is scrolling; leave it alone
        return;
      }
      d.active = true;
      // Throws NotFoundError if the pointer is already gone; the drag still works without it.
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
    }
    // Below the smallest snap there is only the slack the dismiss pull needs.
    setDragH(Math.min(Math.max(d.h - dy, dismissPx()), snapPx(SNAPS.length - 1)));
  }

  function pointerUp(e: React.PointerEvent) {
    onPointerUp?.(e);
    const d = drag.current;
    drag.current = null;
    const h = dragH;
    setDragH(null);
    if (!d?.active || h == null) return;
    if (h < dismissPx() + 1) {
      onClose();
      return;
    }
    let next = nearestSnap((h / window.innerHeight) * 100);
    // A deliberate flick shouldn't land back where it started just because the nearest snap
    // happens to be the one it left.
    const dy = e.clientY - d.y;
    if (next === snap && Math.abs(dy) > FLICK_PX) next = clampSnap(snap + (dy < 0 ? 1 : -1));
    setSnap(next);
  }

  /** Tapping the grip steps up through the snaps, then wraps back to the smallest. */
  function cycle() {
    setSnap((s) => (s >= SNAPS.length - 1 ? 0 : s + 1));
  }

  return (
    <aside
      ref={ref}
      className={`vpanel panel ${dragH != null ? "dragging" : ""}`}
      // A custom property rather than `height`, so only the mobile rule consumes it: an inline
      // height would otherwise outrank the desktop dock's top/bottom the moment the viewport
      // crosses the breakpoint, before this component has re-rendered.
      style={{ "--sheet-h": dragH != null ? `${dragH}px` : `${SNAPS[snap]}vh` } as React.CSSProperties}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
    >
      <button className="sheet-grip" onClick={cycle} aria-label={t("action.resize")} />
      {children}
    </aside>
  );
}

function snapPx(i: number): number {
  return (SNAPS[i] / 100) * window.innerHeight;
}

/** The height at which releasing dismisses the sheet instead of snapping back. */
function dismissPx(): number {
  return snapPx(0) * DISMISS_AT;
}

function clampSnap(i: number): number {
  return Math.min(Math.max(i, 0), SNAPS.length - 1);
}

function nearestSnap(percent: number): number {
  let best = 0;
  for (let i = 1; i < SNAPS.length; i++) {
    if (Math.abs(SNAPS[i] - percent) < Math.abs(SNAPS[best] - percent)) best = i;
  }
  return best;
}
