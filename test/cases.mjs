// Characterization corpus for undo()/redo().
//
// Written against the code AS IT IS, not as it should be: several cases below pin
// behaviour that is arguably wrong (redo of a field_add inventing a blank field,
// undo of an "add area" deleting whichever area is last rather than the one that
// was added). That is the point — the extraction has to reproduce them.
//
// Every case is run in BOTH directions from the same start state.

import { Action, ObjectType } from "../src/data/constants.js";

const UNKNOWN_ELEMENT = 999;
const UNKNOWN_ACTION = 99;

export const baseState = {
  tables: [
    {
      id: "t1",
      name: "users",
      x: 10,
      y: 20,
      fields: [
        { id: "f1", name: "id", type: "INT" },
        { id: "f2", name: "email", type: "VARCHAR" },
      ],
      indices: [
        { id: 0, name: "index_0", fields: ["id"] },
        { id: 1, name: "index_1", fields: ["email"] },
      ],
      uniqueConstraints: [{ id: 0, name: "users_unique_0", fields: ["email"] }],
    },
    {
      id: "t2",
      name: "orders",
      x: 300,
      y: 40,
      fields: [{ id: "f3", name: "user_id", type: "INT" }],
      indices: [],
      uniqueConstraints: [],
    },
    // No uniqueConstraints key at all: the reducers guard with `|| []`.
    { id: "t3", name: "legacy", x: 0, y: 0, fields: [], indices: [] },
  ],
  relationships: [
    {
      id: 0,
      name: "fk_orders_users",
      startTableId: "t2",
      endTableId: "t1",
      startFieldId: "f3",
      endFieldId: "f1",
    },
  ],
  areas: [
    { id: 0, name: "area_0", x: 0, y: 0, width: 200, height: 200 },
    { id: 1, name: "area_1", x: 50, y: 50, width: 100, height: 100 },
  ],
  notes: [
    { id: 0, title: "note_0", content: "a", x: 1, y: 2 },
    { id: 1, title: "note_1", content: "b", x: 3, y: 4 },
  ],
  types: [
    {
      id: "ty1",
      name: "address",
      fields: [
        { id: "tf1", name: "street", type: "VARCHAR" },
        { id: "tf2", name: "city", type: "VARCHAR" },
      ],
      comment: "",
    },
  ],
  enums: [{ id: "en1", name: "status", values: ["new", "done"] }],
};

const table1 = baseState.tables[0];
const rel0 = baseState.relationships[0];

export const cases = [
  // ---------------------------------------------------------------- bulk move
  {
    name: "bulk/mixed",
    entry: {
      action: Action.MOVE,
      bulk: true,
      elements: [
        { id: "t1", type: ObjectType.TABLE, undo: { x: 1, y: 2 }, redo: { x: 9, y: 8 } },
        { id: 1, type: ObjectType.AREA, undo: { x: 3, y: 4 }, redo: { x: 7, y: 6 } },
        { id: 0, type: ObjectType.NOTE, undo: { x: 5, y: 5 }, redo: { x: 5, y: 9 } },
      ],
    },
  },
  {
    name: "bulk/unknown-element-type",
    entry: {
      action: Action.MOVE,
      bulk: true,
      elements: [
        { id: "t1", type: UNKNOWN_ELEMENT, undo: { x: 1 }, redo: { x: 2 } },
        { id: "t2", type: ObjectType.TABLE, undo: { x: 1 }, redo: { x: 2 } },
      ],
    },
  },
  {
    name: "bulk/empty",
    entry: { action: Action.MOVE, bulk: true, elements: [] },
  },
  // bulk short-circuits before the action switch, so a non-MOVE action is bulk too.
  {
    name: "bulk/wins-over-action",
    entry: {
      action: Action.EDIT,
      bulk: true,
      elements: [{ id: "t1", type: ObjectType.TABLE, undo: { name: "u" }, redo: { name: "r" } }],
    },
  },

  // --------------------------------------------------------------- Action.ADD
  {
    name: "add/table",
    entry: {
      action: Action.ADD,
      element: ObjectType.TABLE,
      data: { table: { id: "t9", name: "fresh", fields: [], indices: [] }, index: 2 },
    },
  },
  {
    name: "add/area",
    entry: { action: Action.ADD, element: ObjectType.AREA, data: { id: 1, name: "area_1", x: 50, y: 50 } },
  },
  {
    name: "add/note",
    entry: { action: Action.ADD, element: ObjectType.NOTE, data: { id: 1, title: "note_1", x: 3, y: 4 } },
  },
  {
    name: "add/relationship",
    entry: {
      action: Action.ADD,
      element: ObjectType.RELATIONSHIP,
      data: { relationship: { id: 7, name: "fk_new", startTableId: "t1", endTableId: "t2" }, index: 1 },
    },
  },
  {
    name: "add/type",
    entry: {
      action: Action.ADD,
      element: ObjectType.TYPE,
      data: { type: { id: "ty9", name: "type_1", fields: [] }, index: 1 },
    },
  },
  {
    name: "add/enum",
    entry: {
      action: Action.ADD,
      element: ObjectType.ENUM,
      data: { enum: { id: "en9", name: "enum_1", values: [] }, index: 1 },
    },
  },
  // The element work is skipped but the entry is still moved between stacks.
  {
    name: "add/unknown-element",
    entry: { action: Action.ADD, element: UNKNOWN_ELEMENT, data: { id: 0 } },
  },
  // undo reaches for areas[areas.length - 1] and there is nothing there.
  {
    name: "add/area-on-empty-list",
    state: { ...baseState, areas: [], notes: [] },
    entry: { action: Action.ADD, element: ObjectType.AREA, data: { id: 0, name: "only" } },
  },
  {
    name: "add/note-on-empty-list",
    state: { ...baseState, areas: [], notes: [] },
    entry: { action: Action.ADD, element: ObjectType.NOTE, data: { id: 0, title: "only" } },
  },
  // undo deletes the LAST area, not the one the entry names.
  {
    name: "add/area-entry-is-not-last",
    entry: { action: Action.ADD, element: ObjectType.AREA, data: { id: 0, name: "area_0" } },
  },

  // -------------------------------------------------------------- Action.MOVE
  { name: "move/table", entry: { action: Action.MOVE, element: ObjectType.TABLE, id: "t1", x: 111, y: 222 } },
  { name: "move/area", entry: { action: Action.MOVE, element: ObjectType.AREA, id: 1, x: 111, y: 222 } },
  { name: "move/note", entry: { action: Action.MOVE, element: ObjectType.NOTE, id: 0, x: 111, y: 222 } },
  // Neither stack is touched: the entry evaporates.
  {
    name: "move/unknown-element",
    entry: { action: Action.MOVE, element: UNKNOWN_ELEMENT, id: "t1", x: 1, y: 2 },
  },
  {
    name: "move/table-missing-id",
    entry: { action: Action.MOVE, element: ObjectType.TABLE, id: "nope", x: 1, y: 2 },
  },
  // DRIFT PROBE: undo used `===` and redo used `==` on this lookup. With a numeric
  // entry id against a numeric-string table id the two disagree.
  {
    name: "move/table-numeric-id-vs-string-id",
    driftProbe: "undo used === and redo used == for the table lookup",
    state: {
      ...baseState,
      tables: [{ id: "5", name: "five", x: 1, y: 2, fields: [], indices: [] }],
    },
    entry: { action: Action.MOVE, element: ObjectType.TABLE, id: 5, x: 111, y: 222 },
  },

  // ------------------------------------------------------------ Action.DELETE
  {
    name: "delete/table-with-relationships",
    entry: {
      action: Action.DELETE,
      element: ObjectType.TABLE,
      data: { table: table1, relationship: [rel0], index: 0 },
    },
  },
  {
    name: "delete/table-no-relationships",
    entry: {
      action: Action.DELETE,
      element: ObjectType.TABLE,
      data: { table: baseState.tables[1], relationship: [], index: 1 },
    },
  },
  {
    name: "delete/relationship",
    entry: {
      action: Action.DELETE,
      element: ObjectType.RELATIONSHIP,
      data: { relationship: rel0, index: 0 },
    },
  },
  {
    name: "delete/note",
    entry: { action: Action.DELETE, element: ObjectType.NOTE, data: { id: 1, title: "note_1", x: 3, y: 4 } },
  },
  {
    name: "delete/area",
    entry: { action: Action.DELETE, element: ObjectType.AREA, data: { id: 1, name: "area_1", x: 50, y: 50 } },
  },
  {
    name: "delete/type",
    entry: {
      action: Action.DELETE,
      element: ObjectType.TYPE,
      data: { type: baseState.types[0], index: 0 },
    },
  },
  {
    name: "delete/enum",
    entry: {
      action: Action.DELETE,
      element: ObjectType.ENUM,
      data: { enum: baseState.enums[0], index: 0 },
    },
  },
  {
    name: "delete/unknown-element",
    entry: { action: Action.DELETE, element: UNKNOWN_ELEMENT, data: { id: 0 } },
  },

  // -------------------------------------------------- Action.EDIT / non-table
  {
    name: "edit/area",
    entry: {
      action: Action.EDIT,
      element: ObjectType.AREA,
      aid: 1,
      undo: { x: 1, y: 1, width: 10, height: 10 },
      redo: { x: 2, y: 2, width: 20, height: 20 },
    },
  },
  // The area/note/relationship branches ignore `component` entirely.
  {
    name: "edit/area-with-component",
    entry: {
      action: Action.EDIT,
      element: ObjectType.AREA,
      component: "field_add",
      aid: 0,
      undo: { name: "u" },
      redo: { name: "r" },
    },
  },
  {
    name: "edit/note",
    entry: {
      action: Action.EDIT,
      element: ObjectType.NOTE,
      nid: 0,
      undo: { content: "old" },
      redo: { content: "new" },
    },
  },
  {
    name: "edit/relationship",
    entry: {
      action: Action.EDIT,
      element: ObjectType.RELATIONSHIP,
      rid: 0,
      undo: { name: "old_fk" },
      redo: { name: "new_fk" },
    },
  },
  {
    name: "edit/unknown-element",
    entry: { action: Action.EDIT, element: UNKNOWN_ELEMENT, undo: { a: 1 }, redo: { a: 2 } },
  },

  // ------------------------------------------------------ Action.EDIT / TABLE
  {
    name: "edit/table/self",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TABLE,
      component: "self",
      tid: "t1",
      undo: { name: "users_old", comment: "" },
      redo: { name: "users_new", comment: "hi" },
    },
  },
  // `self` never dereferences the looked-up table, so a bad tid is survivable.
  {
    name: "edit/table/self-missing-tid",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TABLE,
      component: "self",
      tid: "nope",
      undo: { name: "u" },
      redo: { name: "r" },
    },
  },
  {
    name: "edit/table/field",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TABLE,
      component: "field",
      tid: "t1",
      fid: "f2",
      undo: { name: "email_old", type: "TEXT" },
      redo: { name: "email_new", type: "VARCHAR" },
    },
  },
  // Redo does NOT restore the field it removed: it appends a blank one with a
  // fresh nanoid. Pinning the current (lossy) behaviour.
  {
    name: "edit/table/field_add",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TABLE,
      component: "field_add",
      tid: "t1",
      fid: "f2",
    },
  },
  {
    name: "edit/table/field_add-missing-table",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TABLE,
      component: "field_add",
      tid: "nope",
      fid: "f2",
    },
  },
  {
    name: "edit/table/field_delete",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TABLE,
      component: "field_delete",
      tid: "t1",
      data: { field: { id: "f2", name: "email", type: "VARCHAR" }, index: 1, relationship: [rel0] },
    },
  },
  {
    name: "edit/table/field_delete-no-relationships",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TABLE,
      component: "field_delete",
      tid: "t1",
      data: { field: { id: "f1", name: "id", type: "INT" }, index: 0, relationship: [] },
    },
  },
  {
    name: "edit/table/index",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TABLE,
      component: "index",
      tid: "t1",
      iid: 1,
      undo: { name: "index_1", fields: ["email"] },
      redo: { name: "by_email", fields: ["email", "id"] },
    },
  },
  {
    name: "edit/table/index_add",
    entry: { action: Action.EDIT, element: ObjectType.TABLE, component: "index_add", tid: "t1" },
  },
  {
    name: "edit/table/index_add-empty-indices",
    entry: { action: Action.EDIT, element: ObjectType.TABLE, component: "index_add", tid: "t2" },
  },
  // undo filters on `id !== indices.length - 1`, which is a positional guess.
  // With non-contiguous ids it removes the wrong row (or none).
  {
    name: "edit/table/index_add-noncontiguous-ids",
    state: {
      ...baseState,
      tables: [
        {
          id: "t1",
          name: "users",
          fields: [],
          indices: [
            { id: 5, name: "index_5", fields: [] },
            { id: 9, name: "index_9", fields: [] },
          ],
          uniqueConstraints: [],
        },
      ],
    },
    entry: { action: Action.EDIT, element: ObjectType.TABLE, component: "index_add", tid: "t1" },
  },
  {
    name: "edit/table/index_delete",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TABLE,
      component: "index_delete",
      tid: "t1",
      data: { id: 1, name: "index_1", fields: ["email"] },
    },
  },
  {
    name: "edit/table/unique_constraint",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TABLE,
      component: "unique_constraint",
      tid: "t1",
      cid: 0,
      undo: { name: "users_unique_0", fields: ["email"] },
      redo: { name: "uq_email", fields: ["email"] },
    },
  },
  {
    name: "edit/table/unique_constraint_add",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TABLE,
      component: "unique_constraint_add",
      tid: "t1",
    },
  },
  // t3 has no uniqueConstraints key: exercises the `|| []` guards.
  {
    name: "edit/table/unique_constraint_add-undefined-list",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TABLE,
      component: "unique_constraint_add",
      tid: "t3",
    },
  },
  {
    name: "edit/table/unique_constraint_delete",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TABLE,
      component: "unique_constraint_delete",
      tid: "t1",
      data: { id: 0, name: "users_unique_0", fields: ["email"] },
    },
  },
  {
    name: "edit/table/unique_constraint-undefined-list",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TABLE,
      component: "unique_constraint",
      tid: "t3",
      cid: 0,
      undo: { name: "u" },
      redo: { name: "r" },
    },
  },
  {
    name: "edit/table/unknown-component",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TABLE,
      component: "not_a_thing",
      tid: "t1",
      undo: { name: "u" },
      redo: { name: "r" },
    },
  },
  // No component key at all.
  {
    name: "edit/table/no-component",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TABLE,
      tid: "t1",
      undo: { name: "u" },
      redo: { name: "r" },
    },
  },

  // ------------------------------------------------------- Action.EDIT / TYPE
  // The type branch looks up by index when tid is a number and by id otherwise.
  {
    name: "edit/type/field_add-string-tid",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TYPE,
      component: "field_add",
      tid: "ty1",
      data: { field: { id: "tf3", name: "zip", type: "VARCHAR" } },
    },
  },
  {
    name: "edit/type/field_add-numeric-tid",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TYPE,
      component: "field_add",
      tid: 0,
      data: { field: { id: "tf3", name: "zip", type: "VARCHAR" } },
    },
  },
  // Fields with no id: undo falls back to dropping the last one.
  {
    name: "edit/type/field_add-field-without-id",
    state: {
      ...baseState,
      types: [{ id: "ty1", name: "address", fields: [{ name: "street" }, { name: "city" }] }],
    },
    entry: {
      action: Action.EDIT,
      element: ObjectType.TYPE,
      component: "field_add",
      tid: "ty1",
      data: { field: { name: "zip" } },
    },
  },
  // `field` indexes types[a.tid] directly, so it needs a numeric tid.
  {
    name: "edit/type/field",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TYPE,
      component: "field",
      tid: 0,
      fid: 1,
      undo: { name: "city_old" },
      redo: { name: "city_new" },
    },
  },
  {
    name: "edit/type/field-string-tid",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TYPE,
      component: "field",
      tid: "ty1",
      fid: 1,
      undo: { name: "u" },
      redo: { name: "r" },
    },
  },
  {
    name: "edit/type/field_delete",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TYPE,
      component: "field_delete",
      tid: 0,
      fid: 1,
      data: { id: "tf2", name: "city", type: "VARCHAR" },
    },
  },
  {
    name: "edit/type/self",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TYPE,
      component: "self",
      tid: "ty1",
      undo: { name: "address_old" },
      redo: { name: "address_new" },
    },
  },
  {
    name: "edit/type/self-with-updatedFields",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TYPE,
      component: "self",
      tid: "ty1",
      updatedFields: [{ tid: "t1", fid: "f2" }],
      undo: { name: "address_old" },
      redo: { name: "address_new" },
    },
  },
  // updatedFields present but the patch has no name: the cascade is skipped.
  {
    name: "edit/type/self-updatedFields-no-name",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TYPE,
      component: "self",
      tid: "ty1",
      updatedFields: [{ tid: "t1", fid: "f2" }],
      undo: { comment: "old" },
      redo: { comment: "new" },
    },
  },
  {
    name: "edit/type/unknown-component",
    entry: {
      action: Action.EDIT,
      element: ObjectType.TYPE,
      component: "not_a_thing",
      tid: "ty1",
      undo: { name: "u" },
      redo: { name: "r" },
    },
  },

  // ------------------------------------------------------- Action.EDIT / ENUM
  {
    name: "edit/enum",
    entry: {
      action: Action.EDIT,
      element: ObjectType.ENUM,
      id: "en1",
      undo: { name: "status_old" },
      redo: { name: "status_new" },
    },
  },
  {
    name: "edit/enum-with-updatedFields",
    entry: {
      action: Action.EDIT,
      element: ObjectType.ENUM,
      id: "en1",
      updatedFields: [
        { tid: "t1", fid: "f1" },
        { tid: "t1", fid: "f2" },
      ],
      undo: { name: "status_old" },
      redo: { name: "status_new" },
    },
  },
  {
    name: "edit/enum-updatedFields-no-name",
    entry: {
      action: Action.EDIT,
      element: ObjectType.ENUM,
      id: "en1",
      updatedFields: [{ tid: "t1", fid: "f1" }],
      undo: { values: ["a"] },
      redo: { values: ["b"] },
    },
  },
  // The enum branch ignores `component` too.
  {
    name: "edit/enum-with-component",
    entry: {
      action: Action.EDIT,
      element: ObjectType.ENUM,
      component: "self",
      id: "en1",
      undo: { name: "u" },
      redo: { name: "r" },
    },
  },

  // ------------------------------------------------------------ unknown action
  // Nothing happens and the entry is dropped from both stacks.
  {
    name: "action/unknown",
    entry: { action: UNKNOWN_ACTION, element: ObjectType.TABLE, tid: "t1", undo: {}, redo: {} },
  },
  {
    name: "action/missing",
    entry: { element: ObjectType.TABLE, tid: "t1", undo: {}, redo: {} },
  },
];
