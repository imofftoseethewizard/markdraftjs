import path from "node:path";

import { AssetCache } from "./assets.js";
import { startBrowserWhenReady } from "./browser.js";
import {
  DEFAULT_CONFIG_HOME,
  CACHE_DIRECTORY,
  HOST,
  PORT,
  AUTOREFRESH,
  QUIET,
  loadUserSettings,
} from "./config.js";
import { exportPage } from "./export.js";
import { DirectoryReader, StdinReader } from "./readers.js";
import type { ReadmeReader } from "./readers.js";
import { PreviewServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const VERSION = "1.0.0";

function resolveConfig(opts: {
  host?: string | null;
  port?: number | null;
  autorefresh?: boolean | null;
  quiet?: boolean | null;
  theme?: string;
  title?: string | null;
  userContent?: boolean;
  wide?: boolean;
  urlPrefix?: string;
}): ServerConfig {
  const settings = loadUserSettings();
  return {
    host: opts.host ?? settings.HOST ?? HOST,
    port: opts.port ?? settings.PORT ?? PORT,
    autorefresh: opts.autorefresh ?? settings.AUTOREFRESH ?? AUTOREFRESH,
    quiet: opts.quiet ?? settings.QUIET ?? QUIET,
    theme: (opts.theme as ServerConfig["theme"]) ?? "auto",
    title: opts.title ?? null,
    user_content: opts.userContent ?? false,
    wide: opts.wide ?? false,
    url_prefix: opts.urlPrefix ?? "/__",
    highlight_languages: settings.HIGHLIGHT_LANGUAGES ?? [],
  };
}

function makeReader(p?: string | null): ReadmeReader {
  if (p === "-") return new StdinReader();
  return new DirectoryReader(p);
}

function makeCache(): AssetCache {
  const configHome = process.env.MARKDRAFT_HOME ?? DEFAULT_CONFIG_HOME;
  const cacheDir = CACHE_DIRECTORY.replace("{version}", VERSION);
  const cachePath = path.join(configHome, cacheDir);
  return new AssetCache(cachePath);
}

export async function serve(opts: {
  path?: string | null;
  host?: string | null;
  port?: number | null;
  userContent?: boolean;
  wide?: boolean;
  title?: string | null;
  autorefresh?: boolean;
  browser?: boolean;
  quiet?: boolean | null;
  theme?: string;
}): Promise<void> {
  const reader = makeReader(opts.path);
  const assets = makeCache();
  const config = resolveConfig({
    host: opts.host,
    port: opts.port,
    autorefresh: opts.autorefresh,
    quiet: opts.quiet,
    theme: opts.theme,
    title: opts.title,
    userContent: opts.userContent,
    wide: opts.wide,
  });

  await assets.ensureCached(config.quiet);

  const server = new PreviewServer(reader, assets, config);
  await server.listen();

  const addr = server.address();
  if (!config.quiet && addr) {
    process.stderr.write(` * Serving on http://${addr.host}:${addr.port}/\n`);
  }

  if (opts.browser && addr) {
    startBrowserWhenReady(config.host, addr.port, server.abortController.signal);
  }

  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      if (!config.quiet) {
        process.stderr.write(" * Shutting down...\n");
      }
      await server.close();
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

export async function exportFile(opts: {
  path?: string | null;
  userContent?: boolean;
  wide?: boolean;
  renderInline?: boolean;
  outFilename?: string | null;
  title?: string | null;
  quiet?: boolean;
  theme?: string;
}): Promise<void> {
  const reader = makeReader(opts.path);
  const assets = makeCache();
  await assets.ensureCached(opts.quiet ?? false);
  const settings = loadUserSettings();

  let exportToStdout = opts.outFilename === "-";
  let outFilename = opts.outFilename ?? null;

  if (outFilename === null) {
    if (opts.path === "-") {
      exportToStdout = true;
    } else {
      const dirReader = new DirectoryReader(opts.path);
      if (dirReader.rootFilename) {
        const rel = path.relative(process.cwd(), dirReader.rootFilename);
        const parsed = path.parse(rel);
        outFilename = parsed.name + ".html";
      } else {
        outFilename = path.basename(path.resolve(opts.path ?? ".")) + ".html";
      }
    }
  }

  if (!exportToStdout && !opts.quiet) {
    process.stderr.write(`Exporting to ${outFilename}\n`);
  }

  const outFile = exportToStdout ? "-" : outFilename;
  exportPage(reader, null, assets, {
    outFile,
    inline: opts.renderInline ?? true,
    title: opts.title,
    theme: opts.theme ?? "auto",
    userContent: opts.userContent,
    wide: opts.wide,
    quiet: opts.quiet,
    highlightLanguages: settings.HIGHLIGHT_LANGUAGES ?? [],
  });
}

export function clearCache(): void {
  const assets = makeCache();
  assets.clear();
  console.log("Cache cleared.");
}
