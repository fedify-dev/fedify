import $, { type CommandChild } from "@david/dax";
import { getLogger } from "@logtape/logtape";

/**
 * Starts `fedify tunnel -s pinggy.io <port>` and waits up to `timeoutMs`
 * for the tunnel URL to appear in its output.  The tunnel process is kept
 * alive and returned to the caller; it must be killed when no longer needed.
 *
 * Returns `null` if the URL was not found before the timeout.
 */
export default async function startTunnel(
  port: number,
  timeoutMs: number,
): Promise<{ child: CommandChild; url: string } | null> {
  const tunnelLogger = getLogger(["fedify", "examples", "tunnel"]);
  tunnelLogger.info("Opening localhost.run tunnel on port {port}", { port });

  const child = $`mise cli tunnel -s pinggy.io ${String(port)}`
    .stdout("piped")
    .stderr("piped")
    .noThrow()
    .spawn();

  // Accumulate text from both streams while logging each chunk at DEBUG.
  const textChunks: string[] = [];
  const decoder = new TextDecoder();

  const readStream = (stream: ReadableStream<Uint8Array>) => {
    (async () => {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          textChunks.push(text);
          const trimmed = text.trim();
          if (trimmed) tunnelLogger.debug("{output}", { output: trimmed });
        }
      } catch {
        // Stream may error when the process is killed.
      }
    })();
  };

  readStream(child.stdout());
  readStream(child.stderr());

  // Poll until we find an https URL in the accumulated output.
  // The `message` template tag from @optique/run may wrap the URL in double
  // quotes in non-TTY output, so we stop matching at whitespace or quotes.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = textChunks.join("").match(/https:\/\/[^\s"']+/);
    if (match) {
      tunnelLogger.info("Tunnel established at {url}", { url: match[0] });
      return { child, url: match[0] };
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  tunnelLogger.error(
    "Tunnel did not produce a URL within {timeout} ms",
    { timeout: timeoutMs },
  );
  forceKillChild(child);
  return null;
}

/**
 * Sends SIGKILL to `child` immediately.  A rejection handler is attached to
 * the CommandChild promise (which extends Promise<CommandResult>) so that the
 * eventual rejection from the killed process does not surface as an unhandled
 * promise rejection.  We intentionally do **not** await the promise because
 * dax keeps it pending until all piped streams are fully consumed, which may
 * never happen once the process is forcibly killed.
 */
function forceKillChild(child: CommandChild): void {
  child.catch(() => {});
  try {
    child.kill("SIGKILL");
  } catch {
    // Process already exited.
  }
}
