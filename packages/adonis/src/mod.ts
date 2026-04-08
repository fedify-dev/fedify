/**
 * Fedify with AdonisJS
 * ====================
 *
 * This package provides an [AdonisJS] middleware to integrate with Fedify.
 *
 * [AdonisJS]: https://adonisjs.com/
 *
 * @module
 */
import type { Federation } from "@fedify/fedify/federation";
import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

/**
 * Minimal interface for the AdonisJS request object.
 * Compatible with both AdonisJS v6 and v7.
 */
interface AdonisRequest {
  method(): string;
  protocol(): string;
  hostname(): string | null;
  url(): string;
  headers(): Record<string, string | string[] | undefined>;
  request: IncomingMessage;
}

/**
 * Minimal interface for the AdonisJS response object.
 * Compatible with both AdonisJS v6 and v7.
 */
interface AdonisResponse {
  response: ServerResponse;
}

/**
 * Minimal interface for the AdonisJS HTTP context.
 * Compatible with both AdonisJS v6 and v7.
 */
export interface AdonisHttpContext {
  request: AdonisRequest;
  response: AdonisResponse;
}

/**
 * A factory function to create context data for the {@link Federation} object.
 *
 * @template TContextData A type of the context data for the {@link Federation}
 *                        object.
 * @param ctx An AdonisJS HTTP context object.
 * @returns A context data for the {@link Federation} object.
 */
export type ContextDataFactory<TContextData> = (
  ctx: AdonisHttpContext,
) => TContextData | Promise<TContextData>;

/**
 * The interface that the middleware class returned by
 * {@link fedifyMiddleware} implements.
 */
export interface FedifyMiddlewareHandler {
  handle(ctx: AdonisHttpContext, next: () => Promise<void>): Promise<void>;
}

/**
 * Create an AdonisJS middleware class to integrate with the
 * {@link Federation} object.
 *
 * The returned class can be used as an AdonisJS server middleware:
 *
 * ```typescript
 * // app/middleware/fedify_middleware.ts
 * import { fedifyMiddleware } from "@fedify/adonis";
 * import federation from "#services/federation";
 *
 * export default fedifyMiddleware(federation);
 * ```
 *
 * Then register it in `start/kernel.ts`:
 *
 * ```typescript
 * server.use([
 *   () => import("#middleware/fedify_middleware"),
 *   // ... other middleware
 * ]);
 * ```
 *
 * @template TContextData A type of the context data for the {@link Federation}
 *                        object.
 * @param federation A {@link Federation} object to integrate with AdonisJS.
 * @param contextDataFactory A function to create context data for the
 *                           {@link Federation} object.
 * @returns An AdonisJS middleware class.
 */
export function fedifyMiddleware<TContextData>(
  federation: Federation<TContextData>,
  contextDataFactory: ContextDataFactory<TContextData> = () =>
    void 0 as TContextData,
): { new (): FedifyMiddlewareHandler } {
  return class FedifyMiddleware implements FedifyMiddlewareHandler {
    async handle(
      ctx: AdonisHttpContext,
      next: () => Promise<void>,
    ): Promise<void> {
      const request = fromAdonisRequest(ctx);
      let contextData = contextDataFactory(ctx);
      if (contextData instanceof Promise) contextData = await contextData;

      let notFound = false;
      let notAcceptable = false;

      const response = await federation.fetch(request, {
        contextData,
        onNotFound: async () => {
          notFound = true;
          await next();
          return new Response("Not found", { status: 404 });
        },
        onNotAcceptable: async () => {
          notAcceptable = true;
          await next();
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
      await writeResponse(ctx, response);
    }
  };
}

export default fedifyMiddleware;

function fromAdonisRequest(ctx: AdonisHttpContext): Request {
  const allHeaders = ctx.request.headers();
  const host = allHeaders["host"] ?? ctx.request.hostname() ?? "localhost";
  const url = `${ctx.request.protocol()}://${host}${ctx.request.url()}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(allHeaders)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.append(key, value);
    }
  }
  const method = ctx.request.method();
  return new Request(url, {
    method,
    headers,
    // @ts-ignore: duplex is not supported in Deno, but it is in Node.js
    duplex: "half",
    body: method === "GET" || method === "HEAD"
      ? undefined
      : Readable.toWeb(ctx.request.request as unknown as Readable),
  });
}

function writeResponse(
  ctx: AdonisHttpContext,
  response: Response,
): Promise<void> {
  const nodeRes = ctx.response.response;
  nodeRes.statusCode = response.status;
  response.headers.forEach((value, key) => nodeRes.setHeader(key, value));
  if (response.body == null) {
    nodeRes.end();
    return Promise.resolve();
  }
  const body = response.body;
  const reader = body.getReader();
  return new Promise((resolve) => {
    reader.read().then(function read({ done, value }) {
      if (done) {
        reader.releaseLock();
        nodeRes.end();
        resolve();
        return;
      }
      nodeRes.write(Buffer.from(value));
      reader.read().then(read);
    });
  });
}
