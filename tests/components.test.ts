import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { AssetCache } from "../src/assets.js";
import { CDN_ASSETS, loadUserSettings } from "../src/config.js";
import { ReadmeNotFoundError } from "../src/errors.js";
import { DirectoryReader, StdinReader, TextReader } from "../src/readers.js";
import {
  isSourceFile,
  languageForFilename,
  sourceLanguagesFrom,
  wrapSourceText,
} from "../src/source.js";
import { FileWatcher } from "../src/watcher.js";
import { inputPath } from "./helpers.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "markdraftjs-test-"));
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

describe("DirectoryReader", () => {
  it("finds README in directory", () => {
    const reader = new DirectoryReader(inputPath("default"));
    expect(reader.rootFilename).toMatch(/README\.md$/);
  });

  it("accepts explicit file", () => {
    const reader = new DirectoryReader(inputPath("gfm-test.md"));
    expect(reader.rootFilename).toMatch(/gfm-test\.md$/);
  });

  it("directory without readme", () => {
    const reader = new DirectoryReader(inputPath("empty"));
    expect(reader.rootFilename).toBeNull();
    expect(reader.rootDirectory).toBe(path.resolve(inputPath("empty")));
  });

  it("missing file raises", () => {
    expect(() => new DirectoryReader("/nonexistent/path/to/file.md")).toThrow(ReadmeNotFoundError);
  });

  it("list directory", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "README.md"), "hi");
    fs.writeFileSync(path.join(dir, "guide.md"), "guide");
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, ".hidden"), "secret");
    const reader = new DirectoryReader(dir);
    const entries = reader.listDirectory();
    const names = entries.map((e) => e.name);
    expect(names).toContain("README.md");
    expect(names).toContain("guide.md");
    expect(names).toContain("sub");
    expect(names).not.toContain(".hidden");
  });

  it("list directory types", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "README.md"), "hi");
    fs.mkdirSync(path.join(dir, "sub"));
    const reader = new DirectoryReader(dir);
    const entries = reader.listDirectory();
    const types: Record<string, string> = {};
    for (const e of entries) types[e.name] = e.type;
    expect(types["README.md"]).toBe("file");
    expect(types["sub"]).toBe("directory");
  });

  it("list directory includes source files", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "README.md"), "hi");
    fs.writeFileSync(path.join(dir, "main.rs"), "fn main() {}");
    fs.writeFileSync(path.join(dir, "app.py"), "print(1)");
    fs.writeFileSync(path.join(dir, "photo.png"), "");
    const reader = new DirectoryReader(dir);
    const names = reader.listDirectory().map((e) => e.name);
    expect(names).toContain("main.rs");
    expect(names).toContain("app.py");
    expect(names).not.toContain("photo.png");
  });

  it("source files are not binary", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "README.md"), "hi");
    fs.writeFileSync(path.join(dir, "app.js"), "let x = 1;");
    fs.writeFileSync(path.join(dir, "photo.png"), "");
    const reader = new DirectoryReader(dir);
    expect(reader.isBinary("app.js")).toBe(false);
    expect(reader.isBinary("photo.png")).toBe(true);
  });

  it("is directory", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "README.md"), "hi");
    fs.mkdirSync(path.join(dir, "sub"));
    const reader = new DirectoryReader(dir);
    expect(reader.isDirectory(null)).toBe(true);
    expect(reader.isDirectory("sub")).toBe(true);
    expect(reader.isDirectory("README.md")).toBe(false);
  });

  it("normalize none", () => {
    const reader = new DirectoryReader(inputPath("default"));
    expect(reader.normalizeSubpath(null)).toBeNull();
  });

  it("normalize directory adds slash", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "README.md"), "hi");
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sub", "README.md"), "sub");
    const reader = new DirectoryReader(dir);
    expect(reader.normalizeSubpath("sub")).toBe("sub/");
  });

  it("normalize file no slash", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "README.md"), "hi");
    fs.writeFileSync(path.join(dir, "other.md"), "other");
    const reader = new DirectoryReader(dir);
    expect(reader.normalizeSubpath("other.md")).toBe("other.md");
  });

  it("traversal blocked", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "README.md"), "hi");
    const reader = new DirectoryReader(dir);
    expect(() => reader.normalizeSubpath("../escape")).toThrow(ReadmeNotFoundError);
  });

  it("symlink outside root blocked", () => {
    const dir = tmpDir();
    const served = path.join(dir, "served");
    fs.mkdirSync(served);
    fs.writeFileSync(path.join(served, "README.md"), "hi");
    const outside = path.join(dir, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "secret.md"), "secret");
    fs.symlinkSync(path.join(outside, "secret.md"), path.join(served, "link.md"));
    const reader = new DirectoryReader(served);
    expect(() => reader.read("link.md")).toThrow(ReadmeNotFoundError);
  });

  it("symlink inside root allowed", () => {
    const dir = tmpDir();
    const served = path.join(dir, "served");
    fs.mkdirSync(served);
    fs.writeFileSync(path.join(served, "README.md"), "hi");
    fs.writeFileSync(path.join(served, "real.md"), "real content");
    fs.symlinkSync(path.join(served, "real.md"), path.join(served, "link.md"));
    const reader = new DirectoryReader(served);
    expect(reader.read("link.md")).toBe("real content");
  });

  it("is binary png", () => {
    const reader = new DirectoryReader(path.dirname(inputPath()), true);
    expect(reader.isBinary("input/img.png")).toBe(true);
  });

  it("is binary markdown", () => {
    const reader = new DirectoryReader(path.dirname(inputPath()), true);
    expect(reader.isBinary("input/gfm-test.md")).toBe(false);
  });

  it("last updated existing", () => {
    const reader = new DirectoryReader(inputPath("default"));
    const mtime = reader.lastUpdated();
    expect(typeof mtime).toBe("number");
    expect(mtime).toBeGreaterThan(0);
  });

  it("last updated missing", () => {
    const reader = new DirectoryReader(path.dirname(inputPath()), true);
    expect(reader.lastUpdated("nonexistent")).toBeNull();
  });

  it("read text", () => {
    const reader = new DirectoryReader(inputPath("default"));
    const content = reader.read(null);
    expect(typeof content).toBe("string");
    expect(content).toContain("README");
  });

  it("read binary", () => {
    const reader = new DirectoryReader(path.dirname(inputPath()), true);
    const content = reader.read("input/img.png");
    expect(Buffer.isBuffer(content)).toBe(true);
    expect((content as Buffer).subarray(0, 4).toString()).toContain("PNG");
  });

  it("read missing raises", () => {
    const reader = new DirectoryReader(path.dirname(inputPath()), true);
    expect(() => reader.read("nonexistent.md")).toThrow(ReadmeNotFoundError);
  });

  it("filename for root", () => {
    const reader = new DirectoryReader(inputPath("default"));
    expect(reader.filenameFor(null)).toBe("README.md");
  });

  it("filename for missing", () => {
    const reader = new DirectoryReader(path.dirname(inputPath()), true);
    expect(reader.filenameFor("nonexistent")).toBeNull();
  });
});

describe("TextReader", () => {
  it("read", () => {
    expect(new TextReader("hello").read(null)).toBe("hello");
  });

  it("read subpath raises", () => {
    expect(() => new TextReader("hello").read("sub")).toThrow(ReadmeNotFoundError);
  });

  it("filename for none", () => {
    expect(new TextReader("hi", "f.md").filenameFor(null)).toBe("f.md");
  });

  it("filename for subpath", () => {
    expect(new TextReader("hi", "f.md").filenameFor("x")).toBeNull();
  });

  it("normalize subpath", () => {
    expect(new TextReader("hi").normalizeSubpath(null)).toBeNull();
    expect(new TextReader("hi").normalizeSubpath("x/y")).toBe("x/y");
  });
});

describe("StdinReader", () => {
  it("reads once", () => {
    let callCount = 0;

    class MockStdin extends StdinReader {
      // @ts-expect-error override private
      private readStdin(): string {
        callCount++;
        return "stdin text";
      }
    }

    const reader = new MockStdin();
    expect(reader.read(null)).toBe("stdin text");
    expect(reader.read(null)).toBe("stdin text");
    expect(callCount).toBe(1);
  });

  it("subpath raises", () => {
    class MockStdin extends StdinReader {
      // @ts-expect-error override private
      private readStdin(): string {
        return "text";
      }
    }
    expect(() => new MockStdin().read("sub")).toThrow(ReadmeNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Asset cache
// ---------------------------------------------------------------------------

describe("AssetCache", () => {
  it("get path", () => {
    const dir = tmpDir();
    expect(new AssetCache(dir).getPath("x.js")).toBe(path.join(dir, "x.js"));
  });

  it("is cached true", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "x.js"), "content");
    expect(new AssetCache(dir).isCached("x.js")).toBe(true);
  });

  it("is cached false", () => {
    const dir = tmpDir();
    expect(new AssetCache(dir).isCached("x.js")).toBe(false);
  });

  it("all cached true", () => {
    const dir = tmpDir();
    for (const name of Object.keys(CDN_ASSETS)) {
      fs.writeFileSync(path.join(dir, name), "x");
    }
    expect(new AssetCache(dir).allCached()).toBe(true);
  });

  it("all cached false", () => {
    const dir = tmpDir();
    expect(new AssetCache(dir).allCached()).toBe(false);
  });

  it("clear removes dir", () => {
    const dir = tmpDir();
    const d = path.join(dir, "cache");
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, "test.css"), "body{}");
    new AssetCache(d).clear();
    expect(fs.existsSync(d)).toBe(false);
  });

  it("clear missing dir no error", () => {
    const dir = tmpDir();
    new AssetCache(path.join(dir, "nope")).clear(); // no error
  });
});

// ---------------------------------------------------------------------------
// File watcher
// ---------------------------------------------------------------------------

describe("FileWatcher", () => {
  it("yields on change", async () => {
    const dir = tmpDir();
    const md = path.join(dir, "README.md");
    fs.writeFileSync(md, "v1");
    const reader = new DirectoryReader(dir);
    const watcher = new FileWatcher(reader, null, 50);
    const abort = new AbortController();

    const results: boolean[] = [];
    const watchPromise = (async () => {
      for await (const changed of watcher.watch(abort.signal)) {
        results.push(changed);
        abort.abort();
      }
    })();

    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(md, "v2");
    await watchPromise;
    expect(results).toEqual([true]);
  });

  it("exits on abort", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "README.md"), "v1");
    const reader = new DirectoryReader(dir);
    const watcher = new FileWatcher(reader, null, 50);
    const abort = new AbortController();

    const results: boolean[] = [];
    const watchPromise = (async () => {
      for await (const changed of watcher.watch(abort.signal)) {
        results.push(changed);
      }
    })();

    await new Promise((r) => setTimeout(r, 100));
    abort.abort();
    await watchPromise;
    expect(results).toEqual([]);
  });

  it("does not leak abort listeners across iterations", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "README.md"), "v1");
    const reader = new DirectoryReader(dir);
    // Use a very short interval so we accumulate many iterations quickly
    const watcher = new FileWatcher(reader, null, 10);
    const abort = new AbortController();

    // Record warnings
    const warnings: string[] = [];
    const onWarning = (w: Error) => {
      if (w.name === "MaxListenersExceededWarning") warnings.push(w.message);
    };
    process.on("warning", onWarning);

    const watchPromise = (async () => {
      for await (const _changed of watcher.watch(abort.signal)) {
        // not reached without file changes
      }
    })();

    // Let it run for 20+ iterations (10ms * 20 = 200ms)
    await new Promise((r) => setTimeout(r, 250));
    abort.abort();
    await watchPromise;

    process.off("warning", onWarning);
    expect(warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

describe("Config loading", () => {
  it("load missing file", () => {
    const dir = tmpDir();
    expect(loadUserSettings(path.join(dir, "nonexistent"))).toEqual({});
  });

  it("load settings json", () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({ HOST: "0.0.0.0", PORT: 9000 }),
    );
    const result = loadUserSettings(dir);
    expect(result.HOST).toBe("0.0.0.0");
    expect(result.PORT).toBe(9000);
  });

  it("load ignores unrecognized keys", () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({ HOST: "0.0.0.0", foo: "bar" }),
    );
    const result = loadUserSettings(dir);
    expect(result.HOST).toBe("0.0.0.0");
    expect("foo" in result).toBe(false);
  });

  it("HIGHLIGHT_LANGUAGES absent leaves the key undefined", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ HOST: "0.0.0.0" }));
    const result = loadUserSettings(dir);
    expect(result.HIGHLIGHT_LANGUAGES).toBeUndefined();
  });

  it("HIGHLIGHT_LANGUAGES parses a valid entry, resolving a relative path", () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({
        HIGHLIGHT_LANGUAGES: [{ name: "ken", path: "langs/ken.js", global: "hljsDefineKen" }],
      }),
    );
    const result = loadUserSettings(dir);
    expect(result.HIGHLIGHT_LANGUAGES).toEqual([
      { name: "ken", path: path.join(dir, "langs/ken.js"), global: "hljsDefineKen" },
    ]);
  });

  it("HIGHLIGHT_LANGUAGES keeps an absolute path unchanged", () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({ HIGHLIGHT_LANGUAGES: [{ name: "ken", path: "/abs/ken.js" }] }),
    );
    const result = loadUserSettings(dir);
    expect(result.HIGHLIGHT_LANGUAGES).toEqual([{ name: "ken", path: "/abs/ken.js" }]);
  });

  it("HIGHLIGHT_LANGUAGES drops malformed entries but keeps valid ones", () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({
        HIGHLIGHT_LANGUAGES: [
          { name: "ken", path: "/abs/ken.js" },
          { path: "/abs/missing-name.js" },
          { name: "", path: "/abs/empty-name.js" },
          { name: "no-path" },
          { name: "bad-global", path: "/abs/bad-global.js", global: 123 },
          "not-an-object",
          null,
          42,
        ],
      }),
    );
    const result = loadUserSettings(dir);
    expect(result.HIGHLIGHT_LANGUAGES).toEqual([{ name: "ken", path: "/abs/ken.js" }]);
  });

  it("HIGHLIGHT_LANGUAGES normalizes extensions", () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({
        HIGHLIGHT_LANGUAGES: [
          { name: "ken", path: "/abs/ken.js", extensions: ["KEN", ".Knx", "..kn", " kx "] },
        ],
      }),
    );
    const result = loadUserSettings(dir);
    expect(result.HIGHLIGHT_LANGUAGES).toEqual([
      { name: "ken", path: "/abs/ken.js", extensions: [".ken", ".knx", ".kn", ".kx"] },
    ]);
  });

  it("HIGHLIGHT_LANGUAGES skips unusable extension items", () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({
        HIGHLIGHT_LANGUAGES: [
          { name: "ken", path: "/abs/ken.js", extensions: [".ken", "", ".", "a/b", "a b", 7] },
          { name: "empty", path: "/abs/empty.js", extensions: [""] },
          { name: "bad", path: "/abs/bad.js", extensions: "not-an-array" },
        ],
      }),
    );
    const result = loadUserSettings(dir);
    expect(result.HIGHLIGHT_LANGUAGES).toEqual([
      { name: "ken", path: "/abs/ken.js", extensions: [".ken"] },
      { name: "empty", path: "/abs/empty.js" },
    ]);
  });

  it("HIGHLIGHT_LANGUAGES tolerates a non-array value", () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({ HIGHLIGHT_LANGUAGES: "not-an-array" }),
    );
    const result = loadUserSettings(dir);
    expect(result.HIGHLIGHT_LANGUAGES).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

describe("ReadmeNotFoundError", () => {
  it("str default", () => {
    expect(new ReadmeNotFoundError().message).toBe("README not found");
  });

  it("str with path", () => {
    expect(new ReadmeNotFoundError(".").message).toBe("No README found at .");
  });

  it("str with message", () => {
    expect(new ReadmeNotFoundError("p", "custom msg").message).toBe("custom msg");
  });

  it("path attribute", () => {
    expect(new ReadmeNotFoundError("file.md").path).toBe("file.md");
  });

  it("code attribute", () => {
    expect(new ReadmeNotFoundError().code).toBe("ENOENT");
  });

  it("is Error", () => {
    expect(new ReadmeNotFoundError()).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------

describe("languageForFilename", () => {
  it("maps known extensions", () => {
    expect(languageForFilename("src/main.rs")).toBe("rust");
    expect(languageForFilename("app.py")).toBe("python");
    expect(languageForFilename("Widget.TSX")).toBe("typescript");
    expect(languageForFilename("settings.json")).toBe("json");
  });

  it("maps known basenames", () => {
    expect(languageForFilename("Makefile")).toBe("makefile");
    expect(languageForFilename("build/CMakeLists.txt")).toBe("cmake");
    expect(languageForFilename("Dockerfile")).toBe("dockerfile");
  });

  it("leaves markdown and unknown files alone", () => {
    expect(languageForFilename("README.md")).toBeNull();
    expect(languageForFilename("notes.markdown")).toBeNull();
    expect(languageForFilename("notes.txt")).toBeNull();
    expect(languageForFilename("LICENSE")).toBeNull();
    expect(languageForFilename(null)).toBeNull();
  });

  it("isSourceFile agrees", () => {
    expect(isSourceFile("main.go")).toBe(true);
    expect(isSourceFile("README.md")).toBe(false);
  });
});

describe("wrapSourceText", () => {
  it("wraps a source file in a tagged fence", () => {
    expect(wrapSourceText("print(1)\n", "app.py")).toBe("```python\nprint(1)\n```\n");
  });

  it("adds a trailing newline when the file lacks one", () => {
    expect(wrapSourceText("print(1)", "app.py")).toBe("```python\nprint(1)\n```\n");
  });

  it("wraps an empty file", () => {
    expect(wrapSourceText("", "app.py")).toBe("```python\n```\n");
  });

  it("uses a longer fence than any backtick run in the file", () => {
    const text = 'DOC = """\n```\n"""\n';
    expect(wrapSourceText(text, "app.py")).toBe("````python\n" + text + "````\n");
  });

  it("counts indented backtick runs too", () => {
    const text = "x = 1\n   ````\n";
    expect(wrapSourceText(text, "app.py")).toBe("`````python\n" + text + "`````\n");
  });

  it("passes markdown through unchanged", () => {
    expect(wrapSourceText("# Hi\n", "README.md")).toBe("# Hi\n");
    expect(wrapSourceText("# Hi\n", null)).toBe("# Hi\n");
  });
});

describe("sourceLanguagesFrom", () => {
  it("maps configured extensions to the language name", () => {
    const custom = sourceLanguagesFrom([
      { name: "ken", path: "/tmp/ken.js", extensions: [".ken", ".knx"] },
    ]);
    expect(custom).toEqual({ ".ken": "ken", ".knx": "ken" });
    expect(languageForFilename("lib/thing.ken", custom)).toBe("ken");
    expect(wrapSourceText("x\n", "thing.knx", custom)).toBe("```ken\nx\n```\n");
    expect(isSourceFile("thing.ken")).toBe(false);
  });

  it("matches an extensionless name against a configured extension", () => {
    const custom = sourceLanguagesFrom([
      { name: "makefile", path: "/tmp/make.js", extensions: ["justfile"] },
    ]);
    expect(languageForFilename("Justfile", custom)).toBe("makefile");
  });

  it("overrides the built-in tables", () => {
    const custom = sourceLanguagesFrom([
      { name: "objectivec", path: "/tmp/objc.js", extensions: [".h"] },
    ]);
    expect(languageForFilename("thing.h", custom)).toBe("objectivec");
    expect(languageForFilename("thing.h")).toBe("c");
  });

  it("ignores entries without extensions", () => {
    expect(sourceLanguagesFrom([{ name: "ken", path: "/tmp/ken.js" }])).toEqual({});
    expect(sourceLanguagesFrom()).toEqual({});
  });
});
