import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";

import { AssetCache } from "../src/assets.js";
import { TextReader } from "../src/readers.js";
import { PreviewServer } from "../src/server.js";
import { createTextServer, createDirServer, createServer } from "./helpers.js";

const servers: PreviewServer[] = [];

afterEach(async () => {
  for (const s of servers) {
    await s.close();
  }
  servers.length = 0;
});

async function ts(text: string, opts?: Record<string, unknown>) {
  const { client, server } = await createTextServer(text, opts as never);
  servers.push(server);
  return client;
}

async function ds(files: Record<string, string | Buffer>, opts?: Record<string, unknown>) {
  const { client, server } = await createDirServer(files, opts as never);
  servers.push(server);
  return client;
}

// ---------------------------------------------------------------------------
// Page routes
// ---------------------------------------------------------------------------

describe("PageRoutes", () => {
  it("root serves html shell", async () => {
    const client = await ts("# Hello");
    const resp = await client.get("/");
    expect(resp.statusCode).toBe(200);
    expect(resp.text()).toContain("<!DOCTYPE html>");
    expect(resp.text()).toContain("markdraft-content");
  });

  it("page has data attributes", async () => {
    const client = await ts("# Hello");
    const html = (await client.get("/")).text();
    expect(html).toContain("data-content-url=");
    expect(html).toContain("data-color-mode=");
  });

  it("page includes script tags", async () => {
    const client = await ts("text");
    const html = (await client.get("/")).text();
    expect(html).toContain("marked.min.js");
    expect(html).toContain("highlight.min.js");
    expect(html).toContain("mermaid.min.js");
    expect(html).toContain("markdraft.js");
  });

  it("page includes css links", async () => {
    const client = await ts("text");
    const html = (await client.get("/")).text();
    expect(html).toContain("github-markdown-light.css");
    expect(html).toContain("katex.min.css");
    expect(html).toContain("markdraft.css");
  });
});

// ---------------------------------------------------------------------------
// Page title
// ---------------------------------------------------------------------------

describe("PageTitle", () => {
  it("title from filename", async () => {
    const client = await ts("# Hi", { display_filename: "README.md" });
    expect((await client.get("/")).text()).toContain("README.md - Markdraft");
  });

  it("title override", async () => {
    const client = await ts("# Hi", { title: "Custom Title" });
    expect((await client.get("/")).text()).toContain("Custom Title");
  });

  it("title no filename", async () => {
    const client = await ts("# Hi", { display_filename: null });
    const html = (await client.get("/")).text();
    expect(html).toContain("<title>Markdraft</title>");
  });
});

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

describe("Theme", () => {
  it("theme light", async () => {
    const client = await ts("text", { theme: "light" });
    const html = (await client.get("/")).text();
    expect(html).toContain('data-color-mode="light"');
    expect(html).toContain("github-highlight.min.css");
  });

  it("theme dark", async () => {
    const client = await ts("text", { theme: "dark" });
    const html = (await client.get("/")).text();
    expect(html).toContain('data-color-mode="dark"');
    expect(html).toContain("github-highlight-dark.min.css");
  });
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

describe("Layout", () => {
  it("readme layout", async () => {
    const client = await ts("text");
    const html = (await client.get("/")).text();
    expect(html).toContain('id="readme"');
    expect(html).not.toContain("pull-discussion-timeline");
  });

  it("user content layout", async () => {
    const client = await ts("text", { user_content: true });
    const html = (await client.get("/")).text();
    expect(html).toContain("pull-discussion-timeline");
    expect(html).not.toContain('id="readme"');
  });

  it("user content with title", async () => {
    const client = await ts("text", { user_content: true, title: "Issue #1" });
    const html = (await client.get("/")).text();
    expect(html).toContain("timeline-comment-header");
    expect(html).toContain("Issue #1");
  });
});

// ---------------------------------------------------------------------------
// Autorefresh
// ---------------------------------------------------------------------------

describe("Autorefresh", () => {
  it("autorefresh url present", async () => {
    const client = await ts("text", { autorefresh: true });
    expect((await client.get("/")).text()).toContain('data-refresh-url="/__/api/refresh"');
  });

  it("autorefresh url empty", async () => {
    const client = await ts("text", { autorefresh: false });
    expect((await client.get("/")).text()).toContain('data-refresh-url=""');
  });
});

// ---------------------------------------------------------------------------
// API content
// ---------------------------------------------------------------------------

describe("ApiContent", () => {
  it("returns json", async () => {
    const client = await ts("# Hello");
    const resp = await client.get("/__/api/content");
    expect(resp.statusCode).toBe(200);
    expect(resp.headers["content-type"]).toContain("application/json");
  });

  it("returns raw markdown", async () => {
    const client = await ts("# Hello\n\n**bold**");
    const data = (await client.get("/__/api/content")).json() as Record<string, unknown>;
    expect(data.text).toBe("# Hello\n\n**bold**");
  });

  it("returns filename", async () => {
    const client = await ts("text", { display_filename: "README.md" });
    const data = (await client.get("/__/api/content")).json() as Record<string, unknown>;
    expect(data.filename).toBe("README.md");
  });

  it("subpath", async () => {
    const client = await ds({ "README.md": "root", "other.md": "# Other" });
    const data = (await client.get("/__/api/content/other.md")).json() as Record<string, unknown>;
    expect(data.text).toContain("# Other");
  });

  it("missing file 404", async () => {
    const client = await ts("text");
    expect((await client.get("/__/api/content/nope.md")).statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// API refresh
// ---------------------------------------------------------------------------

describe("ApiRefresh", () => {
  it("refresh disabled returns 404", async () => {
    const client = await ts("text", { autorefresh: false });
    expect((await client.get("/__/api/refresh")).statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

describe("StaticFiles", () => {
  it("serve bundled css", async () => {
    const client = await ts("text");
    const resp = await client.get("/__/static/markdraft.css");
    expect(resp.statusCode).toBe(200);
    expect(resp.text()).toContain(".preview-page");
  });

  it("serve bundled js", async () => {
    const client = await ts("text");
    const resp = await client.get("/__/static/markdraft.js");
    expect(resp.statusCode).toBe(200);
    expect(resp.text()).toContain("marked");
  });

  it("serve favicon", async () => {
    const client = await ts("text");
    expect((await client.get("/__/static/favicon.ico")).statusCode).toBe(200);
  });

  it("serve cached asset", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "markdraftjs-cache-"));
    fs.writeFileSync(path.join(tmpDir, "test-asset.js"), "// cached asset");
    const assets = new AssetCache(tmpDir);
    const reader = new TextReader("hi", "README.md");
    const { client, server } = await createServer(reader, assets);
    servers.push(server);
    const resp = await client.get("/__/static/test-asset.js");
    expect(resp.statusCode).toBe(200);
    expect(resp.text()).toContain("// cached asset");
  });

  it("missing static 404", async () => {
    const client = await ts("text");
    expect((await client.get("/__/static/nope.xyz")).statusCode).toBe(404);
  });

  it("path traversal blocked", async () => {
    const client = await ts("text");
    const resp = await client.get("/__/static/../../../etc/passwd");
    expect(resp.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe("Routing", () => {
  it("root serves readme", async () => {
    const client = await ds({ "README.md": "# Root" });
    const resp = await client.get("/");
    expect(resp.statusCode).toBe(200);
    expect(resp.text()).toContain("<!DOCTYPE html>");
  });

  it("explicit file", async () => {
    const client = await ds({ "README.md": "root", "other.md": "# Other" });
    expect((await client.get("/other.md")).statusCode).toBe(200);
  });

  it("missing file 404", async () => {
    const client = await ds({ "README.md": "hi" });
    expect((await client.get("/nope.md")).statusCode).toBe(404);
  });

  it("binary file raw", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(50),
    ]);
    const client = await ds({ "README.md": "hi", "img.png": png });
    const resp = await client.get("/img.png");
    expect(resp.statusCode).toBe(200);
    expect(resp.data.subarray(0, 4).toString()).toContain("PNG");
    expect(resp.headers["content-type"]).toContain("image/png");
  });
});

// ---------------------------------------------------------------------------
// Directory listing
// ---------------------------------------------------------------------------

describe("DirectoryListing", () => {
  it("directory without readme returns 200", async () => {
    const client = await ds({ "sub/guide.md": "# Guide" });
    const resp = await client.get("/sub/");
    expect(resp.statusCode).toBe(200);
    expect(resp.text()).toContain("<!DOCTYPE html>");
  });

  it("listing api returns entries", async () => {
    const client = await ds({
      "docs/guide.md": "# Guide",
      "docs/api.md": "# API",
      "docs/sub/README.md": "# Sub",
    });
    const resp = await client.get("/__/api/content/docs/");
    expect(resp.statusCode).toBe(200);
    const data = resp.json() as Record<string, unknown>;
    expect(data.type).toBe("listing");
    const names = (data.entries as Array<{ name: string }>).map((e) => e.name);
    expect(names).toContain("guide.md");
    expect(names).toContain("api.md");
    expect(names).toContain("sub");
  });

  it("file response includes siblings", async () => {
    const client = await ds({
      "README.md": "# Root",
      "guide.md": "# Guide",
      "other.md": "# Other",
    });
    const data = (await client.get("/__/api/content")).json() as Record<string, unknown>;
    expect(data.type).toBe("file");
    expect(data).toHaveProperty("siblings");
    const names = (data.siblings as Array<{ name: string }>).map((e) => e.name);
    expect(names).toContain("guide.md");
    expect(names).toContain("other.md");
  });
});

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------

describe("SourceFiles", () => {
  it("content api wraps a source file in a fence", async () => {
    const client = await ds({
      "README.md": "# Root",
      "main.rs": "fn main() {}\n",
    });
    const data = (await client.get("/__/api/content/main.rs")).json() as Record<string, unknown>;
    expect(data.type).toBe("file");
    expect(data.text).toBe("```rust\nfn main() {}\n```\n");
    expect(data.filename).toBe("main.rs");
  });

  it("content api leaves markdown unwrapped", async () => {
    const client = await ds({ "README.md": "# Root\n" });
    const data = (await client.get("/__/api/content")).json() as Record<string, unknown>;
    expect(data.text).toBe("# Root\n");
  });

  it("source file serves the html shell", async () => {
    const client = await ds({ "README.md": "# Root", "app.py": "print(1)\n" });
    const resp = await client.get("/app.py");
    expect(resp.statusCode).toBe(200);
    expect(resp.headers["content-type"]).toContain("text/html");
    expect(resp.text()).toContain("app.py - Markdraft");
  });

  it("source file with a non-text mimetype is rendered, not served raw", async () => {
    const client = await ds({ "README.md": "# Root", "app.js": "let x = 1;\n" });
    const resp = await client.get("/app.js");
    expect(resp.statusCode).toBe(200);
    expect(resp.headers["content-type"]).toContain("text/html");
    const data = (await client.get("/__/api/content/app.js")).json() as Record<string, unknown>;
    expect(data.text).toBe("```javascript\nlet x = 1;\n```\n");
  });

  it("wraps a configured HIGHLIGHT_LANGUAGES extension", async () => {
    const client = await ds(
      { "README.md": "# Root", "hello.ken": "(hello)\n" },
      {
        highlight_languages: [{ name: "ken", path: "/nonexistent/ken.js", extensions: [".ken"] }],
      },
    );
    const data = (await client.get("/__/api/content/hello.ken")).json() as Record<string, unknown>;
    expect(data.text).toBe("```ken\n(hello)\n```\n");

    const root = (await client.get("/__/api/content")).json() as Record<string, unknown>;
    const siblings = (root.siblings as Array<{ name: string }>).map((e) => e.name);
    expect(siblings).toContain("hello.ken");
  });

  it("an unconfigured extension still renders as markdown", async () => {
    const client = await ds({ "README.md": "# Root", "hello.ken": "(hello)\n" });
    const data = (await client.get("/__/api/content/hello.ken")).json() as Record<string, unknown>;
    expect(data.text).toBe("(hello)\n");
  });

  it("source files appear in listings and sibling nav", async () => {
    const client = await ds({
      "README.md": "# Root",
      "main.rs": "fn main() {}",
      "docs/guide.md": "# Guide",
      "docs/setup.sh": "echo hi",
    });
    const file = (await client.get("/__/api/content")).json() as Record<string, unknown>;
    const siblings = (file.siblings as Array<{ name: string }>).map((e) => e.name);
    expect(siblings).toContain("main.rs");

    const listing = (await client.get("/__/api/content/docs/")).json() as Record<string, unknown>;
    const names = (listing.entries as Array<{ name: string }>).map((e) => e.name);
    expect(names).toContain("setup.sh");
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("ErrorHandling", () => {
  it("malformed URL returns 400", async () => {
    const { server } = await createTextServer("text");
    servers.push(server);
    const addr = server.address()!;

    // Send a raw HTTP request with a malformed URL that can't be parsed
    const resp = await new Promise<{ statusCode: number }>((resolve) => {
      const req = http.request(
        {
          hostname: addr.host,
          port: addr.port,
          // Absolute URI with no scheme trips URL parser in some cases;
          // use a path that contains characters illegal in a URL authority
          path: "//[::invalid",
          method: "GET",
        },
        (res) => {
          res.resume();
          resolve({ statusCode: res.statusCode ?? 0 });
        },
      );
      req.end();
    });
    expect([400, 404]).toContain(resp.statusCode);
  });

  it("request handler error returns 500 not crash", async () => {
    // Create a server with a reader that throws an unexpected error
    const reader = new TextReader("text", "README.md");
    const original = reader.read.bind(reader);
    reader.read = (subpath: string | null) => {
      if (subpath === "crash") throw new Error("unexpected boom");
      return original(subpath);
    };
    const { client, server: srv } = await createServer(reader);
    servers.push(srv);

    // The crash path should return 500, not kill the server
    const resp = await client.get("/crash");
    expect(resp.statusCode).toBe(500);

    // Server should still be alive for subsequent requests
    const ok = await client.get("/");
    expect(ok.statusCode).toBe(200);
  });

  it("server closes cleanly after SSE connection", async () => {
    const { server } = await createTextServer("text", { autorefresh: true });
    servers.push(server);
    const addr = server.address()!;

    // Open an SSE connection
    const controller = new AbortController();
    const ssePromise = fetch(`http://${addr.host}:${addr.port}/__/api/refresh`, {
      signal: controller.signal,
    }).catch(() => {});

    // Give the SSE connection time to establish
    await new Promise((r) => setTimeout(r, 100));

    // Server should close without hanging (test timeout will catch a hang)
    controller.abort();
    await ssePromise;

    // Remove from tracked servers since we're closing manually
    servers.splice(servers.indexOf(server), 1);
    await server.close();
  });
});

// ---------------------------------------------------------------------------
// Highlight languages
// ---------------------------------------------------------------------------

describe("HighlightLanguages", () => {
  function writeFixture(dir: string, filename: string, content: string): string {
    const p = path.join(dir, filename);
    fs.writeFileSync(p, content);
    return p;
  }

  it("omits highlight-language scripts when none configured", async () => {
    const client = await ts("text");
    const resp = await client.get("/");
    expect(resp.text()).not.toContain("registerLanguage");
    expect(resp.text()).not.toContain("/__/highlight-lang/");
  });

  it("emits a src script and registration call for a `global` entry, after highlight.min.js", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "markdraftjs-hl-"));
    writeFixture(dir, "fixture-lang.js", "window.hljsDefineFixture = function () {};");
    const client = await ts("text", {
      highlight_languages: [
        { name: "fixture", path: path.join(dir, "fixture-lang.js"), global: "hljsDefineFixture" },
      ],
    });
    const resp = await client.get("/");
    const html = resp.text();
    const src = `/__/highlight-lang/${encodeURIComponent("fixture")}`;
    expect(html).toContain(`<script src="${src}"></script>`);
    expect(html).toContain('hljs.registerLanguage("fixture", window["hljsDefineFixture"]);');

    const highlightIdx = html.indexOf("highlight.min.js");
    const fixtureIdx = html.indexOf(src);
    const markdraftIdx = html.lastIndexOf("markdraft.js");
    expect(highlightIdx).toBeGreaterThan(-1);
    expect(fixtureIdx).toBeGreaterThan(highlightIdx);
    expect(markdraftIdx).toBeGreaterThan(fixtureIdx);
  });

  it("emits only a src script (no registration call) for a self-registering entry", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "markdraftjs-hl-"));
    writeFixture(dir, "self-reg.js", "hljs.registerLanguage('selfreg', function () {});");
    const client = await ts("text", {
      highlight_languages: [{ name: "selfreg", path: path.join(dir, "self-reg.js") }],
    });
    const resp = await client.get("/");
    const html = resp.text();
    expect(html).toContain(`<script src="/__/highlight-lang/selfreg"></script>`);
    expect(html).not.toContain('registerLanguage("selfreg"');
  });

  it("serves the configured file's contents at the highlight-lang route", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "markdraftjs-hl-"));
    writeFixture(dir, "fixture-lang.js", "/* fixture body */");
    const client = await ts("text", {
      highlight_languages: [{ name: "fixture", path: path.join(dir, "fixture-lang.js") }],
    });
    const resp = await client.get("/__/highlight-lang/fixture");
    expect(resp.statusCode).toBe(200);
    expect(resp.text()).toContain("/* fixture body */");
  });

  it("404s the highlight-lang route for a name that isn't configured", async () => {
    const client = await ts("text");
    const resp = await client.get("/__/highlight-lang/nope");
    expect(resp.statusCode).toBe(404);
  });

  it("skips a configured entry whose file is missing, without crashing the page", async () => {
    const client = await ts("text", {
      highlight_languages: [{ name: "ghost", path: "/no/such/file/ghost.js" }],
    });
    const resp = await client.get("/");
    expect(resp.statusCode).toBe(200);
    expect(resp.text()).not.toContain("highlight-lang/ghost");
  });
});
