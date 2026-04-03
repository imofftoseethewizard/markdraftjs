import { Command } from "commander";

import { clearCache, exportFile, serve } from "./api.js";

const VERSION = "1.0.0";
const VALID_THEME_OPTIONS = ["light", "dark", "auto"];

function splitAddress(address: string | null): [string | null, number | null] {
  if (!address) return [null, null];
  if (address.includes(":")) {
    const lastColon = address.lastIndexOf(":");
    const host = address.slice(0, lastColon) || null;
    const portStr = address.slice(lastColon + 1);
    const port = parseInt(portStr, 10);
    if (isNaN(port)) return [address, null];
    return [host, port];
  }
  const port = parseInt(address, 10);
  if (isNaN(port)) return [address, null];
  return [null, port];
}

function resolvePathAddress(
  pathArg: string | undefined,
  addressArg: string | undefined,
): [string | undefined, string | undefined] {
  if (pathArg === undefined || addressArg !== undefined) {
    return [pathArg, addressArg];
  }
  const [, port] = splitAddress(pathArg);
  if (port !== null) {
    return [undefined, pathArg];
  }
  return [pathArg, undefined];
}

export async function main(argv?: string[]): Promise<number> {
  const args = argv ?? process.argv.slice(2);

  // Legacy flag detection
  if (args.includes("-a") || args.includes("--address")) {
    console.log("Use draft [options] <path> <address> instead of -a");
    console.log("See draft -h for details");
    return 2;
  }
  if (args.includes("-p") || args.includes("--port")) {
    console.log("Use draft [options] [<path>] [<hostname>:]<port> instead of -p");
    console.log("See draft -h for details");
    return 2;
  }

  const program = new Command("draft")
    .description("Render local readme files before sending off to GitHub.")
    .argument("[path]", "File or directory to render (- for stdin)")
    .argument("[address]", "Host:port to listen on, or output file for --export")
    .option("-V", "Show version and exit")
    .option("--user-content", "Render as user content", false)
    .option("--wide", "Use wide layout", false)
    .option("--clear", "Clear cached assets", false)
    .option("--export", "Export to HTML file", false)
    .option("--no-inline", "Use CDN links instead of inlining (with --export)")
    .option("-b, --browser", "Open in browser", false)
    .option("--title <title>", "Override page title")
    .option("--norefresh", "Disable auto-refresh", false)
    .option("--quiet", "Suppress output", false)
    .option("--theme <theme>", "Theme: light, dark, auto")
    .exitOverride()
    .configureOutput({
      writeOut: (str) => process.stdout.write(str),
      writeErr: (str) => process.stderr.write(str),
    });

  let parsed: Command;
  try {
    parsed = program.parse(["node", "draft", ...args]);
  } catch (e) {
    // Commander throws on --help and --version with exitOverride
    if (e instanceof Error && "exitCode" in e) {
      return (e as Error & { exitCode: number }).exitCode;
    }
    throw e;
  }

  const opts = parsed.opts();

  if (opts.V) {
    console.log(`Markdraft ${VERSION}`);
    return 0;
  }

  if (opts.clear) {
    clearCache();
    return 0;
  }

  // Theme validation
  let theme = "auto";
  if (opts.theme) {
    if (VALID_THEME_OPTIONS.includes(opts.theme)) {
      theme = opts.theme;
    } else {
      console.log('Error: valid options for theme are "auto", "light", "dark"');
      return 1;
    }
  }

  const rawArgs = parsed.args;
  const [pathArg, addressArg] = resolvePathAddress(rawArgs[0], rawArgs[1]);

  // Export mode
  if (opts.export) {
    try {
      await exportFile({
        path: pathArg ?? null,
        userContent: opts.userContent,
        wide: opts.wide,
        renderInline: opts.inline,
        outFilename: addressArg ?? null,
        title: opts.title,
        quiet: opts.quiet,
        theme,
      });
      return 0;
    } catch (e) {
      if (e instanceof Error && e.name === "ReadmeNotFoundError") {
        console.log("Error:", e.message);
        return 1;
      }
      throw e;
    }
  }

  // Serve mode
  const [resolvedPath, resolvedAddress] = resolvePathAddress(pathArg, addressArg);
  const [host, port] = splitAddress(resolvedAddress ?? null);

  if (resolvedAddress && !host && port === null) {
    console.log("Error: Invalid address", JSON.stringify(resolvedAddress));
  }

  try {
    await serve({
      path: resolvedPath ?? null,
      host,
      port,
      userContent: opts.userContent,
      wide: opts.wide,
      title: opts.title,
      autorefresh: !opts.norefresh,
      browser: opts.browser,
      quiet: opts.quiet,
      theme,
    });
    return 0;
  } catch (e) {
    if (e instanceof Error && e.name === "ReadmeNotFoundError") {
      console.log("Error:", e.message);
      return 1;
    }
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.log("Error:", e.message);
      console.log(
        "This port is in use. Is a markdraft server already running? " +
          "Stop that instance or specify another port here.",
      );
      return 1;
    }
    throw e;
  }
}

// Run when executed directly
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/cli.js") || process.argv[1].endsWith("/cli.ts"));

if (isMainModule) {
  main().then((code) => process.exit(code));
}
