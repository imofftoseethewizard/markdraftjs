// Source-file rendering: a non-markdown source file (`main.rs`, `app.py`,
// ...) is previewed by wrapping its entire contents in a fenced code block
// tagged with the matching highlight.js language, so the ordinary markdown
// render path highlights it instead of interpreting the source as markdown.
//
// The wrap happens server-side, at the two points where a file's text is
// handed to the renderer -- the content API in `server.ts` and the static
// export in `export.ts` -- so the live server and `--export` stay in
// lock-step and the client needs no special case.
//
// A file whose name maps to no language here is left completely alone and
// still renders as markdown, which keeps the rule predictable: only the
// extensions listed below -- plus any the user contributed via the
// `extensions` field of a `HIGHLIGHT_LANGUAGES` entry -- change behaviour.

import path from "node:path";

import type { HighlightLanguageConfig } from "./types.js";

// Extension -> highlight.js language name (or alias). Lowercase keys; the
// lookup lowercases the extension before matching. Ambiguous extensions
// (`.m`, `.v`, `.s`) are deliberately absent -- guessing wrong is worse
// than falling back.
//
// An entry whose language highlight.js doesn't actually ship still works:
// the client renderer falls back to `hljs.highlightAuto` for an unknown
// fence language, so the file is still shown as a code block.
export const SOURCE_LANGUAGES: Record<string, string> = {
  // Systems and compiled languages
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hh": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
  ".cs": "csharp",
  ".d": "d",
  ".dart": "dart",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".nim": "nim",
  ".cr": "crystal",
  ".rs": "rust",
  ".scala": "scala",
  ".swift": "swift",
  ".zig": "zig",
  ".f": "fortran",
  ".f90": "fortran",
  // Scripting languages
  ".awk": "awk",
  ".bash": "bash",
  ".bat": "dos",
  ".cmd": "dos",
  ".coffee": "coffeescript",
  ".groovy": "groovy",
  ".jl": "julia",
  ".ksh": "bash",
  ".lua": "lua",
  ".php": "php",
  ".pl": "perl",
  ".pm": "perl",
  ".ps1": "powershell",
  ".py": "python",
  ".pyw": "python",
  ".r": "r",
  ".rb": "ruby",
  ".sh": "bash",
  ".tcl": "tcl",
  ".vim": "vim",
  ".zsh": "bash",
  // Functional languages
  ".clj": "clojure",
  ".cljc": "clojure",
  ".cljs": "clojure",
  ".edn": "clojure",
  ".el": "lisp",
  ".elm": "elm",
  ".erl": "erlang",
  ".ex": "elixir",
  ".exs": "elixir",
  ".fs": "fsharp",
  ".fsi": "fsharp",
  ".fsx": "fsharp",
  ".hrl": "erlang",
  ".hs": "haskell",
  ".lisp": "lisp",
  ".lsp": "lisp",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".scm": "scheme",
  ".ss": "scheme",
  // Web languages
  ".cjs": "javascript",
  ".css": "css",
  ".hbs": "handlebars",
  ".handlebars": "handlebars",
  ".js": "javascript",
  ".jsx": "javascript",
  ".less": "less",
  ".mjs": "javascript",
  ".scss": "scss",
  ".styl": "stylus",
  ".ts": "typescript",
  ".tsx": "typescript",
  // Data, config and markup
  ".cfg": "ini",
  ".cmake": "cmake",
  ".conf": "ini",
  ".gradle": "gradle",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".ini": "ini",
  ".json": "json",
  ".jsonc": "json",
  ".mk": "makefile",
  ".properties": "properties",
  ".proto": "protobuf",
  ".sql": "sql",
  ".tex": "latex",
  ".toml": "toml",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  // Patches
  ".diff": "diff",
  ".patch": "diff",
};

// Extensionless (or otherwise unmatchable) filenames that still name a
// well-known language. Keys are compared case-insensitively against the
// file's basename, and take precedence over the extension table so that
// e.g. `CMakeLists.txt` isn't judged by its `.txt`.
export const SOURCE_FILENAMES: Record<string, string> = {
  brewfile: "ruby",
  "cmakelists.txt": "cmake",
  dockerfile: "dockerfile",
  gemfile: "ruby",
  gnumakefile: "makefile",
  makefile: "makefile",
  podfile: "ruby",
  rakefile: "ruby",
  vagrantfile: "ruby",
};

/**
 * One configured extension in the ".ext" form these tables are keyed by:
 * trimmed, lowercased, leading dots collapsed to one. Returns null for
 * anything that couldn't name a file suffix (empty, or containing
 * whitespace or a path separator), so a single unusable item is skipped
 * rather than taking its whole language entry with it.
 */
export function normalizeExtension(item: unknown): string | null {
  if (typeof item !== "string") return null;
  const trimmed = item.trim().toLowerCase().replace(/^\.+/, "");
  if (trimmed === "" || /[\s/\\]/.test(trimmed)) return null;
  return "." + trimmed;
}

/**
 * The extension -> language table contributed by the user's
 * `HIGHLIGHT_LANGUAGES` entries, keyed like `SOURCE_LANGUAGES`. An entry's
 * `extensions` are re-normalized here (`config.ts` already does so when
 * parsing settings.json, but this is also a public entry point); a later
 * entry wins a collision, as does the user over the built-in tables.
 *
 * Note this uses the raw configured entries, not the render-time-validated
 * ones: a language whose definer file is missing still gets its files shown
 * as code blocks (highlight.js just falls back to auto-detection), which is
 * strictly better than showing the source as markdown.
 */
export function sourceLanguagesFrom(
  entries: HighlightLanguageConfig[] = [],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of entries) {
    for (const item of entry.extensions ?? []) {
      const ext = normalizeExtension(item);
      if (ext !== null) map[ext] = entry.name;
    }
  }
  return map;
}

/**
 * The highlight.js language for a file, or null if the file isn't a source
 * file Markdraft knows how to wrap (markdown included -- markdown is
 * rendered, not quoted).
 *
 * `custom` is a `sourceLanguagesFrom` table; its entries take precedence
 * over the built-in ones, so a user can both add and override extensions.
 * A configured ".ken" matches `main.ken`, and also a file simply named
 * `ken` -- which is how an extensionless name ("Makefile") is configured.
 */
export function languageForFilename(
  filename: string | null,
  custom: Record<string, string> = {},
): string | null {
  if (!filename) return null;
  const base = path.basename(filename).toLowerCase();
  const ext = path.extname(base);
  return (
    custom["." + base] ??
    (ext ? custom[ext] : undefined) ??
    SOURCE_FILENAMES[base] ??
    (ext ? SOURCE_LANGUAGES[ext] : undefined) ??
    null
  );
}

/** Whether `wrapSourceText` would wrap this file rather than pass it through. */
export function isSourceFile(
  filename: string | null,
  custom: Record<string, string> = {},
): boolean {
  return languageForFilename(filename, custom) !== null;
}

// The opening/closing fence for a block that must contain `text` verbatim.
// CommonMark ends a backtick fence at the first line whose leading run of
// backticks is at least as long as the opening one, so a file that itself
// contains ```` ``` ```` (a markdown-quoting script, a docstring with a
// code sample) needs a longer fence than anything inside it.
function fenceFor(text: string): string {
  let longest = 0;
  const runs = /^ {0,3}(`{3,})/gm;
  let match: RegExpExecArray | null;
  while ((match = runs.exec(text)) !== null) {
    longest = Math.max(longest, match[1].length);
  }
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * `text` wrapped in a language-tagged fenced code block when `filename`
 * names a source file, and returned unchanged otherwise (markdown, plain
 * text, anything unrecognized).
 */
export function wrapSourceText(
  text: string,
  filename: string | null,
  custom: Record<string, string> = {},
): string {
  const language = languageForFilename(filename, custom);
  if (language === null) return text;
  const fence = fenceFor(text);
  const body = text.endsWith("\n") || text === "" ? text : text + "\n";
  return `${fence}${language}\n${body}${fence}\n`;
}
