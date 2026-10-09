import type { Federation } from "@fedify/fedify";
import type {
  NextFunction,
  Request as ERequest,
  Response as EResponse,
} from "express";
import { Buffer } from "node:buffer";
import type { Readable } from "node:stream";

type Middleware = (req: ERequest, res: EResponse, next: NextFunction) => void;

export type ContextDataFactory<TContextData> = (
  req: ERequest,
) => TContextData | Promise<TContextData>;

export function integrateFederation<TContextData>(
  federation: Federation<TContextData>,
  contextDataFactory: ContextDataFactory<TContextData>,
): Middleware {
  return (req, res, next) => {
    const body = req.method === "GET" || req.method === "HEAD"
      ? undefined
      : createRequestBody(req);
    const request = fromERequest(req, body?.stream);
    const contextData = contextDataFactory(req);
    const contextDataPromise = contextData instanceof Promise
      ? contextData
      : Promise.resolve(contextData);
    let notFound = false;
    let notAcceptable = false;
    contextDataPromise.then(async (contextData) => {
      const response = await federation.fetch(request, {
        contextData,
        onNotFound: () => {
          // If the `federation` object finds a request not responsible for it
          // (i.e., not a federation-related request), it will call the `next`
          // function provided by the Express framework to continue the request
          // handling by the Express:
          notFound = true;
          body?.restore();
          next();
          return new Response("Not found", { status: 404 }); // unused
        },
        onNotAcceptable: () => {
          // Similar to `onNotFound`, but slightly more tricky.
          // When the `federation` object finds a request not acceptable
          // type-wise (i.e., a user-agent doesn't want JSON-LD), it will call
          // the `next` function provided by the Express framework to continue
          // if the application can handle it, and otherwise return a 406 Not
          // Acceptable response:
          notAcceptable = true;
          installNotAcceptableFallback(req, res);
          body?.restore();
          next();
          return new Response("Not acceptable", {
            status: 406,
            headers: {
              "Content-Type": "text/plain",
              Vary: "Accept",
            },
          });
        },
      });
      if (notFound || notAcceptable) return;
      await setEResponse(res, response);
      // Prevent the Express framework from sending the response again:
      res.end();
      res.status = () => res;
      res.send = () => res;
      res.end = () => res;
      res.json = () => res;
      res.removeHeader = () => res;
      res.setHeader = () => res;
    }).catch((error) => {
      // Once Fedify has handed the request to Express, do not call next again.
      if (notFound || notAcceptable) throw error;
      next(
        error === "route" || error === "router" ? new Error(error) : error ||
          new Error("The federation middleware promise was rejected."),
      );
    });
  };
}

function fromERequest(
  req: ERequest,
  body: ReadableStream<Uint8Array> | undefined,
): Request {
  const url = `${req.protocol}://${req.host ?? req.header("Host")}${req.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (typeof value === "string") {
      headers.append(key, value);
    }
  }
  return new Request(url, {
    method: req.method,
    headers,
    // @ts-ignore: duplex is not supported in Deno, but it is in Node.js
    duplex: "half",
    body,
  });
}

/**
 * The body of a request handed to Fedify, which can be given back to the
 * framework if Fedify declines the request.
 */
interface RequestBody {
  /** The stream to use as the body of the `Request` passed to Fedify. */
  readonly stream: ReadableStream<Uint8Array>;
  /**
   * Puts every chunk Fedify has read back into the raw request, so that the
   * framework's own body parsers see the whole body.  Call this before handing
   * a declined request to the next middleware.
   */
  restore(): void;
}

/**
 * Wraps the raw `IncomingMessage` in a `ReadableStream` that stays inert until
 * first read, and that keeps the chunks it reads so that they can be put back.
 *
 * The `Request` is built before Fedify decides whether it handles the request.
 * Laziness alone is not enough: `Request.clone()` tees the body, and a tee pulls
 * a chunk right away, so a dispatcher calling `ctx.getSignedKey()` starts
 * reading the body even if Fedify then declines the request.  Reading in paused
 * mode, rather than through `Readable.toWeb()`, lets `restore()` unshift those
 * chunks back.
 */
function createRequestBody(message: Readable): RequestBody {
  const consumed: Uint8Array[] = [];
  const restoring = new AbortController();
  let started = false;
  let restored = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        started = true;
        while (!restored) {
          const size = message.readableLength;
          // Reading the exact buffered size, unlike read() without an argument,
          // never makes the stream emit "end", after which unshift() would
          // throw:
          const chunk: Uint8Array | string | null = size > 0
            ? message.read(size)
            : null;
          if (chunk != null) {
            const bytes = typeof chunk === "string"
              ? Buffer.from(chunk)
              : chunk;
            consumed.push(bytes);
            controller.enqueue(bytes);
            return;
          }
          if (isEnded(message)) break;
          if (message.destroyed) {
            throw new Error("The request was closed before its body ended.");
          }
          await waitForReadable(message, restoring.signal);
        }
        controller.close();
      },
      cancel(reason) {
        if (started && !restored) {
          message.destroy(reason instanceof Error ? reason : undefined);
        }
      },
    },
    { highWaterMark: 0 },
  );
  return {
    stream,
    restore() {
      restored = true;
      // Detaches a pending "readable" listener, which would otherwise keep the
      // stream from flowing into the framework's "data" listeners:
      restoring.abort();
      for (let i = consumed.length - 1; i >= 0; i--) {
        message.unshift(consumed[i]);
      }
      consumed.length = 0;
    },
  };
}

/**
 * Tells whether the stream has received all of its data, even if it has not
 * emitted `"end"` yet.  No public API exposes this, so it reads the internal
 * state, which Node.js, Deno, and Bun all provide, and falls back to
 * `readableEnded` elsewhere.
 */
function isEnded(message: Readable): boolean {
  const state = (message as Readable & {
    _readableState?: { ended?: boolean };
  })._readableState;
  return state?.ended ?? message.readableEnded;
}

function waitForReadable(
  message: Readable,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return resolve();
    const cleanup = () => {
      message.off("readable", onReady);
      message.off("end", onReady);
      message.off("close", onReady);
      message.off("error", onError);
      signal.removeEventListener("abort", onReady);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (error: unknown) => {
      cleanup();
      reject(error);
    };
    message.on("readable", onReady);
    message.on("end", onReady);
    message.on("close", onReady);
    message.on("error", onError);
    signal.addEventListener("abort", onReady);
  });
}

function setEResponse(res: EResponse, response: Response): Promise<void> {
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (response.body == null) return Promise.resolve();
  const body = response.body;
  return new Promise((resolve) => {
    const reader = body.getReader();
    reader.read().then(function read({ done, value }) {
      if (done) {
        reader.releaseLock();
        resolve();
        return;
      }
      res.write(Buffer.from(value));
      reader.read().then(read);
    });
  });
}

/**
 * Waits for downstream handling to finish before replacing an unsent 404.
 * A matched route can still fall through, and next() does not wait for an
 * asynchronous handler. Already committed responses belong to the application.
 */
function installNotAcceptableFallback(req: ERequest, res: EResponse): void {
  const end = res.end;
  const send = res.send;
  let pending = true;
  let applicationResponse = false;
  const wrappedSend: typeof res.send = function (
    this: EResponse,
    body?: unknown,
  ) {
    applicationResponse = true;
    return send.call(this, body);
  };
  res.send = wrappedSend;
  const wrapped: typeof res.end = function (
    this: EResponse,
    ...args: unknown[]
  ) {
    if (this.end === wrapped) this.end = end;
    if (this.send === wrappedSend) this.send = send;
    if (
      !pending || applicationResponse || this.headersSent ||
      this.statusCode !== 404 || !isDefaultNotFound(req, this, args[0])
    ) {
      pending = false;
      return end.apply(this, args as Parameters<typeof end>);
    }
    pending = false;
    const callback = args.find((arg) => typeof arg === "function") as
      | (() => void)
      | undefined;
    const body = "Not acceptable";
    this.statusCode = 406;
    this.statusMessage = "Not Acceptable";
    for (
      const header of [
        "Content-Encoding",
        "Content-Language",
        "Content-Range",
        "ETag",
        "Last-Modified",
        "Transfer-Encoding",
      ]
    ) this.removeHeader(header);
    this.setHeader("Content-Type", "text/plain; charset=utf-8");
    this.setHeader("Content-Length", Buffer.byteLength(body));
    this.vary("Accept");
    return end.call(
      this,
      req.method === "HEAD" ? undefined : body,
      "utf8",
      callback,
    );
  };
  res.end = wrapped;
}

/**
 * Express offers no public router-exhaustion callback to middleware. Recognize
 * finalhandler's default page, failing safe when its format changes. An app
 * response identical to that default page cannot be distinguished from it.
 */
function isDefaultNotFound(
  req: ERequest,
  res: EResponse,
  chunk: unknown,
): boolean {
  if (
    res.getHeader("Content-Security-Policy") !== "default-src 'none'" ||
    res.getHeader("X-Content-Type-Options") !== "nosniff" ||
    res.getHeader("Content-Type") !== "text/html; charset=utf-8"
  ) return false;
  // Match the whole default page, preserving custom HTML with similar
  // markup. HEAD omits the page, so only its expected length is available.
  const path = (req.originalUrl ?? req.url).split("?")[0];
  // Match finalhandler's encodeurl escaping, retaining valid percent escapes.
  const encodedPath = path
    .replace(
      /(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF]([^\uDC00-\uDFFF]|$)/g,
      "$1\uFFFD$2",
    )
    .replace(
      /(?:[^\x21\x23-\x3B\x3D\x3F-\x5F\x61-\x7A\x7C\x7E]|%(?:[^0-9A-Fa-f]|[0-9A-Fa-f][^0-9A-Fa-f]|$))+/g,
      encodeURI,
    );
  const message = `Cannot ${req.method} ${encodedPath}`.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
  const page = '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n' +
    `<pre>${message}</pre>\n</body>\n</html>\n`;
  return req.method === "HEAD"
    ? chunk == null &&
      Number(res.getHeader("Content-Length")) === Buffer.byteLength(page)
    : chunk === page;
}
