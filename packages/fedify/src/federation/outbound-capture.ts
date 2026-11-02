import { ResponseBodyPump } from "./outbound-body.ts";
import type {
  OutboundBodyCaptureSummary,
  OutboundResponseBodyCapture,
} from "./outbound-report.ts";

const diagnosticTimeoutMs = 1000;
const diagnosticMaxBytes = 1024;
const diagnostics = new WeakMap<Response, string>();

/** Reuse a selected capture's diagnostic preview instead of acquiring a second reader. */
export function takeCapturedDiagnostic(response: Response): string | undefined {
  const value = diagnostics.get(response);
  diagnostics.delete(response);
  return value;
}

/** Validate and copy before replacing the current observer registration. */
export function snapshotBodyCapture<T>(
  value: OutboundResponseBodyCapture<T> | undefined,
): OutboundResponseBodyCapture<T> | undefined {
  if (value === undefined) return undefined;
  if (
    value == null || typeof value !== "object" ||
    typeof value.onBody !== "function"
  ) {
    throw new TypeError("Response body capture requires an onBody callback.");
  }
  const { maxBytes, timeoutMs, responses = "all", onBody } = value;
  if (typeof maxBytes !== "number" || typeof timeoutMs !== "number") {
    throw new TypeError(
      "Response body capture requires numeric maxBytes and timeoutMs.",
    );
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError(
      "Response body capture maxBytes must be a positive safe integer.",
    );
  }
  if (
    !Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
    Math.ceil(timeoutMs) > 2147483647
  ) {
    throw new RangeError(
      "Response body capture timeoutMs is outside the timer range.",
    );
  }
  if (responses !== "all" && responses !== "non-success-http-responses") {
    throw new TypeError("Invalid response body capture selector.");
  }
  return Object.freeze({
    maxBytes,
    timeoutMs: Math.ceil(timeoutMs),
    responses,
    onBody,
  });
}

type WithoutBytes<T> = T extends unknown ? Omit<T, "bytesExposed"> : never;
type CaptureResult = WithoutBytes<OutboundBodyCaptureSummary>;

/** One source reader feeds both the revocable application view and bounded diagnostics. */
export async function captureResponseBody(
  response: Response,
  options: {
    maxBytes: number;
    timeoutMs: number;
    responses?: "all" | "non-success-http-responses";
  },
  onBody: (
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ) => void | Promise<void>,
): Promise<OutboundBodyCaptureSummary> {
  if (options.responses === "non-success-http-responses" && response.ok) {
    return Object.freeze({ type: "filtered", bytesExposed: 0 });
  }
  if (response.body == null) {
    return Object.freeze({ type: "no-body", bytesExposed: 0 });
  }
  const start = performance.now();
  const expires = start + options.timeoutMs;
  let pump: ResponseBodyPump;
  try {
    pump = new ResponseBodyPump(
      response.body,
      Math.max(options.timeoutMs, response.ok ? 0 : diagnosticTimeoutMs),
    );
  } catch (error) {
    return Object.freeze({
      type: "failed",
      phase: "body" as const,
      error,
      bytesExposed: 0,
    });
  }
  const signal = new AbortController();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let active = true;
  let bytesExposed = 0;
  let result: CaptureResult | undefined;
  let eof = false;
  let diagnosticBytes = 0;
  let diagnosticTruncated = false;
  let diagnosticFailed = false;
  const preview: string[] = [];
  const decoder = new TextDecoder();
  let pending:
    | Promise<ReadableStreamReadResult<Uint8Array> | undefined>
    | undefined;
  const read = () =>
    pending ??= pump.read().then((value) => {
      pending = undefined;
      if (value?.done) eof = true;
      if (
        !response.ok && value != null && !value.done &&
        performance.now() - start < diagnosticTimeoutMs
      ) {
        const remaining = diagnosticMaxBytes - diagnosticBytes;
        const chunk = value.value;
        if (chunk.length > remaining) diagnosticTruncated = true;
        if (remaining > 0 && chunk.length > 0) {
          const selected = chunk.subarray(0, remaining);
          preview.push(decoder.decode(selected, { stream: true }));
          diagnosticBytes += selected.length;
        }
      }
      return value;
    }, (error) => {
      pending = undefined;
      diagnosticFailed = true;
      throw error;
    });
  const revoke = (reason: unknown) => {
    active = false;
    if (!signal.signal.aborted) signal.abort(reason);
    // Controller access works even while the application retains a locked reader.
    try {
      controller.error(reason);
    } catch { /* The consumer may already have cancelled. */ }
  };
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    async pull() {
      try {
        while (active) {
          if (performance.now() >= expires) {
            result = { type: "deadline" };
            revoke(
              new DOMException(
                "Response body capture deadline exceeded.",
                "TimeoutError",
              ),
            );
            return;
          }
          const value = await read();
          if (!active) return;
          if (performance.now() >= expires || value == null) {
            result = { type: "deadline" };
            revoke(
              new DOMException(
                "Response body capture deadline exceeded.",
                "TimeoutError",
              ),
            );
            return;
          }
          if (value.done) {
            result = { type: "complete" };
            active = false;
            controller.close();
            return;
          }
          if (value.value.length === 0) continue;
          const chunk = value.value.slice(0, options.maxBytes - bytesExposed);
          bytesExposed += chunk.length;
          controller.enqueue(chunk);
          if (bytesExposed === options.maxBytes) {
            result = { type: "limit-reached" };
            revoke(
              new DOMException(
                "Response body capture byte limit reached.",
                "QuotaExceededError",
              ),
            );
          }
          return;
        }
      } catch (error) {
        if (active) {
          result = { type: "failed", phase: "body", error };
          revoke(error);
        }
      }
    },
    cancel(reason) {
      result = { type: "consumer-stopped", reason };
      revoke(reason);
    },
  }, { highWaterMark: 0 });
  let timer!: ReturnType<typeof setTimeout>;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      result = { type: "deadline" };
      revoke(
        new DOMException(
          "Response body capture deadline exceeded.",
          "TimeoutError",
        ),
      );
      resolve();
    }, Math.max(0, expires - performance.now()));
  });
  const callback = Promise.resolve().then(() => onBody(body, signal.signal))
    .then(
      () => {},
      (error) => {
        if (result == null || result.type === "complete") {
          result = { type: "failed", phase: "observer", error };
        }
      },
    );
  try {
    await Promise.race([callback, deadline]);
    clearTimeout(timer);
    if (performance.now() >= expires) result = { type: "deadline" };
    result ??= { type: "callback-returned" };
    revoke(new DOMException("Response body capture finished.", "AbortError"));
    // Diagnostics may continue under their own budget, never exposing more app bytes.
    if (!response.ok) {
      pump.limitLifetime(diagnosticTimeoutMs - (performance.now() - start));
      try {
        while (
          !eof && !diagnosticTruncated &&
          performance.now() - start < diagnosticTimeoutMs
        ) {
          if (await read() == null) break;
        }
      } catch { /* Diagnostic failure does not replace HTTP evidence. */ }
      diagnostics.set(
        response,
        preview.join("") +
          (diagnosticTruncated
            ? "… (truncated)"
            : !eof && !diagnosticFailed
            ? "… (timed out)"
            : ""),
      );
    }
    return Object.freeze({
      ...result,
      bytesExposed,
    }) as OutboundBodyCaptureSummary;
  } finally {
    clearTimeout(timer);
    pump.close();
  }
}
