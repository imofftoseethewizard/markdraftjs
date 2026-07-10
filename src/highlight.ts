// Render-time support for the `HIGHLIGHT_LANGUAGES` config facility: a
// user can register any highlight.js language via
// `~/.markdraft/settings.json`, and both render paths (the live server in
// `server.ts` and the static export in `export.ts`) share this validation
// and script-emission logic so they stay in lock-step.
//
// Config-shape validation (types, required fields) happens once at parse
// time in `config.ts`. This module re-validates `name`/`global` as safe
// script-identifier-shaped tokens and checks the file exists, at the point
// each page is actually rendered -- a file can appear/disappear between
// process start and a given request, and identifier-shape is a security
// property of *this* interpolation site, not of config parsing in general.

import fs from "node:fs";

import type { HighlightLanguageConfig } from "./types.js";

// highlight.js language names/aliases are conventionally lowercase and may
// contain digits, underscores, hyphens or a trailing `+` (e.g. "c++",
// "objective-c", "step21"). This is intentionally looser than a JS
// identifier -- `name` is always interpolated as a JSON-quoted string
// literal (never a bare identifier), so this check exists to reject
// surprising/control characters, not to prevent injection by itself.
const LANGUAGE_NAME_RE = /^[A-Za-z][A-Za-z0-9_+-]*$/;

// `global` names a `window` property that the inline registration script
// reads. It's looked up via bracket notation with a JSON-quoted key (never
// spliced in as bare code), but we still require it to look like a genuine
// JS identifier so a malformed config entry can't smuggle arbitrary
// characters into the emitted page.
const JS_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function warn(quiet: boolean, message: string): void {
  if (!quiet) {
    console.warn(`markdraft: ${message}`);
  }
}

/**
 * Filters a list of configured highlight languages down to the ones that are
 * safe and ready to emit right now: `name` and `global` (when present) must
 * look like safe tokens, and the file at `path` must exist. Anything
 * dropped is logged via `console.warn` unless `quiet`. Never throws.
 */
export function resolveHighlightLanguages(
  entries: HighlightLanguageConfig[],
  quiet: boolean,
): HighlightLanguageConfig[] {
  const resolved: HighlightLanguageConfig[] = [];
  for (const entry of entries) {
    if (!LANGUAGE_NAME_RE.test(entry.name)) {
      warn(quiet, `highlight language name ${JSON.stringify(entry.name)} is not valid, skipping`);
      continue;
    }
    if (entry.global !== undefined && !JS_IDENTIFIER_RE.test(entry.global)) {
      warn(
        quiet,
        `highlight language "${entry.name}" has an invalid "global" ` +
          `(${JSON.stringify(entry.global)}), skipping`,
      );
      continue;
    }
    let isFile = false;
    try {
      isFile = fs.statSync(entry.path).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) {
      warn(quiet, `highlight language "${entry.name}" file not found, skipping: ${entry.path}`);
      continue;
    }
    resolved.push(entry);
  }
  return resolved;
}

/**
 * The inline registration `<script>` for a validated entry, or "" for a
 * self-registering file (no `global`) which needs only its `src`/inline
 * load and nothing else.
 */
export function registrationScript(entry: HighlightLanguageConfig): string {
  if (!entry.global) return "";
  return (
    `  <script>hljs.registerLanguage(${JSON.stringify(entry.name)}, ` +
    `window[${JSON.stringify(entry.global)}]);</script>`
  );
}
