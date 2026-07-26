// Per-table width: cards size themselves to their content so field names and
// types are never truncated. settings.tableWidth is the minimum (the canvas
// resize handle raises that floor); a table only grows past it when its own
// text needs the room.

import { resolveType } from "./customTypes";

// Measured against the real row markup in Table.jsx:
//   <div class="h-[40px] px-3 py-1 flex items-center gap-[6px]">
//     [grip 10px] [name]
//     <div class="field-right flex items-center gap-[6px]">[key][?][type][delete]</div>
//   (.field-right carries margin-inline-start:auto — see styles/card.css)
// The name sits hard left; the key badge and the type ride together on the
// right, with no leader between them.
const ROW_PADDING = 24; // px-3 on both sides
const GRIP = 10; // the grip dot / drag handle
const ROW_GAP = 6; // gap-[6px] between every item in a row
const KEY_BADGE = 23; // PK/FK/UQ badge, now part of the right cluster
const NULL_GLYPH = 8; // "?" nullable marker
const NAME_GAP_MIN = 24; // blank run kept between the name and the right cluster
const DELETE_BTN = 34; // revealed on hover — budget it so nothing shifts/overlaps
const HEADER_ACTIONS = 104; // lock / collapse / more buttons revealed on hover
const ALIAS_GAP = 6; // gap between the table name and its alias
const SAFETY = 6; // hinting/subpixel slack
// There is deliberately no maximum. A card is drawn at exactly this width — the
// foreignObject, the roughjs outline and the relationship anchors all take it —
// so a wider card is a wider card, consistently, and nothing lands outside the
// border. Capping it does not make the content fit; it hides it. A 640px cap
// used to be applied here, and because <foreignObject> clips to its own bounds
// (SVG's default overflow:hidden) a table whose widest row needed 800px painted
// as `..._normalized_lowercase_for_d` cut off mid-word with its VARCHAR(255)
// type gone from the card entirely — no ellipsis, no hint that anything was
// missing. Screenshotted in both Chromium and WebKit before it was removed.
// If very wide cards ever become a problem, the answer is to wrap or reflow the
// row, not to clip it: names and types are never truncated.

// The canvas inherits the body font-size (16px); sketch mode swaps the family
// via CSS (see index.css). Keep these in sync with Table.jsx.
const FONT_SIZE = 15; // field names (mono)
const TITLE_SIZE = 20; // table name (handwriting)
const ALIAS_SIZE = 13; // table alias next to the name
const TYPE_SIZE = 13.5; // type label (mono)
// Byte-identical to the stack index.css paints .field-name / .field-type with:
// measuring against a different fallback than the one that renders is how a
// name ends up wider than its card.
const MONO_STACK =
  'ui-monospace, "JetBrains Mono", "SFMono-Regular", "Cascadia Mono", Menlo, Consolas, "Noto Sans Mono CJK SC", monospace';
const SKETCH_STACK =
  '"Excalifont", "Segoe Print", "Bradley Hand", "KaiTi", "STKaiti", "Kaiti SC", cursive';

let ctx = null;
let ctxFontKey = "";

// measureText is the real per-frame cost in this file: Relationship.jsx
// re-measures both endpoints of every relationship on every drag frame, so a
// 50-table diagram runs ~1550 measurements per frame (4ms in WebKit) for text
// that has not changed. The same string in the same font always has the same
// width, so cache it — mirroring commentHeightCache in utils.js. Bounded and
// FIFO-evicted so a long editing session cannot grow it without limit.
const measureCache = new Map();
const MEASURE_CACHE_LIMIT = 4000;

// Before the webfonts resolve, measureText answers with fallback metrics. Those
// answers are cached under the same key as the post-swap ones, so without this
// every card measured during the swap window would stay wrong for the whole
// session — a fresh bug traded for the one the cache fixes.
if (typeof document !== "undefined" && document.fonts) {
  document.fonts.ready.then(() => measureCache.clear());
}

function measure(text, weight, family, size = FONT_SIZE) {
  if (!text) return 0;
  if (typeof document === "undefined") return String(text).length * 8;
  const cacheKey = `${weight}|${size}|${family}|${text}`;
  const cached = measureCache.get(cacheKey);
  if (cached !== undefined) return cached;
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  const key = `${weight} ${size}px ${family}`;
  if (ctxFontKey !== key) {
    ctx.font = key;
    ctxFontKey = key;
  }
  const width = ctx.measureText(String(text)).width;
  if (measureCache.size >= MEASURE_CACHE_LIMIT) {
    measureCache.delete(measureCache.keys().next().value);
  }
  measureCache.set(cacheKey, width);
  return width;
}

function canvasFontFamily(sketchMode) {
  if (sketchMode) return SKETCH_STACK;
  if (typeof window === "undefined") return "sans-serif";
  return window.getComputedStyle(document.body).fontFamily || "sans-serif";
}

function typeLabel(database, field) {
  const resolved = resolveType(database, field.type);
  const sized =
    (resolved.isSized || resolved.hasPrecision) &&
    field.size !== undefined &&
    field.size !== null &&
    field.size !== "";
  return sized ? `${field.type}(${field.size})` : field.type;
}

/**
 * Width a table needs so nothing is clipped. Never less than minWidth, and
 * deliberately unbounded above (see the note on the constants).
 * Budgets for the controls that appear on hover so rows don't reflow or
 * collide when the pointer enters the card.
 */
export function getRequiredTableWidth(table, database, settings) {
  const min = settings?.tableWidth ?? 240;
  if (!table) return min;
  const family = canvasFontFamily(settings?.sketchMode);
  const showTypes = settings?.showDataTypes !== false;

  // Header: bold title, its optional alias, and room for the hover buttons.
  let widest =
    ROW_PADDING +
    measure(table.name, "bold", family, TITLE_SIZE) +
    (table.alias
      ? ALIAS_GAP + measure(table.alias, "normal", family, ALIAS_SIZE)
      : 0) +
    HEADER_ACTIONS;

  for (const field of table.fields ?? []) {
    // Right cluster, laid out right-to-left: [badge] [?] [type] [delete].
    // The badge is always budgeted even though a field without a key does not
    // render one: whether a field is a foreign key lives in `relationships`,
    // which this function deliberately does not take — Table.jsx, the
    // relationship geometry and auto-layout all call it and must agree on the
    // width to the pixel. Over-reserving 29px on a keyless row is harmless;
    // guessing low would clip an FK row's type.
    let right = KEY_BADGE + ROW_GAP + DELETE_BTN;
    if (showTypes) {
      right +=
        measure(typeLabel(database, field), "normal", MONO_STACK, TYPE_SIZE) +
        ROW_GAP;
      if (!field.notNull) right += NULL_GLYPH + ROW_GAP;
    }
    // Identifiers render in the mono stack now, so measure them that way.
    const left =
      ROW_PADDING +
      GRIP +
      ROW_GAP +
      measure(field.name, "normal", MONO_STACK, FONT_SIZE);
    const row = left + NAME_GAP_MIN + right + SAFETY;
    if (row > widest) widest = row;
  }

  return Math.max(min, Math.ceil(widest));
}

/**
 * Width lookup for every table, keyed by id — relationship geometry and
 * auto-layout need the width of each table, which may differ.
 */
export function buildTableWidths(tables, database, settings) {
  const map = new Map();
  for (const t of tables ?? []) {
    map.set(t.id, getRequiredTableWidth(t, database, settings));
  }
  return map;
}
