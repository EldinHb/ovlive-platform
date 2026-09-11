// The 1 Hz clock behind ages and countdowns; the formatting lives in @ovlive/shared.
import { useEffect, useState } from "react";

export { etaLabel, pad2 } from "@ovlive/shared";

export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, []);
  return now;
}
