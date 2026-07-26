// Node ESM resolve hook: lets the harness import app modules that use Vite-style
// extensionless relative specifiers (`from "../data/constants"`), which every
// file in src/ does. Without this, either the harness could not import src/, or
// src/utils/history.js would have to be the one file in the repo writing
// explicit .js extensions. 15 lines here is the cheaper trade.

const EXTENSIONS = [".js", ".jsx", ".mjs", "/index.js"];

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    const relative = specifier.startsWith("./") || specifier.startsWith("../");
    if (!relative || /\.(js|jsx|mjs|cjs|json|css)$/.test(specifier)) throw err;
    for (const ext of EXTENSIONS) {
      try {
        return await next(specifier + ext, context);
      } catch {
        // try the next candidate
      }
    }
    throw err;
  }
}
