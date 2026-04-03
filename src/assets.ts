import fs from "node:fs";
import path from "node:path";

import { CDN_ASSETS } from "./config.js";

export class AssetCache {
  readonly cachePath: string;

  constructor(cachePath: string) {
    this.cachePath = cachePath;
  }

  getPath(filename: string): string {
    return path.join(this.cachePath, filename);
  }

  isCached(filename: string): boolean {
    return fs.existsSync(this.getPath(filename));
  }

  allCached(): boolean {
    return Object.keys(CDN_ASSETS).every((f) => this.isCached(f));
  }

  async ensureCached(quiet = false): Promise<void> {
    if (this.allCached()) return;
    fs.mkdirSync(this.cachePath, { recursive: true });
    for (const [filename, url] of Object.entries(CDN_ASSETS)) {
      if (this.isCached(filename)) continue;
      if (!quiet) {
        process.stderr.write(` * Downloading ${filename}\n`);
      }
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(this.getPath(filename), buffer);
      } catch (ex) {
        if (!quiet) {
          process.stderr.write(` * Warning: failed to download ${filename} - ${ex}\n`);
        }
      }
    }
  }

  clear(): void {
    if (this.cachePath && fs.existsSync(this.cachePath)) {
      fs.rmSync(this.cachePath, { recursive: true, force: true });
    }
  }
}
