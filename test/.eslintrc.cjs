// The harness is Node code, not browser code: it reads files, uses node: builtins
// and exits with a status. The root config sets env.browser for src/.
module.exports = {
  env: { node: true, browser: false, es2022: true },
  parserOptions: { ecmaVersion: "latest", sourceType: "module" },
  rules: {
    // test/support/legacy.js compiles the pre-refactor reducer bodies with
    // `new Function`, which is the whole point of the oracle.
    "no-new-func": "off",
  },
  overrides: [
    {
      // The Playwright-driven tests are CommonJS: playwright is not a dependency
      // of this repo, so they are run manually against an external install.
      files: ["smoke/**/*.cjs", "e2e/**/*.cjs", "perf/**/*.cjs"],
      parserOptions: { sourceType: "script" },
      // These files are Node scripts that also contain page.evaluate() callbacks,
      // whose bodies are serialised and run in the browser. Listing the DOM
      // globals they use is narrower than switching env.browser on, which would
      // stop eslint catching a genuine browser-global typo in the Node half.
      globals: {
        document: "readonly",
        localStorage: "readonly",
        requestAnimationFrame: "readonly",
        KeyboardEvent: "readonly",
        PerformanceObserver: "readonly",
      },
    },
  ],
};
