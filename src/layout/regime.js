// The single source of truth for the layout breakpoints.
//
// Both sides of the app read the same signal: this module stamps
// `data-layout="sheet|rail|desktop"` onto <html>, CSS keys off
// `:root[data-layout="…"]` and never writes a breakpoint literal of its own, and
// React reads `useLayoutRegime()`. That is the whole point. Bug A1 was two
// gates that disagreed — `window.innerWidth >= 768` in Canvas.jsx against
// `@media (max-width: 700px)` in three stylesheets — which left the 701–767px
// band and every landscape phone falling between them. matchMedia is used on
// both sides here because innerWidth and @media also disagree by the scrollbar
// width on desktop, and that whole class of drift is what produced A1.
//
// Why width only, and not height / aspect / area: the failure being fixed is a
// horizontal one that merely *appears* in landscape. At 844x390 the 405px-wide
// switch (x 219.7–624.4) and the 352px rail (x 476–828) collide; give the same
// viewport more height and they still collide, give it more width and they do
// not. Height's real role is a continuous penalty, not a threshold — a bottom
// sheet is wrong at 390px tall because 62% of 390 leaves 148px of canvas — so
// height enters only through the min()/max-height formulas in CSS. Aspect and
// area were rejected because neither is monotone in the quantity that actually
// breaks (usable width beside a rail): 900x900 and 900x400 both host a rail,
// 500x2000 hosts none, and an area test cannot tell those apart.

import { useSyncExternalStore } from "react";

/** Below this the inspector cannot be a rail: a 288px rail still leaves >=328px of canvas. */
export const RAIL_MIN_W = 640;

/**
 * Above this the top band holds the doc island, the centred switch and the rail
 * all at once. Derived, not chosen: with the switch capped at 424px and the doc
 * island at `50vw - 240px`, the switch clears the rail when W >= 1184, and the
 * doc island keeps its natural 379px when W >= 1238. max(1184, 1238) -> 1240.
 */
export const DESKTOP_MIN_W = 1240;

export const LAYOUT = {
  SHEET: "sheet",
  RAIL: "rail",
  DESKTOP: "desktop",
};

const canMatch = typeof window !== "undefined" && !!window.matchMedia;
const mqRail = canMatch ? window.matchMedia(`(min-width: ${RAIL_MIN_W}px)`) : null;
const mqDesk = canMatch
  ? window.matchMedia(`(min-width: ${DESKTOP_MIN_W}px)`)
  : null;

export function getLayoutRegime() {
  if (!canMatch) return LAYOUT.DESKTOP;
  if (mqDesk.matches) return LAYOUT.DESKTOP;
  if (mqRail.matches) return LAYOUT.RAIL;
  return LAYOUT.SHEET;
}

function stamp() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.layout = getLayoutRegime();
}

// Runs at import. main.jsx imports this module before it renders, so the
// attribute is on <html> before the first paint and no regime's CSS is ever
// applied to the wrong viewport for a frame.
stamp();

const listeners = new Set();

function onChange() {
  stamp();
  for (const fn of listeners) fn();
}

if (canMatch) {
  mqRail.addEventListener("change", onChange);
  mqDesk.addEventListener("change", onChange);
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The current regime, re-rendering the caller when it changes. */
export function useLayoutRegime() {
  return useSyncExternalStore(subscribe, getLayoutRegime, () => LAYOUT.DESKTOP);
}
