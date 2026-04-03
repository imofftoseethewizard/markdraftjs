export class ReadmeNotFoundError extends Error {
  readonly path: string | null;
  readonly code = "ENOENT";

  constructor(path: string | null = null, message?: string) {
    const msg = message ?? (path ? `No README found at ${path}` : "README not found");
    super(msg);
    this.name = "ReadmeNotFoundError";
    this.path = path;
  }
}

export class AlreadyRunningError extends Error {
  constructor(message?: string) {
    super(message ?? "Server is already running");
    this.name = "AlreadyRunningError";
  }
}
