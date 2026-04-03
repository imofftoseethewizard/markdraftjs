import net from "node:net";

function isServerRunning(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(host: string, port: number, signal?: AbortSignal): Promise<boolean> {
  while (!signal?.aborted) {
    if (await isServerRunning(host, port)) return true;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 100);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
  return false;
}

export async function startBrowser(url: string): Promise<void> {
  try {
    const { exec } = await import("node:child_process");
    const command =
      process.platform === "darwin"
        ? `open ${JSON.stringify(url)}`
        : process.platform === "win32"
          ? `start "" ${JSON.stringify(url)}`
          : `xdg-open ${JSON.stringify(url)}`;
    exec(command);
  } catch {
    // Ignore errors opening browser
  }
}

export async function startBrowserWhenReady(
  host: string,
  port: number,
  signal?: AbortSignal,
): Promise<void> {
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  if (await waitForServer(displayHost, port, signal)) {
    await startBrowser(`http://${displayHost}:${port}/`);
  }
}
