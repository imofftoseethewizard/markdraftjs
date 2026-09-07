import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AssetCache } from "../src/assets.js";
import { TextReader, DirectoryReader } from "../src/readers.js";
import type { ReadmeReader } from "../src/readers.js";
import { PreviewServer } from "../src/server.js";
import type { ServerConfig } from "../src/types.js";

export class MockAssetCache extends AssetCache {
  override async ensureCached(): Promise<void> {
    fs.mkdirSync(this.cachePath, { recursive: true });
  }
}

export class MockAssetCacheWithDummies extends AssetCache {
  constructor(cachePath: string) {
    super(cachePath);
    fs.mkdirSync(cachePath, { recursive: true });
    const dummies = [
      "github-markdown-light.css",
      "github-markdown-dark.css",
      "github-highlight.min.css",
      "github-highlight-dark.min.css",
      "marked.min.js",
      "marked-alert.umd.js",
      "highlight.min.js",
      "katex.min.js",
      "marked-katex-extension.umd.js",
      "mermaid.min.js",
      "leaflet.js",
      "leaflet.css",
      "three.min.js",
      "marked-emoji.umd.js",
      "gemoji.json",
    ];
    for (const name of dummies) {
      fs.writeFileSync(path.join(cachePath, name), `/* dummy ${name} */`);
    }
  }
}

export interface TestResponse {
  statusCode: number;
  data: Buffer;
  headers: Record<string, string>;
  text(): string;
  json(): unknown;
}

export class TestClient {
  readonly baseUrl: string;

  constructor(host: string, port: number) {
    this.baseUrl = `http://${host}:${port}`;
  }

  async get(urlPath: string): Promise<TestResponse> {
    const res = await fetch(this.baseUrl + urlPath, { redirect: "follow" });
    const buf = Buffer.from(await res.arrayBuffer());
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    return {
      statusCode: res.status,
      data: buf,
      headers,
      text: () => buf.toString("utf-8"),
      json: () => JSON.parse(buf.toString("utf-8")),
    };
  }
}

const DEFAULT_CONFIG: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  autorefresh: true,
  quiet: true,
  theme: "light",
  title: null,
  user_content: false,
  wide: false,
  url_prefix: "/__",
  highlight_languages: [],
};

export async function createServer(
  reader: ReadmeReader,
  assets?: AssetCache,
  configOverrides?: Partial<ServerConfig>,
): Promise<{ client: TestClient; server: PreviewServer }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "markdraftjs-test-"));
  const cache = assets ?? new MockAssetCache(path.join(tmpDir, "cache"));
  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  const server = new PreviewServer(reader, cache, config);
  await server.listen();
  const addr = server.address()!;
  const client = new TestClient(addr.host, addr.port);
  return { client, server };
}

export async function createTextServer(
  text: string,
  opts?: Partial<ServerConfig> & { display_filename?: string | null },
): Promise<{ client: TestClient; server: PreviewServer }> {
  const displayFilename =
    opts && "display_filename" in opts ? (opts.display_filename ?? null) : "README.md";
  const { display_filename: _df, ...configOverrides } = opts ?? {};
  const reader = new TextReader(text, displayFilename);
  return createServer(reader, undefined, configOverrides as Partial<ServerConfig>);
}

export async function createDirServer(
  files: Record<string, string | Buffer>,
  configOverrides?: Partial<ServerConfig>,
): Promise<{ client: TestClient; server: PreviewServer; tmpDir: string }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "markdraftjs-content-"));
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(tmpDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (Buffer.isBuffer(content)) {
      fs.writeFileSync(filePath, content);
    } else {
      fs.writeFileSync(filePath, content, "utf-8");
    }
  }
  // Mirrors api.ts: the same configured languages reach the reader (which
  // uses them to recognize source files) and the server config.
  const reader = new DirectoryReader(tmpDir, false, configOverrides?.highlight_languages ?? []);
  const { client, server } = await createServer(reader, undefined, configOverrides);
  return { client, server, tmpDir };
}

export function inputPath(...parts: string[]): string {
  return path.join(import.meta.dirname, "input", ...parts);
}
