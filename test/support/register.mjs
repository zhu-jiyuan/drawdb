// Entry shim so the harness can be run as:
//   node --import ./test/support/register.mjs test/run.mjs
import { register } from "node:module";
register("./resolve-src.mjs", import.meta.url);
