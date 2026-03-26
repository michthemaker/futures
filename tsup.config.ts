import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/node/index.ts"],
  format: ["esm"],
  dts: true,
  outDir: "dist",
  clean: true,
  skipNodeModulesBundle: true,
});
