import { execFile } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import process from "node:process";
import type { WebFramework } from "../types.ts";
import { printErrorMessage, printMessage } from "../utils.ts";

/**
 * Check if a port is currently in use by attempting a TCP connection.
 */
export function isPortInUse(port: number, timeout = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "localhost" });
    socket.setTimeout(timeout);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Poll until the port is free or timeout is reached.
 * Returns true if the port was released, false if still occupied.
 */
export async function waitForPortRelease(
  port: number,
  timeout = 5000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!(await isPortInUse(port))) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Attempt to kill any process listening on the given port using lsof.
 */
export async function killProcessOnPort(port: number): Promise<void> {
  try {
    const pids = await new Promise<string>((resolve, reject) => {
      execFile("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
    for (const pid of pids.trim().split("\n").filter(Boolean)) {
      try {
        process.kill(parseInt(pid, 10), "SIGKILL");
      } catch {
        // Process may have already exited
      }
    }
  } catch {
    // lsof not available or no process found — ignore
  }
}

/**
 * Starting from `startPort`, find the first port that is not in use.
 */
export async function findFreePort(startPort: number): Promise<number> {
  let port = startPort;
  while (await isPortInUse(port)) {
    port++;
  }
  return port;
}

const ENTRY_FILES: Partial<Record<WebFramework, string>> = {
  "bare-bones": "src/main.ts",
  express: "src/index.ts",
  hono: "src/index.ts",
  elysia: "src/index.ts",
};

/**
 * Replace the hardcoded default port with `newPort` in the generated test
 * app's source files.  Strategy varies by framework.
 */
export async function replacePortInApp(
  dir: string,
  wf: WebFramework,
  defaultPort: number,
  newPort: number,
): Promise<void> {
  if (defaultPort === newPort) return;

  const entryFile = ENTRY_FILES[wf];

  if (entryFile) {
    // Frameworks with a source entry file: text-replace the port number
    const filePath = join(dir, entryFile);
    const content = await readFile(filePath, "utf8");
    await writeFile(
      filePath,
      content.replaceAll(String(defaultPort), String(newPort)),
    );
    return;
  }

  if (wf === "nitro") {
    // Nitro reads PORT from .env
    await appendFile(join(dir, ".env"), `\nPORT=${newPort}\n`);
    return;
  }

  if (wf === "astro") {
    // Insert server.port into the Astro config
    const configPath = join(dir, "astro.config.ts");
    const content = await readFile(configPath, "utf8");
    await writeFile(
      configPath,
      content.replace(
        "defineConfig({",
        `defineConfig({\n  server: { port: ${newPort} },`,
      ),
    );
    return;
  }

  printErrorMessage`Unknown framework ${wf} — cannot replace port.`;
}

/**
 * Ensure a port is fully released after killing a server process.
 * If the port is still occupied after waiting, force-kill the holder.
 */
export async function ensurePortReleased(port: number): Promise<void> {
  const released = await waitForPortRelease(port, 5000);
  if (!released) {
    printMessage`    Port ${String(port)} still in use — force-killing...`;
    await killProcessOnPort(port);
    await waitForPortRelease(port, 3000);
  }
}
