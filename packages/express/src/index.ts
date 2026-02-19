import type { Federation } from "@fedify/fedify";
import type {
  NextFunction,
  Request as ERequest,
  Response as EResponse,
} from "express";
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";

type Middleware = (req: ERequest, res: EResponse, next: NextFunction) => void;

export type ContextDataFactory<TContextData> = (
  req: ERequest,
) => TContextData | Promise<TContextData>;

export function integrateFederation<TContextData>(
  federation: Federation<TContextData>,
  contextDataFactory: ContextDataFactory<TContextData>,
): Middleware {
  return (req, res, next) => {
    const request = fromERequest(req);
    const contextData = contextDataFactory(req);
    const contextDataPromise = contextData instanceof Promise
      ? contextData
      : Promise.resolve(contextData);
    contextDataPromise.then(async (contextData) => {
      let notFound = false;
      let notAcceptable = false;
      const response = await federation.fetch(request, {
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
      // Prevent the Express framework from sending the response again:
      res.end();
      res.status = () => res;
      res.send = () => res;
      res.end = () => res;
      res.json = () => res;
      res.removeHeader = () => res;
      res.setHeader = () => res;
    });
  };
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
      : (Readable.toWeb(req)),
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
