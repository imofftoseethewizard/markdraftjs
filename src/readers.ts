import fs from "node:fs";
import path from "node:path";
import posixpath from "node:path/posix";

import { DEFAULT_FILENAMES, DEFAULT_FILENAME, SUPPORTED_EXTENSIONS } from "./config.js";
import { ReadmeNotFoundError } from "./errors.js";
import type { DirectoryEntry } from "./types.js";

const MIME_MAP: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "application/x-font-woff",
  ".woff2": "font/woff2",
  ".ttf": "application/octet-stream",
  ".eot": "application/vnd.ms-fontobject",
  ".txt": "text/plain",
  ".xml": "application/xml",
};

function guessMimeType(filepath: string): string | null {
  const ext = path.extname(filepath).toLowerCase();
  return MIME_MAP[ext] ?? null;
}

function safeJoin(directory: string, ...pathnames: string[]): string {
  const base = fs.realpathSync(directory);
  const joined = path.resolve(base, path.join(...pathnames));
  const target = fs.existsSync(joined) ? fs.realpathSync(joined) : joined;

  const rel = path.relative(base, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ReadmeNotFoundError(target);
  }

  // Walk each component to check for symlinks escaping root
  let check = base;
  const parts = path.join(...pathnames).split(path.sep);
  for (const part of parts) {
    check = path.join(check, part);
    if (fs.existsSync(check) && fs.lstatSync(check).isSymbolicLink()) {
      const real = fs.realpathSync(check);
      const symRel = path.relative(base, real);
      if (symRel.startsWith("..") || path.isAbsolute(symRel)) {
        throw new ReadmeNotFoundError(check);
      }
    }
  }

  return target;
}

export abstract class ReadmeReader {
  normalizeSubpath(subpath: string | null): string | null {
    if (subpath === null) return null;
    return posixpath.normalize(subpath);
  }

  filenameFor(_subpath: string | null): string | null {
    return null;
  }

  mimetypeFor(subpath: string | null = null): string | null {
    if (subpath === null) subpath = DEFAULT_FILENAME;
    return guessMimeType(subpath);
  }

  isBinary(_subpath: string | null = null): boolean {
    return false;
  }

  isDirectory(_subpath: string | null = null): boolean {
    return false;
  }

  lastUpdated(_subpath: string | null = null): number | null {
    return null;
  }

  listDirectory(_subpath: string | null = null): DirectoryEntry[] {
    return [];
  }

  abstract read(subpath: string | null): string | Buffer;
}

export class DirectoryReader extends ReadmeReader {
  readonly rootDirectory: string;
  readonly rootFilename: string | null;

  constructor(inputPath: string | null = null, silent = false) {
    super();
    const p = path.normalize(inputPath ?? ".");

    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      this.rootDirectory = path.resolve(p);
      this.rootFilename = this.findReadme(this.rootDirectory);
    } else if (fs.existsSync(p) || silent) {
      const abspath = path.resolve(p);
      this.rootFilename = abspath;
      this.rootDirectory = path.dirname(abspath);
    } else {
      throw new ReadmeNotFoundError(p, "File not found: " + p);
    }
  }

  private findReadme(dirpath: string): string | null {
    for (const filename of DEFAULT_FILENAMES) {
      const fullPath = path.join(dirpath, filename);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
    return null;
  }

  override normalizeSubpath(subpath: string | null): string | null {
    if (subpath === null) return null;
    subpath = posixpath.normalize(subpath);
    const filename = path.normalize(safeJoin(this.rootDirectory, subpath));
    if (fs.existsSync(filename) && fs.statSync(filename).isDirectory()) {
      if (!subpath.endsWith("/")) subpath += "/";
    }
    return subpath;
  }

  readmeFor(subpath: string | null): string | null {
    if (subpath === null) return this.rootFilename;
    const filename = path.normalize(safeJoin(this.rootDirectory, subpath));
    if (!fs.existsSync(filename)) {
      throw new ReadmeNotFoundError(filename);
    }
    if (fs.statSync(filename).isDirectory()) {
      return this.findReadme(filename);
    }
    return filename;
  }

  override filenameFor(subpath: string | null): string | null {
    try {
      const filename = this.readmeFor(subpath);
      if (filename === null) return null;
      return path.relative(this.rootDirectory, filename);
    } catch (e) {
      if (e instanceof ReadmeNotFoundError) return null;
      throw e;
    }
  }

  override isBinary(subpath: string | null = null): boolean {
    const mimetype = this.mimetypeFor(subpath);
    return Boolean(mimetype && !mimetype.startsWith("text/"));
  }

  override isDirectory(subpath: string | null = null): boolean {
    if (subpath === null) {
      return fs.statSync(this.rootDirectory).isDirectory();
    }
    try {
      const filename = path.normalize(safeJoin(this.rootDirectory, subpath));
      return fs.existsSync(filename) && fs.statSync(filename).isDirectory();
    } catch (e) {
      if (e instanceof ReadmeNotFoundError) return false;
      throw e;
    }
  }

  override lastUpdated(subpath: string | null = null): number | null {
    try {
      const readme = this.readmeFor(subpath);
      if (readme === null) return null;
      return fs.statSync(readme).mtimeMs;
    } catch (e) {
      if (e instanceof ReadmeNotFoundError) return null;
      if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT")
        return null;
      throw e;
    }
  }

  override listDirectory(subpath: string | null = null): DirectoryEntry[] {
    let dirpath: string;
    if (subpath === null) {
      dirpath = this.rootDirectory;
    } else {
      dirpath = safeJoin(this.rootDirectory, subpath);
    }
    if (!fs.existsSync(dirpath) || !fs.statSync(dirpath).isDirectory()) {
      return [];
    }
    const entries: DirectoryEntry[] = [];
    const names = fs.readdirSync(dirpath).sort();
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const full = path.join(dirpath, name);
      if (fs.statSync(full).isDirectory()) {
        entries.push({ name, type: "directory" });
      } else if (SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
        entries.push({ name, type: "file" });
      }
    }
    return entries;
  }

  override read(subpath: string | null = null): string | Buffer {
    const binary = this.isBinary(subpath);
    const readme = this.readmeFor(subpath);
    if (readme === null) {
      throw new ReadmeNotFoundError(subpath ?? this.rootDirectory, "No README found");
    }
    try {
      if (binary) {
        return fs.readFileSync(readme);
      }
      return fs.readFileSync(readme, "utf-8");
    } catch (e) {
      if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ReadmeNotFoundError(readme);
      }
      throw e;
    }
  }
}

export class TextReader extends ReadmeReader {
  text: string;
  readonly displayFilename: string | null;

  constructor(text: string, displayFilename: string | null = null) {
    super();
    this.text = text;
    this.displayFilename = displayFilename;
  }

  override filenameFor(subpath: string | null): string | null {
    if (subpath !== null) return null;
    return this.displayFilename;
  }

  override read(subpath: string | null = null): string {
    if (subpath !== null) {
      throw new ReadmeNotFoundError(subpath);
    }
    return this.text;
  }
}

export class StdinReader extends TextReader {
  private loaded = false;

  constructor(displayFilename: string | null = null) {
    super("", displayFilename);
  }

  override read(subpath: string | null = null): string {
    if (!this.loaded && subpath === null) {
      this.text = this.readStdin();
      this.loaded = true;
    }
    return super.read(subpath);
  }

  private readStdin(): string {
    return fs.readFileSync(0, "utf-8");
  }
}
