// Consequences of the undo/redo extraction that neither test/run.mjs nor
// test/smoke/history-smoke.cjs can see, all asserted against the SERVER's
// document and the SERVER's traffic rather than against the DOM.
//
//   NODE_PATH=<e2e>/node_modules node test/e2e/history-consequences.cjs --base=http://localhost:3101
//
// 1. AUTOSAVE COUPLING. Workspace's dirty-flag effect lists `undoStack` and
//    `redoStack` in its dependency array (src/components/Workspace.jsx:480) and
//    nothing else that a pure value edit touches — renaming a field moves no array
//    *length*. So an undo only reaches the server if applying an entry still
//    replaces both stack arrays by identity: `.filter()` in ControlPanel.undo and
//    `[...prev, value]` in history.js do, a `.pop()` "cleanup" would not, and the
//    header would say "Saved" over a server that never heard about the undo. That
//    is the bug class that recently shipped for inspector edits, so the test is
//    built around the sharpest case: a rename, where stack identity is the ONLY
//    dependency that can fire. It checks both that a PUT was actually sent and
//    that the persisted content moved.
//
//    Note on versions: the server hashes content and answers `unchanged: true`
//    without bumping the version when a PUT carries identical content
//    (server/diagrams.js:174). So a version bump proves a *content* save; the
//    counted PUT proves the dirty flag fired. Both are asserted.
//
// 2. STACK INVARIANTS. Redo cleared by a new edit; exact conservation across N
//    undos + N redos and inertness past the ends; and the same logical edit — a
//    field rename — pushed from Table.jsx's canvas inline editor vs
//    Inspector.jsx's field panel, undone from both, compared byte for byte.
//    2c includes a control: an inspector input that goes through the panel's own
//    `textField` helper, so a disagreement can be attributed to the surface that
//    built the entry rather than to the reducer that consumed it.

const { chromium } = require("playwright");
const {
  sleep, login, seed, openEditor, fetchDoc, waitForServer, reporter, realErrors,
} = require("./support.cjs");

const F = (id, name, type, extra = {}) => ({
  id, name, type, default: "", check: "", primary: false, unique: false,
  notNull: false, increment: false, comment: "", ...extra,
});

const CONTENT = () => ({
  gistId: "",
  tables: [
    {
      id: "t1", name: "orders", x: 200, y: 180, comment: "", indices: [],
      uniqueConstraints: [], color: "#6259cf", locked: false,
      fields: [
        F("f1", "id", "BIGINT", { primary: true, notNull: true }),
        F("f2", "user_id", "VARCHAR", { size: "" }),
      ],
    },
  ],
  references: [],
  notes: [],
  // An area keeps Workspace's dirty effect off its all-empty early-return path in
  // every state this test passes through, including ones where tables dip to 0.
  areas: [{ id: 0, name: "zone", x: 660, y: 180, width: 200, height: 160, color: "#6965db", locked: false }],
  pan: { x: 0, y: 0 },
  zoom: 0.8,
  types: [],
  enums: [],
});

const f2 = (doc) => ((doc.content.tables.find((t) => t.id === "t1") || { fields: [] }).fields || []).find((f) => f.id === "f2") || {};
const nameOf = (doc) => f2(doc).name;

// Everything the editor persists, minus bookkeeping the server owns. Two edit
// surfaces performing one logical edit must undo to the same value of this.
const shape = (doc) => JSON.stringify({
  tables: doc.content.tables,
  references: doc.content.references,
  areas: doc.content.areas,
  notes: doc.content.notes,
  types: doc.content.types,
  enums: doc.content.enums,
});

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  // Direct evidence that the dirty flag fired, independent of what the server
  // then decides to do with the payload.
  let puts = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT" && /\/api\/diagrams\//.test(r.url())) puts++;
  });
  const countPuts = async (fn) => {
    puts = 0;
    await fn();
    return puts;
  };

  const R = reporter();
  await login(page);

  // ---- UI helpers -------------------------------------------------------------

  const undoBtn = () => page.locator('button[title="Undo"]').first();
  const redoBtn = () => page.locator('button[title="Redo"]').first();
  const canUndo = async () => (await undoBtn().getAttribute("disabled")) === null;
  const canRedo = async () => (await redoBtn().getAttribute("disabled")) === null;

  // A viewport point that is bare canvas: not over a table/note/area card, the
  // tool switch, a floating island or the inspector. Hard-coded coordinates are
  // the wrong tool here — the editor fits the diagram to the viewport on load, so
  // where the cards land depends on the document.
  const emptyPoint = async () => {
    const candidates = [];
    for (let y = 760; y >= 200; y -= 60) for (let x = 1360; x >= 200; x -= 120) candidates.push({ x, y });
    const hit = await page.evaluate((pts) => {
      const blocked = /table-|field-|note|area|isl-|tsw-|tool-switch|inspector|ititle|frow|fcard|cp-|header/i;
      for (const p of pts) {
        const el = document.elementFromPoint(p.x, p.y);
        if (!el) continue;
        let node = el, bad = false;
        for (let i = 0; node && i < 8; i++, node = node.parentElement) {
          const cls = typeof node.className === "string" ? node.className : (node.className?.baseVal ?? "");
          if (blocked.test(cls) || /^(BUTTON|INPUT|SELECT|ASIDE|HEADER)$/.test(node.tagName)) { bad = true; break; }
        }
        if (!bad) return p;
      }
      return null;
    }, candidates);
    return hit || { x: 700, y: 700 };
  };

  // Undo/redo must not be typed into an input and no placement tool may be armed.
  const press = async (combo) => {
    await page.keyboard.press("Escape");
    const p = await emptyPoint();
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(250);
    await page.keyboard.press(combo);
  };

  // Canvas surface: click the field name on the card, retype, Enter (Table.jsx:879).
  const canvasRename = async (from, to) => {
    await page.locator(".field-name").filter({ hasText: from }).first().click({ force: true });
    await page.waitForTimeout(350);
    const input = page.locator(".field-name input").first();
    await input.fill(to);
    await input.press("Enter");
    await page.waitForTimeout(600);
  };

  const selectTable = async () => {
    await page.locator(".table-title").first().click({ force: true });
    await page.waitForTimeout(900);
  };
  // Expands the given field's card in the inspector, idempotently.
  const openInspectorField = async (index) => {
    const row = page.locator(".frow").nth(index);
    if (!/▾/.test(await row.innerText())) {
      await row.click();
      await page.waitForTimeout(600);
    }
  };
  const inspectorInput = (labelRe) =>
    page.locator(".fcard .fbody .f").filter({ hasText: labelRe }).first().locator("input").first();
  const commitInspector = async () => {
    await page.locator(".ititle").first().click({ force: true }); // blur commits
    await page.waitForTimeout(700);
  };

  const ids = [];
  const fresh = async (label) => {
    const id = await seed(page, label, CONTENT());
    ids.push(id);
    await openEditor(page, id);
    return id;
  };

  // ===========================================================================
  // 1. AUTOSAVE COUPLING
  // ===========================================================================
  console.log("\n=== 1. autosave coupling: does an undo reach the server? ===");
  let id = await fresh("history autosave");

  const v0 = await fetchDoc(page, id);
  R.step("baseline persisted", nameOf(v0) === "user_id", `version=${v0.version} name=${nameOf(v0)}`);

  await canvasRename("user_id", "buyer_id");
  const v1 = await waitForServer(page, id, (d) => nameOf(d) === "buyer_id");
  R.step("edit reached the server", nameOf(v1) === "buyer_id", `name=${nameOf(v1)}, version ${v0.version} -> ${v1.version}`);
  R.step("edit advanced the version", v1.version > v0.version, `${v0.version} -> ${v1.version}`);
  R.step("undo is offered for it", await canUndo(), `canUndo=${await canUndo()}`);

  // The load-bearing check. No array length changes across this undo, so the only
  // dirty-effect dependency that can fire is undoStack/redoStack identity.
  let n = await countPuts(async () => {
    await press("Control+z");
    await waitForServer(page, id, (d) => nameOf(d) === "user_id");
  });
  const v2 = await fetchDoc(page, id);
  R.step("UNDO sent a PUT (dirty flag fired from the stacks)", n > 0, `${n} PUT(s)`);
  R.step("UNDO reverted the server's content", nameOf(v2) === "user_id", `name=${nameOf(v2)}`);
  R.step("UNDO advanced the version", v2.version > v1.version, `${v1.version} -> ${v2.version}`);

  n = await countPuts(async () => {
    await press("Control+y");
    await waitForServer(page, id, (d) => nameOf(d) === "buyer_id");
  });
  const v3 = await fetchDoc(page, id);
  R.step("REDO sent a PUT", n > 0, `${n} PUT(s)`);
  R.step("REDO re-applied on the server", nameOf(v3) === "buyer_id", `name=${nameOf(v3)}`);
  R.step("REDO advanced the version", v3.version > v2.version, `${v2.version} -> ${v3.version}`);

  // Structural undo too. Its length dependencies would carry it on their own, so
  // this is the weaker test of the pair, but it must also hold.
  const beforeAdd = await fetchDoc(page, id);
  const spot = await emptyPoint();
  await page.locator('.tool-switch button[aria-label="Table"]').first().click();
  await page.waitForTimeout(400);
  await page.mouse.click(spot.x, spot.y);
  await page.waitForTimeout(900);
  const added = await waitForServer(page, id, (d) => d.content.tables.length === 2);
  R.step("structural edit (place a table) persisted", added.content.tables.length === 2, `${beforeAdd.content.tables.length} -> ${added.content.tables.length} tables (placed at ${spot.x},${spot.y})`);
  await page.locator('.tool-switch button[aria-label="Select"]').first().click().catch(() => {});
  await page.waitForTimeout(300);
  n = await countPuts(async () => {
    await press("Control+z");
    await waitForServer(page, id, (d) => d.content.tables.length === 1);
  });
  const removed = await fetchDoc(page, id);
  R.step("undo of a structural edit reached the server", removed.content.tables.length === 1, `${added.content.tables.length} -> ${removed.content.tables.length} tables, ${n} PUT(s), version ${added.version} -> ${removed.version}`);

  // ===========================================================================
  // 2a. REDO CLEARED BY A NEW EDIT
  // ===========================================================================
  console.log("\n=== 2a. a new edit clears the redo stack ===");
  id = await fresh("history redo-clear");

  await canvasRename("user_id", "edit_A");
  await waitForServer(page, id, (d) => nameOf(d) === "edit_A");
  await press("Control+z");
  const undoneA = await waitForServer(page, id, (d) => nameOf(d) === "user_id");
  R.step("edit A undone", nameOf(undoneA) === "user_id", `name=${nameOf(undoneA)}`);
  R.step("redo is now offered", await canRedo(), `canRedo=${await canRedo()}`);

  // A fresh edit while a redo is pending. Every producer pairs its push with
  // setRedoStack([]), so edit A must become unreachable.
  await canvasRename("user_id", "edit_B");
  const afterB = await waitForServer(page, id, (d) => nameOf(d) === "edit_B");
  R.step("edit B applied", nameOf(afterB) === "edit_B", `name=${nameOf(afterB)}`);
  R.step("the new edit cleared the redo stack", !(await canRedo()), `canRedo=${await canRedo()}`);

  await press("Control+y");
  await sleep(3500);
  const stale = await fetchDoc(page, id);
  R.step("redo after a new edit is inert (edit A did not come back)", nameOf(stale) === "edit_B", `name=${nameOf(stale)}`);

  // Clearing redo must not have eaten undo.
  await press("Control+z");
  const undoneB = await waitForServer(page, id, (d) => nameOf(d) === "user_id");
  R.step("edit B is still undoable", nameOf(undoneB) === "user_id", `name=${nameOf(undoneB)}`);

  // ===========================================================================
  // 2b. CONSERVATION AND BOUNDEDNESS
  // ===========================================================================
  console.log("\n=== 2b. N undos + N redos conserve exactly; past the ends is inert ===");
  const N = 6;
  id = await fresh("history conservation");
  const base = await fetchDoc(page, id);

  let prevName = "user_id";
  for (let i = 1; i <= N; i++) {
    await canvasRename(prevName, `step_${i}`);
    await waitForServer(page, id, (d) => nameOf(d) === `step_${i}`);
    prevName = `step_${i}`;
  }
  const atTop = await fetchDoc(page, id);
  R.step(`${N} edits applied`, nameOf(atTop) === `step_${N}`, `name=${nameOf(atTop)}`);

  for (let i = 0; i < N; i++) await press("Control+z");
  const drained = await waitForServer(page, id, (d) => nameOf(d) === "user_id");
  R.step(`${N} undos land exactly on the baseline (no entry consumed twice or skipped)`, nameOf(drained) === "user_id", `name=${nameOf(drained)}`);
  R.step("the document is byte-identical to the pre-edit baseline", shape(drained) === shape(base), shape(drained) === shape(base) ? "identical" : "DIFFERS");
  R.step("the undo stack is now empty", !(await canUndo()), `canUndo=${await canUndo()}`);
  R.step(`the redo stack holds exactly the ${N} entries popped`, await canRedo(), `canRedo=${await canRedo()}`);

  // Over-pop. The guard is `if (undoStack.length === 0) return`.
  const beforeOverPop = await fetchDoc(page, id);
  const overPopPuts = await countPuts(async () => {
    for (let i = 0; i < 3; i++) await press("Control+z");
    await sleep(3000);
  });
  const afterOverPop = await fetchDoc(page, id);
  R.step("3 undos past the end change nothing and send no PUT", shape(afterOverPop) === shape(beforeOverPop) && overPopPuts === 0, `${overPopPuts} PUT(s), version ${beforeOverPop.version} -> ${afterOverPop.version}`);

  for (let i = 0; i < N; i++) await press("Control+y");
  const refilled = await waitForServer(page, id, (d) => nameOf(d) === `step_${N}`);
  R.step(`${N} redos return to the top of the stack`, nameOf(refilled) === `step_${N}`, `name=${nameOf(refilled)}`);
  R.step("redo restored the document byte-identically", shape(refilled) === shape(atTop), shape(refilled) === shape(atTop) ? "identical" : "DIFFERS");
  R.step("the redo stack is now empty", !(await canRedo()), `canRedo=${await canRedo()}`);

  const beforeOverRedo = await fetchDoc(page, id);
  const overRedoPuts = await countPuts(async () => {
    for (let i = 0; i < 3; i++) await press("Control+y");
    await sleep(3000);
  });
  const afterOverRedo = await fetchDoc(page, id);
  R.step("3 redos past the end change nothing and send no PUT", shape(afterOverRedo) === shape(beforeOverRedo) && overRedoPuts === 0, `${overRedoPuts} PUT(s), version ${beforeOverRedo.version} -> ${afterOverRedo.version}`);

  // ===========================================================================
  // 2c. TWO SURFACES, ONE LOGICAL EDIT
  // ===========================================================================
  console.log("\n=== 2c. canvas inline rename vs inspector rename, undone ===");

  // -- canvas surface: Table.jsx commitFieldName
  const idCanvas = await fresh("history surface canvas");
  const canvasBase = await fetchDoc(page, idCanvas);
  await canvasRename("user_id", "renamed_here");
  const canvasEdited = await waitForServer(page, idCanvas, (d) => nameOf(d) === "renamed_here");
  R.step("canvas inline rename applied", nameOf(canvasEdited) === "renamed_here", `name=${nameOf(canvasEdited)}`);
  await press("Control+z");
  await sleep(4000);
  const canvasUndone = await fetchDoc(page, idCanvas);
  R.step("canvas rename undoes", nameOf(canvasUndone) === "user_id", `name=${nameOf(canvasUndone)}`);

  // -- inspector surface: Inspector.jsx field-name input -> editField
  const idInspector = await fresh("history surface inspector");
  const inspectorBase = await fetchDoc(page, idInspector);
  await selectTable();
  await openInspectorField(1);
  await inspectorInput(/^Field name/i).fill("renamed_here");
  await commitInspector();
  const inspectorEdited = await waitForServer(page, idInspector, (d) => nameOf(d) === "renamed_here");
  R.step("inspector rename applied", nameOf(inspectorEdited) === "renamed_here", `name=${nameOf(inspectorEdited)}`);
  R.step("inspector rename pushed an undo entry", await canUndo(), `canUndo=${await canUndo()}`);

  const inspectorUndoPuts = await countPuts(async () => {
    await press("Control+z");
    await sleep(4000);
  });
  const inspectorUndone = await fetchDoc(page, idInspector);
  R.step("the inspector entry was consumed by undo", !(await canUndo()) && (await canRedo()), `canUndo=${await canUndo()} canRedo=${await canRedo()}, ${inspectorUndoPuts} PUT(s)`);
  R.step("inspector rename undoes", nameOf(inspectorUndone) === "user_id", `name=${nameOf(inspectorUndone)}`);

  R.step("both surfaces produced the same edited document", shape(canvasEdited) === shape(inspectorEdited), shape(canvasEdited) === shape(inspectorEdited) ? "identical" : `canvas name=${nameOf(canvasEdited)} inspector name=${nameOf(inspectorEdited)}`);
  const surfacesAgree = shape(canvasUndone) === shape(inspectorUndone);
  R.step("BOTH SURFACES UNDO TO THE SAME DOCUMENT", surfacesAgree, surfacesAgree ? "identical" : `canvas -> "${nameOf(canvasUndone)}", inspector -> "${nameOf(inspectorUndone)}"`);
  R.step("that document is the untouched baseline", shape(canvasUndone) === shape(canvasBase) && shape(inspectorUndone) === shape(inspectorBase), `canvas=${shape(canvasUndone) === shape(canvasBase)} inspector=${shape(inspectorUndone) === shape(inspectorBase)}`);
  if (!surfacesAgree) {
    console.log("    canvas    f2:", JSON.stringify(f2(canvasUndone)));
    console.log("    inspector f2:", JSON.stringify(f2(inspectorUndone)));
  }

  // CONTROL. Same component, same editField(), but through the panel's own
  // `textField` helper, which restores the focus-time value before committing
  // (Inspector.jsx:236-243). If this one undoes while the field-name input above
  // does not, the defect is in the entry the surface built, not in the reducer
  // that consumed it.
  console.log("\n    control: an inspector input that goes through textField()");
  const idControl = await fresh("history surface inspector-control");
  await selectTable();
  await openInspectorField(1);
  const dflt = inspectorInput(/^Default/i);
  R.step("found the inspector Default input", (await dflt.count()) > 0, `count=${await dflt.count()}`);
  await dflt.fill("gen_random_uuid()");
  await commitInspector();
  const ctrlEdited = await waitForServer(page, idControl, (d) => f2(d).default === "gen_random_uuid()");
  R.step("inspector Default edit applied", f2(ctrlEdited).default === "gen_random_uuid()", `default="${f2(ctrlEdited).default}"`);
  await press("Control+z");
  await sleep(4000);
  const ctrlUndone = await fetchDoc(page, idControl);
  R.step("inspector Default edit UNDOES (reducer handles inspector-built entries)", f2(ctrlUndone).default === "", `default="${f2(ctrlUndone).default}"`);

  // Scope of the stacks: they are React state, so a reload drops them. Documented
  // rather than judged.
  await openEditor(page, idCanvas);
  await press("Control+y");
  await sleep(3000);
  const afterReload = await fetchDoc(page, idCanvas);
  R.step("reloading the editor drops the stacks, so redo is inert (documents scope)", nameOf(afterReload) === "user_id", `name=${nameOf(afterReload)}`);

  const bad = realErrors(errors);
  R.step("no page errors throughout", bad.length === 0, bad.slice(0, 3).join(" | "));

  for (const d of ids) {
    await page.evaluate((i) => fetch(`/api/diagrams/${i}`, { method: "DELETE", credentials: "include" }), d).catch(() => {});
  }
  const failures = R.finish("history consequences");
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("HARNESS ERROR", e);
  process.exit(2);
});
