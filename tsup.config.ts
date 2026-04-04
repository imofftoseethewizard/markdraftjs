import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node20",
  splitting: false,
  sourcemap: true,
  onSuccess: async () => {
    const fs = await import("fs");
    const cli = fs.readFileSync("dist/cli.js", "utf-8");
    if (!cli.startsWith("#!/")) {
      fs.writeFileSync("dist/cli.js", "#!/usr/bin/env node\n" + cli);
    }
    fs.chmodSync("dist/cli.js", 0o755);
  },
});
