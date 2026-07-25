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
import { layoutTables, gridPosition } from "../src/utils/tableLayout.js";

export { layoutTables, gridPosition };

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
      const rel = normalizeRelationship(r, content.tables);
      const duplicate = content.references.some(
        (x) =>
          x.startTableId === rel.startTableId &&
          x.startFieldId === rel.startFieldId &&
          x.endTableId === rel.endTableId &&
          x.endFieldId === rel.endFieldId,
      );
      if (duplicate) {
        throw new Error(
          `add_relationships: ${r.fromTable}.${r.fromField} → ${r.toTable}.${r.toField} already exists.`,
        );
      }
      // Names are labels, not keys — de-collide so drop_relationships can
      // address one unambiguously.
      let name = rel.name;
      let n = 2;
      while (content.references.some((x) => x.name === name)) {
        name = `${rel.name}_${n++}`;
      }
      rel.name = name;
      content.references.push(rel);
    }
    summary.push(`added ${ops.add_relationships.length} relationship(s)`);
  }

  // 8. drop_relationships (by name)
  if (ops.drop_relationships && ops.drop_relationships.length > 0) {
    let dropped = 0;
    for (const name of ops.drop_relationships) {
      const matches = content.references.filter((r) => r.name === name);
      if (matches.length === 0) {
        throw new Error(`drop_relationships: no relationship named "${name}".`);
      }
      // Never mass-delete on a name collision — that silently destroys data.
      if (matches.length > 1) {
        throw new Error(
          `drop_relationships: "${name}" is ambiguous (matches ${matches.length}).`,
        );
      }
      content.references = content.references.filter(
        (r) => r.id !== matches[0].id,
      );
      dropped += 1;
    }
    summary.push(`dropped ${dropped} relationship(s)`);
  }

  // 9. auto_layout — recompute every table position from the FK hierarchy.
  // Runs last so freshly added tables participate.
  if (ops.auto_layout === true) {
    layoutTables(content.tables, content.references);
    summary.push(`re-laid out ${content.tables.length} table(s)`);
  }

  return summary;
}
