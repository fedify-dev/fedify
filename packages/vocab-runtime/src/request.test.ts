import { deepStrictEqual } from "node:assert";
import process from "node:process";
import { test } from "node:test";
import metadata from "../deno.json" with { type: "json" };
import {
  createActivityPubRequest,
  FetchError,
  getUserAgent,
  isTransientFetchError,
} from "./request.ts";
import { UrlError } from "./url.ts";

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

test("isTransientFetchError() classifies document loader errors", () => {
  const url = "https://example.com/object";
  const response = (status: number) => new Response(null, { status });
  deepStrictEqual(
    isTransientFetchError(new FetchError(url, "HTTP 503", response(503))),
    true,
  );
  deepStrictEqual(
    isTransientFetchError(new FetchError(url, "HTTP 408", response(408))),
    true,
  );
  deepStrictEqual(
    isTransientFetchError(new FetchError(url, "HTTP 429", response(429))),
    true,
  );
  deepStrictEqual(
    isTransientFetchError(new FetchError(url, "HTTP 404", response(404))),
    false,
  );
  deepStrictEqual(
    isTransientFetchError(new FetchError(url, "HTTP 410", response(410))),
    false,
  );
  deepStrictEqual(
    isTransientFetchError(new FetchError(url, "Redirect loop detected")),
    false,
  );
  const timeout = new FetchError(url, "Timed out after 1000 ms");
  timeout.cause = new DOMException("Timed out", "TimeoutError");
  deepStrictEqual(isTransientFetchError(timeout), true);
  const tooLarge = new FetchError(url, "Body exceeds the limit");
  tooLarge.name = "BodyTooLargeError";
  deepStrictEqual(isTransientFetchError(tooLarge), false);
  deepStrictEqual(
    isTransientFetchError(new UrlError("DNS lookup failed", { reason: "dns" })),
    true,
  );
  deepStrictEqual(
    isTransientFetchError(new UrlError("Disallowed private URL")),
    false,
  );
  deepStrictEqual(
    isTransientFetchError(
      new TypeError("fetch failed", { cause: new Error("ECONNRESET") }),
    ),
    true,
  );
  let invalidUrl: unknown;
  try {
    new URL("::");
  } catch (error) {
    invalidUrl = error;
  }
  deepStrictEqual(isTransientFetchError(invalidUrl), false);
  deepStrictEqual(
    isTransientFetchError(
      new TypeError("Failed to parse URL from ::", {
        cause: Object.assign(new TypeError("Invalid URL"), {
          code: "ERR_INVALID_URL",
        }),
      }),
    ),
    false,
  );
  deepStrictEqual(isTransientFetchError(new SyntaxError("Bad JSON")), false);
  deepStrictEqual(
    isTransientFetchError(new DOMException("Aborted", "AbortError")),
    true,
  );
  deepStrictEqual(isTransientFetchError(new Error("unknown")), true);
});

test("isTransientFetchError() recognizes errors from other package copies", () => {
  const dns = Object.assign(new Error("DNS lookup failed"), {
    name: "UrlError",
    reason: "dns",
  });
  deepStrictEqual(isTransientFetchError(dns), true);
  const notFound = Object.assign(new Error("HTTP 404"), {
    name: "FetchError",
    url: new URL("https://example.com/"),
    response: new Response(null, { status: 404 }),
  });
  deepStrictEqual(isTransientFetchError(notFound), false);
});

test("isTransientFetchError() classifies aggregate errors by their members", () => {
  const notFound = (url: string) =>
    new FetchError(url, "HTTP 404", new Response(null, { status: 404 }));
  const unavailable = (url: string) =>
    new FetchError(url, "HTTP 503", new Response(null, { status: 503 }));
  deepStrictEqual(
    isTransientFetchError(
      new AggregateError([
        notFound("https://a.example/"),
        notFound("https://b.example/"),
      ]),
    ),
    false,
  );
  deepStrictEqual(
    isTransientFetchError(
      new AggregateError([
        notFound("https://a.example/"),
        unavailable("https://b.example/"),
      ]),
    ),
    true,
  );
  deepStrictEqual(isTransientFetchError(new AggregateError([])), true);
  const gone = new FetchError(
    "https://a.example/",
    "HTTP 410",
    new Response(null, { status: 410 }),
  );
  deepStrictEqual(
    isTransientFetchError(new AggregateError([gone, gone])),
    false,
  );
  deepStrictEqual(
    isTransientFetchError(
      new AggregateError([
        new FetchError("https://a.example/", "a", undefined),
        new FetchError("https://b.example/", "b", undefined),
      ].map((e) => Object.assign(e, { cause: gone }))),
    ),
    false,
  );
});

test("isTransientFetchError() tolerates cyclic causes", () => {
  const error = new FetchError("https://example.com/", "cyclic");
  error.cause = error;
  deepStrictEqual(isTransientFetchError(error), true);
});
