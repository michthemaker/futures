import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/node/index.ts"],
    format: ["esm"],
    dts: true,
    outDir: "dist",
    clean: false,
    skipNodeModulesBundle: true,
  },
  {
    entry: ["src/dom/index.ts"],
    format: ["esm"],
    dts: { resolve: false },
    outDir: "dist/dom",
    clean: false,
    skipNodeModulesBundle: true,
    tsconfig: "src/dom/tsconfig.json",
    external: ["../index"],
  },
]);
