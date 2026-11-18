interface CompileResult {
  success: boolean;
  code: number;
  stderr: string;
  signal?: string | null;
}

interface RetryOptions {
  sleep?: (milliseconds: number) => Promise<void>;
  warn?: (message: string) => void;
}

/** Retry interrupted compiler downloads without masking deterministic errors. */
export async function compileWithDownloadRetries(
  compile: () => Promise<CompileResult>,
  target: string,
  options: RetryOptions = {},
): Promise<void> {
  const sleep =
    options.sleep ??
    ((milliseconds) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const warn = options.warn ?? console.warn;
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await compile();
    if (result.success) return;
    const plainStderr = result.stderr.replace(
      new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
      "",
    );
    const lines = plainStderr.split(/\r?\n/);
    const lastError = lines.findLastIndex(
      (line) => line.startsWith("error:") || line.startsWith("error["),
    );
    const diagnostic = lastError < 0 ? "" : lines.slice(lastError).join("\n");
    const interruptedDownload =
      !result.signal &&
      (/^error: Failed caching npm package[^\r\n]*\r?\n\s*0: error reading a body from connection/.test(
        diagnostic,
      ) ||
        /^error: Writing deno compile executable to temporary file [^\r\n]*\r?\n\s*Caused by:\s*\r?\n\s*0: Setting up base binary\.\r?\n\s*1: error reading a body from connection/.test(
          diagnostic,
        ));
    if (!interruptedDownload || attempt === attempts) {
      throw new Error(
        `CLI compilation for ${target} failed with exit code ${result.code}`,
      );
    }
    const delay = attempt * 2_000;
    warn(
      `Compiler download interrupted for ${target}; retrying compilation in ${delay}ms (${attempt + 1}/${attempts}).`,
    );
    await sleep(delay);
  }
}
