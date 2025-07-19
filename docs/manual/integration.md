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
the `Accept` header (i.e., [content negotiation]).  Basically, this architecture
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

[content negotiation]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Content_negotiation


Express
-------

[Express] is a fast, unopinionated, minimalist web framework for Node.js.
The [@fedify/express] package provides a middleware to integrate Fedify with
Express:

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
[@fedify/express]: https://github.com/fedify-dev/express


Hono
----

*This API is available since Fedify 0.6.0.*

[Hono] is a fast, lightweight, and Web standard-compliant server framework for
TypeScript.  Fedify has the `@fedify/fedify/x/hono` module that provides
a middleware to integrate Fedify with Hono:

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { federation } from "@fedify/fedify/x/hono";
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
The [@fedify/h3] package provides a middleware to integrate Fedify with h3:

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
[@fedify/h3]: https://github.com/fedify-dev/h3


Fresh
-----

*This API is available since Fedify 0.4.0.*

[Fresh] is a full stack modern web framework for Deno.  Fedify has the
`@fedify/fedify/x/fresh` module that provides a middleware to integrate Fedify
with Fresh.  Put the following code in your *routes/_middleware.ts* file:

~~~~ typescript{8-12}
import { createFederation } from "@fedify/fedify";
import { integrateHandler } from "@fedify/fedify/x/fresh";

const federation = createFederation<string>({
  // Omitted for brevity; see the related section for details.
});

// This is the entry point to the Fedify middleware from the Fresh framework:
export const handler = integrateHandler(
  federation,
  (req, ctx) => "context data",
);

~~~~

[Fresh]: https://fresh.deno.dev/


SvelteKit
---------

*This API is available since Fedify 1.3.0.*

[SvelteKit] is a framework for building web applications with [Svelte].  Fedify
has the `@fedify/fedify/x/sveltekit` module that provides a hook handler to
integrate Fedify with SvelteKit.  Put the following code in your
*hooks.server.ts* file:

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { fedifyHook } from "@fedify/fedify/x/sveltekit";

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

> [!IMPORTANT]
> In a CommonJS-based NestJS project, this ESM-only module requires setting `NODE_OPTIONS=--experimental-require-module` at runtime

[NestJS] is a modular, versatile, and scalable framework for building efficient, reliable, and scalable server-side applications with Node.js and TypeScript.
The [@fedify/nestjs] package provides a middleware to integrate Fedify with
NestJS:


~~~~ typescript
// --- modules/federation/federation.service ---
import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import {
  FEDIFY_FEDERATION,
} from '@fedify/nestjs';
import { Federation, parseSemver } from '@fedify/fedify';

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
    this.federation.setNodeInfoDispatcher(async (context) => {
      return {
        software: {
          name: "Fedify NestJS sample",
          version: parseSemVer("0.0.1")
        }
      }
    });
  }
}

// --- modules/federation/federation.module.ts ---

import { Module } from '@nestjs/common';
import { FederationService } from './federation.service';

@Module({
  providers: [FederationService],
  exports: [FederationService],
})
export class FederationModule {}

// --- main.module.ts ---
import {
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { FederationModule } from './modules/federation/federation.module';
import { InProcessMessageQueue, MemoryKvStore, Federation } from '@fedify/fedify';

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

    // Apply middleware to all routes except auth endpoints
    consumer.apply(fedifyMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
~~~~

[NestJS]: https://nestjs.com/


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

[`Request`]: https://developer.mozilla.org/en-US/docs/Web/API/Request
[`Response`]: https://developer.mozilla.org/en-US/docs/Web/API/Response
