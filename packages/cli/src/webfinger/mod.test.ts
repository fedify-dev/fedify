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

  const wrongOptionResult = parse(webFingerCommand, [
    ...argsWithResourcesOnly,
    "-Q",
  ]);

  assert.ok(!wrongOptionResult.success);

  const wrongOptionValueResult = parse(
    webFingerCommand,
    [...argsWithResourcesOnly, "--max-redirection", "-10"],
  );

  assert.ok(!wrongOptionValueResult.success);
});

// ---------------------------------------------------------------------
// Mocked WebFinger test (Fix for Issue #480)
// ---------------------------------------------------------------------

test("Test lookupSingleWebFinger", async () => {
  const originalFetch = globalThis.fetch;

  const mockResponses: Record<string, unknown> = {
    "https://hackers.pub/.well-known/webfinger?resource=acct%3Ahongminhee%40hackers.pub":
      {
        subject: "acct:hongminhee@hackers.pub",
        aliases: [ALIASES[0]],
        links: [
          {
            rel: "self",
            type: "application/activity+json",
            href: ALIASES[0],
          },
        ],
      },

    "https://hollo.social/.well-known/webfinger?resource=acct%3Afedify%40hollo.social":
      {
        subject: "acct:fedify@hollo.social",
        aliases: [ALIASES[1]],
        links: [
          {
            rel: "self",
            type: "application/activity+json",
            href: ALIASES[1],
          },
        ],
      },
  };

  globalThis.fetch = async (input: Request | string | URL) => {
    const url = input.toString();
    const response = mockResponses[url];

    if (response) {
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          "Content-Type": "application/jrd+json",
        },
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const aliases = (await Array.fromAsync(
      RESOURCES,
      (resource) => lookupSingleWebFinger({ resource }),
    )).map((item) => item?.aliases?.[0]);

    assert.deepEqual(aliases, ALIASES);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
