import { parseArgs } from "node:util";

import { clearCache, exportFile, serve } from "./api.js";

const VERSION = "1.1.0";
const VALID_THEME_OPTIONS = ["light", "dark", "auto"];
const HELP = `Usage: draft [options] [path] [address]

Render local readme files before sending off to GitHub.

Arguments:
  path                   File or directory to render (- for stdin)
  address                Host:port to listen on, or output file for --export

Options:
  -V, --version          Show version and exit
  --user-content         Render as user content
  --wide                 Use wide layout
  --clear                Clear cached assets
  --export               Export to HTML file
  --no-inline            Use CDN links instead of inlining (with --export)
  -b, --browser          Open in browser
  --title <title>        Override page title
  --norefresh            Disable auto-refresh
  --quiet                Suppress output
  --theme <theme>        Theme: light, dark, auto
  -h, --help             Show this help
`;

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

  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(HELP);
    return 0;
  }

  if (args.includes("-V") || args.includes("--version")) {
    console.log(`Markdraft ${VERSION}`);
    return 0;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        V: { type: "boolean" },
        version: { type: "boolean" },
        "user-content": { type: "boolean", default: false },
        wide: { type: "boolean", default: false },
        clear: { type: "boolean", default: false },
        export: { type: "boolean", default: false },
        "no-inline": { type: "boolean", default: false },
        browser: { type: "boolean", short: "b", default: false },
        title: { type: "string" },
        norefresh: { type: "boolean", default: false },
        quiet: { type: "boolean", default: false },
        theme: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (e) {
    if (e instanceof TypeError && "code" in e) {
      console.error(e.message);
      console.error("See draft --help for usage.");
      return 2;
    }
    throw e;
  }
  const { values: opts, positionals } = parsed;

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

  const [pathArg, addressArg] = resolvePathAddress(positionals[0], positionals[1]);

  // Export mode
  if (opts.export) {
    try {
      await exportFile({
        path: pathArg ?? null,
        userContent: opts["user-content"],
        wide: opts.wide,
        renderInline: !opts["no-inline"],
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
      userContent: opts["user-content"],
      wide: opts.wide,
      title: opts.title,
      autorefresh: !opts.norefresh,
      browser: opts.browser as boolean,
      quiet: opts.quiet,
      theme,
    });
    return 0;
  } catch (e) {
    if (e instanceof Error && e.name === "ReadmeNotFoundError") {
      console.log("Error:", e.message);
      return 1;
    }
    const code = e instanceof Error && "code" in e ? (e as NodeJS.ErrnoException).code : null;
    if (code === "EADDRINUSE") {
      console.error("Error:", (e as Error).message);
      console.error(
        "This port is in use. Is a markdraft server already running? " +
          "Stop that instance or specify another port here.",
      );
      return 1;
    }
    if (code === "ENOTFOUND") {
      console.error("Error: could not resolve address", JSON.stringify(host ?? resolvedAddress));
      return 1;
    }
    throw e;
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    const code = e instanceof Error && "code" in e ? (e as NodeJS.ErrnoException).code : null;
    if (code) {
      console.error(`Error (${code}): ${msg}`);
    } else {
      console.error(`Error: ${msg}`);
    }
    process.exit(1);
  },
);
