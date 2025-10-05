/**
 * Fedify with Fastify
 * ===================
 *
 * This module provides integration between Fedify and Fastify.
 */
import type { Federation, FederationFetchOptions } from "@fedify/fedify";
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyPluginOptions,
  FastifyRequest,
} from "fastify";
import fp from "fastify-plugin";

import { Readable } from "node:stream";

type ErrorHandlers = Omit<FederationFetchOptions<unknown>, "contextData">;

/**
 * A factory function that creates context data for the Federation instance.
 */
export type ContextDataFactory<TContextData> = (
  request: FastifyRequest,
) => TContextData | Promise<TContextData>;

/**
 * Plugin options for Fedify integration.
 */
export interface FedifyPluginOptions<TContextData>
  extends FastifyPluginOptions {
  federation: Federation<TContextData>;
  contextDataFactory?: ContextDataFactory<TContextData>;
  errorHandlers?: Partial<ErrorHandlers>;
}

/**
 * Fastify plugin that integrates with a Federation instance.
 *
 * @example
 * ```typescript
 * import { createFederation, MemoryKvStore, Person } from "@fedify/fedify";
 * import fedifyPlugin from "@fedify/fastify";
 * import Fastify from "fastify";
 *
 * const fastify = Fastify();
 *
 * const federation = createFederation({ kv: new MemoryKvStore() });
 *
 * // Add federation routes
 * federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
 *   return new Person({
 *     id: ctx.getActorUri(identifier),
 *     preferredUsername: identifier,
 *   });
 * });
 *
 * // Register the plugin
 * await fastify.register(fedifyPlugin, {
 *   federation,
 *   contextDataFactory: () => undefined,
 *   errorHandlers: { onNotFound: () => new Response("Not Found", { status: 404 }) },
 * });
 * ```
 */
const fedifyPluginCore: FastifyPluginAsync<FedifyPluginOptions<unknown>> = (
  fastify: FastifyInstance,
  options: FedifyPluginOptions<unknown>,
) => {
  const { federation, contextDataFactory = () => undefined, errorHandlers } =
    options;
  fastify.addHook("onRequest", async (request, reply) => {
    const webRequest = toWebRequest(request);
    const contextData = await contextDataFactory(request);

    const response = await federation.fetch(webRequest, {
      contextData,
      onNotAcceptable: () => defaultNotAcceptableResponse,
      onNotFound: () => dummyNotFoundResponse,
      ...errorHandlers,
    });

    // Delegate to Fastify if the response is a dummy not found response.
    if (response === dummyNotFoundResponse) {
      return;
    }

    await reply.send(response);
  });
  return Promise.resolve();
};

// Wrap with fastify-plugin to bypass encapsulation
const fedifyPlugin: FastifyPluginAsync<FedifyPluginOptions<unknown>> = fp(
  fedifyPluginCore,
  {
    name: "fedify-plugin",
    fastify: "5.x",
  },
);

const dummyNotFoundResponse = new Response("", { status: 404 });
const defaultNotAcceptableResponse = new Response("Not Acceptable", {
  status: 406,
  headers: { "Content-Type": "text/plain", Vary: "Accept" },
});

/**
 * Convert Fastify request to Web API Request.
 */
function toWebRequest(fastifyReq: FastifyRequest): Request {
  const protocol = fastifyReq.protocol;
  const host = fastifyReq.headers.host ?? fastifyReq.hostname;
  const url = `${protocol}://${host}${fastifyReq.url}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(fastifyReq.raw.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (value !== undefined) {
      headers.set(key, String(value));
    }
  }

  const body = fastifyReq.method === "GET" || fastifyReq.method === "HEAD"
    ? undefined
    : fastifyReq.body !== undefined
    ? typeof fastifyReq.body === "string"
      ? fastifyReq.body
      : JSON.stringify(fastifyReq.body)
    : Readable.toWeb(fastifyReq.raw) as ReadableStream;

  return new Request(url, {
    method: fastifyReq.method,
    headers,
    body,
  });
}

export default fedifyPlugin;

export { fedifyPlugin };
