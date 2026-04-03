import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { UserSettings } from "./types.js";

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
    return result;
  } catch {
    return {};
  }
}
