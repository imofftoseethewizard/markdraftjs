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
    const { default: open } = await import("open");
    await open(url);
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
