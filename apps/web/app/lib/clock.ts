// Shared ticking clock + countdown formatting for the vehicle and stop panels, so both
// render arrival times identically.

import { useEffect, useState } from "react";
import type { TFn } from "./i18n";

/**
 * A clock that re-renders once a second. The detail/board endpoints are only polled every
 * several seconds, so the age and the arrival countdowns have to tick locally — otherwise
 * they'd jump in multi-second steps.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, []);
  return now;
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Countdown to a stop arrival/departure, always down to the second. Seconds are zero-padded
 * so the tabular-figure column keeps its width as it ticks instead of shifting every ten
 * seconds.
 *
 * The seconds carry real per-stop information for most operators — measured over 142 live
 * trips / 2164 scheduled calls, the share of stop times not landing on `:00` is HTM 96%,
 * GVB 95%, RET 70%, KEOLIS 58%, EBS 47%, but **0% for CXX / ARR / QBUZZ**, which publish
 * whole minutes. For those three the seconds digit is just `delay % 60` and is therefore
 * constant across the trip. It also means the countdown is finer-grained than the clock
 * line beside it, which renders HH:MM and drops the schedule's seconds.
 */
export function etaLabel(secs: number, t: TFn): string {
  if (secs <= 0) return t("eta.now");
  if (secs < 60) return t("eta.secs", { n: secs });
  const s = pad2(secs % 60);
  const mins = Math.floor(secs / 60);
  if (mins < 60) return t("eta.minsSecs", { n: mins, s });
  return t("eta.hoursMinsSecs", { h: Math.floor(mins / 60), n: pad2(mins % 60), s });
}
