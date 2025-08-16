import { assertEquals, assertExists } from "@std/assert";
import { createFederationBuilder } from "../fedify/federation/builder.ts";
import { MemoryKvStore } from "../fedify/federation/kv.ts";
import {
  createDebugger,
  integrateDebugger,
  integrateDebuggerWithFederation,
} from "./integration.ts";

Deno.test("integrateDebugger - adds observer to federation builder", () => {
  const federation = createFederationBuilder<void>();

  const result = integrateDebugger(federation, {
    path: "/debug",
    maxActivities: 100,
  });

  assertExists(result.observer);
  assertExists(result.handler);
  assertEquals(result.path, "/debug");

  // Check that observer was added to federation
  const options = (federation as any).options;
  assertExists(options);
  assertExists(options.observers);
  assertEquals(options.observers.length, 1);
  assertEquals(options.observers[0], result.observer);
});

Deno.test("integrateDebugger - respects autoRegisterRoutes option", () => {
  const federation = createFederationBuilder<void>();

  const result = integrateDebugger(federation, {
    autoRegisterRoutes: false,
  });

  assertExists(result.observer);
  assertExists(result.handler);
  assertEquals(result.path, "/__debugger__"); // Default path
});

Deno.test("createDebugger - creates standalone debugger", () => {
  const { observer, handler } = createDebugger({
    maxActivities: 500,
    production: true,
    token: "secret",
  });

  assertExists(observer);
  assertExists(handler);
  assertEquals(observer.isProduction(), true);
  assertEquals(observer.getToken(), "secret");
});

Deno.test("createDebugger - uses default options", () => {
  const { observer } = createDebugger();

  assertExists(observer);
  assertEquals(observer.getPath(), "/__debugger__");
  assertEquals(observer.isProduction(), false);
});
