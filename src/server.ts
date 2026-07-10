import http from "node:http";
import { setMaxListeners } from "node:events";
import fs from "node:fs";
import path from "node:path";
import posixpath from "node:path/posix";
import { fileURLToPath } from "node:url";

import { AssetCache } from "./assets.js";
import { KATEX_CSS_URL } from "./config.js";
import { ReadmeNotFoundError } from "./errors.js";
import { registrationScript, resolveHighlightLanguages } from "./highlight.js";
import type { ReadmeReader } from "./readers.js";
import type { ServerConfig } from "./types.js";
import { FileWatcher } from "./watcher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME_MAP: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "application/x-font-woff",
  ".woff2": "font/woff2",
  ".ttf": "application/octet-stream",
  ".eot": "application/vnd.ms-fontobject",
};

function guessContentType(filepath: string): string {
  const ext = path.extname(filepath).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function resolveStaticDir(): string {
  const candidate = path.join(__dirname, "static");
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    return candidate;
  }
  // Fallback: check relative to project root (for dev with tsx)
  const devCandidate = path.resolve(__dirname, "..", "static");
  if (fs.existsSync(devCandidate) && fs.statSync(devCandidate).isDirectory()) {
    return devCandidate;
  }
  throw new Error("Cannot find static directory");
}

const STATIC_DIR = resolveStaticDir();

// Page body variants for template.html
const README_BODY = `\
                  <div id="readme" class="Box md Box--responsive">
                    <div id="markdraft-nav" class="Box-header d-flex border-bottom-0 flex-items-center color-bg-default rounded-top-2">
                    </div>
                    <div class="Box-body px-5 pb-5">
                      <article id="markdraft-content" class="markdown-body entry-content container-lg">
                      </article>
                    </div>
                  </div>`;

const USER_CONTENT_BODY = `\
                  <div class="pull-discussion-timeline">
                    <div class="ml-0 pl-0 ml-md-6 pl-md-3">
                      <div class="TimelineItem pt-0">
                        <div class="timeline-comment-group TimelineItem-body my-0">
                          <div class="ml-n3 timeline-comment unminimized-comment comment previewable-edit editable-comment timeline-comment--caret reorderable-task-lists">
                            {comment_header}
                            <div class="edit-comment-hide">
                              <table class="d-block">
                                <tbody class="d-block">
                                  <tr class="d-block">
                                    <td class="d-block comment-body markdown-body" id="markdraft-content">
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>`;

const COMMENT_HEADER = `\
<div class="timeline-comment-header clearfix d-block d-sm-flex">
                                <h3 class="timeline-comment-header-text f5 text-normal">
                                  <strong class="css-truncate expandable"><span class="author text-inherit css-truncate-target">{title}</span></strong>
                                </h3>
                              </div>`;

const AUTO_THEME_SCRIPT = `\
<script>
  (function() {
    function applyTheme(dark) {
      var t = dark ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', t);
      document.documentElement.setAttribute('data-color-mode', t);
      var mc = document.getElementById('markdraft-markdown-css');
      var mca = document.getElementById('markdraft-markdown-css-alt');
      var hc = document.getElementById('markdraft-highlight-css');
      var hca = document.getElementById('markdraft-highlight-css-alt');
      if (dark) {
        if (mc) mc.disabled = true;
        if (mca) mca.disabled = false;
        if (hc) hc.disabled = true;
        if (hca) hca.disabled = false;
      } else {
        if (mc) mc.disabled = false;
        if (mca) mca.disabled = true;
        if (hc) hc.disabled = false;
        if (hca) hca.disabled = true;
      }
      var app = document.getElementById('markdraft-app');
      if (app) app.setAttribute('data-theme', t);
    }
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    applyTheme(mq.matches);
    mq.addEventListener('change', function(e) { applyTheme(e.matches); });
  })();
  </script>`;

function templateReplace(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

export class PreviewServer {
  readonly reader: ReadmeReader;
  readonly assets: AssetCache;
  readonly config: ServerConfig;
  readonly abortController: AbortController;
  private server: http.Server;
  private template: string | null = null;

  constructor(reader: ReadmeReader, assets: AssetCache, config: ServerConfig) {
    this.reader = reader;
    this.assets = assets;
    this.config = config;
    this.abortController = new AbortController();
    setMaxListeners(0, this.abortController.signal);
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  private getTemplate(): string {
    if (this.template === null) {
      const templatePath = path.join(STATIC_DIR, "template.html");
      this.template = fs.readFileSync(templatePath, "utf-8");
    }
    return this.template;
  }

  buildPage(subpath: string | null = null): string {
    const cfg = this.config;
    const filename = this.reader.filenameFor(subpath) ?? "";
    const title = cfg.title ?? filename;
    const displayTitle = escapeHtml(title || filename);
    const pageTitle = cfg.title
      ? escapeHtml(cfg.title)
      : filename
        ? escapeHtml(filename) + " - Markdraft"
        : "Markdraft";

    const theme = cfg.theme ?? "light";
    const isAuto = theme === "auto";
    const dataColorMode = isAuto ? "light" : theme === "dark" ? "dark" : "light";
    const markdownCss = theme === "dark" ? "github-markdown-dark.css" : "github-markdown-light.css";
    const highlightCss =
      theme === "dark" ? "github-highlight-dark.min.css" : "github-highlight.min.css";

    const staticUrl = cfg.url_prefix + "/static";
    let contentPath = cfg.url_prefix + "/api/content";
    if (subpath) contentPath += "/" + subpath;

    let refreshUrl = "";
    if (cfg.autorefresh) {
      refreshUrl = cfg.url_prefix + "/api/refresh";
      if (subpath) refreshUrl += "/" + subpath;
    }

    let pageBody: string;
    if (cfg.user_content) {
      let commentHeader = "";
      if (displayTitle) {
        commentHeader = COMMENT_HEADER.replace("{title}", displayTitle);
      }
      pageBody = USER_CONTENT_BODY.replace("{comment_header}", commentHeader);
    } else {
      pageBody = README_BODY;
    }

    let autoCss = "";
    let autoThemeScript = "";
    if (isAuto) {
      autoCss =
        `  <link rel="stylesheet" href="${staticUrl}/github-markdown-dark.css"` +
        ` id="markdraft-markdown-css-alt" disabled />\n` +
        `  <link rel="stylesheet" href="${staticUrl}/github-highlight-dark.min.css"` +
        ` id="markdraft-highlight-css-alt" disabled />`;
      autoThemeScript = AUTO_THEME_SCRIPT;
    }

    return templateReplace(this.getTemplate(), {
      title: pageTitle,
      favicon_url: staticUrl + "/favicon.ico",
      static_url: staticUrl,
      markdown_css_url: staticUrl + "/" + markdownCss,
      highlight_css_url: staticUrl + "/" + highlightCss,
      katex_css_url: KATEX_CSS_URL,
      auto_css: autoCss,
      auto_theme_script: autoThemeScript,
      content_url: contentPath,
      refresh_url: refreshUrl,
      data_color_mode: dataColorMode,
      page_body: pageBody,
      highlight_language_scripts: this.buildHighlightLanguageScripts(),
    });
  }

  // Custom `HIGHLIGHT_LANGUAGES` entries: one `<script src>` per configured
  // language (served via `handleHighlightLanguage` below, never an arbitrary
  // client-supplied path), plus a `hljs.registerLanguage(...)` call for
  // entries with a `global` (self-registering files need only the `src`
  // load). Emitted into `{highlight_language_scripts}`, which the template
  // places after `highlight.min.js` and before `markdraft.js`, so
  // `hljs.getLanguage(name)` is truthy by the time the renderer runs.
  private buildHighlightLanguageScripts(): string {
    const cfg = this.config;
    const resolved = resolveHighlightLanguages(cfg.highlight_languages, cfg.quiet);
    const parts: string[] = [];
    for (const entry of resolved) {
      const url = `${cfg.url_prefix}/highlight-lang/${encodeURIComponent(entry.name)}`;
      parts.push(`  <script src="${url}"></script>`);
      const registration = registrationScript(entry);
      if (registration) parts.push(registration);
    }
    return parts.join("\n");
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.on("error", reject);
      this.server.listen(this.config.port, this.config.host, () => resolve());
    });
  }

  address(): { host: string; port: number } | null {
    const addr = this.server.address();
    if (addr === null || typeof addr === "string") return null;
    return { host: addr.address, port: addr.port };
  }

  close(): Promise<void> {
    this.abortController.abort();
    return new Promise((resolve) => {
      this.server.close(() => resolve());
      // Force-close keep-alive connections that the browser may reuse
      // to reconnect SSE after abort.
      this.server.closeAllConnections();
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    let urlPath: string;
    try {
      urlPath = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;
    } catch {
      this.sendError(res, 400);
      return;
    }

    try {
      const urlPrefix = this.config.url_prefix;

      if (urlPath.startsWith(urlPrefix + "/api/content")) {
        this.handleApiContent(urlPath, urlPrefix, res);
      } else if (urlPath.startsWith(urlPrefix + "/api/refresh")) {
        this.handleApiRefresh(urlPath, urlPrefix, req, res);
      } else if (urlPath.startsWith(urlPrefix + "/static/")) {
        this.handleStatic(urlPath, urlPrefix, res);
      } else if (urlPath.startsWith(urlPrefix + "/highlight-lang/")) {
        this.handleHighlightLanguage(urlPath, urlPrefix, res);
      } else {
        this.handlePage(urlPath, res);
      }
    } catch (e) {
      if (!res.headersSent) {
        this.sendError(res, 500);
      }
      if (!this.config.quiet) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(` * Internal error: ${msg}\n`);
      }
      return;
    }

    if (!this.config.quiet) {
      const method = req.method ?? "GET";
      process.stderr.write(` * ${method} ${urlPath} ${res.statusCode}\n`);
    }
  }

  private handlePage(urlPath: string, res: http.ServerResponse): void {
    const subpath = urlPath.replace(/^\//, "") || null;

    let normalized: string | null;
    try {
      normalized = this.reader.normalizeSubpath(subpath);
    } catch (e) {
      if (e instanceof ReadmeNotFoundError) {
        this.sendError(res, 404);
        return;
      }
      throw e;
    }

    if (normalized !== subpath) {
      this.sendRedirect(res, "/" + (normalized ?? ""));
      return;
    }

    // Binary files
    if (this.reader.isBinary(subpath)) {
      try {
        const raw = this.reader.read(subpath);
        const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        const mimetype = this.reader.mimetypeFor(subpath) ?? "application/octet-stream";
        this.sendBytes(res, 200, data, mimetype);
      } catch (e) {
        if (e instanceof ReadmeNotFoundError) {
          this.sendError(res, 404);
          return;
        }
        throw e;
      }
      return;
    }

    // Try to read the file; fall back to directory listing
    try {
      this.reader.read(subpath);
    } catch (e) {
      if (e instanceof ReadmeNotFoundError) {
        if (this.reader.isDirectory(subpath)) {
          const page = this.buildPage(subpath);
          this.sendText(res, 200, page, "text/html; charset=utf-8");
          return;
        }
        this.sendError(res, 404);
        return;
      }
      throw e;
    }

    const page = this.buildPage(subpath);
    this.sendText(res, 200, page, "text/html; charset=utf-8");
  }

  private handleApiContent(urlPath: string, urlPrefix: string, res: http.ServerResponse): void {
    const subpath = this.extractSubpath(urlPath, urlPrefix + "/api/content");
    let text: string | Buffer;
    let filename: string;
    try {
      text = this.reader.read(subpath);
      filename = this.reader.filenameFor(subpath) ?? "";
    } catch (e) {
      if (e instanceof ReadmeNotFoundError) {
        if (this.reader.isDirectory(subpath)) {
          const entries = this.reader.listDirectory(subpath);
          let listingPath = (subpath ?? "").replace(/\/+$/, "");
          if (listingPath) listingPath += "/";
          const body = JSON.stringify({
            type: "listing",
            path: listingPath,
            entries,
          });
          this.sendText(res, 200, body, "application/json; charset=utf-8");
          return;
        }
        this.sendError(res, 404);
        return;
      }
      throw e;
    }

    // Navigation data
    let navDir: string | null;
    let navPath: string;
    if (this.reader.isDirectory(subpath)) {
      navDir = subpath;
      const np = (subpath ?? "").replace(/\/+$/, "");
      navPath = np ? np + "/" : "";
    } else if (subpath) {
      const parent = posixpath.dirname(subpath.replace(/\/+$/, ""));
      navDir = parent || null;
      navPath = parent ? parent + "/" : "";
    } else {
      navDir = null;
      navPath = "";
    }
    const siblings = this.reader.listDirectory(navDir);

    const textStr = typeof text === "string" ? text : text.toString("utf-8");
    const body = JSON.stringify({
      type: "file",
      text: textStr,
      filename,
      path: subpath ?? "",
      parent: navPath,
      siblings,
    });
    this.sendText(res, 200, body, "application/json; charset=utf-8");
  }

  private handleApiRefresh(
    urlPath: string,
    urlPrefix: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    if (!this.config.autorefresh) {
      this.sendError(res, 404);
      return;
    }
    const subpath = this.extractSubpath(urlPath, urlPrefix + "/api/refresh");

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const watcher = new FileWatcher(this.reader, subpath);
    const watchAbort = new AbortController();

    req.on("close", () => watchAbort.abort());
    this.abortController.signal.addEventListener("abort", () => watchAbort.abort(), {
      once: true,
    });

    (async () => {
      try {
        for await (const _changed of watcher.watch(watchAbort.signal)) {
          res.write('data: {"updated": true}\r\n\r\n');
          if (!this.config.quiet) {
            const filename = this.reader.filenameFor(subpath) ?? "file";
            process.stderr.write(` * Change detected in ${filename}, refreshing\n`);
          }
        }
      } catch {
        // Client disconnected or server shutting down
      }
      res.end();
    })();
  }

  private handleStatic(urlPath: string, urlPrefix: string, res: http.ServerResponse): void {
    const prefix = urlPrefix + "/static/";
    const filename = urlPath.slice(prefix.length);
    if (!filename || filename.includes("..")) {
      this.sendError(res, 404);
      return;
    }

    // Check bundled static dir first
    const bundled = path.join(STATIC_DIR, filename);
    if (fs.existsSync(bundled) && fs.statSync(bundled).isFile()) {
      this.serveFile(res, bundled);
      return;
    }

    // Check asset cache
    const cached = this.assets.getPath(filename);
    if (fs.existsSync(cached) && fs.statSync(cached).isFile()) {
      this.serveFile(res, cached);
      return;
    }

    this.sendError(res, 404);
  }

  // Serves the file for one configured `HIGHLIGHT_LANGUAGES` entry, looked
  // up by `name` against the validated config list -- never by a
  // client-supplied path, so a request can only ever reach a file the
  // operator explicitly listed in their own settings.json.
  private handleHighlightLanguage(
    urlPath: string,
    urlPrefix: string,
    res: http.ServerResponse,
  ): void {
    const prefix = urlPrefix + "/highlight-lang/";
    const name = decodeURIComponent(urlPath.slice(prefix.length));
    const resolved = resolveHighlightLanguages(this.config.highlight_languages, this.config.quiet);
    const entry = resolved.find((e) => e.name === name);
    if (!entry) {
      this.sendError(res, 404);
      return;
    }
    this.serveFile(res, entry.path);
  }

  private serveFile(res: http.ServerResponse, filepath: string): void {
    const contentType = guessContentType(filepath);
    const data = fs.readFileSync(filepath);
    this.sendBytes(res, 200, data, contentType);
  }

  private extractSubpath(urlPath: string, prefix: string): string | null {
    const sub = urlPath.slice(prefix.length).replace(/^\/+|\/+$/g, "");
    return sub || null;
  }

  private sendText(
    res: http.ServerResponse,
    code: number,
    text: string,
    contentType: string,
  ): void {
    this.sendBytes(res, code, Buffer.from(text, "utf-8"), contentType);
  }

  private sendBytes(
    res: http.ServerResponse,
    code: number,
    data: Buffer,
    contentType: string,
  ): void {
    res.writeHead(code, {
      "Content-Type": contentType,
      "Content-Length": data.length,
    });
    res.end(data);
  }

  private sendRedirect(res: http.ServerResponse, location: string): void {
    res.writeHead(302, { Location: location });
    res.end();
  }

  private sendError(res: http.ServerResponse, code: number): void {
    res.writeHead(code, { "Content-Type": "text/plain" });
    res.end(String(code));
  }
}
