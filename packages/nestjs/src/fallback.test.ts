import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { test } from "@fedify/fixture";
import { strict as assert } from "node:assert";
import "reflect-metadata";
import {
  Controller,
  Get,
  Header,
  HttpCode,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  Next,
  NotFoundException,
  RequestMethod,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { AddressInfo } from "node:net";
// Node cannot load legacy decorators directly; exercise the built middleware.
import { integrateFederation } from "../dist/index.mjs";

for (
  const mode of [
    "unhandled",
    "async-pass",
    "html",
    "async-html",
    "not-found-html",
    "not-found-json",
    "not-found-error",
    "controller-pass",
  ]
) {
  test(
    "NestJS preserves the application's response or falls back to 406: " + mode,
    async () => {
      const fed = createFederation<void>({ kv: new MemoryKvStore() });
      fed.setActorDispatcher("/users/{identifier}", () => null);
      class ActorController {
        async actor(next?: () => void) {
          if (mode === "controller-pass") return next!();
          if (mode === "not-found-error") {
            throw new NotFoundException("No such user");
          }
          if (mode === "not-found-json") return { error: "No such user" };

          if (mode === "async-html") {
            await new Promise((r) => setTimeout(r, 10));
          }
          return mode === "not-found-html"
            ? "<p>No such user</p>"
            : "<p>Alice</p>";
        }
      }
      Controller("users")(ActorController);
      Get(":identifier")(
        ActorController.prototype,
        "actor",
        Object.getOwnPropertyDescriptor(ActorController.prototype, "actor")!,
      );
      const descriptor = Object.getOwnPropertyDescriptor(
        ActorController.prototype,
        "actor",
      )!;
      if (mode.startsWith("not-found")) {
        HttpCode(404)(ActorController.prototype, "actor", descriptor);
      }
      if (mode === "not-found-html") {
        Header("Content-Type", "text/html")(
          ActorController.prototype,
          "actor",
          descriptor,
        );
      }
      if (mode === "controller-pass") {
        Next()(ActorController.prototype, "actor", 0);
      }
      class AppModule implements NestModule {
        configure(consumer: MiddlewareConsumer) {
          consumer.apply(integrateFederation(fed, () => undefined)).forRoutes(
            { path: "users/:identifier", method: RequestMethod.GET },
            { path: "users/:identifier", method: RequestMethod.HEAD },
          );
          if (mode === "async-pass") {
            consumer.apply(
              async (_req: unknown, _res: unknown, next: () => void) => {
                await new Promise((r) => setTimeout(r, 10));
                next();
              },
            ).forRoutes({
              path: "users/:identifier",
              method: RequestMethod.GET,
            });
          }
        }
      }
      Module({
        controllers: mode !== "unhandled" && mode !== "async-pass"
          ? [ActorController]
          : [],
      })(
        AppModule,
      );
      const app = await NestFactory.create(AppModule, { logger: false });
      try {
        await app.listen(0, "127.0.0.1");
        const { port } = app.getHttpServer().address() as AddressInfo;
        app.getHttpAdapter().getInstance().set("json spaces", 2);
        for (const method of ["GET", "HEAD"]) {
          const response = await fetch(`http://127.0.0.1:${port}/users/alice`, {
            method,
            headers: { Accept: "image/png" },
            signal: AbortSignal.timeout(5000),
          });
          const expected = mode.startsWith("not-found")
            ? 404
            : mode.endsWith("html")
            ? 200
            : 406;
          assert.equal(response.status, expected);
          const body = await response.text();
          if (method === "HEAD") assert.equal(body, "");
          else if (mode === "not-found-json") {
            assert.deepEqual(JSON.parse(body), { error: "No such user" });
          } else if (mode === "not-found-error") {
            assert.equal(JSON.parse(body).message, "No such user");
          } else {assert.equal(
              body,
              expected === 406
                ? "Not acceptable"
                : mode === "not-found-html"
                ? "<p>No such user</p>"
                : "<p>Alice</p>",
            );}
          if (expected === 406) {
            assert.equal(
              response.headers.get("Content-Type")?.split(";")[0],
              "text/plain",
            );
            assert.ok(
              response.headers.get("Vary")?.split(",").some((field) =>
                field.trim().toLowerCase() === "accept"
              ),
            );
            assert.equal(response.headers.get("ETag"), null);
          }
        }
        const missing = await fetch(`http://127.0.0.1:${port}/missing`);
        assert.equal(missing.status, 404);
        assert.equal((await missing.json()).statusCode, 404);
        assert.equal(missing.headers.get("Vary"), null);
      } finally {
        app.getHttpServer().closeAllConnections();
        await app.close();
      }
    },
  );
}
