import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

/** Asset extensions the host imports `with { type: "text" }`. */
const TEXT_MODULE_EXTENSIONS = new Set([".md", ".html", ".txt", ".sql", ".tmpl"]);

export default defineConfig({
  // Bun defines `import.meta.dir` in every module; Vite leaves it undefined, so
  // host modules that resolve default log paths from it crash on import. The
  // values are only trace/log defaults, so a stable temp directory is enough.
  define: {
    "import.meta.dir": JSON.stringify(process.cwd()),
  },
  // The host packages (@oh-my-pi/*) import assets as
  // `import p from "./x.md" with { type: "text" }` — a Bun text-module
  // assertion. Vite has no loader for it, so any test whose import graph
  // reaches those modules fails to transform. Serving the extensions as raw
  // text reproduces Bun's semantics for the test run; the shipping code path is
  // unaffected because OMP itself is Bun.
  plugins: [
    {
      name: "bun-text-modules",
      enforce: "pre",
      transform(_code, id) {
        const ext = id.slice(id.lastIndexOf("."));
        if (!TEXT_MODULE_EXTENSIONS.has(ext)) return undefined;
        return { code: `export default ${JSON.stringify(readFileSync(id, "utf8"))};`, map: null };
      },
    },
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
