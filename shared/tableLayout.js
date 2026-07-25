// Relationship-aware table layout, shared by the editor's Auto arrange and the
// MCP server's table placement.
//
// It lived in mcp/shapes.js, which the editor imported across the package
// boundary. It cannot live under src/ either: the runtime image ships only
// mcp/, server/ and dist/, so an mcp -> src import resolves in the repo and
// crashes in the container. shared/ is the one place both the browser bundle
// and the MCP server can reach, and Dockerfile.cloud copies it in.

// Editor render metrics (src/data/constants.js): tableWidth default 240
// (user-adjustable 180-520), tableHeaderHeight 50, tableFieldHeight 36.
export const TABLE_WIDTH = 240;
const HEADER_H = 50;
const FIELD_H = 36;
const COL_GAP = 140;
const ROW_GAP = 70;
const MARGIN = 80;

function tableHeight(t) {
  return HEADER_H + Math.max(1, t.fields?.length || 1) * FIELD_H;
}

// Relationship-aware layered layout: tables nobody references sit in the
// leftmost column, each child goes one column right of its deepest parent,
// and within a column tables are ordered near their parents (barycenter) to
// keep FK lines short and uncrossed. Height-aware, so tall tables never
// overlap. Deterministic. Mutates x/y in place and returns the tables.
// widthOf: optional (table) => width, so the editor can space columns by each
// card's real measured width (cards size themselves to their content).
export function layoutTables(
  tables,
  references,
  tableWidth = TABLE_WIDTH,
  widthOf = null,
) {
  const ids = new Set(tables.map((t) => t.id));
  const parentsOf = new Map(tables.map((t) => [t.id, new Set()]));
  for (const r of references || []) {
    if (
      ids.has(r.startTableId) &&
      ids.has(r.endTableId) &&
      r.startTableId !== r.endTableId
    ) {
      parentsOf.get(r.startTableId).add(r.endTableId); // child -> parent
    }
  }

  // layer(child) = max(layer(parents)) + 1; bounded rounds keep cycles safe
  const layer = new Map(tables.map((t) => [t.id, 0]));
  for (let round = 0; round < tables.length; round++) {
    let changed = false;
    for (const t of tables) {
      for (const p of parentsOf.get(t.id)) {
        const want = Math.min(layer.get(p) + 1, tables.length - 1);
        if (layer.get(t.id) < want) {
          layer.set(t.id, want);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const columns = new Map();
  for (const t of tables) {
    const l = layer.get(t.id);
    if (!columns.has(l)) columns.set(l, []);
    columns.get(l).push(t);
  }

  const rowIndex = new Map(); // table id -> row position in its column
  let x = MARGIN;
  for (const l of [...columns.keys()].sort((a, b) => a - b)) {
    const col = columns.get(l);
    const barycenter = (t) => {
      const rows = [...parentsOf.get(t.id)]
        .map((p) => rowIndex.get(p))
        .filter((v) => v !== undefined);
      return rows.length
        ? rows.reduce((s, v) => s + v, 0) / rows.length
        : Number.MAX_SAFE_INTEGER; // parentless tables sink to the bottom
    };
    col.sort(
      (a, b) => barycenter(a) - barycenter(b) || a.name.localeCompare(b.name),
    );
    let y = MARGIN;
    let widestInColumn = tableWidth;
    col.forEach((t, i) => {
      t.x = x;
      t.y = y;
      y += tableHeight(t) + ROW_GAP;
      rowIndex.set(t.id, i);
      const w = widthOf ? widthOf(t) : tableWidth;
      if (w > widestInColumn) widestInColumn = w;
    });
    x += widestInColumn + COL_GAP;
  }
  return tables;
}

// Grid slot for the i-th table: 4 columns, 260px apart, rows 280px apart.
// Still used when appending tables to an existing, possibly hand-arranged
// diagram (a full re-layout would move the user's tables uninvited).
export function gridPosition(i) {
  return {
    x: 100 + (i % 4) * 260,
    y: 100 + Math.floor(i / 4) * 280,
  };
}

// Returns a stateful placer that hands out non-colliding grid slots, continuing
// after any tables that already exist in the document.
