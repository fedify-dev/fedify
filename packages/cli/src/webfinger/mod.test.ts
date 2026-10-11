import { clearActiveConfig, setActiveConfig } from "@optique/config";
import { runWithConfig } from "@optique/config/run";
import { parse } from "@optique/core/parser";
import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { type Config, configContext } from "../config.ts";
import runWebFinger, { lookupSingleWebFinger } from "./action.ts";
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

for (
  const { name, args, config, allowed } of [
    { name: "short flag", args: ["-p"], config: {}, allowed: true },
    {
      name: "long flag",
      args: ["--allow-private-address"],
      config: {},
      allowed: true,
    },
    {
      name: "configuration opt-in",
      args: [],
      config: { webfinger: { allowPrivateAddress: true } },
      allowed: true,
    },
    { name: "default rejection", args: [], config: {}, allowed: false },
    {
      name: "configuration opt-out",
      args: [],
      config: { webfinger: { allowPrivateAddress: false } },
      allowed: false,
    },
    {
      name: "flag overrides configuration opt-out",
      args: ["-p"],
      config: { webfinger: { allowPrivateAddress: false } },
      allowed: true,
    },
  ] satisfies {
    name: string;
    args: string[];
    config: Config;
    allowed: boolean;
  }[]
) {
  test(`runWebFinger private address - ${name}`, async () => {
    const resource = "http://127.0.0.1/users/alice";
    const descriptor = { subject: resource, aliases: [resource] };
    const requests: { url: string; userAgent: string | null }[] = [];
    const originalFetch = globalThis.fetch;
    const originalWrite = process.stdout.write;
    let output = "";
    globalThis.fetch = (input, init) => {
      requests.push({
        url: String(input),
        userAgent: new Headers(init?.headers).get("User-Agent"),
      });
      return Promise.resolve(
        new Response(JSON.stringify(descriptor), {
          headers: { "Content-Type": "application/jrd+json" },
        }),
      );
    };
    process.stdout.write = function (...args) {
      output += String(args[0]);
      return Reflect.apply(originalWrite, this, args);
    };
    try {
      const options = await runWithConfig(webFingerCommand, configContext, {
        load: () => config,
        args: [COMMAND, ...args, "-u", USER_AGENT, resource],
      });
      await runWebFinger(options);
    } finally {
      globalThis.fetch = originalFetch;
      process.stdout.write = originalWrite;
    }
    // Assert after execution: lookup and spinner error handling swallow errors
    // thrown inside fetch, so assertions in the mock would not fail the test.
    assert.deepEqual(
      requests,
      allowed
        ? [{
          url: "http://127.0.0.1/.well-known/webfinger?resource=" +
            encodeURIComponent(resource),
          userAgent: USER_AGENT,
        }]
        : [],
    );
    if (allowed) {
      assert.ok(output.includes(resource), output);
      assert.ok(output.includes("subject"), output);
    } else {
      assert.strictEqual(output, "");
    }
  });
}

test("Test webFingerCommand - resources only", async () => {
  const argsWithResourcesOnly = [COMMAND, ...RESOURCES];
  setActiveConfig(configContext.id, {});
  const result = await parse(webFingerCommand, argsWithResourcesOnly);
  clearActiveConfig(configContext.id);

  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.command, COMMAND);
    assert.deepEqual(result.value.resources, RESOURCES);
    assert.strictEqual(result.value.allowPrivateAddresses, false);
    assert.strictEqual(result.value.maxRedirection, 5);
    // userAgent has a dynamic default value from getUserAgent()
    assert.ok(result.value.userAgent?.startsWith("Fedify/"));
  }
});

test("Test webFingerCommand - with all options", () => {
  const argsWithResourcesOnly = [COMMAND, ...RESOURCES];
  const maxRedirection = 10;
  assert.deepEqual(
    parse(webFingerCommand, [
      ...argsWithResourcesOnly,
      "-u",
      USER_AGENT,
      "--max-redirection",
      String(maxRedirection),
      "--allow-private-address",
    ]),
    {
      success: true,
      value: {
        command: COMMAND,
        resources: RESOURCES,
        allowPrivateAddresses: true,
        maxRedirection,
        userAgent: USER_AGENT,
      },
    },
  );
});

test("Test webFingerCommand - wrong option", () => {
  const argsWithResourcesOnly = [COMMAND, ...RESOURCES];
  const wrongOptionResult = parse(webFingerCommand, [
    ...argsWithResourcesOnly,
    "-Q",
  ]);
  assert.ok(!wrongOptionResult.success);
});

test("Test webFingerCommand - invalid option value fails", () => {
  const argsWithResourcesOnly = [COMMAND, ...RESOURCES];
  const result = parse(
    webFingerCommand,
    [...argsWithResourcesOnly, "--max-redirection", "-10"],
  );
  assert.ok(!result.success);
});

// ----------------------------------------------------------------------
// FIX FOR ISSUE #480 – MOCK FETCH TO REMOVE EXTERNAL DEPENDENCY
// ----------------------------------------------------------------------

test("Test lookupSingleWebFinger", async (): Promise<void> => {
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

  // Correct async fetch mock returning Promise<Response>
  globalThis.fetch = async (
    input: RequestInfo | URL,
  ): Promise<Response> => {
    await Promise.resolve();

    const url = String(input);
    const responseData = mockResponses[url];

    if (responseData) {
      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: {
          "Content-Type": "application/jrd+json",
        },
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const results = await Array.fromAsync(
      RESOURCES,
      // HTTP responses are mocked, so skip the SSRF guard's external DNS lookup.
      // TODO: Use allowPrivateAddresses when merging into 2.4-maintenance or later.
      (resource) =>
        lookupSingleWebFinger({ resource, allowPrivateAddress: true }),
    );

    const aliases = results.map((w) => w?.aliases?.[0]);
    assert.deepEqual(aliases, ALIASES);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
