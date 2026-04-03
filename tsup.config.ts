import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node20",
  splitting: false,
  sourcemap: true,
  banner: ({ entryPoint }) => {
    if (entryPoint?.includes("cli.ts")) {
      return { js: "#!/usr/bin/env node" };
    }
    return {};
  },
});
