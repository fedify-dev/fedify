import { deepStrictEqual } from "node:assert";
import process from "node:process";
import { test } from "node:test";
import metadata from "../deno.json" with { type: "json" };
import { createActivityPubRequest, getUserAgent } from "./request.ts";

test("getUserAgent()", () => {
  if ("Deno" in globalThis) {
    deepStrictEqual(
      getUserAgent(),
      `Fedify/${metadata.version} (Deno/${Deno.version.deno})`,
    );
    deepStrictEqual(
      getUserAgent({ software: "MyApp/1.0.0" }),
      `MyApp/1.0.0 (Fedify/${metadata.version}; Deno/${Deno.version.deno})`,
    );
    deepStrictEqual(
      getUserAgent({ url: "https://example.com/" }),
      `Fedify/${metadata.version} (Deno/${Deno.version.deno}; +https://example.com/)`,
    );
    deepStrictEqual(
      getUserAgent({
        software: "MyApp/1.0.0",
        url: new URL("https://example.com/"),
      }),
      `MyApp/1.0.0 (Fedify/${metadata.version}; Deno/${Deno.version.deno}; +https://example.com/)`,
    );
  } else if ("Bun" in globalThis) {
    deepStrictEqual(
      getUserAgent(),
      // @ts-ignore: `Bun` is a global variable in Bun
      `Fedify/${metadata.version} (Bun/${Bun.version})`,
    );
    deepStrictEqual(
      getUserAgent({ software: "MyApp/1.0.0" }),
      // @ts-ignore: `Bun` is a global variable in Bun
      `MyApp/1.0.0 (Fedify/${metadata.version}; Bun/${Bun.version})`,
    );
    deepStrictEqual(
      getUserAgent({ url: "https://example.com/" }),
      // @ts-ignore: `Bun` is a global variable in Bun
      `Fedify/${metadata.version} (Bun/${Bun.version}; +https://example.com/)`,
    );
    deepStrictEqual(
      getUserAgent({
        software: "MyApp/1.0.0",
        url: new URL("https://example.com/"),
      }),
      // @ts-ignore: `Bun` is a global variable in Bun
      `MyApp/1.0.0 (Fedify/${metadata.version}; Bun/${Bun.version}; +https://example.com/)`,
    );
  } else if (navigator.userAgent === "Cloudflare-Workers") {
    deepStrictEqual(
      getUserAgent(),
      `Fedify/${metadata.version} (Cloudflare-Workers)`,
    );
    deepStrictEqual(
      getUserAgent({ software: "MyApp/1.0.0" }),
      `MyApp/1.0.0 (Fedify/${metadata.version}; Cloudflare-Workers)`,
    );
    deepStrictEqual(
      getUserAgent({ url: "https://example.com/" }),
      `Fedify/${metadata.version} (Cloudflare-Workers; +https://example.com/)`,
    );
    deepStrictEqual(
      getUserAgent({
        software: "MyApp/1.0.0",
        url: new URL("https://example.com/"),
      }),
      `MyApp/1.0.0 (Fedify/${metadata.version}; Cloudflare-Workers; +https://example.com/)`,
    );
  } else {
    deepStrictEqual(
      getUserAgent(),
      `Fedify/${metadata.version} (Node.js/${process.versions.node})`,
    );
    deepStrictEqual(
      getUserAgent({ software: "MyApp/1.0.0" }),
      `MyApp/1.0.0 (Fedify/${metadata.version}; Node.js/${process.versions.node})`,
    );
    deepStrictEqual(
      getUserAgent({ url: "https://example.com/" }),
      `Fedify/${metadata.version} (Node.js/${process.versions.node}; +https://example.com/)`,
    );
    deepStrictEqual(
      getUserAgent({
        software: "MyApp/1.0.0",
        url: new URL("https://example.com/"),
      }),
      `MyApp/1.0.0 (Fedify/${metadata.version}; Node.js/${process.versions.node}; +https://example.com/)`,
    );
  }
});

test("createActivityPubRequest() asks for the ActivityStreams profile", () => {
  const request = createActivityPubRequest("https://example.com/object");
  deepStrictEqual(
    request.headers.get("Accept"),
    "application/activity+json, " +
      'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
  );
});
