import { getDocPage } from "@optique/core";
import { run } from "@optique/run";
import { assert, assertEquals } from "@std/assert";
import test from "node:test";
import { recordingSink } from "./log.ts";
import { runTunnel, tunnelCommand } from "./tunnel.ts";

test("tunnel description", () => {
  const description = getDocPage(tunnelCommand)?.description?.[0];
  const text = description?.type === "text" ? description.text : undefined;
  assert(
    text?.includes(
      "Expose a local HTTP server to the public internet using a secure tunnel.",
    ),
  );
});

test("tunnel command structure", () => {
  const testCommandWithOptions = run(tunnelCommand, {
    args: ["tunnel", "3001", "-s", "pinggy.io", "-d"],
  });
  const testCommandWithoutOptions = run(tunnelCommand, {
    args: ["tunnel", "3000"],
  });

  assertEquals(testCommandWithOptions.command, "tunnel");
  assertEquals(testCommandWithOptions.port, 3001);
  assertEquals(testCommandWithOptions.service, "pinggy.io");
  assertEquals(testCommandWithOptions.debug, true);

  assertEquals(testCommandWithoutOptions.port, 3000);
  assertEquals(testCommandWithoutOptions.service, undefined);
  assertEquals(testCommandWithoutOptions.debug, false);
});

test("tunnel successfully creates and manages tunnel", async () => {
  recordingSink.startRecording();

  const testCommandWithOptions = run(tunnelCommand, {
    args: ["tunnel", "3001", "-s", "pinggy.io", "-d"],
  });
  await runTunnel(testCommandWithOptions);

  recordingSink.stopRecording();

  const logs = recordingSink.getRecords();
  assert(
    logs.some((log) => log.rawMessage.includes("The tunnel URL is found")),
  );
});
