import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { exportPage } from "../src/export.js";
import { TextReader } from "../src/readers.js";
import { MockAssetCacheWithDummies } from "./helpers.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "markdraftjs-export-"));
}

function makeAssets(): MockAssetCacheWithDummies {
  return new MockAssetCacheWithDummies(path.join(tmpDir(), "cache"));
}

// ---------------------------------------------------------------------------
// Inline export
// ---------------------------------------------------------------------------

describe("InlineExport", () => {
  it("contains css", () => {
    const reader = new TextReader("text", "README.md");
    const html = exportPage(reader, null, makeAssets());
    expect(html).toContain("/* dummy github-markdown-light.css */");
  });

  it("contains js", () => {
    const reader = new TextReader("text", "README.md");
    const html = exportPage(reader, null, makeAssets());
    expect(html).toContain("/* dummy marked.min.js */");
    expect(html).toContain("/* dummy highlight.min.js */");
    expect(html).toContain("/* dummy katex.min.js */");
    expect(html).toContain("/* dummy marked-alert.umd.js */");
    expect(html).toContain("/* dummy mermaid.min.js */");
  });

  it("contains markdraft js", () => {
    const reader = new TextReader("text", "README.md");
    const html = exportPage(reader, null, makeAssets());
    expect(html).toContain("markdraft-source");
    expect(html).toContain("marked.parse");
  });

  it("inline includes katex css link", () => {
    const reader = new TextReader("text", "README.md");
    const html = exportPage(reader, null, makeAssets());
    expect(html).toContain("katex.min.css");
  });
});

// ---------------------------------------------------------------------------
// CDN export
// ---------------------------------------------------------------------------

describe("CdnExport", () => {
  it("has cdn links", () => {
    const reader = new TextReader("text", "README.md");
    const html = exportPage(reader, null, makeAssets(), { inline: false });
    expect(html).toContain("cdn.jsdelivr.net");
    expect(html).toContain('<script src="https://');
    expect(html).toContain('<link rel="stylesheet" href="https://');
  });
});

// ---------------------------------------------------------------------------
// Markdown embedding
// ---------------------------------------------------------------------------

describe("MarkdownEmbedding", () => {
  it("markdown in source tag", () => {
    const reader = new TextReader("# Hello\n\n**bold**", "README.md");
    const html = exportPage(reader, null, makeAssets());
    expect(html).toContain("# Hello");
    expect(html).toContain("**bold**");
  });

  it("script tag escaped", () => {
    const reader = new TextReader("text</script>more", "README.md");
    const html = exportPage(reader, null, makeAssets());
    expect(html).toContain("<\\/script");
    const sourceSection = html.split("markdraft-source")[1].split("</script")[0];
    expect(sourceSection).not.toContain("</script>more");
  });

  it("script tag case insensitive", () => {
    const reader = new TextReader("text</ScRiPt><script>alert(1)</script>end", "README.md");
    const html = exportPage(reader, null, makeAssets());
    const sourceSection = html.split("markdraft-source")[1].split("</script")[0];
    expect(sourceSection).not.toContain("</ScRiPt>");
  });
});

// ---------------------------------------------------------------------------
// Export metadata
// ---------------------------------------------------------------------------

describe("ExportMetadata", () => {
  it("title", () => {
    const reader = new TextReader("text", "README.md");
    const html = exportPage(reader, null, makeAssets(), { title: "My Page" });
    expect(html).toContain("<title>My Page</title>");
  });

  it("dark theme", () => {
    const reader = new TextReader("text", "README.md");
    const html = exportPage(reader, null, makeAssets(), { theme: "dark" });
    expect(html).toContain('data-color-mode="dark"');
    expect(html).toContain("github-highlight-dark");
  });

  it("light theme default", () => {
    const reader = new TextReader("text", "README.md");
    const html = exportPage(reader, null, makeAssets());
    expect(html).toContain('data-color-mode="light"');
  });
});

// ---------------------------------------------------------------------------
// Export layout
// ---------------------------------------------------------------------------

describe("ExportLayout", () => {
  it("readme layout", () => {
    const reader = new TextReader("text", "README.md");
    const html = exportPage(reader, null, makeAssets());
    expect(html).toContain('id="readme"');
    expect(html).not.toContain("pull-discussion-timeline");
  });

  it("user content layout", () => {
    const reader = new TextReader("text", "README.md");
    const html = exportPage(reader, null, makeAssets(), { userContent: true });
    expect(html).toContain("pull-discussion-timeline");
    expect(html).not.toContain('id="readme"');
  });
});

// ---------------------------------------------------------------------------
// Export emoji
// ---------------------------------------------------------------------------

describe("ExportEmoji", () => {
  it("inline has gemoji data", () => {
    const reader = new TextReader("text", "README.md");
    const html = exportPage(reader, null, makeAssets());
    expect(html).toContain("markdraft-gemoji");
    expect(html).toContain("application/json");
  });

  it("inline has emoji extension", () => {
    const reader = new TextReader("text", "README.md");
    const html = exportPage(reader, null, makeAssets());
    expect(html).toContain("/* dummy marked-emoji.umd.js */");
  });

  it("no inline has emoji cdn", () => {
    const reader = new TextReader("text", "README.md");
    const html = exportPage(reader, null, makeAssets(), { inline: false });
    expect(html).toContain("marked-emoji");
    expect(html).toContain("cdn.jsdelivr.net");
  });
});

// ---------------------------------------------------------------------------
// Export output
// ---------------------------------------------------------------------------

describe("ExportHighlightLanguages", () => {
  function fixture(dir: string, filename: string, content: string): string {
    const p = path.join(dir, filename);
    fs.writeFileSync(p, content);
    return p;
  }

  it("omits highlight-language script when none configured", () => {
    const reader = new TextReader("text", "README.md");
    const html = exportPage(reader, null, makeAssets());
    expect(html).toContain("/* dummy highlight.min.js */");
    expect(html).not.toContain("registerLanguage");
  });

  it("inlines the file and registration call for a `global` entry, after highlight.min.js", () => {
    const dir = tmpDir();
    fixture(dir, "fixture-lang.js", "/* FIXTURE_LANG_BODY */ window.hljsDefineFixture = 1;");
    const reader = new TextReader("text", "README.md");
    const html = exportPage(reader, null, makeAssets(), {
      highlightLanguages: [
        { name: "fixture", path: path.join(dir, "fixture-lang.js"), global: "hljsDefineFixture" },
      ],
    });
    expect(html).toContain("FIXTURE_LANG_BODY");
    expect(html).toContain('hljs.registerLanguage("fixture", window["hljsDefineFixture"]);');

    const highlightIdx = html.indexOf("/* dummy highlight.min.js */");
    const fixtureIdx = html.indexOf("FIXTURE_LANG_BODY");
    const clientJsIdx = html.indexOf("marked.parse"); // inside the appended client_js block
    expect(highlightIdx).toBeGreaterThan(-1);
    expect(fixtureIdx).toBeGreaterThan(highlightIdx);
    expect(clientJsIdx).toBeGreaterThan(fixtureIdx);
  });

  it("inlines only the file (no registration call) for a self-registering entry", () => {
    const dir = tmpDir();
    fixture(dir, "self-reg.js", "/* SELF_REG_BODY */ hljs.registerLanguage('selfreg', {});");
    const reader = new TextReader("text", "README.md");
    const html = exportPage(reader, null, makeAssets(), {
      highlightLanguages: [{ name: "selfreg", path: path.join(dir, "self-reg.js") }],
    });
    expect(html).toContain("SELF_REG_BODY");
    // No *additional* markdraft-emitted registration call beyond the file's own.
    expect(html).not.toContain('hljs.registerLanguage("selfreg"');
  });

  it("also inlines the highlight-language file in CDN (--no-inline) mode", () => {
    const dir = tmpDir();
    fixture(dir, "fixture-lang.js", "/* FIXTURE_LANG_CDN_BODY */");
    const reader = new TextReader("text", "README.md");
    const html = exportPage(reader, null, makeAssets(), {
      inline: false,
      highlightLanguages: [{ name: "fixture", path: path.join(dir, "fixture-lang.js") }],
    });
    expect(html).toContain("cdn.jsdelivr.net");
    expect(html).toContain("FIXTURE_LANG_CDN_BODY");
  });

  it("skips a configured entry whose file is missing, without throwing", () => {
    const reader = new TextReader("text", "README.md");
    expect(() =>
      exportPage(reader, null, makeAssets(), {
        quiet: true,
        highlightLanguages: [{ name: "ghost", path: "/no/such/file/ghost.js" }],
      }),
    ).not.toThrow();
  });
});

describe("ExportOutput", () => {
  it("to file", () => {
    const reader = new TextReader("# Test", "README.md");
    const outPath = path.join(tmpDir(), "out.html");
    exportPage(reader, null, makeAssets(), { outFile: outPath });
    const html = fs.readFileSync(outPath, "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("returns string", () => {
    const reader = new TextReader("# Test", "README.md");
    const html = exportPage(reader, null, makeAssets());
    expect(typeof html).toBe("string");
    expect(html).toContain("<!DOCTYPE html>");
  });
});

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------

describe("SourceFileExport", () => {
  it("embeds a source file as a fenced code block", () => {
    const reader = new TextReader("fn main() {}\n", "main.rs");
    const html = exportPage(reader, null, makeAssets());
    expect(html).toContain("```rust\nfn main() {}\n```");
    expect(html).toContain("main.rs - Markdraft");
  });

  it("uses a configured HIGHLIGHT_LANGUAGES extension", () => {
    const reader = new TextReader("(hello)\n", "hello.ken");
    const html = exportPage(reader, null, makeAssets(), {
      highlightLanguages: [{ name: "ken", path: "/nonexistent/ken.js", extensions: [".ken"] }],
      quiet: true,
    });
    expect(html).toContain("```ken\n(hello)\n```");
  });

  it("leaves markdown unwrapped", () => {
    const reader = new TextReader("# Hi\n", "README.md");
    const html = exportPage(reader, null, makeAssets());
    expect(html).toContain('<script id="markdraft-source" type="text/markdown"># Hi\n</script>');
  });
});
