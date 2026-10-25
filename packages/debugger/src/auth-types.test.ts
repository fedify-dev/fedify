/** Consumer contracts that must remain valid throughout Fedify 2.x. */
import type { Federation } from "@fedify/fedify/federation";
import type { Sink } from "@logtape/logtape";
import { strictEqual } from "node:assert/strict";
import { test } from "node:test";
import {
  createFederationDebugger,
  type FederationDebuggerAuth,
  type FederationDebuggerOptions,
  type FederationDebuggerSimpleOptions,
} from "@fedify/debugger";

function describeAuth(auth: FederationDebuggerAuth): string {
  switch (auth.type) {
    case "password":
      return "password";
    case "usernamePassword":
      return "username and password";
    case "request":
      return "request";
    default: {
      const exhaustive: never = auth;
      return exhaustive;
    }
  }
}

// Existing wrappers and dependency-injection implementations must still be
// assignable to the factory, not only the other way around.
function wrapDebugger<T>(
  federation: Federation<T>,
  options?: FederationDebuggerSimpleOptions,
): Federation<T> & { sink: Sink } {
  return createFederationDebugger(federation, options);
}

interface LegacyFactory {
  <T>(
    federation: Federation<T>,
    options?: FederationDebuggerSimpleOptions,
  ): Federation<T> & { sink: Sink };
  <T>(
    federation: Federation<T>,
    options: FederationDebuggerOptions,
  ): Federation<T> & { sink: Sink };
}

test("debugger preserves released auth consumer types", () => {
  const labels: Record<FederationDebuggerAuth["type"], string> = {
    password: "password",
    usernamePassword: "username and password",
    request: "request",
  };
  const auth: Extract<
    FederationDebuggerAuth,
    { type: "usernamePassword" }
  > = { type: "usernamePassword", username: "alice", password: "secret" };
  strictEqual(describeAuth(auth), labels[auth.type]);

  const callbackAuth: Extract<
    FederationDebuggerAuth,
    { type: "usernamePassword" }
  > = {
    type: "usernamePassword",
    authenticate(username: string, password: string) {
      return username === "alice" && password === "secret";
    },
  };
  const simple: FederationDebuggerSimpleOptions = { auth: callbackAuth };
  const releasedAuth: FederationDebuggerAuth | undefined = simple.auth;
  strictEqual(releasedAuth, callbackAuth);

  const callback: LegacyFactory = createFederationDebugger;
  const mock: typeof createFederationDebugger = wrapDebugger;
  const dependencies: { createDebugger: typeof createFederationDebugger } = {
    createDebugger: wrapDebugger,
  };
  const extractedOptions: Parameters<typeof createFederationDebugger>[1] = {
    exporter: undefined!,
    kv: undefined!,
    auth,
  };
  const extractedAuth: FederationDebuggerAuth | undefined =
    extractedOptions.auth;
  strictEqual(extractedAuth, auth);
  strictEqual(callback, createFederationDebugger);
  strictEqual(mock, wrapDebugger);
  strictEqual(dependencies.createDebugger, wrapDebugger);
});
