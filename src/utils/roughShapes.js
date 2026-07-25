// Hand-drawn geometry via roughjs — the same library Excalidraw uses.
//
// Earlier the sketch look came from an SVG displacement filter over ordinary
// boxes, which only wobbled the edges, cost a lot on mobile GPUs, and had to be
// disabled there. These are real paths: they look genuinely hand-drawn, render
// identically on every device, and export cleanly.

import rough from "roughjs/bin/rough";

const generator = rough.generator();

// Rough re-randomizes on every call, so a stable seed per element keeps the
// strokes from jittering on each React render.
export function seedFrom(id) {
  const s = String(id ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2 ** 31;
}

const cache = new Map();
const CACHE_LIMIT = 600;

function memo(key, build) {
  const hit = cache.get(key);
  if (hit) return hit;
  const value = build();
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}

function toPaths(drawable) {
  return generator.toPaths(drawable).map((p) => p.d);
}

/**
 * Hand-drawn card outline, returned as SVG path strings. Two overlapping
 * strokes (rough's multi-stroke) give the "drawn twice" pencil feel.
 */
export function roughCard(width, height, seed, { roughness = 1.6 } = {}) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return memo(`card:${w}:${h}:${seed}:${roughness}`, () =>
    toPaths(
      generator.rectangle(2, 2, w - 4, h - 4, {
        seed: seed || 1,
        roughness,
        bowing: 1.6,
        strokeWidth: 1.3,
        // stroke/fill are applied by the caller so one geometry serves every
        // table colour and theme.
        disableMultiStroke: false,
      }),
    ),
  );
}

/**
 * Filled hand-drawn rectangle — used for the card body and the header wash so
 * the pastel areas have sketchy edges instead of crisp CSS corners.
 */
export function roughFill(width, height, seed, { offsetY = 0 } = {}) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const y = Math.round(offsetY);
  return memo(`fill:${w}:${h}:${y}:${seed}`, () =>
    generator
      .toPaths(
        generator.rectangle(2, 2 + y, w - 4, h, {
          seed: seed || 1,
          roughness: 1.4,
          bowing: 1.2,
          fill: "#000",
          fillStyle: "solid",
          stroke: "none",
        }),
      )
      .map((p) => p.d),
  );
}

/**
 * Hand-drawn horizontal rule (header underline, row separators).
 */
export function roughRule(x1, y, x2, seed, { roughness = 0.9 } = {}) {
  const a = Math.round(x1);
  const b = Math.round(x2);
  const yy = Math.round(y);
  return memo(`rule:${a}:${b}:${yy}:${seed}`, () =>
    toPaths(
      generator.line(a, yy, b, yy, {
        seed: seed || 1,
        roughness,
        bowing: 1.4,
        strokeWidth: 1,
        disableMultiStroke: true,
      }),
    ),
  );
}

/**
 * Hand-drawn version of an arbitrary path (used for relationship curves).
 */
export function roughPath(d, seed, { roughness = 0.9 } = {}) {
  if (!d) return [];
  return memo(`path:${d}:${seed}:${roughness}`, () =>
    toPaths(
      generator.path(d, {
        seed: seed || 1,
        roughness,
        bowing: 1,
        strokeWidth: 1.6,
        disableMultiStroke: true,
      }),
    ),
  );
}
