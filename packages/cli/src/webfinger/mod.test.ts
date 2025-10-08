import { parse } from "@optique/core/parser";
import assert from "node:assert/strict";
import test from "node:test";
import { lookupSingleWebFinger } from "./action.ts";
import { webFingerCommand } from "./command.ts";

const COMMAND = "webfinger";
const USER_AGENT = "MyUserAgent/1.0";
const RESOURCES = [
  "@hongminhee@hackers.pub",
  "@fedify@hollo.social",
];
const ALIASES = [
  "https://hackers.pub/ap/actors/019382d3-63d7-7cf7-86e8-91e2551c306c",
  "https://hollo.social/@fedify",
];

test("Test webFingerCommand", () => {
  // Resources only
  const argsWithResourcesOnly = [COMMAND, ...RESOURCES];
  assert.deepEqual(
    parse(webFingerCommand, argsWithResourcesOnly),
    {
      success: true,
      value: {
        debug: false,
        command: COMMAND,
        resources: RESOURCES,
        allowPrivateAddresses: undefined,
        maxRedirection: 5,
        userAgent: undefined,
      },
    },
  );
  // With options
  const maxRedirection = 10;
  assert.deepEqual(
    parse(webFingerCommand, [
      ...argsWithResourcesOnly,
      "-d",
      "-u",
      USER_AGENT,
      "--max-redirection",
      String(maxRedirection),
      "--allow-private-address",
    ]),
    {
      success: true,
      value: {
        debug: true,
        command: COMMAND,
        resources: RESOURCES,
        allowPrivateAddresses: true,
        maxRedirection,
        userAgent: USER_AGENT,
      },
    },
  );
  // Wrong option
  const wrongOptionResult = parse(webFingerCommand, [
    ...argsWithResourcesOnly,
    "-Q",
  ]);
  assert.deepEqual(
    wrongOptionResult,
    { ...wrongOptionResult, success: false },
  );
  // Wrong option value
  const wrongOptionValueResult = parse(
    webFingerCommand,
    [...argsWithResourcesOnly, "--max-redirection", "-10"],
  );
  assert.deepEqual(
    wrongOptionValueResult,
    { ...wrongOptionValueResult, success: false },
  );
});

test("Test lookupSingleWebFinger", async () => {
  const aliases = (await Array.fromAsync(
    RESOURCES,
    (resource) => lookupSingleWebFinger({ resource }),
  )).map((w) => w?.aliases?.[0]);
  assert.deepEqual(aliases, ALIASES);
});
