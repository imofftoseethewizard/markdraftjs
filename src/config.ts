import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeExtension } from "./source.js";
import type { HighlightLanguageConfig, UserSettings } from "./types.js";

// -- Readme file discovery ---------------------------------------------------

export const SUPPORTED_TITLES = ["README", "Readme", "readme", "Home"];
export const SUPPORTED_EXTENSIONS = [".md", ".markdown"];

export const DEFAULT_FILENAMES = SUPPORTED_TITLES.flatMap((title) =>
  SUPPORTED_EXTENSIONS.map((ext) => title + ext),
);
export const DEFAULT_FILENAME = DEFAULT_FILENAMES[0];

// -- Paths and URLs -----------------------------------------------------------

export const DEFAULT_CONFIG_HOME = path.join(os.homedir(), ".markdraft");
export const DEFAULT_URL_PREFIX = "/__";

// -- Server defaults (overridable via ~/.markdraft/settings.json) ---------------

export const HOST = "localhost";
export const PORT = 6565;
export const AUTOREFRESH = true;
export const QUIET = false;
export const CACHE_DIRECTORY = "cache-{version}";

// -- CDN assets ---------------------------------------------------------------

export const CDN_ASSETS: Record<string, string> = {
  // Markdown rendering
  "marked.min.js": "https://cdn.jsdelivr.net/npm/marked/marked.min.js",
  // Syntax highlighting
  "highlight.min.js":
    "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/highlight.min.js",
  "github-highlight.min.css":
    "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github.min.css",
  "github-highlight-dark.min.css":
    "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github-dark.min.css",
  // Mermaid diagrams
  "mermaid.min.js": "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js",
  // GitHub styling (light and dark builds)
  "github-markdown-light.css":
    "https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown-light.css",
  "github-markdown-dark.css":
    "https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown-dark.css",
  // Math (LaTeX) rendering
  "katex.min.js": "https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.js",
  "marked-katex-extension.umd.js": "https://cdn.jsdelivr.net/npm/marked-katex-extension",
  // GitHub-style alerts ([!NOTE], [!WARNING], etc.)
  "marked-alert.umd.js": "https://cdn.jsdelivr.net/npm/marked-alert",
  // GeoJSON map rendering
  "leaflet.js": "https://cdn.jsdelivr.net/npm/leaflet@1/dist/leaflet.js",
  "leaflet.css": "https://cdn.jsdelivr.net/npm/leaflet@1/dist/leaflet.css",
  // STL 3D model rendering
  "three.min.js": "https://cdn.jsdelivr.net/npm/three@0.160/build/three.min.js",
  // Emoji shortcodes (:rocket: etc.)
  "gemoji.json": "https://cdn.jsdelivr.net/npm/gemoji/index.json",
  "marked-emoji.umd.js": "https://cdn.jsdelivr.net/npm/marked-emoji",
};

// KaTeX CSS is loaded from CDN directly (references relative font URLs
// that the CDN serves automatically). Not cached locally.
export const KATEX_CSS_URL = "https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css";

// Parses a single `HIGHLIGHT_LANGUAGES` entry, dropping (returning null for)
// anything malformed: `name`/`path` are required non-empty strings, `global`
// is an optional string, `extensions` is an optional array (individual
// unusable items are skipped rather than dropping the entry). Relative
// `path`s are resolved against the config home; absolute paths pass through
// unchanged. Existence of the resolved file is intentionally NOT checked
// here -- that happens at render time (see `src/highlight.ts`), so a
// settings.json written before its language file exists isn't treated as
// malformed.
function parseHighlightLanguageEntry(item: unknown, home: string): HighlightLanguageConfig | null {
  if (item === null || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  if (typeof rec.name !== "string" || rec.name === "") return null;
  if (typeof rec.path !== "string" || rec.path === "") return null;
  if (rec.global !== undefined && typeof rec.global !== "string") return null;
  if (rec.extensions !== undefined && !Array.isArray(rec.extensions)) return null;

  const resolvedPath = path.isAbsolute(rec.path) ? rec.path : path.join(home, rec.path);
  const entry: HighlightLanguageConfig = { name: rec.name, path: resolvedPath };
  if (typeof rec.global === "string") entry.global = rec.global;
  if (Array.isArray(rec.extensions)) {
    const extensions = rec.extensions
      .map(normalizeExtension)
      .filter((ext): ext is string => ext !== null);
    if (extensions.length > 0) entry.extensions = extensions;
  }
  return entry;
}

export function loadUserSettings(configHome?: string): UserSettings {
  const home = configHome ?? process.env.MARKDRAFT_HOME ?? DEFAULT_CONFIG_HOME;
  const settingsFile = path.join(home, "settings.json");
  if (!fs.existsSync(settingsFile)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(settingsFile, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const result: UserSettings = {};
    if (typeof data.HOST === "string") result.HOST = data.HOST;
    if (typeof data.PORT === "number") result.PORT = data.PORT;
    if (typeof data.AUTOREFRESH === "boolean") result.AUTOREFRESH = data.AUTOREFRESH;
    if (typeof data.QUIET === "boolean") result.QUIET = data.QUIET;
    if (Array.isArray(data.HIGHLIGHT_LANGUAGES)) {
      result.HIGHLIGHT_LANGUAGES = data.HIGHLIGHT_LANGUAGES.map((item) =>
        parseHighlightLanguageEntry(item, home),
      ).filter((entry): entry is HighlightLanguageConfig => entry !== null);
    }
    return result;
  } catch {
    return {};
  }
}
