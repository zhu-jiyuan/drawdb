// Shared plumbing for the undo/redo consequence tests.
//
// playwright is deliberately NOT a dependency of this repo (a previous dependency
// addition desynced the lockfile and broke the ARM CI build), so these files are
// run from a directory where playwright resolves:
//
//   NODE_PATH=/path/to/e2e/node_modules node test/e2e/<file>.cjs
//
// Requires a server whose STATIC_DIR points at a FRESH `npm run build`.

const PASSWORD = "test-password-123";

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const BASE = arg("base", process.env.BASE || "http://localhost:3101");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(page) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in to cloud" }).click();
  await page.getByText("Recent diagrams").waitFor({ timeout: 30000 });
}

// PUTs a document and returns its id. `content` is the diagram body.
async function seed(page, name, content) {
  return page.evaluate(
    async ({ name: n, content: c }) => {
      const id = crypto.randomUUID();
      await fetch(`/api/diagrams/${id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: n,
          database: "postgresql",
          content: c,
          baseVersion: null,
          force: false,
        }),
      });
      return id;
    },
    { name, content },
  );
}

async function openEditor(page, id) {
  await page.goto(`${BASE}/editor/diagrams/${id}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForTimeout(4500);
}

// The whole persisted document, straight from the server. This is the oracle:
// the UI is the thing under suspicion, so nothing is read out of the DOM.
async function fetchDoc(page, id) {
  return page.evaluate(async (i) => {
    const r = await fetch(`/api/diagrams/${i}`, { credentials: "include" });
    const j = await r.json();
    return { version: j.version, content: j.content };
  }, id);
}

// Polls the server until `want(doc)` holds. Returns the last document seen either
// way, so a caller can report what it actually got when the wait times out.
async function waitForServer(page, id, want, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = await fetchDoc(page, id);
  while (!want(last) && Date.now() < deadline) {
    await sleep(350);
    last = await fetchDoc(page, id);
  }
  return last;
}

// Fires undo/redo the way a user does. react-hotkeys-hook listens on document and
// ignores events raised from form tags, so focus has to be off any input first.
async function hotkey(page, combo) {
  await page.locator(".ititle, .table-title, body").first().click({ force: true, position: { x: 2, y: 2 } }).catch(() => {});
  await page.keyboard.press(combo);
}

function reporter() {
  const results = [];
  return {
    results,
    step(name, ok, detail) {
      results.push({ name, ok: !!ok, detail });
      console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
    },
    finish(label) {
      const bad = results.filter((r) => !r.ok);
      console.log(
        `\n${bad.length ? "FAIL" : "PASS"}  ${label}: ${results.length - bad.length}/${results.length} checks`,
      );
      return bad.length;
    },
  };
}

// Console/page noise this local setup produces regardless of history: the vercel
// analytics stub 404s to index.html, and /api/auth/me 401s before login.
function realErrors(errors) {
  return errors.filter(
    (e) =>
      !/favicon|manifest|ResizeObserver|_vercel|insights|auth\/me|401|Unexpected token '<'|Failed to load resource/i.test(
        e,
      ),
  );
}

module.exports = {
  BASE,
  PASSWORD,
  arg,
  sleep,
  login,
  seed,
  openEditor,
  fetchDoc,
  waitForServer,
  hotkey,
  reporter,
  realErrors,
};
