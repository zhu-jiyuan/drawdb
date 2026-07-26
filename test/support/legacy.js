// Compiles the verbatim undo()/redo() bodies extracted from a pinned revision of
// ControlPanel.jsx into callable functions, with every closure variable they
// referenced supplied as a function parameter.
//
// This is the "before" oracle. It is not a paraphrase of the old reducers — it is
// their source text, so it cannot drift from what shipped. Regenerate with
// `node test/tools/extract-legacy.mjs`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { nanoid } from "nanoid";
import { Action, ObjectType } from "../../src/data/constants.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures");

// Every free identifier the two bodies reference.
const CLOSURE = [
  "undoStack",
  "redoStack",
  "setUndoStack",
  "setRedoStack",
  "tables",
  "areas",
  "notes",
  "types",
  "addTable",
  "updateTable",
  "deleteTable",
  "updateField",
  "deleteField",
  "setRelationships",
  "addRelationship",
  "deleteRelationship",
  "updateRelationship",
  "addArea",
  "updateArea",
  "deleteArea",
  "addNote",
  "updateNote",
  "deleteNote",
  "addType",
  "updateType",
  "deleteType",
  "setTypes",
  "addEnum",
  "updateEnum",
  "deleteEnum",
  "ObjectType",
  "Action",
  "nanoid",
];

function compile(name) {
  const body = readFileSync(join(fixtures, `legacy-${name}.body.txt`), "utf8");
  return new Function(...CLOSURE, body);
}

const compiled = { undo: compile("undo"), redo: compile("redo") };

// Drives the legacy reducer against an apiDouble harness. `direction` picks which
// body to run; the harness supplies the same surface the real contexts did.
export function runLegacy(direction, harness) {
  const { api } = harness;
  const args = CLOSURE.map((name) => {
    switch (name) {
      case "undoStack":
        return harness.readable.undoStack;
      case "redoStack":
        return harness.readable.redoStack;
      case "ObjectType":
        return ObjectType;
      case "Action":
        return Action;
      case "nanoid":
        return nanoid;
      default: {
        const v = api[name];
        if (v === undefined) throw new Error(`legacy closure gap: ${name}`);
        return v;
      }
    }
  });
  return compiled[direction](...args);
}

export { CLOSURE };
