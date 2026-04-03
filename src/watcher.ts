import type { ReadmeReader } from "./readers.js";

export class FileWatcher {
  readonly reader: ReadmeReader;
  readonly subpath: string | null;
  readonly interval: number;

  constructor(reader: ReadmeReader, subpath: string | null = null, interval = 300) {
    this.reader = reader;
    this.subpath = subpath;
    this.interval = interval;
  }

  async *watch(signal: AbortSignal): AsyncGenerator<boolean> {
    let lastUpdated = this.reader.lastUpdated(this.subpath);
    while (!signal.aborted) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.interval);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      if (signal.aborted) break;
      const updated = this.reader.lastUpdated(this.subpath);
      if (updated !== lastUpdated) {
        lastUpdated = updated;
        yield true;
      }
    }
  }
}
