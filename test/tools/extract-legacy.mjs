// Regenerates the "before" oracle for the undo/redo characterization harness.
//
// The legacy reducers are closures over React context setters, so they cannot be
// imported. Rather than hand-copying them into a test double (which drifts), we
// slice their bodies verbatim out of a pinned git revision of ControlPanel.jsx
// and compile them at test time with the closure variables supplied as function
// parameters. The extracted text is therefore provably the shipped code.
//
//   node test/tools/extract-legacy.mjs [gitRef]
//
// Default ref is the commit that was HEAD when the harness was written, so the
// oracle stays fixed even after the refactor lands and the towers are gone.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures");

const ref = process.argv[2] ?? "51d99e1";
const path = "src/components/EditorHeader/ControlPanel.jsx";

const source = execFileSync("git", ["show", `${ref}:${path}`], {
  cwd: join(here, "..", ".."),
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});

// Slice `const <name> = () => {` .. matching `};` at the same indentation.
function sliceBody(name) {
  const opener = `  const ${name} = () => {\n`;
  const start = source.indexOf(opener);
  if (start === -1) throw new Error(`could not find ${name} in ${ref}:${path}`);
  const bodyStart = start + opener.length;
  const end = source.indexOf("\n  };\n", bodyStart);
  if (end === -1) throw new Error(`could not find end of ${name}`);
  return source.slice(bodyStart, end + 1);
}

for (const name of ["undo", "redo"]) {
  const body = sliceBody(name);
  writeFileSync(join(fixtures, `legacy-${name}.body.txt`), body);
  const lines = body.split("\n").length;
  console.log(`legacy-${name}.body.txt  ${lines} lines  from ${ref}`);
}
