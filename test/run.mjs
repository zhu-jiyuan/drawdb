// Characterization harness for undo()/redo().
//
//   node test/run.mjs            run every check
//   node test/run.mjs --update   rewrite the golden snapshot from the legacy oracle
//   node test/run.mjs -v         also print each case name
//
// Three independent checks:
//
//   1. GOLDEN     the legacy oracle (verbatim source text of the pre-refactor
//                 reducers, see test/support/legacy.js) against a committed
//                 snapshot. Guards the oracle itself against accidental edits.
//   2. DIFFERENTIAL  legacy oracle vs src/utils/history.js over the same corpus,
//                 comparing the full ordered call log AND the resulting document.
//                 This is the proof that the extraction is behaviour-preserving,
//                 and it does not depend on the api double being realistic.
//   3. SOURCE GUARD  that ControlPanel's thin wrappers still look the way this
//                 harness assumes, since the harness replicates their 4 lines.
//
// No test runner and no new dependency: plain node.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHarness, normalize } from "./support/apiDouble.js";
import { runLegacy } from "./support/legacy.js";
import { baseState, cases } from "./cases.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const goldenPath = join(here, "fixtures", "golden.json");

const update = process.argv.includes("--update");
const verbose = process.argv.includes("-v");

// Cases whose expected result deliberately changed with the refactor. Each must
// carry a reason; the report calls these out.
const INTENTIONAL_CHANGES = {
  "move/table-numeric-id-vs-string-id:redo":
    "redo's `==` table lookup unified to `===` (see report: drift 1)",
};

// ---------------------------------------------------------------- comparison

// Canonical JSON with sorted keys: key insertion order is not behaviour.
function canon(value) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value), null, 2);
}

function scenarioState(testCase) {
  return testCase.state ?? baseState;
}

// Seeds the stack the reducer pops from, with a sentinel underneath so that
// popping the wrong end is visible.
function seed(testCase, direction) {
  const state = scenarioState(testCase);
  const sentinel = { action: "SENTINEL", element: "SENTINEL" };
  return {
    ...state,
    undoStack: direction === "undo" ? [sentinel, testCase.entry] : [],
    redoStack: direction === "redo" ? [sentinel, testCase.entry] : [],
  };
}

function observe(run) {
  let error = null;
  try {
    run();
  } catch (err) {
    error = {
      name: err.constructor.name,
      // V8 quotes the failing source expression, so reading state through `api`
      // instead of a bare closure variable changes the text without changing the
      // behaviour ("tables.find(...)" -> "api.tables.find(...)"). Strip the
      // receiver so the comparison is about where and whether it threw. Any other
      // difference in the message still fails.
      message: err.message.replace(/\bapi\./g, ""),
    };
  }
  return error;
}

function result(testCase, direction, driver) {
  const harness = createHarness(seed(testCase, direction));
  const error = observe(() => driver(direction, harness));
  return normalize({
    error,
    calls: harness.log,
    document: {
      tables: harness.state.tables,
      relationships: harness.state.relationships,
      areas: harness.state.areas,
      notes: harness.state.notes,
      types: harness.state.types,
      enums: harness.state.enums,
    },
    undoStack: harness.state.undoStack,
    redoStack: harness.state.redoStack,
  });
}

// ------------------------------------------------------- the extracted module

async function loadExtracted() {
  const path = join(root, "src", "utils", "history.js");
  if (!existsSync(path)) return null;
  const { applyHistoryEntry } = await import(path);
  // Replicates ControlPanel's thin wrapper. Check 3 guards this against drift.
  return (direction, harness) => {
    const { api } = harness;
    const stack = direction === "undo" ? harness.readable.undoStack : harness.readable.redoStack;
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    const pop = direction === "undo" ? api.setUndoStack : api.setRedoStack;
    pop((prev) => prev.filter((_, i) => i !== prev.length - 1));
    applyHistoryEntry(entry, direction, api);
  };
}

// ------------------------------------------------------------------ execution

const failures = [];
const notes = [];
let checks = 0;

function check(label, ok, detail) {
  checks += 1;
  if (ok) {
    if (verbose) console.log(`  ok   ${label}`);
  } else {
    failures.push({ label, detail });
    console.log(`  FAIL ${label}`);
  }
}

const legacyResults = {};
for (const testCase of cases) {
  for (const direction of ["undo", "redo"]) {
    legacyResults[`${testCase.name}:${direction}`] = result(testCase, direction, runLegacy);
  }
}

// ---- check 1: golden snapshot of the legacy oracle
console.log("golden snapshot (legacy oracle)");
if (update) {
  writeFileSync(goldenPath, canon(legacyResults) + "\n");
  console.log(`  wrote ${goldenPath} (${Object.keys(legacyResults).length} entries)`);
} else if (!existsSync(goldenPath)) {
  failures.push({ label: "golden.json missing", detail: "run: node test/run.mjs --update" });
  console.log("  FAIL golden.json missing — run: node test/run.mjs --update");
} else {
  const expected = readFileSync(goldenPath, "utf8").trim();
  const actual = canon(legacyResults).trim();
  check("legacy oracle matches golden.json", expected === actual, "oracle output changed");
}

// ---- check 2: differential legacy vs extracted
const extracted = await loadExtracted();
console.log("\ndifferential (legacy oracle vs src/utils/history.js)");
if (!extracted) {
  console.log("  skip src/utils/history.js does not exist yet");
  notes.push("differential skipped: src/utils/history.js not present");
} else {
  for (const testCase of cases) {
    for (const direction of ["undo", "redo"]) {
      const key = `${testCase.name}:${direction}`;
      const before = legacyResults[key];
      const after = result(testCase, direction, extracted);
      const same = canon(before) === canon(after);
      const intentional = INTENTIONAL_CHANGES[key];
      if (intentional) {
        check(
          `${key} (intentionally changed: ${intentional})`,
          !same,
          "expected an intentional behaviour change but got identical output",
        );
        notes.push(`intentional change confirmed: ${key} — ${intentional}`);
      } else {
        check(key, same, { before: canon(before), after: canon(after) });
      }
    }
  }
}

// ---- check 3: source guard on ControlPanel's wrappers
console.log("\nsource guard (ControlPanel wrappers)");
const controlPanel = readFileSync(
  join(root, "src", "components", "EditorHeader", "ControlPanel.jsx"),
  "utf8",
);
if (!extracted) {
  console.log("  skip extraction has not happened yet");
} else {
  check(
    "imports applyHistoryEntry from utils/history",
    /import\s*\{\s*applyHistoryEntry\s*\}\s*from\s*"\.\.\/\.\.\/utils\/history"/.test(controlPanel),
    "expected ControlPanel to import applyHistoryEntry",
  );
  for (const [direction, stack, setter] of [
    ["undo", "undoStack", "setUndoStack"],
    ["redo", "redoStack", "setRedoStack"],
  ]) {
    // The wrapper this harness replicates: guards, read last, pop, delegate.
    //
    // The readOnly guard is a deliberate addition: the menu item and the toolbar
    // button were disabled while readOnly but useHotkeys called straight through,
    // so Ctrl+Z mutated a read-only version preview. It is not an
    // INTENTIONAL_CHANGES entry because it is not a reducer difference — it
    // decides whether applyHistoryEntry is reached at all, never what it does,
    // so every case below is unaffected. Covered end to end by
    // test/e2e/history-gaps.cjs.
    const wrapper = new RegExp(
      `const ${direction} = \\(\\) => \\{\\s*` +
        `if \\(layout\\.readOnly\\) return;\\s*` +
        `if \\(${stack}\\.length === 0\\) return;\\s*` +
        `const entry = ${stack}\\[${stack}\\.length - 1\\];\\s*` +
        `${setter}\\(\\(prev\\) => prev\\.filter\\(\\(_, i\\) => i !== prev\\.length - 1\\)\\);\\s*` +
        `applyHistoryEntry\\(entry, "${direction}", historyApi\\(\\)\\);\\s*\\};`,
    );
    check(`${direction}() wrapper matches the shape the harness replicates`, wrapper.test(controlPanel), {
      hint: "harness replicates these 4 lines; keep them in sync or update run.mjs",
    });
  }
  check(
    "the if/else-if towers are gone from ControlPanel",
    !/a\.component === "unique_constraint_add"/.test(controlPanel),
    "ControlPanel still contains the old component tower",
  );
}

// ---------------------------------------------------------------- summary

console.log(
  `\n${failures.length === 0 ? "PASS" : "FAIL"}  ${checks - failures.length}/${checks} checks` +
    `  (${cases.length} cases x 2 directions)`,
);
for (const note of notes) console.log(`note: ${note}`);
if (failures.length) {
  console.log("\n--- failures ---");
  for (const f of failures.slice(0, 4)) {
    console.log(`\n### ${f.label}`);
    if (typeof f.detail === "string") {
      console.log(f.detail);
    } else if (f.detail?.before) {
      // Print only the differing lines: full dumps are unreadable.
      const b = f.detail.before.split("\n");
      const a = f.detail.after.split("\n");
      for (let i = 0; i < Math.max(b.length, a.length); i += 1) {
        if (b[i] !== a[i]) console.log(`  line ${i + 1}\n    legacy:    ${b[i]}\n    extracted: ${a[i]}`);
      }
    } else {
      console.log(JSON.stringify(f.detail));
    }
  }
  if (failures.length > 4) console.log(`\n… and ${failures.length - 4} more`);
  process.exit(1);
}
