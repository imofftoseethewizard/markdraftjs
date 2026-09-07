export interface ServerConfig {
  host: string;
  port: number;
  autorefresh: boolean;
  quiet: boolean;
  theme: "light" | "dark" | "auto";
  title: string | null;
  user_content: boolean;
  wide: boolean;
  url_prefix: string;
  highlight_languages: HighlightLanguageConfig[];
}

/**
 * A single highlight.js language registration, as configured via
 * `HIGHLIGHT_LANGUAGES` in `~/.markdraft/settings.json`.
 *
 * `path` is resolved (relative entries joined against the config home) by
 * the time it reaches this shape; it is validated to exist, and `name`/
 * `global` are validated as safe identifiers, at render time (see
 * `src/highlight.ts`) -- not at config-parse time.
 */
export interface HighlightLanguageConfig {
  /** highlight.js language name/alias used for registration and fence matching. */
  name: string;
  /** Path to the language definer JS file (resolved to absolute). */
  path: string;
  /**
   * `window` global the file assigns its definer function to, for files that
   * don't call `hljs.registerLanguage` themselves (e.g. a UMD `<script>`
   * bundle). Omit for a self-registering file (most official hljs CDN
   * language files).
   */
  global?: string;
  /**
   * File extensions whose contents should be previewed as this language
   * (see `src/source.ts`). Normalized at config-parse time to lowercase
   * with a leading dot, and matched against a file's extension or, for an
   * extensionless file, its whole name.
   */
  extensions?: string[];
}

export interface ContentFileResponse {
  type: "file";
  text: string;
  filename: string;
  path: string;
  parent: string;
  siblings: DirectoryEntry[];
}

export interface ContentListingResponse {
  type: "listing";
  path: string;
  entries: DirectoryEntry[];
}

export type ContentResponse = ContentFileResponse | ContentListingResponse;

export interface DirectoryEntry {
  name: string;
  type: "file" | "directory";
}

export interface UserSettings {
  HOST?: string;
  PORT?: number;
  AUTOREFRESH?: boolean;
  QUIET?: boolean;
  HIGHLIGHT_LANGUAGES?: HighlightLanguageConfig[];
}
