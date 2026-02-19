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
          // if any route is matched, and otherwise, it will return a 406 Not
          // Acceptable response:
          notAcceptable = true;
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

      if (notFound || (notAcceptable && req.route != null)) return;
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
