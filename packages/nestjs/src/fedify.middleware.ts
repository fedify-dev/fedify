import type { Federation } from "@fedify/fedify";
import { Injectable, type NestMiddleware, type Type } from "@nestjs/common";
import type {
  NextFunction,
  Request as ERequest,
  Response as EResponse,
} from "express";
import { Buffer } from "node:buffer";

export type ContextDataFactory<TContextData> = (
  req: Request,
  res: Response,
) => TContextData | Promise<TContextData>;

// from https://github.com/fedify-dev/fedify/blob/main/express/index.ts
export function integrateFederation<TContextData>(
  federation: Federation<unknown>,
  contextDataFactory: ContextDataFactory<TContextData>,
): Type<NestMiddleware> {
  @Injectable()
  class FedifyIntegrationMiddleware implements NestMiddleware {
    async use(req: ERequest, res: EResponse, next: NextFunction) {
      let notFound = false;
      let notAcceptable = false;

      const contextData = await contextDataFactory(req, res);

      // Create Web API Request
      const webRequest = fromERequest(req);
      const response = await federation.fetch(webRequest, {
        contextData,
        onNotFound: () => {
          // If the `federation` object finds a request not responsible for it
          // (i.e., not a federation-related request), it will call the `next`
          // function provided by the Express framework to continue the request
          // handling by the Express:
          notFound = true;
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

      next();
    }
  }

  return FedifyIntegrationMiddleware;
}

function fromERequest(req: ERequest): Request {
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
    body: req.method === "GET" || req.method === "HEAD"
      ? undefined
      : (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)
        ? JSON.stringify(req.body)
        : req.body),
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
  const json = res.json;
  let pending = true;
  let defaultNotFound = false;
  const wrappedJson: typeof res.json = function (
    this: EResponse,
    body?: unknown,
  ) {
    // Nest's terminal NotFoundException is sent through the exception filter,
    // not Express's finalhandler. Observe the object before send() serializes
    // it (or omits it for HEAD). Custom controller/filter responses stay intact.
    defaultNotFound = this.statusCode === 404 && isDefaultNotFound(req, body);
    return json.call(this, body);
  };
  res.json = wrappedJson;
  const wrapped: typeof res.end = function (
    this: EResponse,
    ...args: unknown[]
  ) {
    if (this.end === wrapped) this.end = end;
    if (this.json === wrappedJson) this.json = json;
    if (
      !pending || !defaultNotFound || this.headersSent ||
      this.statusCode !== 404
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

/** A custom response copying Nest's exact default 404 is indistinguishable. */
function isDefaultNotFound(req: ERequest, body: unknown): boolean {
  if (
    body == null || typeof body !== "object" || Object.keys(body).length !== 3
  ) {
    return false;
  }
  const error = body as {
    statusCode?: unknown;
    error?: unknown;
    message?: unknown;
  };
  return error.statusCode === 404 && error.error === "Not Found" &&
    error.message === `Cannot ${req.method} ${req.originalUrl}`;
}
