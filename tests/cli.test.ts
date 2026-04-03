import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";

import { main } from "../src/cli.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "markdraftjs-cli-"));
}

describe("CLI main()", () => {
  const originalEnv = process.env.MARKDRAFT_HOME;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MARKDRAFT_HOME;
    } else {
      process.env.MARKDRAFT_HOME = originalEnv;
    }
  });

  it("version flag", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main(["-V"]);
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Markdraft"));
    log.mockRestore();
  });

  it("deprecated -a flag", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main(["-a"]);
    expect(code).toBe(2);
    log.mockRestore();
  });

  it("deprecated -p flag", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main(["-p"]);
    expect(code).toBe(2);
    log.mockRestore();
  });

  it("theme invalid", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main(["--theme=invalid", "--export", "."]);
    expect(code).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("valid options"));
    log.mockRestore();
  });

  it("missing readme", async () => {
    const dir = tmpDir();
    const empty = path.join(dir, "empty");
    fs.mkdirSync(empty);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.MARKDRAFT_HOME = path.join(dir, ".markdraft");
    const code = await main(["--export", empty]);
    expect(code).toBe(1);
    expect(log).toHaveBeenCalledWith("Error:", expect.any(String));
    log.mockRestore();
  });

  it("export writes file", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "README.md"), "# Export Test");
    const outFile = path.join(dir, "out.html");
    process.env.MARKDRAFT_HOME = path.join(dir, ".markdraft");
    const code = await main(["--export", dir, outFile, "--quiet"]);
    expect(code).toBe(0);
    const html = fs.readFileSync(outFile, "utf-8");
    expect(html).toContain("# Export Test");
  });

  it("export with title", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "README.md"), "# Content");
    const outFile = path.join(dir, "out.html");
    process.env.MARKDRAFT_HOME = path.join(dir, ".markdraft");
    const code = await main(["--export", "--title=Custom", dir, outFile, "--quiet"]);
    expect(code).toBe(0);
    const html = fs.readFileSync(outFile, "utf-8");
    expect(html).toContain("Custom");
  });

  it("no inline export", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "README.md"), "# No Inline");
    const outFile = path.join(dir, "out.html");
    process.env.MARKDRAFT_HOME = path.join(dir, ".markdraft");
    const code = await main(["--export", "--no-inline", dir, outFile, "--quiet"]);
    expect(code).toBe(0);
    const html = fs.readFileSync(outFile, "utf-8");
    expect(html).toContain("cdn.jsdelivr.net");
  });

  it("clear flag", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = tmpDir();
    process.env.MARKDRAFT_HOME = dir;
    const code = await main(["--clear"]);
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith("Cache cleared.");
    log.mockRestore();
  });
});
