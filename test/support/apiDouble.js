// A test double for the context surface that undo()/redo() close over.
//
// Two jobs:
//
// 1. Record an ordered, deep-cloned log of every call the reducer makes. This is
//    the primary equivalence signal for the characterization harness: it does not
//    depend on the double being a faithful model of the contexts, so "legacy and
//    extracted agree" is proven regardless of how good this file is.
//
// 2. Model the real context mutators well enough that the resulting document is
//    meaningful, so a golden snapshot says something about the app.
//
// React fidelity note: in ControlPanel the reducers read `tables`/`areas`/
// `notes`/`types` as render-time consts, and calling updateTable() does NOT make
// a later read in the same tick see the write. So reads are served from a frozen
// snapshot taken at entry, while writes accumulate into a separate "next" state
// (which is how React composes queued setState updaters). Getting this backwards
// would make the double disagree with the browser.

// Mirrors getRelationshipFields in src/utils/utils.js. Inlined rather than
// imported to keep the harness's import graph down to one app module
// (data/constants): utils.js pulls in data/datatypes and uses atob.
function getRelationshipFields(relationship) {
  if (Array.isArray(relationship?.fields) && relationship.fields.length > 0) {
    return relationship.fields;
  }
  return [
    {
      startFieldId: relationship?.startFieldId,
      endFieldId: relationship?.endFieldId,
    },
  ];
}

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

function emptyState() {
  return {
    tables: [],
    relationships: [],
    areas: [],
    notes: [],
    types: [],
    enums: [],
    undoStack: [],
    redoStack: [],
  };
}

export function createHarness(initial = {}) {
  // `next` accumulates writes; `read` is the render-time snapshot.
  const next = { ...emptyState(), ...clone(initial) };
  const read = clone(next);
  const log = [];

  const record = (name, args) => log.push({ name, args: clone(args) });

  // Applies a React-style setter argument: updater fn or bare value.
  const apply = (key, arg) => {
    next[key] = typeof arg === "function" ? arg(next[key]) : arg;
  };

  const mapById = (key, id, values) => {
    next[key] = next[key].map((it) => (it.id === id ? { ...it, ...values } : it));
  };

  // Areas and notes keep `id` equal to array index, so both contexts renumber
  // after every structural change.
  const renumber = (list) => list.map((it, i) => ({ ...it, id: i }));

  const api = {
    // ---- render-time state snapshots ----
    get tables() {
      return read.tables;
    },
    get areas() {
      return read.areas;
    },
    get notes() {
      return read.notes;
    },
    get types() {
      return read.types;
    },

    // ---- DiagramContext ----
    addTable(data, addToHistory) {
      record("addTable", [data, addToHistory]);
      if (data) {
        const temp = next.tables.slice();
        // `data.index || tables.length` in the real context: index 0 is falsy,
        // so a table deleted from the head comes back at the tail.
        temp.splice(data.index || next.tables.length, 0, data.table);
        next.tables = temp;
      } else {
        next.tables = [...next.tables, { id: "new-table", fields: [], indices: [], uniqueConstraints: [] }];
      }
    },
    updateTable(id, values) {
      record("updateTable", [id, values]);
      mapById("tables", id, values);
    },
    deleteTable(id, addToHistory) {
      record("deleteTable", [id, addToHistory]);
      next.relationships = next.relationships.filter(
        (e) => !(e.startTableId === id || e.endTableId === id),
      );
      next.tables = next.tables.filter((e) => e.id !== id);
    },
    updateField(tid, fid, values) {
      record("updateField", [tid, fid, values]);
      next.tables = next.tables.map((table) =>
        tid === table.id
          ? {
              ...table,
              fields: table.fields.map((f) =>
                fid === f.id ? { ...f, ...values } : f,
              ),
            }
          : table,
      );
    },
    deleteField(field, tid, addToHistory) {
      record("deleteField", [field, tid, addToHistory]);
      const table = next.tables.find((t) => t.id === tid);
      if (!table) return;
      const referencesField = (r) =>
        getRelationshipFields(r).some(
          (p) =>
            (r.startTableId === tid && p.startFieldId === field.id) ||
            (r.endTableId === tid && p.endFieldId === field.id),
        );
      next.relationships = next.relationships.filter((e) => !referencesField(e));
      mapById("tables", tid, {
        fields: table.fields.filter((e) => e.id !== field.id),
      });
    },
    setRelationships(arg) {
      record("setRelationships", ["<updater>"]);
      apply("relationships", arg);
    },
    addRelationship(data, addToHistory) {
      record("addRelationship", [data, addToHistory]);
      const temp = next.relationships.slice();
      temp.splice(data.index, 0, data.relationship || data);
      next.relationships = temp;
    },
    deleteRelationship(id, addToHistory) {
      record("deleteRelationship", [id, addToHistory]);
      next.relationships = next.relationships.filter((e) => e.id !== id);
    },
    updateRelationship(id, values) {
      record("updateRelationship", [id, values]);
      mapById("relationships", id, values);
    },

    // ---- AreasContext ----
    addArea(data, addToHistory) {
      record("addArea", [data, addToHistory]);
      const temp = next.areas.slice();
      temp.splice(data.id, 0, data);
      next.areas = renumber(temp);
    },
    updateArea(id, values) {
      record("updateArea", [id, values]);
      mapById("areas", id, values);
    },
    deleteArea(id, addToHistory) {
      record("deleteArea", [id, addToHistory]);
      next.areas = renumber(next.areas.filter((e) => e.id !== id));
    },

    // ---- NotesContext ----
    addNote(data, addToHistory) {
      record("addNote", [data, addToHistory]);
      const temp = next.notes.slice();
      temp.splice(data.id, 0, data);
      next.notes = renumber(temp);
    },
    updateNote(id, values) {
      record("updateNote", [id, values]);
      mapById("notes", id, values);
    },
    deleteNote(id, addToHistory) {
      record("deleteNote", [id, addToHistory]);
      next.notes = renumber(next.notes.filter((e) => e.id !== id));
    },

    // ---- TypesContext (ids may be a nanoid string OR an array index) ----
    addType(data, addToHistory) {
      record("addType", [data, addToHistory]);
      const temp = next.types.slice();
      temp.splice(data.index, 0, data.type);
      next.types = temp;
    },
    updateType(id, values) {
      record("updateType", [id, values]);
      next.types = next.types.map((item, index) =>
        (typeof id === "number" ? index === id : item.id === id)
          ? { ...item, ...values }
          : item,
      );
    },
    deleteType(id, addToHistory) {
      record("deleteType", [id, addToHistory]);
      next.types = next.types.filter((e, i) =>
        typeof id === "number" ? i !== id : e.id !== id,
      );
    },
    setTypes(arg) {
      record("setTypes", ["<updater>"]);
      apply("types", arg);
    },

    // ---- EnumsContext ----
    addEnum(data, addToHistory) {
      record("addEnum", [data, addToHistory]);
      const temp = next.enums.slice();
      temp.splice(data.index, 0, data.enum);
      next.enums = temp;
    },
    updateEnum(id, values) {
      record("updateEnum", [id, values]);
      mapById("enums", id, values);
    },
    deleteEnum(id, addToHistory) {
      record("deleteEnum", [id, addToHistory]);
      next.enums = next.enums.filter((e) => e.id !== id);
    },

    // ---- UndoRedoContext ----
    setUndoStack(arg) {
      record("setUndoStack", ["<updater>"]);
      apply("undoStack", arg);
    },
    setRedoStack(arg) {
      record("setRedoStack", ["<updater>"]);
      apply("redoStack", arg);
    },
  };

  return { api, log, state: next, readable: read };
}

// Generated field/index ids are random (nanoid). Replace them with stable
// placeholders so two runs of the same scenario can be compared.
export function normalize(value) {
  const seen = new Map();
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = k === "id" && typeof val === "string" && /^[\w-]{21}$/.test(val)
          ? (seen.has(val) ? seen.get(val) : seen.set(val, `<generated-${seen.size}>`).get(val))
          : walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(value);
}
