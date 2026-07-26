import { nanoid } from "nanoid";
import { Action, ObjectType } from "../data/constants";

// Applies one undo/redo history entry.
//
// undo and redo are mirror images: they differ only in which side of the entry
// they read (`entry.undo` vs `entry.redo`) and which stack the entry is pushed
// onto afterwards. They used to be two ~200-line if/else-if towers in
// ControlPanel, switching on action x element x component, and they had drifted
// apart. Here the shared shape is expressed once and only the branches that are
// genuinely asymmetric are written twice.
//
// Handlers come in two forms:
//   fn                 symmetric — reads `patch` and works for both directions
//   { undo, redo }     genuinely different work per direction
//
// The caller supplies `api`: the context surface, plus render-time snapshots of
// tables/areas/notes/types. Reads come from those snapshots, so (as in React) a
// write made during this call is not visible to a later read in the same call.

// `updatedFields` carries table fields whose type string tracks a type/enum name.
// Renaming the type has to rewrite them; other edits leave them alone.
function cascadeRename(entry, patch, api) {
  if (entry.updatedFields) {
    if (patch.name) {
      entry.updatedFields.forEach((x) =>
        api.updateField(x.tid, x.fid, { type: patch.name.toUpperCase() }),
      );
    }
  }
}

// Types are addressed either by array index (number) or by id (string).
function findType(entry, api) {
  return api.types.find((t, i) =>
    typeof entry.tid === "number" ? i === entry.tid : t.id === entry.tid,
  );
}

// Reindexes a list so `id` matches position, which is the invariant indices and
// uniqueConstraints are stored under.
const reindex = (list) => list.map((item, i) => ({ ...item, id: i }));

// ---------------------------------------------------------------------------
// Action.ADD and Action.DELETE, per element.
//
//   ADD    undo -> removeAdded (falls back to remove), redo -> add
//   DELETE undo -> restore (falls back to add),        redo -> remove
//
// `removeAdded` exists only for areas and notes, whose ADD entries are undone
// positionally rather than by id (see the comment on each).
const ELEMENT_OPS = {
  [ObjectType.TABLE]: {
    add: (entry, api) => api.addTable(entry.data, false),
    // A deleted table takes its relationships with it, so they come back first.
    restore: (entry, api) => {
      entry.data.relationship.forEach((x) => api.addRelationship(x, false));
      api.addTable(entry.data, false);
    },
    remove: (entry, api) => api.deleteTable(entry.data.table.id, false),
  },
  [ObjectType.AREA]: {
    add: (entry, api) => api.addArea(entry.data, false),
    remove: (entry, api) => api.deleteArea(entry.data.id, false),
    // Deletes whichever area is currently last rather than the one the entry
    // names. Preserved deliberately: areas keep id === index and an added area
    // is always last, so the two agree in practice.
    removeAdded: (entry, api) => api.deleteArea(api.areas[api.areas.length - 1].id, false),
  },
  [ObjectType.NOTE]: {
    add: (entry, api) => api.addNote(entry.data, false),
    remove: (entry, api) => api.deleteNote(entry.data.id, false),
    // Same positional assumption as areas.
    removeAdded: (entry, api) => api.deleteNote(api.notes[api.notes.length - 1].id, false),
  },
  [ObjectType.RELATIONSHIP]: {
    add: (entry, api) => api.addRelationship(entry.data, false),
    remove: (entry, api) => api.deleteRelationship(entry.data.relationship.id, false),
  },
  [ObjectType.TYPE]: {
    add: (entry, api) => api.addType(entry.data, false),
    remove: (entry, api) => api.deleteType(entry.data.type.id, false),
  },
  [ObjectType.ENUM]: {
    add: (entry, api) => api.addEnum(entry.data, false),
    remove: (entry, api) => api.deleteEnum(entry.data.enum.id, false),
  },
};

// ---------------------------------------------------------------------------
// Action.MOVE, per element. Both directions do the same thing: record where the
// element is now onto the opposite stack, then move it to where the entry says.
//
// Tables are addressed by id; areas and notes are indexed positionally, which
// works because both keep id === array index.
const MOVE_OPS = {
  [ObjectType.TABLE]: {
    current: (entry, api) => {
      const { x, y } = api.tables.find((t) => t.id === entry.id);
      return { x, y };
    },
    apply: (entry, api) => api.updateTable(entry.id, { x: entry.x, y: entry.y }),
  },
  [ObjectType.AREA]: {
    current: (entry, api) => ({ x: api.areas[entry.id].x, y: api.areas[entry.id].y }),
    apply: (entry, api) => api.updateArea(entry.id, { x: entry.x, y: entry.y }),
  },
  [ObjectType.NOTE]: {
    current: (entry, api) => ({ x: api.notes[entry.id].x, y: api.notes[entry.id].y }),
    apply: (entry, api) => api.updateNote(entry.id, { x: entry.x, y: entry.y }),
  },
};

// Bulk moves carry their own per-element undo/redo coordinates.
const BULK_UPDATE = {
  [ObjectType.TABLE]: (api) => api.updateTable,
  [ObjectType.AREA]: (api) => api.updateArea,
  [ObjectType.NOTE]: (api) => api.updateNote,
};

// ---------------------------------------------------------------------------
// Action.EDIT, keyed `${element}.${component}`.
//
// `${element}.*` is the fallback for elements that ignore `component` entirely
// (areas, notes, relationships, enums all have a single edit shape).
const EDIT_HANDLERS = {
  [`${ObjectType.AREA}.*`]: (entry, { patch, api }) => api.updateArea(entry.aid, patch),
  [`${ObjectType.NOTE}.*`]: (entry, { patch, api }) => api.updateNote(entry.nid, patch),
  [`${ObjectType.RELATIONSHIP}.*`]: (entry, { patch, api }) =>
    api.updateRelationship(entry.rid, patch),
  [`${ObjectType.ENUM}.*`]: (entry, { patch, api }) => {
    api.updateEnum(entry.id, patch);
    cascadeRename(entry, patch, api);
  },

  // ---- table ----
  [`${ObjectType.TABLE}.self`]: (entry, { patch, api }) => api.updateTable(entry.tid, patch),
  [`${ObjectType.TABLE}.field`]: (entry, { patch, api }) =>
    api.updateField(entry.tid, entry.fid, patch),
  [`${ObjectType.TABLE}.field_add`]: {
    undo: (entry, { table, api }) =>
      api.updateTable(entry.tid, {
        fields: table.fields.filter((e) => e.id !== entry.fid),
      }),
    // Appends a blank field with a fresh id rather than restoring the one that
    // was there. Preserved as-is: see the report — this loses the field's
    // contents on redo, and is a pre-existing bug, not something the extraction
    // introduced.
    redo: (entry, { table, api }) =>
      api.updateTable(entry.tid, {
        fields: [
          ...table.fields,
          {
            name: "",
            type: "",
            default: "",
            check: "",
            primary: false,
            unique: false,
            notNull: false,
            increment: false,
            comment: "",
            id: nanoid(),
          },
        ],
      }),
  },
  [`${ObjectType.TABLE}.field_delete`]: {
    undo: (entry, { table, api }) => {
      api.setRelationships((prev) => {
        let temp = [...prev];
        entry.data.relationship.forEach((r) => {
          temp.splice(r.id, 0, r);
        });
        return temp;
      });
      const updatedFields = table.fields.slice();
      updatedFields.splice(entry.data.index, 0, entry.data.field);
      api.updateTable(entry.tid, { fields: updatedFields });
    },
    redo: (entry, { api }) => api.deleteField(entry.data.field, entry.tid, false),
  },
  [`${ObjectType.TABLE}.index`]: (entry, { patch, table, api }) =>
    api.updateTable(entry.tid, {
      indices: table.indices.map((index) =>
        index.id === entry.iid ? { ...index, ...patch } : index,
      ),
    }),
  [`${ObjectType.TABLE}.index_add`]: {
    // Drops the index whose id equals length - 1, i.e. the last one by position.
    undo: (entry, { table, api }) =>
      api.updateTable(entry.tid, {
        indices: reindex(table.indices.filter((e) => e.id !== table.indices.length - 1)),
      }),
    redo: (entry, { table, api }) =>
      api.updateTable(entry.tid, {
        indices: [
          ...table.indices,
          {
            id: table.indices.length,
            name: `index_${table.indices.length}`,
            fields: [],
          },
        ],
      }),
  },
  [`${ObjectType.TABLE}.index_delete`]: {
    undo: (entry, { table, api }) => {
      const updatedIndices = table.indices.slice();
      updatedIndices.splice(entry.data.id, 0, entry.data);
      api.updateTable(entry.tid, { indices: reindex(updatedIndices) });
    },
    redo: (entry, { table, api }) =>
      api.updateTable(entry.tid, {
        indices: reindex(table.indices.filter((e) => e.id !== entry.data.id)),
      }),
  },
  [`${ObjectType.TABLE}.unique_constraint`]: (entry, { patch, table, api }) =>
    api.updateTable(entry.tid, {
      uniqueConstraints: (table.uniqueConstraints || []).map((constraint) =>
        constraint.id === entry.cid ? { ...constraint, ...patch } : constraint,
      ),
    }),
  [`${ObjectType.TABLE}.unique_constraint_add`]: {
    undo: (entry, { table, api }) => {
      const constraints = table.uniqueConstraints || [];
      api.updateTable(entry.tid, {
        uniqueConstraints: reindex(constraints.filter((e) => e.id !== constraints.length - 1)),
      });
    },
    redo: (entry, { table, api }) => {
      const constraints = table.uniqueConstraints || [];
      api.updateTable(entry.tid, {
        uniqueConstraints: [
          ...constraints,
          {
            id: constraints.length,
            name: `${table.name}_unique_${constraints.length}`,
            fields: [],
          },
        ],
      });
    },
  },
  [`${ObjectType.TABLE}.unique_constraint_delete`]: {
    undo: (entry, { table, api }) => {
      const updatedConstraints = (table.uniqueConstraints || []).slice();
      updatedConstraints.splice(entry.data.id, 0, entry.data);
      api.updateTable(entry.tid, { uniqueConstraints: reindex(updatedConstraints) });
    },
    redo: (entry, { table, api }) =>
      api.updateTable(entry.tid, {
        uniqueConstraints: reindex(
          (table.uniqueConstraints || []).filter((e) => e.id !== entry.data.id),
        ),
      }),
  },

  // ---- custom type ----
  [`${ObjectType.TYPE}.self`]: (entry, { patch, api }) => {
    api.updateType(entry.tid, patch);
    cascadeRename(entry, patch, api);
  },
  // Indexes types positionally, unlike field_add just below which accepts either
  // an index or an id.
  [`${ObjectType.TYPE}.field`]: (entry, { patch, api }) =>
    api.updateType(entry.tid, {
      fields: api.types[entry.tid].fields.map((e, i) =>
        i === entry.fid ? { ...e, ...patch } : e,
      ),
    }),
  [`${ObjectType.TYPE}.field_add`]: {
    undo: (entry, { api }) => {
      const type = findType(entry, api);
      api.updateType(entry.tid, {
        // Fields predating the id migration are dropped by position instead.
        fields: type.fields.filter((f, i) =>
          f.id ? f.id !== entry.data.field.id : i !== type.fields.length - 1,
        ),
      });
    },
    redo: (entry, { api }) => {
      const type = findType(entry, api);
      api.updateType(entry.tid, { fields: [...type.fields, entry.data.field] });
    },
  },
  [`${ObjectType.TYPE}.field_delete`]: {
    undo: (entry, { api }) =>
      api.setTypes((prev) =>
        prev.map((t, i) => {
          if (i === entry.tid) {
            const temp = t.fields.slice();
            temp.splice(entry.fid, 0, entry.data);
            return { ...t, fields: temp };
          }
          return t;
        }),
      ),
    redo: (entry, { api }) =>
      api.updateType(entry.tid, {
        fields: api.types[entry.tid].fields.filter((field, i) => i !== entry.fid),
      }),
  },
};

function resolveHandler(table, key, fallbackKey, direction) {
  const handler = table[key] ?? (fallbackKey ? table[fallbackKey] : undefined);
  if (!handler) return undefined;
  return typeof handler === "function" ? handler : handler[direction];
}

/**
 * Apply a single history entry.
 *
 * @param entry     the history entry, as pushed by the contexts
 * @param direction "undo" or "redo"
 * @param api       context surface + render-time state snapshots
 */
export function applyHistoryEntry(entry, direction, api) {
  const patch = direction === "undo" ? entry.undo : entry.redo;
  // The entry moves to the other stack; the caller has already popped it.
  const pushOpposite = direction === "undo" ? api.setRedoStack : api.setUndoStack;
  const push = (value) => pushOpposite((prev) => [...prev, value]);

  // A bulk move short-circuits the action switch entirely.
  if (entry.bulk) {
    for (const element of entry.elements) {
      const update = BULK_UPDATE[element.type];
      if (update) update(api)(element.id, element[direction]);
    }
    push(entry);
    return;
  }

  switch (entry.action) {
    case Action.ADD:
    case Action.DELETE: {
      const ops = ELEMENT_OPS[entry.element];
      // An unrecognised element does no work but still changes stacks.
      if (ops) {
        if (entry.action === Action.ADD) {
          if (direction === "undo") (ops.removeAdded ?? ops.remove)(entry, api);
          else ops.add(entry, api);
        } else if (direction === "undo") (ops.restore ?? ops.add)(entry, api);
        else ops.remove(entry, api);
      }
      push(entry);
      return;
    }

    case Action.MOVE: {
      const ops = MOVE_OPS[entry.element];
      // Note: no push for an unrecognised element, so the entry is dropped from
      // both stacks. Matches the previous behaviour.
      if (!ops) return;
      const { x, y } = ops.current(entry, api);
      push({ ...entry, x, y });
      ops.apply(entry, api);
      return;
    }

    case Action.EDIT: {
      const table =
        entry.element === ObjectType.TABLE
          ? api.tables.find((t) => t.id === entry.tid)
          : undefined;
      const handler = resolveHandler(
        EDIT_HANDLERS,
        `${entry.element}.${entry.component}`,
        `${entry.element}.*`,
        direction,
      );
      // An unrecognised element or component does no work but still changes stacks.
      if (handler) handler(entry, { patch, table, direction, api });
      push(entry);
      return;
    }

    default:
      // Unknown action: the entry is dropped from both stacks.
      return;
  }
}
