// Kept private in each package to avoid adding public API in a patch release.
// TODO(Jiwon Kwon): Consolidate the duplicated body helpers in @fedify/vocab-runtime,
// @fedify/webfinger, and @fedify/fedify into a shared implementation.
import { getLogger } from "@logtape/logtape";
import { FetchError } from "./request.ts";

/** Decoded JSON body limit: 16 MiB.  @internal */
export const MAX_BODY_SIZE: number = 16 * 1024 * 1024;

/** A body exceeded the byte limit.  @internal */
export class BodyTooLargeError extends FetchError {
  /** Creates an error for a body exceeding the given limit. */
  constructor(url: string | URL, maxBytes: number) {
    super(url, `Body exceeds the limit of ${maxBytes} bytes`);
    this.name = "BodyTooLargeError";
  }
}

/** Validates a finite, positive byte limit.  @internal */
function validateBodySizeLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError(
      "The body size limit must be a positive safe integer.",
    );
  }
}

/**
 * Reads UTF-8 text while limiting bytes received from the body stream.
 * Fetch responses are already decompressed, so the stream count is authoritative.
 * @param message The response or request to read.
 * @param maxBytes The maximum number of decoded bytes to read.
 * @param url The URL to include in errors and logs.
 * @returns The decoded body text.
 * @throws {BodyTooLargeError} If the body exceeds the limit.
 * @internal
 */
export async function readBoundedText(
  message: Pick<Request, "body" | "headers">,
  maxBytes: number,
  url: string | URL,
): Promise<string> {
  validateBodySizeLimit(maxBytes);
  const reader = message.body?.getReader();
  const tooLarge = (): never => {
    getLogger(["fedify", "runtime", "body"]).warn(
      "Body from {url} exceeds the limit of {maxBytes} bytes.",
      { url: url.toString(), maxBytes },
    );
    throw new BodyTooLargeError(url, maxBytes);
  };
  try {
    // Content-Length describes the encoded body when compression is used.
    // Only use it as an early rejection for an unencoded body.
    const length = message.headers.get("Content-Length");
    const encoding = message.headers.get("Content-Encoding");
    if (
      (encoding == null || encoding.toLowerCase() === "identity") &&
      length != null && /^\d+$/.test(length) && Number(length) > maxBytes
    ) tooLarge();
    if (reader == null) return "";
    let size = 0;
    const bounded = new ReadableStream<BufferSource>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        size += value.byteLength;
        if (size > maxBytes) tooLarge();
        controller.enqueue(value);
      },
    }, { highWaterMark: 0 });
    const textReader = bounded.pipeThrough(new TextDecoderStream()).getReader();
    try {
      const chunks: string[] = [];
      while (true) {
        const { done, value } = await textReader.read();
        if (done) break;
        chunks.push(value);
      }
      return chunks.join("");
    } finally {
      textReader.releaseLock();
    }
  } catch (error) {
    // A cloned inbox request is a tee.  Awaiting one branch's cancellation
    // would deadlock until the other branch is canceled by the inbox handler.
    if (reader != null) void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader?.releaseLock();
  }
}
