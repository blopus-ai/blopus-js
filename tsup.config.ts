import { defineConfig } from "tsup";

// Builds ESM + CJS + .d.ts for the library entry, the /ai subpath, and the CLI.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    ai: "src/ai.ts",
    cli: "src/cli.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  // `ai` is an optional peer dep loaded via dynamic import — never bundle it.
  external: ["ai"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
