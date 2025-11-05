---
description: >-
  Fedify is designed to be used together with web frameworks.  This document
  explains how to integrate Fedify with web frameworks.
---

Integration
===========

Fedify is designed to be used together with web frameworks.  This document
explains how to integrate Fedify with web frameworks.


How it works
------------

Usually, Fedify behaves as a middleware that wraps around the web framework's
request handler.  The middleware intercepts the incoming HTTP requests and
dispatches them to the appropriate handler based on the request path and
the [`Accept`] header (i.e., [content negotiation]).  Basically, this architecture
allows Fedify and your web framework to coexist in the same domain and port.

For example, if you make a request to */.well-known/webfinger* Fedify will
handle the request by itself, but if you make a request to */users/alice*
(assuming your web framework has a handler for `/users/:handle`) with `Accept:
text/html` header, Fedify will dispatch the request to the web framework's
appropriate handler for `/users/:handle`.  Or if you define an actor dispatcher
for `/users/{handle}` in Fedify, and the request is made with `Accept:
application/activity+json` header, Fedify will dispatch the request to the
appropriate actor dispatcher.

Here is a diagram that illustrates the architecture:

~~~~ mermaid
sequenceDiagram
  participant Client
  participant Fedify
  participant AD as Actor dispatcher<br/>(Fedify)
  participant WF as Web framework

  Client ->> Fedify: GET /users/alice<br/>(Accept: application/activity+json)
  Fedify -->> Client: 200 OK
  Fedify ->> AD: GET /users/alice
  AD -->> Fedify: 200 OK
  Fedify -->> Client: 200 OK

  Client ->> Fedify: GET /users/alice<br/>(Accept: text/html)
  Fedify ->> AD: GET /users/alice<br/>(Accept: text/html)
  AD -->> Fedify: 406 Not Acceptable
  Fedify ->> WF: GET /users/alice
  WF -->> Fedify: 200 OK
  Fedify -->> Client: 200 OK
~~~~

> [!NOTE]
>
> Why not use a reverse proxy in front of the web framework and Fedify?
> Because you would want to call Fedify's API from the web framework's
> request handler, e.g., to send an ActivityPub activity.  If you put a
> reverse proxy in front of them, the web framework cannot call Fedify's API
> directly.
>
> Of course, you can divide your application into two separate services,
> one for ActivityPub and the other for the web application, and put a
> reverse proxy in front of them.  But in this case, you need to implement
> the communication between the two services (using a message queue or RPC,
> for example), which is non-trivial.

[`Accept`]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Accept
[content negotiation]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Content_negotiation


Express
-------

[Express] is a fast, unopinionated, minimalist web framework for Node.js.
The *@fedify/express* package provides a middleware to integrate Fedify with
Express:

::: code-group

~~~~ sh [Deno]
deno add jsr:@fedify/express
~~~~

~~~~ sh [npm]
npm add @fedify/express
~~~~

~~~~ sh [pnpm]
pnpm add @fedify/express
~~~~

~~~~ sh [Yarn]
yarn add @fedify/express
~~~~

~~~~ sh [Bun]
bun add @fedify/express
~~~~

:::

~~~~ typescript twoslash
// @noErrors: 2345
import express from "express";
import { integrateFederation } from "@fedify/express";
import { createFederation } from "@fedify/fedify";

export const federation = createFederation<string>({
  // Omitted for brevity; see the related section for details.
});

export const app = express();

app.set("trust proxy", true);

app.use(integrateFederation(federation, (req) => "context data goes here"));  // [!code highlight]
~~~~

[Express]: https://expressjs.com/


Fastify
-------

*This API is available since Fedify 1.9.0.*

[Fastify] is a fast and low overhead web framework for Node.js, with
a powerful plugin architecture and sensible defaults.  The *@fedify/fastify*
package provides a plugin to integrate Fedify with Fastify:

::: code-group

~~~~ sh [npm]
npm add @fedify/fastify
~~~~

~~~~ sh [pnpm]
pnpm add @fedify/fastify
~~~~

~~~~ sh [Yarn]
yarn add @fedify/fastify
~~~~

~~~~ sh [Bun]
bun add @fedify/fastify
~~~~

:::

~~~~ typescript twoslash
// @noErrors: 2345
import Fastify from "fastify";
import { fedifyPlugin } from "@fedify/fastify";
import { createFederation } from "@fedify/fedify";

export const federation = createFederation<void>({
  // Omitted for brevity; see the related section for details.
});

const fastify = Fastify({ logger: true });

// Register the Fedify plugin:
await fastify.register(fedifyPlugin, {  // [!code highlight]
  federation,  // [!code highlight]
  contextDataFactory: () => undefined,  // [!code highlight]
});  // [!code highlight]

fastify.listen({ port: 3000 });
~~~~

[Fastify]: https://fastify.dev/


Koa
---

*This API is available since Fedify 1.9.0.*

[Koa] is a lightweight, expressive, and modern web framework for Node.js,
designed by the team behind Express.  It uses async functions and provides
a more elegant middleware architecture.  The *@fedify/koa* package provides
a middleware to integrate Fedify with Koa:

::: code-group

~~~~ sh [Deno]
deno add jsr:@fedify/koa
~~~~

~~~~ sh [npm]
npm add @fedify/koa
~~~~

~~~~ sh [pnpm]
pnpm add @fedify/koa
~~~~

~~~~ sh [Yarn]
yarn add @fedify/koa
~~~~

~~~~ sh [Bun]
bun add @fedify/koa
~~~~

:::

~~~~ typescript twoslash
// @noErrors: 2345
import Koa from "koa";
import { createMiddleware } from "@fedify/koa";
import { createFederation } from "@fedify/fedify";

export const federation = createFederation<string>({
  // Omitted for brevity; see the related section for details.
});

export const app = new Koa();

app.proxy = true;  // trust proxy headers

app.use(createMiddleware(federation, (ctx) => "context data goes here"));  // [!code highlight]
~~~~

> [!NOTE]
> The `@fedify/koa` package supports both Koa v2.x and v3.x.

[Koa]: https://koajs.com/


Hono
----

*This API is available since Fedify 1.9.0.*

[Hono] is a fast, lightweight, and Web standard-compliant server framework for
TypeScript.  The *@fedify/hono* package provides a middleware to integrate
Fedify with Hono:

::: code-group

~~~~ sh [Deno]
deno add jsr:@fedify/hono
~~~~

~~~~ sh [npm]
npm add @fedify/hono
~~~~

~~~~ sh [pnpm]
pnpm add @fedify/hono
~~~~

~~~~ sh [Yarn]
yarn add @fedify/hono
~~~~

~~~~ sh [Bun]
bun add @fedify/hono
~~~~

:::

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { federation } from "@fedify/hono";
import { Hono } from "hono";

const fedi = createFederation<string>({
  // Omitted for brevity; see the related section for details.
});

const app = new Hono();
app.use(federation(fedi, (ctx) => "context data"));  // [!code highlight]
~~~~

[Hono]: https://hono.dev/


h3
--

[h3] is an HTTP server framework behind [Nitro], [Analog], [Vinxi],
[SolidStart], [TanStack Start], and other many web frameworks.
The *@fedify/h3* package provides a middleware to integrate Fedify with h3:

::: code-group

~~~~ sh [Deno]
deno add jsr:@fedify/h3
~~~~

~~~~ sh [npm]
npm add @fedify/h3
~~~~

~~~~ sh [pnpm]
pnpm add @fedify/h3
~~~~

~~~~ sh [Yarn]
yarn add @fedify/h3
~~~~

~~~~ sh [Bun]
bun add @fedify/h3
~~~~

:::

~~~~ typescript {9-15} twoslash
// @noErrors: 2345
import { createApp, createRouter } from "h3";
import { createFederation } from "@fedify/fedify";
import { integrateFederation, onError } from "@fedify/h3";

export const federation = createFederation<string>({
  // Omitted for brevity; see the related section for details.
});

export const app = createApp({ onError });
app.use(
  integrateFederation(
    federation,
    (event, request) => "context data goes here"
  )
);

const router = createRouter();
app.use(router);
~~~~

> [!NOTE]
> Your app has to configure `onError` to let Fedify negotiate content types.
> If you don't do this, Fedify will not be able to respond with a proper error
> status code when a content negotiation fails.

[h3]: https://h3.unjs.io/
[Nitro]: https://nitro.unjs.io/
[Analog]: https://analogjs.org/
[Vinxi]: https://vinxi.vercel.app/
[SolidStart]: https://start.solidjs.com/
[TanStack Start]: https://tanstack.com/start


SvelteKit
---------

*This API is available since Fedify 1.3.0.*

[SvelteKit] is a framework for building web applications with [Svelte].  The
*@fedify/sveltekit* package provides a middleware to integrate Fedify with
SvelteKit:

::: code-group

~~~~ sh [Deno]
deno add jsr:@fedify/sveltekit
~~~~

~~~~ sh [npm]
npm add @fedify/sveltekit
~~~~

~~~~ sh [pnpm]
pnpm add @fedify/sveltekit
~~~~

~~~~ sh [Yarn]
yarn add @fedify/sveltekit
~~~~

~~~~ sh [Bun]
bun add @fedify/sveltekit
~~~~

:::

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { fedifyHook } from "@fedify/sveltekit";

const federation = createFederation<string>({
  // Omitted for brevity; see the related section for details.
});

// This is the entry point to the Fedify hook from the SvelteKit framework:
export const handle = fedifyHook(federation, (req) => "context data");
~~~~

[SvelteKit]: https://kit.svelte.dev/
[Svelte]: https://svelte.dev/


NestJS
------

*This API is available since Fedify 1.8.0.*

[NestJS] is a modular, versatile, and scalable framework for building efficient,
reliable, and scalable server-side applications with Node.js and TypeScript.
The *@fedify/nestjs* package provides a middleware to integrate Fedify with
NestJS:

::: code-group

~~~~ sh [npm]
npm add @fedify/nestjs
~~~~

~~~~ sh [pnpm]
pnpm add @fedify/nestjs
~~~~

~~~~ sh [Yarn]
yarn add @fedify/nestjs
~~~~

~~~~ sh [Bun]
bun add @fedify/nestjs
~~~~

:::

~~~~ typescript [modules/federation/federation.service.ts] twoslash
import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import {
  FEDIFY_FEDERATION,
} from '@fedify/nestjs';
import { Federation } from '@fedify/fedify';

@Injectable()
export class FederationService implements OnModuleInit {
  private initialized = false;

  constructor(
    @Inject(FEDIFY_FEDERATION) private federation: Federation<unknown>,
  ) { }

  async onModuleInit() {
    if (!this.initialized) {
      await this.initialize();
      this.initialized = true;
    }
  }

  async initialize() {
    this.federation.setNodeInfoDispatcher("/nodeinfo/2.1", async (context) => {
      return {
        software: {
          name: "Fedify NestJS sample",
          version: "0.0.1"
        },
        protocols: ["activitypub"],
        usage: {
          users: {
            total: 0,
            activeHalfyear: 0,
            activeMonth: 0,
            activeDay: 0,
          },
          localPosts: 0,
          localComments: 0,
        },
      }
    });
  }
}
~~~~

~~~~ typescript [modules/federation/federation.module.ts] twoslash
// @noErrors: 2395 2307
import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import {
  FEDIFY_FEDERATION,
} from '@fedify/nestjs';
import { Federation } from '@fedify/fedify';

@Injectable()
export class FederationService implements OnModuleInit {
  private initialized = false;

  constructor(
    @Inject(FEDIFY_FEDERATION) private federation: Federation<unknown>,
  ) { }

  async onModuleInit() {
    if (!this.initialized) {
      await this.initialize();
      this.initialized = true;
    }
  }

  async initialize() {
  }
}
// ---cut-before---
import { Module } from '@nestjs/common';
import { FederationService } from './federation.service';

@Module({
  providers: [FederationService],
  exports: [FederationService],
})
export class FederationModule {}
~~~~

~~~~ typescript [app.module.ts] twoslash
// @noErrors: 2307
// ---cut-before---
import {
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as express from 'express';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { FederationModule } from './modules/federation/federation.module';
import { InProcessMessageQueue, MemoryKvStore, Federation } from '@fedify/fedify';
import process from 'node:process';

import {
  FEDIFY_FEDERATION,
  FedifyModule,
  integrateFederation,
} from '@fedify/nestjs';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
    FedifyModule.forRoot({
      kv: new MemoryKvStore(),
      queue: new InProcessMessageQueue(),
      origin: process.env.FEDERATION_ORIGIN || 'http://localhost:3000',
    }),
    FederationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  constructor(
    @Inject(FEDIFY_FEDERATION) private federation: Federation<unknown>,
  ) { }

  configure(consumer: MiddlewareConsumer) {
    const fedifyMiddleware = integrateFederation(
      this.federation,
      async (req, res) => {
        return {
          request: req,
          response: res,
          url: new URL(req.url, process.env.FEDERATION_ORIGIN),
        };
      },
    );

    // Fedify middleware requires the raw request body for HTTP signature verification
    // so we apply `express.raw()` before `fedifyMiddleware` to preserve the body.
    consumer.apply(
      express.raw({ type: '*/*' }),
      fedifyMiddleware
    ).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
~~~~

[NestJS]: https://nestjs.com/


Elysia
------

*This API is available since Fedify 1.8.0.*

[Elysia] is an ergonomic framework designed for humans, featuring built-in
TypeScript support with end-to-end type safety, type integrity, and
an exceptional developer experience.  Powered by Bun, it delivers high
performance and modern tooling.  The *@fedify/elysia* package provides
a seamless plugin for integrating Fedify with Elysia:

~~~~ sh [Bun]
bun add @fedify/elysia
~~~~

~~~~ typescript
import { fedify } from "@fedify/elysia";
import { federation } from "./federation.ts";  // Your `Federation` instance
import { Elysia } from "elysia";

const app = new Elysia();

app
  .use(fedify(federation, () => "context data goes here"))
  .listen(3000);

console.log("Elysia App Start!");
~~~~

[Elysia]: https://elysiajs.com/


Next.js
-------

*This API is available since Fedify 1.9.0.*

> [!TIP]
> You can see the example in the `examples/next-integration` directory in
> the [Fedify repository].  You can create a Fedify–Next.js app copying the
> example with the following command:
>
> ::: code-group
>
> ~~~~ sh [npm]
> npx create-next-app -e https://github.com/fedify-dev/fedify \
>   --example-path examples/next-integration
> ~~~~
>
> ~~~~ sh [pnpm]
> pnpm create next-app -e https://github.com/fedify-dev/fedify \
>   --example-path examples/next-integration
> ~~~~
>
> ~~~~ sh [Yarn]
> yarn create next-app -e https://github.com/fedify-dev/fedify \
>   --example-path examples/next-integration
> ~~~~
>
> ~~~~ sh [Bun]
> bun create next-app -e https://github.com/fedify-dev/fedify \
>   --example-path examples/next-integration
> ~~~~
>
> :::

[Next.js] is a React framework that enables you to build server-rendered
and statically generated web applications.  The *@fedify/next* package provides
a middleware to integrate Fedify with Next.js:

::: code-group

~~~~ sh [Deno]
deno add jsr:@fedify/next
~~~~

~~~~ sh [npm]
npm add @fedify/next
~~~~

~~~~ sh [pnpm]
pnpm add @fedify/next
~~~~

~~~~ sh [Yarn]
yarn add @fedify/next
~~~~

~~~~ sh [Bun]
bun add @fedify/next
~~~~

:::

Or create an app with the following command using the Fedify CLI:

~~~~ sh
fedify init my-next-app
~~~~

~~~~
? Choose the JavaScript runtime to use › Node.js
? Choose the package manager to use › npm
? Choose the web framework to integrate Fedify with › Next.js
? Choose the key–value store to use for caching › In-memory
? Choose the message queue to use for background jobs › In-process
✔ Would you like your code inside a `src/` directory? … No
✔ Would you like to customize the import alias (`@/*` by default)? … No
~~~~

Then you can see the Next.js boilerplate code in the `my-next-app` directory.
If you have created a Next.js app with `create-next-app` before, you'll see
some differences in the code. There is a `middleware.ts` file in the
`my-next-app` directory, which is the entry point to the Fedify middleware
from the Next.js framework. Or, if you just install *@fedify/next* manually,
put the following code in your `middleware.ts` file:

~~~~ typescript
import { fedifyWith } from "@fedify/next";
import federation from "./federation"; // Your `Federation` instance

export default fedifyWith(federation)(
/*
  function (request: Request) {
    // If you need to handle other requests besides federation
    // requests in middleware, you can do it here.
    // If you handle only federation requests in middleware,
    // you don't need this function.
    return NextResponse.next();
  },
*/
)

// This config needs because middleware process only requests with the
// "Accept" header matching the federation accept regex.
// More details: https://nextjs.org/docs/app/api-reference/file-conventions/middleware#config-object-optional
export const config = {
  runtime: "nodejs",
  matcher: [
    {
      source: "/:path*",
      has: [
        {
          type: "header",
          key: "Accept",
          value: ".*application\\/((jrd|activity|ld)\\+json|xrd\\+xml).*",
        },
      ],
    },
    {
      source: "/:path*",
      has: [
        {
          type: "header",
          key: "content-type",
          value: ".*application\\/((jrd|activity|ld)\\+json|xrd\\+xml).*",
        },
      ],
    },
    { source: "/.well-known/nodeinfo" },
    { source: "/.well-known/x-nodeinfo2" },
  ],
};
~~~~

As you can see in the comment, you can handle other requests besides
federation requests in the middleware.  If you handle only federation requests
in the middleware, you can omit the function argument of `fedifyWith()`.
The `config` object is necessary to let Next.js know that the middleware
should process requests with the [`Accept`] header matching the federation
accept regex.  This is because Next.js middleware processes only requests
with the [`Accept`] header matching the regex by default.  More details can be
found in the Next.js official documentation [`config` in `middleware.js`].

[Next.js]: https://nextjs.org/
[`config` in `middleware.js`]: https://nextjs.org/docs/app/api-reference/file-conventions/middleware#config-object-optional

Fresh
-----

*This API is available since Fedify 2.0.0.*

[Fresh] is a full stack modern web framework for Deno.  Fedify has the
`@fedify/fresh` module that provides a middleware to integrate Fedify
with Fresh.

::: code-group

~~~~ sh [Deno]
deno add jsr:@fedify/fresh
~~~~

:::

> [!NOTE]
> The `@fedify/fresh` package only supports Fresh 2.x.

> [!WARNING]
> Due to `@fedify/fedify`'s `multicodec` dependency CJS issue, you should externalize `@fedify/fedify` in `vite.config.ts`.
>
> ~~~~typescript
> import { fresh } from "@fresh/plugin-vite";
> import { defineConfig } from "vite";
> 
> export default defineConfig({
>   plugins: [fresh()],
>   ssr: {
>     external: [
>       "@fedify/fedify",
>     ],
>   },
>   build: {
>     rollupOptions: {
>       external: [
>         "@fedify/fedify",
>       ],
>     },
>   },
> });
> ~~~~

> [!WARNING]
> Due to `@fedify/fedify` use `Temporal` inside, you should add `deno.unstable` to `compilerOptions.libs` field of `deno.json`.
> ~~~~json
>  "compilerOptions": {
>    "lib": [
>      "dom",
>      "dom.asynciterable",
>      "dom.iterable",
>      "deno.ns",
>      "deno.unstable"
>    ],
> ...
> ~~~~

Put the following code in your *routes/_middleware.ts* file:

~~~~ typescript [_middelware.ts]
import { createFederation } from "@fedify/fedify";
import { integrateHandler } from "@fedify/fresh";
import { define } from "../utils.ts";

const federation = createFederation<void>({
  // Omitted for brevity; see the related section for details.
});

// This is the entry point to the Fedify middleware from the Fresh framework:
export default define.middleware(
  integrateHandler(federation, () => undefined),
);
~~~~

Or you can use `app.use()` in your `main.ts` to register the middleware globally:

~~~~ typescript [main.ts]
import { App } from "fresh";
import { createFederation } from "@fedify/fedify";
import { integrateHandler } from "@fedify/fresh";
import { define } from "./utils.ts";
const app = new App();
const federation = createFederation<void>({
  // Omitted for brevity; see the related section for details.
});
// This is the entry point to the Fedify middleware from the Fresh framework:
const fedifyMiddleware = define.middleware(
  integrateHandler(federation, () => undefined),
);
app.use(fedifyMiddleware);
~~~~

[Fresh]: https://fresh.deno.dev/

Custom middleware
-----------------

Even if you are using a web framework that is not officially supported by
Fedify, you can still integrate Fedify with the framework by creating a custom
middleware (unless the framework does not support middleware).

Web frameworks usually provide a way to intercept incoming requests and outgoing
responses in the middle, which is so-called <dfn>middleware</dfn>.  If your
web framework has a middleware feature, you can use it to intercept
federation-related requests and handle them with the `Federation` object.

The key is to create a middleware that calls the `Federation.fetch()` method
with the incoming request and context data, and then sends the response from
Fedify to the client.  At this point, you can use `onNotFound` and
`onNotAcceptable` callbacks to forward the request to the next middleware.

The following is an example of a custom middleware for a hypothetical web
framework:

~~~~ typescript
import { Federation } from "@fedify/fedify";

export type Middleware = (
  request: Request,
  next: (request: Request) => Promise<Response>
) => Promise<Response>;

export function createFedifyMiddleware<TContextData>(
  federation: Federation<TContextData>,
  contextDataFactory: (request: Request) => TContextData,
): Middleware {
  return async (request, next) => {
    return await federation.fetch(request, {
      contextData: contextDataFactory(request),

      // If the `federation` object finds a `request` not responsible for it
      // (i.e., not a federation-related request), it will call the `next`
      // provided by the web framework to continue the request handling by
      // the web framework:
      onNotFound: async (request) => await next(request),

      // Similar to `onNotFound`, but slightly more tickly one.
      // When the `federation` object finds a `request` not acceptable type-wise
      // (i.e., a user-agent doesn't want JSON-LD), it will call the `next`
      // provided by the web framework so that it renders HTML if there's some
      // page.  Otherwise, it will simply respond with `406 Not Acceptable`.
      // This trick enables the Fedify and the web framework to share the same
      // routes and they do content negotiation depending on `Accept` header:
      onNotAcceptable: async (request) => {
        const response = await next(request);
        if (response.status !== 404) return response;
        return new Response("Not Acceptable", {
          status: 406,
          headers: {
            "Content-Type": "text/plain",
            Vary: "Accept"
          },
        })
      }
    });
  };
}
~~~~

In some cases, your web framework may not represent requests and responses
as [`Request`] and [`Response`] objects.  In that case, you need to convert
the request and response objects to the appropriate types that the `Federation`
object can handle.

[Fedify repository]: https://github.com/fedify-dev/fedify
[`Request`]: https://developer.mozilla.org/en-US/docs/Web/API/Request
[`Response`]: https://developer.mozilla.org/en-US/docs/Web/API/Response
