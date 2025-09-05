import { lookupWebFinger } from "@fedify/fedify/webfinger";
import { run } from "@optique/run";
import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import test from "node:test";
import { convertHandleToUrl, webFingerCommand } from "./webfinger.ts";

const COMMAND = "webfinger";
const RESOURCES = ["@hongminhee@hackers.pub", "@fedify@hollo.social"];
const USER_AGENT = "MyUserAgent/1.0";
const ALIASES = [
  "https://hackers.pub/ap/actors/019382d3-63d7-7cf7-86e8-91e2551c306c",
  "https://hollo.social/@fedify",
];

test("webFingerCommand", () => {
  // Resources only
  const argsWithResourcesOnly = [COMMAND, ...RESOURCES];
  assertEquals(
    run(webFingerCommand, {
      args: argsWithResourcesOnly,
    }),
    {
      command: COMMAND,
      resources: RESOURCES,
      allowPrivateAddresses: undefined,
      maxRedirection: 5,
      userAgent: undefined,
    },
  );
  // With options
  const maxRedirection = 10;
  assertStrictEquals(
    run(webFingerCommand, {
      args: [
        ...argsWithResourcesOnly,
        "-u",
        USER_AGENT,
        "--max-redirection",
        String(maxRedirection),
        "--allow-private-addresses",
      ],
    }),
    {
      command: COMMAND,
      resources: RESOURCES,
      allowPrivateAddresses: true,
      maxRedirection,
      userAgent: USER_AGENT,
    },
  );
  // Wrong option
  assertThrows(() =>
    run(
      webFingerCommand,
      {
        args: [
          ...argsWithResourcesOnly,
          "-Q",
        ],
      },
    )
  );
  // Wrong option value
  assertThrows(() =>
    run(
      webFingerCommand,
      {
        args: [
          ...argsWithResourcesOnly,
          "--max-redirection",
          "-10",
        ],
      },
    )
  );
});

test("Lookup webfinger", async () => {
  const aliases = (await Array.fromAsync(
    RESOURCES.map(convertHandleToUrl),
    (h) => lookupWebFinger(h),
  )).map((w) => w?.aliases?.[0]);
  assertStrictEquals(aliases, ALIASES);
});
