// Per-table width: cards size themselves to their content so field names and
// types are never truncated. settings.tableWidth is the minimum (the canvas
// resize handle raises that floor); a table only grows past it when its own
// text needs the room.

import { resolveType } from "./customTypes";

// Measured against the real row markup in Table.jsx:
//   <div class="h-[36px] px-2 ... flex justify-between items-center gap-1">
//     <div class="flex items-center gap-2">[grip 10px] [name]</div>
//     <div class="flex items-center gap-1 shrink-0">[key][?][type][delete]</div>
const ROW_PADDING = 24; // px-3 on both sides
const GRIP = 10 + 6; // grip dot + gap
const CLUSTER_GAP = 4; // gap-1 between the name and type clusters
const KEY_BADGE = 23 + 6; // fixed PK/FK/UQ column + its gap
const NULL_GLYPH = 12; // "?" nullable marker + its gap
const CHIP_PADDING = 16; // the type chip's px-[6px] on both sides
const LEADER_MIN = 24; // minimum visible run of leader dots
const DELETE_BTN = 34; // revealed on hover — budget it so nothing shifts/overlaps
const HEADER_ACTIONS = 104; // lock / collapse / more buttons revealed on hover
const SAFETY = 6; // hinting/subpixel slack
const MAX_WIDTH = 640;

// The canvas inherits the body font-size (16px); sketch mode swaps the family
// via CSS (see index.css). Keep these in sync with Table.jsx.
const FONT_SIZE = 15; // field names (mono)
const TITLE_SIZE = 20; // table name (handwriting)
const TYPE_SIZE = 13.5; // type chip (mono)
const MONO_STACK =
  'ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace';
const SKETCH_STACK =
  '"Excalifont", "Segoe Print", "Bradley Hand", "KaiTi", "STKaiti", "Kaiti SC", cursive';

let ctx = null;
let ctxFontKey = "";

function measure(text, weight, family, size = FONT_SIZE) {
  if (!text) return 0;
  if (typeof document === "undefined") return String(text).length * 8;
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  const key = `${weight} ${size}px ${family}`;
  if (ctxFontKey !== key) {
    ctx.font = key;
    ctxFontKey = key;
  }
  return ctx.measureText(String(text)).width;
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
 * Width a table needs so nothing is clipped, clamped to [minWidth, MAX_WIDTH].
 * Budgets for the controls that appear on hover so rows don't reflow or
 * collide when the pointer enters the card.
 */
export function getRequiredTableWidth(table, database, settings) {
  const min = settings?.tableWidth ?? 240;
  if (!table) return min;
  const family = canvasFontFamily(settings?.sketchMode);
  const showTypes = settings?.showDataTypes !== false;

  // Header: bold title + room for the hover action buttons.
  let widest =
    ROW_PADDING +
    measure(table.name, "bold", family, TITLE_SIZE) +
    HEADER_ACTIONS;

  for (const field of table.fields ?? []) {
    let right = DELETE_BTN;
    if (showTypes) {
      right +=
        measure(typeLabel(database, field), "normal", MONO_STACK, TYPE_SIZE) +
        CHIP_PADDING;
      if (!field.notNull) right += NULL_GLYPH;
    }
    // Identifiers render in the mono stack now, so measure them that way.
    const row =
      ROW_PADDING +
      GRIP +
      KEY_BADGE +
      measure(field.name, "normal", MONO_STACK, FONT_SIZE) +
      LEADER_MIN +
      CLUSTER_GAP +
      right +
      SAFETY;
    if (row > widest) widest = row;
  }

  return Math.min(MAX_WIDTH, Math.max(min, Math.ceil(widest)));
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
