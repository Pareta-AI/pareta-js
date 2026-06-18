import { defineConfig } from "tsup";

// Dual ESM + CJS + .d.ts from one entry. tsup (esbuild) emits dist/index.mjs,
// dist/index.cjs, dist/index.d.ts — matching the package.json `exports` map.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".cjs" };
  },
});
