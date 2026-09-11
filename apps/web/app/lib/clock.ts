// Shared ticking clock for the vehicle and stop panels. The formatting lives in
// @ovlive/shared; this hook is the React half.

import { useEffect, useState } from "react";

export { etaLabel, pad2 } from "@ovlive/shared";

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
