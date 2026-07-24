// shapes.js — translate between the MCP-facing "simplified" schema and the exact
// drawdb editor `content` document. The web editor is strict: malformed docs make
// it crash, so every table/field/relationship is built with the full key set the
// editor expects (see src/context/DiagramContext.jsx and src/components/EditorCanvas
// in the drawdb frontend).

import { nanoid } from "nanoid";

export const DEFAULT_COLOR = "#175e7a";

// Keys the drawdb editor recognizes (databases[database] is looked up without a
// guard in the frontend — an unknown value crashes the editor). "mssql" is
// accepted as an input alias and normalized to "transactsql".
export const DATABASES = [
  "generic",
  "postgresql",
  "mysql",
  "sqlite",
  "mariadb",
  "mssql",
  "transactsql",
  "oraclesql",
];

export function normalizeDatabase(db) {
  const value = db || "generic";
  return value === "mssql" ? "transactsql" : value;
}

export const CARDINALITIES = ["one_to_one", "one_to_many", "many_to_one"];

export const CONSTRAINTS = [
  "No action",
  "Restrict",
  "Cascade",
  "Set null",
  "Set default",
];

const DEFAULT_CARDINALITY = "many_to_one";
const DEFAULT_CONSTRAINT = "No action";

// ---- layout ----------------------------------------------------------------

// Editor render metrics (src/data/constants.js): tableWidth 220,
// tableHeaderHeight 50, tableFieldHeight 36.
const TABLE_WIDTH = 220;
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
export function layoutTables(tables, references) {
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
    col.forEach((t, i) => {
      t.x = x;
      t.y = y;
      y += tableHeight(t) + ROW_GAP;
      rowIndex.set(t.id, i);
    });
    x += TABLE_WIDTH + COL_GAP;
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
export function makePlacer(existingTables) {
  const occupied = new Set(
    (existingTables || []).map((t) => `${t.x},${t.y}`),
  );
  let i = (existingTables || []).length;
  return function next() {
    let pos = gridPosition(i);
    // Skip a slot that would land exactly on an existing table.
    while (occupied.has(`${pos.x},${pos.y}`)) {
      i += 1;
      pos = gridPosition(i);
    }
    occupied.add(`${pos.x},${pos.y}`);
    i += 1;
    return pos;
  };
}

// ---- content skeleton ------------------------------------------------------

export function blankContent(database) {
  const content = {
    gistId: "",
    tables: [],
    references: [],
    notes: [],
    areas: [],
    pan: { x: 0, y: 0 },
    zoom: 1,
  };
  // Only dialects that support them carry these collections on a fresh doc.
  if (database === "postgresql") content.types = [];
  if (database === "mysql") content.enums = [];
  return content;
}

// Guards a loaded doc so an update never drops the collections the editor reads.
export function ensureContentArrays(content) {
  if (!Array.isArray(content.tables)) content.tables = [];
  if (!Array.isArray(content.references)) content.references = [];
  if (!Array.isArray(content.notes)) content.notes = [];
  if (!Array.isArray(content.areas)) content.areas = [];
  if (content.gistId === undefined) content.gistId = "";
  if (content.pan === undefined) content.pan = { x: 0, y: 0 };
  if (content.zoom === undefined) content.zoom = 1;
  return content;
}

// ---- normalization: simple -> full -----------------------------------------

export function normalizeField(f) {
  if (!f || typeof f.name !== "string" || f.name.length === 0) {
    throw new Error("Every field needs a non-empty `name`.");
  }
  if (typeof f.type !== "string" || f.type.length === 0) {
    throw new Error(
      `Field "${f.name}" needs a \`type\` string (e.g. INT, BIGINT, VARCHAR, TEXT, TIMESTAMP, BOOLEAN).`,
    );
  }
  const primary = f.primary === true;
  // primary implies notNull + unique unless the caller says otherwise.
  const notNull = f.notNull === undefined ? primary : f.notNull === true;
  const unique = f.unique === undefined ? primary : f.unique === true;

  const field = {
    id: nanoid(),
    name: f.name,
    type: String(f.type).toUpperCase(),
    default: f.default === undefined || f.default === null ? "" : String(f.default),
    check: f.check === undefined || f.check === null ? "" : String(f.check),
    primary,
    unique,
    notNull,
    increment: f.increment === true,
    comment: f.comment === undefined || f.comment === null ? "" : String(f.comment),
  };
  if (f.size !== undefined && f.size !== null && f.size !== "") {
    field.size = f.size;
  }
  if (Array.isArray(f.values)) {
    field.values = f.values.slice();
  }
  return field;
}

export function normalizeTable(t, place) {
  if (!t || typeof t.name !== "string" || t.name.length === 0) {
    throw new Error("Every table needs a non-empty `name`.");
  }
  if (!Array.isArray(t.fields) || t.fields.length === 0) {
    throw new Error(`Table "${t.name}" needs at least one field.`);
  }
  const pos = place();
  return {
    id: nanoid(),
    name: t.name,
    x: pos.x,
    y: pos.y,
    fields: t.fields.map(normalizeField),
    comment: t.comment === undefined || t.comment === null ? "" : String(t.comment),
    indices: [],
    color: DEFAULT_COLOR,
    locked: false,
  };
}

function findUniqueTable(tables, name, role) {
  const matches = tables.filter((t) => t.name === name);
  if (matches.length === 0) {
    throw new Error(`${role} table "${name}" does not exist in this diagram.`);
  }
  if (matches.length > 1) {
    throw new Error(`${role} table "${name}" is ambiguous (defined more than once).`);
  }
  return matches[0];
}

function findUniqueField(table, fieldName, role) {
  const matches = table.fields.filter((f) => f.name === fieldName);
  if (matches.length === 0) {
    throw new Error(
      `${role} field "${fieldName}" does not exist on table "${table.name}".`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `${role} field "${fieldName}" is ambiguous on table "${table.name}".`,
    );
  }
  return matches[0];
}

// Builds a full relationship. `from` is the CHILD (FK holder), `to` the PARENT.
export function normalizeRelationship(r, tables) {
  if (!r || typeof r !== "object") {
    throw new Error("A relationship must be an object.");
  }
  const child = findUniqueTable(tables, r.fromTable, "Relationship `from`");
  const parent = findUniqueTable(tables, r.toTable, "Relationship `to`");
  const childField = findUniqueField(child, r.fromField, "Relationship `from`");
  const parentField = findUniqueField(parent, r.toField, "Relationship `to`");

  const cardinality = r.cardinality || DEFAULT_CARDINALITY;
  if (!CARDINALITIES.includes(cardinality)) {
    throw new Error(
      `Invalid cardinality "${cardinality}". Use one of: ${CARDINALITIES.join(", ")}.`,
    );
  }
  const deleteConstraint = r.onDelete || DEFAULT_CONSTRAINT;
  if (!CONSTRAINTS.includes(deleteConstraint)) {
    throw new Error(
      `Invalid onDelete "${deleteConstraint}". Use one of: ${CONSTRAINTS.join(", ")}.`,
    );
  }
  const updateConstraint = r.onUpdate || DEFAULT_CONSTRAINT;
  if (!CONSTRAINTS.includes(updateConstraint)) {
    throw new Error(
      `Invalid onUpdate "${updateConstraint}". Use one of: ${CONSTRAINTS.join(", ")}.`,
    );
  }

  return {
    id: nanoid(),
    name: `fk_${child.name}_${childField.name}_${parent.name}`,
    startTableId: child.id,
    startFieldId: childField.id,
    endTableId: parent.id,
    endFieldId: parentField.id,
    fields: [{ startFieldId: childField.id, endFieldId: parentField.id }],
    cardinality,
    updateConstraint,
    deleteConstraint,
  };
}

// Assembles a brand-new content doc from simplified tables + relationships,
// laid out by foreign-key hierarchy.
export function buildContent(database, simpleTables, simpleRels) {
  const content = blankContent(database);
  const place = makePlacer([]);
  content.tables = (simpleTables || []).map((t) => normalizeTable(t, place));
  content.references = (simpleRels || []).map((r) =>
    normalizeRelationship(r, content.tables),
  );
  layoutTables(content.tables, content.references);
  return content;
}

// ---- simplify: full -> simple (read view) ----------------------------------

function simplifyField(f) {
  const out = {
    name: f.name,
    type: f.type,
    primary: !!f.primary,
    notNull: !!f.notNull,
    unique: !!f.unique,
    increment: !!f.increment,
    default: f.default === undefined || f.default === null ? "" : f.default,
    comment: f.comment === undefined || f.comment === null ? "" : f.comment,
  };
  if (f.size !== undefined && f.size !== null && f.size !== "") out.size = f.size;
  if (Array.isArray(f.values) && f.values.length > 0) out.values = f.values;
  return out;
}

export function simplifyDiagram(server, url, includeLayout) {
  const content =
    server.content && typeof server.content === "object" ? server.content : {};
  const tables = Array.isArray(content.tables) ? content.tables : [];
  const references = Array.isArray(content.references) ? content.references : [];
  const tableById = new Map(tables.map((t) => [t.id, t]));

  const simpleTables = tables.map((t) => {
    const st = {
      name: t.name,
      comment: t.comment === undefined || t.comment === null ? "" : t.comment,
      fields: Array.isArray(t.fields) ? t.fields.map(simplifyField) : [],
    };
    if (includeLayout) {
      st.x = t.x;
      st.y = t.y;
      st.color = t.color;
    }
    return st;
  });

  const relationships = references.map((r) => {
    const child = tableById.get(r.startTableId);
    const parent = tableById.get(r.endTableId);
    const childField = child?.fields?.find((f) => f.id === r.startFieldId);
    const parentField = parent?.fields?.find((f) => f.id === r.endFieldId);
    return {
      name: r.name,
      fromTable: child ? child.name : null,
      fromField: childField ? childField.name : null,
      toTable: parent ? parent.name : null,
      toField: parentField ? parentField.name : null,
      cardinality: r.cardinality,
      onDelete: r.deleteConstraint,
    };
  });

  return {
    diagramId: server.diagramId,
    name: server.name,
    database: server.database,
    version: server.version,
    url,
    tables: simpleTables,
    relationships,
    counts: {
      notes: Array.isArray(content.notes) ? content.notes.length : 0,
      areas: Array.isArray(content.areas) ? content.areas.length : 0,
      enums: Array.isArray(content.enums) ? content.enums.length : 0,
      types: Array.isArray(content.types) ? content.types.length : 0,
    },
  };
}

// ---- update operations -----------------------------------------------------

// Applies a partial SimpleField patch onto an existing full field in place.
function applyFieldPatch(field, set) {
  if (!set || typeof set !== "object") return;
  if (set.name !== undefined) field.name = set.name;
  if (set.type !== undefined) field.type = String(set.type).toUpperCase();
  if (set.default !== undefined) {
    field.default = set.default === null ? "" : String(set.default);
  }
  if (set.check !== undefined) {
    field.check = set.check === null ? "" : String(set.check);
  }
  if (set.comment !== undefined) {
    field.comment = set.comment === null ? "" : String(set.comment);
  }
  if (set.increment !== undefined) field.increment = set.increment === true;
  if (set.size !== undefined) {
    if (set.size === null || set.size === "") delete field.size;
    else field.size = set.size;
  }
  if (set.values !== undefined) {
    if (Array.isArray(set.values)) field.values = set.values.slice();
    else delete field.values;
  }
  if (set.primary !== undefined) field.primary = set.primary === true;
  // primary:true implies notNull + unique unless explicitly overridden.
  if (set.notNull !== undefined) field.notNull = set.notNull === true;
  else if (set.primary === true) field.notNull = true;
  if (set.unique !== undefined) field.unique = set.unique === true;
  else if (set.primary === true) field.unique = true;
}

// Mutates `content` by applying update ops in the documented order.
// Returns a list of human-readable summary strings.
export function applyOps(content, ops) {
  ensureContentArrays(content);
  const summary = [];

  const findTable = (name, verb) => findUniqueTable(content.tables, name, verb);

  // 1. add_tables
  if (ops.add_tables && ops.add_tables.length > 0) {
    const place = makePlacer(content.tables);
    for (const t of ops.add_tables) {
      if (content.tables.some((x) => x.name === t.name)) {
        throw new Error(`add_tables: a table named "${t.name}" already exists.`);
      }
      content.tables.push(normalizeTable(t, place));
    }
    summary.push(`added ${ops.add_tables.length} table(s)`);
  }

  // 2. drop_tables (+ relationships touching them)
  if (ops.drop_tables && ops.drop_tables.length > 0) {
    for (const name of ops.drop_tables) {
      const tbl = findTable(name, "drop_tables");
      content.tables = content.tables.filter((x) => x.id !== tbl.id);
      content.references = content.references.filter(
        (r) => r.startTableId !== tbl.id && r.endTableId !== tbl.id,
      );
    }
    summary.push(`dropped ${ops.drop_tables.length} table(s)`);
  }

  // 3. rename_tables (relationship names are labels — left untouched)
  if (ops.rename_tables && ops.rename_tables.length > 0) {
    for (const pair of ops.rename_tables) {
      const tbl = findTable(pair.from, "rename_tables");
      if (content.tables.some((x) => x.name === pair.to && x.id !== tbl.id)) {
        throw new Error(`rename_tables: a table named "${pair.to}" already exists.`);
      }
      tbl.name = pair.to;
    }
    summary.push(`renamed ${ops.rename_tables.length} table(s)`);
  }

  // 4. add_fields
  if (ops.add_fields && ops.add_fields.length > 0) {
    let count = 0;
    for (const entry of ops.add_fields) {
      const tbl = findTable(entry.table, "add_fields");
      for (const f of entry.fields || []) {
        if (tbl.fields.some((x) => x.name === f.name)) {
          throw new Error(
            `add_fields: field "${f.name}" already exists on table "${entry.table}".`,
          );
        }
        tbl.fields.push(normalizeField(f));
        count += 1;
      }
    }
    summary.push(`added ${count} field(s)`);
  }

  // 5. drop_fields (+ relationships referencing the field)
  if (ops.drop_fields && ops.drop_fields.length > 0) {
    for (const entry of ops.drop_fields) {
      const tbl = findTable(entry.table, "drop_fields");
      const fld = findUniqueField(tbl, entry.field, "drop_fields");
      tbl.fields = tbl.fields.filter((f) => f.id !== fld.id);
      content.references = content.references.filter(
        (r) =>
          !(
            (r.startTableId === tbl.id && r.startFieldId === fld.id) ||
            (r.endTableId === tbl.id && r.endFieldId === fld.id)
          ),
      );
    }
    summary.push(`dropped ${ops.drop_fields.length} field(s)`);
  }

  // 6. modify_fields
  if (ops.modify_fields && ops.modify_fields.length > 0) {
    for (const entry of ops.modify_fields) {
      const tbl = findTable(entry.table, "modify_fields");
      const fld = findUniqueField(tbl, entry.field, "modify_fields");
      applyFieldPatch(fld, entry.set);
    }
    summary.push(`modified ${ops.modify_fields.length} field(s)`);
  }

  // 7. add_relationships
  if (ops.add_relationships && ops.add_relationships.length > 0) {
    for (const r of ops.add_relationships) {
      content.references.push(normalizeRelationship(r, content.tables));
    }
    summary.push(`added ${ops.add_relationships.length} relationship(s)`);
  }

  // 8. drop_relationships (by name)
  if (ops.drop_relationships && ops.drop_relationships.length > 0) {
    for (const name of ops.drop_relationships) {
      const before = content.references.length;
      content.references = content.references.filter((r) => r.name !== name);
      if (content.references.length === before) {
        throw new Error(`drop_relationships: no relationship named "${name}".`);
      }
    }
    summary.push(`dropped ${ops.drop_relationships.length} relationship(s)`);
  }

  // 9. auto_layout — recompute every table position from the FK hierarchy.
  // Runs last so freshly added tables participate.
  if (ops.auto_layout === true) {
    layoutTables(content.tables, content.references);
    summary.push(`re-laid out ${content.tables.length} table(s)`);
  }

  return summary;
}
