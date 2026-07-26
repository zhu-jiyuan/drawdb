// Reducer cost, isolated from React.
//
//   node --import ./test/support/register.mjs test/perf/history-bench.mjs
//
// Question: applyHistoryEntry() runs on every undo. On a 30-table diagram, what
// do 50 undos + 50 redos cost, and did the extraction make it slower than the
// if/else tower it replaced?
//
// The legacy oracle (verbatim source text of the old reducers, pinned to 51d99e1)
// is benchmarked alongside so the answer is a delta, not a bare number. Both run
// against the same context double.
//
// Deliberately NOT test/support/apiDouble.js: that one structuredClone()s every
// argument to build the equivalence log, which costs more than the reducer does
// and would flatten the very difference we are measuring. This double mirrors the
// real context mutators (same map/filter/spread shapes) with no instrumentation.

import { applyHistoryEntry } from "../../src/utils/history.js";
import { runLegacy } from "../support/legacy.js";
import { Action, ObjectType } from "../../src/data/constants.js";

const TABLES = 30;
const FIELDS = 8;
const OPS = 50;

// ---------------------------------------------------------------- the document

function seedDoc() {
  const tables = [];
  for (let t = 0; t < TABLES; t++) {
    const fields = [];
    for (let f = 0; f < FIELDS; f++) {
      fields.push({
        id: `t${t}f${f}`,
        name: `field_${f}`,
        type: "VARCHAR",
        default: "",
        check: "",
        primary: f === 0,
        unique: f === 0,
        notNull: f === 0,
        increment: false,
        comment: "",
        size: 255,
      });
    }
    tables.push({
      id: `t${t}`,
      name: `table_${t}`,
      x: (t % 6) * 260,
      y: Math.floor(t / 6) * 240,
      comment: "",
      indices: [{ id: `t${t}i0`, name: "idx0", fields: ["field_0"], unique: false }],
      uniqueConstraints: [],
      color: "#3f5fc9",
      locked: false,
      fields,
    });
  }
  // A relationship per adjacent pair: deleteField/deleteTable scan these, so an
  // empty list would understate the cost.
  const relationships = [];
  for (let t = 1; t < TABLES; t++) {
    relationships.push({
      id: `r${t}`,
      name: `fk_${t}`,
      startTableId: `t${t - 1}`,
      endTableId: `t${t}`,
      startFieldId: `t${t - 1}f0`,
      endFieldId: `t${t}f1`,
      cardinality: "one_to_many",
      updateConstraint: "No action",
      deleteConstraint: "No action",
    });
  }
  const areas = [];
  for (let a = 0; a < 4; a++) {
    areas.push({ id: a, name: `area_${a}`, x: a * 300, y: 900, width: 260, height: 200, color: "#6965db", locked: false });
  }
  return { tables, relationships, areas, notes: [], types: [], enums: [] };
}

// ------------------------------------------------------------------ workloads

// What ordinary editing produces: inspector/canvas field and table edits.
function editEntries(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i % TABLES;
    if (i % 2 === 0) {
      out.push({
        action: Action.EDIT, element: ObjectType.TABLE, component: "field",
        tid: `t${t}`, fid: `t${t}f${i % FIELDS}`,
        undo: { name: `field_${i % FIELDS}` }, redo: { name: `renamed_${i}` },
      });
    } else {
      out.push({
        action: Action.EDIT, element: ObjectType.TABLE, component: "self",
        tid: `t${t}`, undo: { name: `table_${t}` }, redo: { name: `renamed_t${i}` },
      });
    }
  }
  return out;
}

// A harsher mix that also walks the structural branches. ADD/DELETE are paired
// so the table count returns to 30 every 4 entries and the run stays in steady
// state instead of drifting to 0 or 80 tables.
function mixedEntries(n) {
  const out = [];
  const doc = seedDoc();
  for (let i = 0; i < n; i++) {
    const t = i % TABLES;
    switch (i % 5) {
      case 0:
        out.push({
          action: Action.EDIT, element: ObjectType.TABLE, component: "field",
          tid: `t${t}`, fid: `t${t}f2`, undo: { name: "field_2" }, redo: { name: `r${i}` },
        });
        break;
      case 1:
        out.push({
          action: Action.MOVE, bulk: true, x: 5, y: 5,
          elements: doc.tables.slice(0, 12).map((tb) => ({ id: tb.id, type: ObjectType.TABLE })),
          undo: { x: 0, y: 0 }, redo: { x: 40, y: 40 },
        });
        break;
      case 2:
        out.push({
          action: Action.EDIT, element: ObjectType.TABLE, component: "index",
          tid: `t${t}`, iid: 0, undo: { name: "idx0" }, redo: { name: `idx_${i}` },
        });
        break;
      case 3:
        out.push({
          action: Action.ADD, element: ObjectType.TABLE,
          data: { table: { ...doc.tables[t], id: `added${i}` }, index: doc.tables.length },
        });
        break;
      default:
        out.push({
          action: Action.DELETE, element: ObjectType.TABLE,
          data: { table: doc.tables[t], relationship: [] },
        });
        break;
    }
  }
  return out;
}

// ----------------------------------------------------------- context double
//
// Same shapes as the real contexts. Reads come from a render-time snapshot taken
// when the pass starts (matching ControlPanel, where `tables` is a const), writes
// accumulate into `next` the way queued React updaters compose.

function makeApi(doc) {
  const next = { ...doc, undoStack: [], redoStack: [] };
  let read = { tables: next.tables, areas: next.areas, notes: next.notes, types: next.types };
  const apply = (k, arg) => { next[k] = typeof arg === "function" ? arg(next[k]) : arg; };
  const mapById = (k, id, v) => { next[k] = next[k].map((it) => (it.id === id ? { ...it, ...v } : it)); };
  const renumber = (l) => l.map((it, i) => ({ ...it, id: i }));

  const api = {
    get tables() { return read.tables; },
    get areas() { return read.areas; },
    get notes() { return read.notes; },
    get types() { return read.types; },
    addTable(data) {
      const tmp = next.tables.slice();
      tmp.splice(data ? data.index || next.tables.length : next.tables.length, 0,
        data ? data.table : { id: "new", fields: [], indices: [], uniqueConstraints: [] });
      next.tables = tmp;
    },
    updateTable(id, v) { mapById("tables", id, v); },
    deleteTable(id) {
      next.relationships = next.relationships.filter((e) => e.startTableId !== id && e.endTableId !== id);
      next.tables = next.tables.filter((e) => e.id !== id);
    },
    updateField(tid, fid, v) {
      next.tables = next.tables.map((tb) => (tb.id === tid
        ? { ...tb, fields: tb.fields.map((f) => (f.id === fid ? { ...f, ...v } : f)) }
        : tb));
    },
    deleteField(field, tid) {
      const tb = next.tables.find((x) => x.id === tid);
      if (!tb) return;
      next.relationships = next.relationships.filter(
        (r) => !((r.startTableId === tid && r.startFieldId === field.id)
          || (r.endTableId === tid && r.endFieldId === field.id)),
      );
      mapById("tables", tid, { fields: tb.fields.filter((f) => f.id !== field.id) });
    },
    setRelationships(a) { apply("relationships", a); },
    addRelationship(data) {
      const tmp = next.relationships.slice();
      tmp.splice(data.index, 0, data.relationship || data);
      next.relationships = tmp;
    },
    deleteRelationship(id) { next.relationships = next.relationships.filter((e) => e.id !== id); },
    updateRelationship(id, v) { mapById("relationships", id, v); },
    addArea(data) { const tmp = next.areas.slice(); tmp.splice(data.id, 0, data); next.areas = renumber(tmp); },
    updateArea(id, v) { mapById("areas", id, v); },
    deleteArea(id) { next.areas = renumber(next.areas.filter((e) => e.id !== id)); },
    addNote(data) { const tmp = next.notes.slice(); tmp.splice(data.id, 0, data); next.notes = renumber(tmp); },
    updateNote(id, v) { mapById("notes", id, v); },
    deleteNote(id) { next.notes = renumber(next.notes.filter((e) => e.id !== id)); },
    addType(data) { const tmp = next.types.slice(); tmp.splice(data.index, 0, data.type); next.types = tmp; },
    updateType(id, v) {
      next.types = next.types.map((it, i) => ((typeof id === "number" ? i === id : it.id === id) ? { ...it, ...v } : it));
    },
    deleteType(id) { next.types = next.types.filter((e, i) => (typeof id === "number" ? i !== id : e.id !== id)); },
    setTypes(a) { apply("types", a); },
    addEnum(data) { const tmp = next.enums.slice(); tmp.splice(data.index, 0, data.enum); next.enums = tmp; },
    updateEnum(id, v) { mapById("enums", id, v); },
    deleteEnum(id) { next.enums = next.enums.filter((e) => e.id !== id); },
    setUndoStack(a) { apply("undoStack", a); },
    setRedoStack(a) { apply("redoStack", a); },
  };
  // Called between entries: React would have re-rendered, so the next pass reads
  // the writes the previous one made.
  const commit = () => {
    read = { tables: next.tables, areas: next.areas, notes: next.notes, types: next.types };
  };
  return { api, next, commit };
}

// ------------------------------------------------------------------- drivers
//
// Replicates ControlPanel's 4-line wrappers exactly (test/run.mjs's source guard
// pins those 4 lines, so this stays honest).

function runExtracted(entries, direction) {
  const { api, next, commit } = makeApi(seedDoc());
  const stackKey = direction === "undo" ? "undoStack" : "redoStack";
  next[stackKey] = entries.slice();
  for (let i = 0; i < entries.length; i++) {
    const stack = next[stackKey];
    if (stack.length === 0) break;
    const entry = stack[stack.length - 1];
    api[direction === "undo" ? "setUndoStack" : "setRedoStack"]((prev) =>
      prev.filter((_, j) => j !== prev.length - 1));
    applyHistoryEntry(entry, direction, api);
    commit();
  }
  return next;
}

function runTower(entries, direction) {
  const { api, next, commit } = makeApi(seedDoc());
  const stackKey = direction === "undo" ? "undoStack" : "redoStack";
  next[stackKey] = entries.slice();
  for (let i = 0; i < entries.length; i++) {
    if (next[stackKey].length === 0) break;
    // The legacy bodies pop the entry themselves; they read the stack as a
    // render-time const, so hand them the current array.
    runLegacy(direction, {
      api,
      readable: { undoStack: next.undoStack, redoStack: next.redoStack },
    });
    commit();
  }
  return next;
}

// --------------------------------------------------------------------- timing

function bench(label, fn, reps) {
  for (let i = 0; i < 3; i++) fn(); // warm up the JIT
  const samples = [];
  for (let r = 0; r < reps; r++) {
    const t0 = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  return { label, median, min: samples[0], max: samples[samples.length - 1] };
}

const doc = seedDoc();
console.log(
  `diagram: ${doc.tables.length} tables x ${FIELDS} fields ` +
  `(${doc.tables.length * FIELDS} fields), ${doc.relationships.length} relationships, ` +
  `${doc.areas.length} areas`,
);
console.log(`workload: ${OPS} undos + ${OPS} redos, ${20} repetitions each\n`);

const REPS = 20;
const rows = [];
for (const [name, entries] of [["edit-heavy", editEntries(OPS)], ["mixed", mixedEntries(OPS)]]) {
  for (const direction of ["undo", "redo"]) {
    const ext = bench(`${name}/${direction} extracted`, () => runExtracted(entries, direction), REPS);
    const old = bench(`${name}/${direction} tower`, () => runTower(entries, direction), REPS);
    rows.push({ name, direction, ext, old });
  }
}

const pad = (s, n) => String(s).padEnd(n);
const num = (v) => v.toFixed(3).padStart(8);
console.log(
  `${pad("workload", 12)}${pad("dir", 6)}${pad("  extracted x50", 17)}${pad("  per op", 10)}` +
  `${pad("  tower x50", 14)}${pad("  per op", 10)}  delta`,
);
for (const r of rows) {
  const d = ((r.ext.median - r.old.median) / r.old.median) * 100;
  console.log(
    `${pad(r.name, 12)}${pad(r.direction, 6)}${num(r.ext.median)} ms   ${num(r.ext.median / OPS)} ms` +
    `${num(r.old.median)} ms   ${num(r.old.median / OPS)} ms  ${d >= 0 ? "+" : ""}${d.toFixed(1)}%`,
  );
}

// Sanity: a benchmark that measured nothing would still print numbers. Confirm
// both drivers actually mutated the document the same way.
const a = runExtracted(editEntries(OPS), "undo");
const b = runTower(editEntries(OPS), "undo");
const same = JSON.stringify(a.tables) === JSON.stringify(b.tables);
console.log(`\nsanity: extracted and tower produced ${same ? "IDENTICAL" : "DIFFERENT"} documents`);
if (!same) process.exit(1);
