import { useEffect, useState } from "react";

// Card widths are measured with canvas measureText. The hand-drawn face loads
// with font-display: swap, so a first measurement can land on fallback metrics
// (narrower) and leave cards too small. Re-render once the real fonts resolve
// so every width is recomputed against what is actually painted.
let ready = typeof document === "undefined" || !document.fonts;

export default function useFontsReady() {
  const [tick, setTick] = useState(ready ? 1 : 0);

  useEffect(() => {
    if (ready) return undefined;
    let cancelled = false;
    document.fonts.ready.then(() => {
      ready = true;
      if (!cancelled) setTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return tick;
}
