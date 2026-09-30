import { signObject } from "@fedify/fedify";
import {
  type Actor,
  Note,
  type Object as APObject,
  OrderedCollection,
  Person,
} from "@fedify/vocab";
import {
  type DocumentLoader,
  exportDidKey,
  FetchError,
  formatIri,
  getDocumentLoader as getDefaultDocumentLoader,
  parseIri,
  toCompatibleEf61Id,
  withGatewayHints,
} from "@fedify/vocab-runtime";
import { parse } from "@optique/core/parser";
import fetchMock from "fetch-mock";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { serve } from "srvx";
import { lookupCommand, runLookup } from "./lookup.ts";
import {
  gatewayUrl,
  getIriKey,
  getPortableLookupProblem,
  isPortableReference,
} from "./portable.ts";
import { matchesActor } from "./utils.ts";
import { linksToActor, lookupPortableWebFinger } from "./webfinger/action.ts";
import { webFingerCommand } from "./webfinger/command.ts";

const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
]) as CryptoKeyPair;
const did = await exportDidKey(keyPair.publicKey);
const keyId = new URL(`${did}#${did.slice("did:key:".length)}`);
const otherKeyPair = await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
]) as CryptoKeyPair;
const otherDid = await exportDidKey(otherKeyPair.publicKey);
const contextLoader = getDefaultDocumentLoader();

const PORTABLE_CONTENT_TYPE =
  'application/ld+json; profile="https://www.w3.org/ns/activitystreams"';

function portableId(path: string, authority: string = did): URL {
  return parseIri(`ap://${authority}${path}`);
}

/**
 * A local FEP-ef61 gateway serving JSON-LD documents by their object paths.
 */
interface Gateway {
  readonly url: URL;
  readonly requests: string[];
  readonly documents: Map<string, unknown>;
  close(): Promise<void>;
}

async function startGateway(): Promise<Gateway> {
  const requests: string[] = [];
  const documents = new Map<string, unknown>();
  const prefix = `/.well-known/apgateway/${did}`;
  const server = serve({
    port: 0,
    hostname: "127.0.0.1",
    silent: true,
    fetch(request) {
      const { pathname } = new URL(request.url);
      requests.push(pathname);
      const document = pathname.startsWith(prefix)
        ? documents.get(pathname.slice(prefix.length))
        : undefined;
      if (document == null) return new Response(null, { status: 404 });
      return new Response(JSON.stringify(document), {
        headers: { "Content-Type": PORTABLE_CONTENT_TYPE },
      });
    },
  });
  await server.ready();
  assert.ok(server.url != null);
  return {
    url: new URL(new URL(server.url).origin),
    requests,
    documents,
    close: () => server.close(true),
  };
}

async function sign<T extends APObject>(object: T): Promise<T> {
  return await signObject(object, keyPair.privateKey, keyId, {
    contextLoader,
  });
}

async function serveObject(
  gateway: Gateway,
  path: string,
  object: APObject,
): Promise<void> {
  gateway.documents.set(path, await object.toJsonLd({ contextLoader }));
}

function createActor(gateway: URL): Person {
  return new Person({
    id: portableId("/actor"),
    preferredUsername: "alice",
    inbox: portableId("/actor/inbox"),
    outbox: portableId("/actor/outbox"),
    gateways: [gateway],
  });
}

/** Serves a signed actor and two signed notes, the second replying. */
async function serveFixtures(gateway: Gateway): Promise<void> {
  await serveObject(gateway, "/actor", await sign(createActor(gateway.url)));
  await serveObject(
    gateway,
    "/note",
    await sign(
      new Note({
        id: portableId("/note"),
        attribution: portableId("/actor"),
        content: "Hello",
      }),
    ),
  );
  await serveObject(
    gateway,
    "/reply",
    await sign(
      new Note({
        id: portableId("/reply"),
        attribution: portableId("/actor"),
        replyTarget: withGatewayHints(portableId("/note"), [gateway.url]),
        content: "Reply",
      }),
    ),
  );
}

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`Exited with code ${code}`);
  }
}

async function captureStderr<T>(
  callback: () => Promise<T>,
): Promise<{ result: T; stderr: string }> {
  const originalWrite = process.stderr.write;
  let stderr = "";
  process.stderr.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: unknown,
    callback?: () => void,
  ) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    if (typeof encodingOrCallback === "function") encodingOrCallback();
    else callback?.();
    return true;
  }) as typeof process.stderr.write;
  try {
    return { result: await callback(), stderr };
  } finally {
    process.stderr.write = originalWrite;
  }
}

type LookupRunCommand = Parameters<typeof runLookup>[0];

/**
 * Runs `fedify lookup` with the raw output written to a temporary file.
 * @returns The exit code (0 if the command did not exit), the output, and
 *          the standard error.
 */
async function lookup(
  overrides: Partial<LookupRunCommand>,
  deps: Parameters<typeof runLookup>[1] = {},
): Promise<{ code: number; output: string; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), "fedify-portable-lookup-"));
  const output = join(dir, "output.json");
  try {
    const command = {
      command: "lookup",
      urls: [],
      traverse: false,
      recurse: undefined,
      recurseDepth: undefined,
      suppressErrors: false,
      authorizedFetch: false,
      firstKnock: undefined,
      tunnelService: undefined,
      userAgent: "FedifyTest/1.0",
      gateways: [],
      allowPrivateAddress: true,
      timeout: undefined,
      reverse: false,
      format: "raw",
      separator: "----",
      output,
      debug: false,
      ignoreConfig: false,
      configPath: undefined,
      ...overrides,
    } as LookupRunCommand;
    const { result: code, stderr } = await captureStderr(async () => {
      try {
        await runLookup(command, {
          ...deps,
          exit: (code: number) => {
            throw new ExitSignal(code);
          },
        });
        return 0;
      } catch (error) {
        if (error instanceof ExitSignal) return error.code;
        throw error;
      }
    });
    let text = "";
    try {
      text = await readFile(output, "utf8");
    } catch {
      // No output was written.
    }
    return { code, output: text, stderr };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function parseOutputs(output: string, separator = "----"): unknown[] {
  return output.split(`\n${separator}\n`).map((part) => JSON.parse(part));
}

test("getIriKey() identifies portable objects canonically", () => {
  const key = `ap+ef61://${did}/actor`;
  const encoded = `ap://${encodeURIComponent(did)}/actor`;
  const compatible =
    `https://gateway.example/.well-known/apgateway/${did}/actor`;
  assert.equal(getIriKey(`ap://${did}/actor`), key);
  assert.equal(getIriKey(encoded), key);
  assert.equal(getIriKey(`ap+ef61://${did}/actor`), key);
  assert.equal(
    getIriKey(`ap://${did}/actor?@gateway=https%3A%2F%2Fgateway.example`),
    key,
  );
  assert.equal(getIriKey(compatible), key);
  assert.equal(getIriKey(new URL(compatible)), key);
  assert.equal(getIriKey(portableId("/actor")), key);
  assert.equal(getIriKey(`ap://${did}/actor#main`), `${key}#main`);
  assert.notEqual(getIriKey(`ap://${did}/other`), key);
  assert.equal(
    getIriKey("https://example.com/users/alice"),
    "https://example.com/users/alice",
  );
  assert.equal(getIriKey("ap://not-a-did/actor"), null);
  assert.equal(
    getIriKey(
      `https://gateway.example/.well-known/apgateway/${did}/actor?@gateway=x`,
    ),
    null,
  );
});

test("getPortableLookupProblem() detects missing gateways", () => {
  const hinted = withGatewayHints(portableId("/actor"), [
    new URL("https://gateway.example"),
  ]);
  assert.equal(getPortableLookupProblem(`ap://${did}/actor`), "no-gateway");
  assert.equal(getPortableLookupProblem(portableId("/actor")), "no-gateway");
  assert.equal(
    getPortableLookupProblem(`ap://${did}/actor`, [
      new URL("https://gateway.example"),
    ]),
    null,
  );
  assert.equal(getPortableLookupProblem(formatIri(hinted)), null);
  assert.equal(getPortableLookupProblem(hinted), null);
  assert.equal(
    getPortableLookupProblem(`ap://${did}/actor?@gateway=not-a-gateway`),
    "no-gateway",
  );
  assert.equal(getPortableLookupProblem("ap://not-a-did/actor"), "malformed");
  assert.equal(getPortableLookupProblem("https://example.com/actor"), null);
  assert.equal(getPortableLookupProblem("@alice@example.com"), null);
});

test("isPortableReference() recognizes portable and compatible IDs", () => {
  assert.ok(isPortableReference(`ap://${did}/actor`));
  assert.ok(isPortableReference(`AP+EF61://${did}/actor`));
  assert.ok(
    isPortableReference(
      `https://gateway.example/.well-known/apgateway/${did}/actor`,
    ),
  );
  assert.ok(!isPortableReference("https://example.com/actor"));
  assert.ok(!isPortableReference("@alice@example.com"));
});

test("gatewayUrl() accepts only gateway origins", () => {
  const parser = gatewayUrl();
  const result = parser.parse("https://gateway.example");
  assert.ok(result.success);
  assert.equal(result.value.href, "https://gateway.example/");
  for (
    const input of [
      "https://gateway.example/path",
      "https://gateway.example/?q=1",
      "https://user@gateway.example/",
      "ftp://gateway.example/",
      "not a url",
    ]
  ) {
    assert.ok(!parser.parse(input).success, input);
  }
});

test("--gateway is parsed by the lookup and webfinger commands", () => {
  const lookupResult = parse(lookupCommand, [
    "lookup",
    "--gateway",
    "https://a.example",
    "--gateway",
    "https://b.example",
    `ap://${did}/actor`,
  ]);
  assert.ok(lookupResult.success);
  assert.deepEqual(
    lookupResult.value.gateways.map((g) => g.href),
    ["https://a.example/", "https://b.example/"],
  );
  assert.ok(
    !parse(lookupCommand, [
      "lookup",
      "--gateway",
      "https://a.example/path",
      `ap://${did}/actor`,
    ]).success,
  );
  const webFingerResult = parse(webFingerCommand, [
    "webfinger",
    "--gateway",
    "https://a.example",
    `ap://${did}/actor`,
  ]);
  assert.ok(webFingerResult.success);
  assert.deepEqual(
    webFingerResult.value.gateways.map((g) => g.href),
    ["https://a.example/"],
  );
});

test("matchesActor() matches portable actors by their canonical IDs", async () => {
  const actor = createActor(new URL("https://gateway.example"));
  let handleLookups = 0;
  const getHandle = (_: Actor) => {
    handleLookups++;
    return Promise.resolve("@alice@gateway.example");
  };
  const matches = (list: string[]) => matchesActor(actor, list, getHandle);
  assert.ok(await matches([`ap://${did}/actor`]));
  assert.ok(await matches([`ap+ef61://${did}/actor`]));
  assert.ok(await matches([`ap://${encodeURIComponent(did)}/actor`]));
  assert.ok(
    await matches([
      `ap://${did}/actor?@gateway=https%3A%2F%2Fother.example`,
    ]),
  );
  assert.ok(
    await matches([
      `https://other.example/.well-known/apgateway/${did}/actor`,
    ]),
  );
  assert.ok(!await matches([`ap://${did}/other`]));
  assert.ok(!await matches([`ap://${otherDid}/actor`]));
  assert.ok(!await matches([`ap://${did}/actor#key`]));
  assert.ok(
    !await matches([
      `https://other.example/.well-known/apgateway/${did}/actor?@gateway=x`,
    ]),
  );
  assert.equal(handleLookups, 0);
  assert.ok(await matches([`ap://${did}/other`, `ap://${did}/actor`]));
  assert.ok(await matches(["@alice@gateway.example"]));
  assert.equal(handleLookups, 1);
});

test("matchesActor() looks up the handle at most once", async () => {
  const actor = createActor(new URL("https://gateway.example"));
  let handleLookups = 0;
  const getHandle = (_: Actor) => {
    handleLookups++;
    return Promise.reject(new TypeError("No handle."));
  };
  assert.ok(
    await matchesActor(
      actor,
      ["@bob@example.com", "@carol@example.com", `ap://${did}/actor`],
      getHandle,
    ),
  );
  assert.equal(handleLookups, 1);
  handleLookups = 0;
  assert.ok(
    await matchesActor(
      actor,
      ["@bob@example.com", "not a handle", "@carol@example.com", "*"],
      getHandle,
    ),
  );
  assert.equal(handleLookups, 1);
  // A handle that cannot be looked up is not a non-match, so that a reject
  // list fails closed:
  handleLookups = 0;
  await assert.rejects(
    matchesActor(actor, ["@bob@example.com", `ap://${did}/other`], getHandle),
    /No handle/,
  );
  assert.equal(handleLookups, 1);
});

test("fedify lookup looks up portable objects", async () => {
  const gateway = await startGateway();
  try {
    await serveFixtures(gateway);
    const hint = encodeURIComponent(gateway.url.origin);
    for (
      const url of [
        `ap://${did}/actor?@gateway=${hint}`,
        `ap+ef61://${encodeURIComponent(did)}/actor?@gateway=${hint}`,
        toCompatibleEf61Id(portableId("/actor"), gateway.url).href,
      ]
    ) {
      const { code, output, stderr } = await lookup({ urls: [url] });
      assert.equal(code, 0, stderr);
      const [actor] = parseOutputs(output) as Record<string, unknown>[];
      assert.equal(actor.id, `ap+ef61://${did}/actor`, url);
      assert.equal(actor.preferredUsername, "alice");
    }
    const { code, output, stderr } = await lookup({
      urls: [`ap://${did}/note`],
      gateways: [gateway.url],
    });
    assert.equal(code, 0, stderr);
    const [note] = parseOutputs(output) as Record<string, unknown>[];
    assert.equal(note.id, `ap+ef61://${did}/note`);
  } finally {
    await gateway.close();
  }
});

test("fedify lookup refuses portable IDs without gateways", async () => {
  const gateway = await startGateway();
  try {
    const { code, stderr } = await lookup({ urls: [`ap://${did}/actor`] });
    assert.equal(code, 1);
    assert.match(stderr, /has no @gateway location hints/);
    assert.match(stderr, /--gateway/);
    assert.doesNotMatch(stderr, /authorized-fetch/);
    assert.deepEqual(gateway.requests, []);
  } finally {
    await gateway.close();
  }
});

test("fedify lookup rejects portable objects with invalid proofs", async () => {
  const gateway = await startGateway();
  try {
    await serveFixtures(gateway);
    const note = gateway.documents.get("/note") as Record<string, unknown>;
    // The rejected ID is printed in its canonical form even if the gateway
    // serves it percent-encoded:
    gateway.documents.set("/note", {
      ...note,
      id: `ap://${encodeURIComponent(did)}/note`,
      content: "Tampered",
    });
    const { code, output, stderr } = await lookup({
      urls: [`ap://${did}/note`],
      gateways: [gateway.url],
    });
    assert.equal(code, 1);
    assert.equal(output, "");
    assert.match(
      stderr,
      new RegExp(
        `Rejected the portable object ap\\+ef61://${did}/note, as its ` +
          "integrity proof is invalid",
      ),
    );
    assert.doesNotMatch(stderr, /authorized-fetch/);
  } finally {
    await gateway.close();
  }
});

test("fedify lookup falls back to another gateway after a rejection", async () => {
  const bad = await startGateway();
  const good = await startGateway();
  try {
    await serveFixtures(bad);
    await serveFixtures(good);
    const note = bad.documents.get("/note") as Record<string, unknown>;
    bad.documents.set("/note", { ...note, content: "Tampered" });
    const { code, output, stderr } = await lookup({
      urls: [`ap://${did}/note`],
      gateways: [bad.url, good.url],
    });
    assert.equal(code, 0, stderr);
    const [fetched] = parseOutputs(output) as Record<string, unknown>[];
    assert.equal(fetched.content, "Hello");
    assert.doesNotMatch(stderr, /Rejected/);
  } finally {
    await bad.close();
    await good.close();
  }
});

test("fedify lookup follows portable objects with --recurse", async () => {
  const gateway = await startGateway();
  try {
    await serveFixtures(gateway);
    const { code, output, stderr } = await lookup({
      urls: [`ap://${did}/reply`],
      gateways: [gateway.url],
      recurse: "replyTarget",
      recurseDepth: 5,
    });
    assert.equal(code, 0, stderr);
    const objects = parseOutputs(output) as Record<string, unknown>[];
    assert.deepEqual(
      objects.map((o) => o.id),
      [`ap+ef61://${did}/reply`, `ap+ef61://${did}/note`],
    );
  } finally {
    await gateway.close();
  }
});

test("fedify lookup --recurse uses --gateway for unhinted links", async () => {
  const gateway = await startGateway();
  try {
    await serveFixtures(gateway);
    await serveObject(
      gateway,
      "/reply",
      await sign(
        new Note({
          id: portableId("/reply"),
          attribution: portableId("/actor"),
          replyTarget: portableId("/note"),
          content: "Reply",
        }),
      ),
    );
    const hinted = `ap://${did}/reply?@gateway=${
      encodeURIComponent(gateway.url.origin)
    }`;
    const failed = await lookup({
      urls: [hinted],
      recurse: "replyTarget",
      recurseDepth: 5,
    });
    assert.equal(failed.code, 1);
    assert.match(
      failed.stderr,
      new RegExp(`Failed to recursively fetch object: ap\\+ef61://${did}/note`),
    );
    assert.match(failed.stderr, /has no @gateway location hints/);
    const { code, output, stderr } = await lookup({
      urls: [hinted],
      gateways: [gateway.url],
      recurse: "replyTarget",
      recurseDepth: 5,
    });
    assert.equal(code, 0, stderr);
    assert.equal(parseOutputs(output).length, 2);
  } finally {
    await gateway.close();
  }
});

test("fedify lookup traverses portable collections", async () => {
  const gateway = await startGateway();
  const untrusted = await startGateway();
  try {
    await serveFixtures(gateway);
    // An unsecured collection, which is trusted only if it is served by
    // a gateway that its owner lists:
    await serveObject(
      gateway,
      "/actor/outbox",
      new OrderedCollection({
        id: portableId("/actor/outbox"),
        attribution: portableId("/actor"),
        totalItems: 1,
        items: [withGatewayHints(portableId("/note"), [gateway.url])],
      }),
    );
    // The same documents on a gateway that the owner does not list:
    for (const [path, document] of gateway.documents) {
      untrusted.documents.set(path, document);
    }
    const { code, output, stderr } = await lookup({
      urls: [`ap://${did}/actor/outbox`],
      gateways: [gateway.url],
      traverse: true,
    });
    assert.equal(code, 0, stderr);
    const [item] = parseOutputs(output) as Record<string, unknown>[];
    assert.equal(item.id, `ap+ef61://${did}/note`);

    const rejected = await lookup({
      urls: [`ap://${did}/actor/outbox`],
      gateways: [untrusted.url],
      traverse: true,
    });
    assert.equal(rejected.code, 1);
    assert.match(
      rejected.stderr,
      /served by a gateway that its owner does not list/,
    );
  } finally {
    await gateway.close();
    await untrusted.close();
  }
});

test("fedify lookup verifies with the follow-up private-address policy", async () => {
  const gateway = await startGateway();
  try {
    await serveFixtures(gateway);
    await serveObject(
      gateway,
      "/actor/outbox",
      new OrderedCollection({
        id: portableId("/actor/outbox"),
        attribution: withGatewayHints(portableId("/actor"), [gateway.url]),
        totalItems: 0,
      }),
    );
    const { code, stderr } = await lookup({
      urls: [`ap://${did}/actor/outbox`],
      gateways: [gateway.url],
      allowPrivateAddress: false,
    });
    assert.equal(code, 1);
    // The collection given on the command line may be on a private address,
    // but its owner, which the verifier discovers, may not:
    assert.ok(gateway.requests.some((path) => path.endsWith("/outbox")));
    assert.ok(!gateway.requests.some((path) => path.endsWith("/actor")));
    assert.match(stderr, /private|localhost/i);
  } finally {
    await gateway.close();
  }
});

test("fedify lookup does not blame a recovered owner fetch failure", async () => {
  const missing = await startGateway();
  const gateway = await startGateway();
  try {
    // The owner is not on the first gateway, and has no gateways on the second
    // one, so it cannot be verified:
    await serveObject(
      gateway,
      "/actor",
      await sign(
        new Person({
          id: portableId("/actor"),
          preferredUsername: "alice",
          outbox: portableId("/actor/outbox"),
        }),
      ),
    );
    await serveObject(
      gateway,
      "/actor/outbox",
      new OrderedCollection({
        id: portableId("/actor/outbox"),
        attribution: withGatewayHints(portableId("/actor"), [
          missing.url,
          gateway.url,
        ]),
        totalItems: 0,
      }),
    );
    // Explicit gateways would replace the owner's location hints:
    const { code, stderr } = await lookup({
      urls: [
        `ap://${did}/actor/outbox?@gateway=${
          encodeURIComponent(gateway.url.origin)
        }`,
      ],
    });
    assert.equal(code, 1);
    assert.ok(missing.requests.some((path) => path.endsWith("/actor")));
    assert.match(stderr, /whose owner could not be retrieved/);
    assert.doesNotMatch(stderr, /HTTP 404/);
    assert.doesNotMatch(stderr, /authorized-fetch/);
  } finally {
    await missing.close();
    await gateway.close();
  }
});

test("fedify lookup looks up portable actors by WebFinger handles", async () => {
  const gateway = await startGateway();
  // A public IP address, so that the WebFinger lookup needs no DNS; the
  // request is answered by fetch-mock:
  const host = "93.184.215.14";
  fetchMock.spyGlobal();
  fetchMock.get(`begin:https://${host}/.well-known/webfinger`, {
    subject: `acct:alice@${host}`,
    links: [{
      rel: "self",
      type: "application/activity+json",
      href: toCompatibleEf61Id(portableId("/actor"), gateway.url).href,
    }],
  });
  try {
    await serveFixtures(gateway);
    const { code, output, stderr } = await lookup({
      urls: [`@alice@${host}`],
    });
    assert.equal(code, 0, stderr);
    const [actor] = parseOutputs(output) as Record<string, unknown>[];
    assert.equal(actor.id, `ap+ef61://${did}/actor`);
  } finally {
    fetchMock.unmockGlobal();
    fetchMock.removeRoutes();
    await gateway.close();
  }
});

function createTimeoutLoaderFactory(
  timedOut: (url: string) => boolean,
): typeof import("./docloader.ts").getDocumentLoader {
  const base = getDefaultDocumentLoader({ allowPrivateAddress: true });
  return () =>
    Promise.resolve<DocumentLoader>((url, options) => {
      if (!timedOut(url)) return base(url, options);
      // The same shape as a timeout of the built-in document loaders:
      const error = new FetchError(url, "Timed out after 10000 ms");
      error.cause = new DOMException("Timed out.", "TimeoutError");
      return Promise.reject(error);
    });
}

test("fedify lookup --recurse reports the default timeout of the first object", async () => {
  // Loopback addresses are refused before any WebFinger request:
  const url = "https://127.0.0.1:1/notes/1";
  const { code, stderr } = await lookup(
    { urls: [url], recurse: "replyTarget", recurseDepth: 5 },
    { getDocumentLoader: createTimeoutLoaderFactory((u) => u === url) },
  );
  assert.equal(code, 1);
  assert.match(stderr, /Request timed out after 10 seconds/);
  assert.doesNotMatch(stderr, /authorized-fetch/);
});

test("fedify lookup --recurse reports the default timeout of a linked object", async () => {
  const gateway = await startGateway();
  try {
    await serveFixtures(gateway);
    const { code, output, stderr } = await lookup(
      {
        urls: [`ap://${did}/reply`],
        gateways: [gateway.url],
        recurse: "replyTarget",
        recurseDepth: 5,
      },
      {
        getDocumentLoader: createTimeoutLoaderFactory((u) =>
          u.endsWith("/note")
        ),
      },
    );
    assert.equal(code, 1);
    assert.equal(parseOutputs(output).length, 1);
    assert.match(stderr, /Request timed out after 10 seconds/);
    assert.doesNotMatch(stderr, /authorized-fetch/);

    const suppressed = await lookup(
      {
        urls: [`ap://${did}/reply`],
        gateways: [gateway.url],
        recurse: "replyTarget",
        recurseDepth: 5,
        suppressErrors: true,
      },
      {
        getDocumentLoader: createTimeoutLoaderFactory((u) =>
          u.endsWith("/note")
        ),
      },
    );
    assert.equal(suppressed.code, 0, suppressed.stderr);
    assert.equal(parseOutputs(suppressed.output).length, 1);
  } finally {
    await gateway.close();
  }
});

test("fedify lookup --recurse reports an explicit timeout of a linked object", async () => {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => release = resolve);
  const server = serve({
    port: 0,
    hostname: "127.0.0.1",
    silent: true,
    async fetch(request) {
      const { pathname, origin } = new URL(request.url);
      if (pathname === "/reply") {
        return Response.json({
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Note",
          id: `${origin}/reply`,
          inReplyTo: `${origin}/stalled`,
          content: "Reply",
        }, { headers: { "Content-Type": "application/activity+json" } });
      }
      await released;
      return new Response(null, { status: 404 });
    },
  });
  await server.ready();
  assert.ok(server.url != null);
  try {
    const { code, stderr } = await lookup({
      urls: [new URL("/reply", server.url).href],
      recurse: "replyTarget",
      recurseDepth: 5,
      timeout: 0.2,
    });
    assert.equal(code, 1);
    assert.match(stderr, /Request timed out after 0\.2 seconds/);
    assert.doesNotMatch(stderr, /authorized-fetch/);
  } finally {
    release();
    await server.close(true);
  }
});

test("lookupPortableWebFinger() uses the first gateway of the actor", async () => {
  const gateway = await startGateway();
  fetchMock.spyGlobal();
  const compatibleId = toCompatibleEf61Id(portableId("/actor"), gateway.url);
  fetchMock.get(`begin:https://${gateway.url.host}/.well-known/webfinger`, {
    subject: `acct:alice@${gateway.url.host}`,
    links: [{
      rel: "self",
      type: "application/activity+json",
      href: compatibleId.href,
    }],
  });
  try {
    await serveFixtures(gateway);
    for (
      const resource of [
        `ap://${did}/actor?@gateway=${encodeURIComponent(gateway.url.origin)}`,
        compatibleId.href,
      ]
    ) {
      const result = await lookupPortableWebFinger({
        resource,
        allowPrivateAddresses: true,
      });
      assert.equal(result.address, `acct:alice@${gateway.url.host}`);
      assert.equal(formatIri(result.actorId), `ap+ef61://${did}/actor`);
      assert.ok(linksToActor(result.descriptor, result.actorId));
    }
    const result = await lookupPortableWebFinger({
      resource: `ap://${did}/actor`,
      gateways: [gateway.url],
      allowPrivateAddresses: true,
    });
    assert.equal(result.address, `acct:alice@${gateway.url.host}`);
    await assert.rejects(
      lookupPortableWebFinger({
        resource: `ap://${did}/actor`,
        allowPrivateAddresses: true,
      }),
      /no @gateway location hints/,
    );
  } finally {
    fetchMock.unmockGlobal();
    fetchMock.removeRoutes();
    await gateway.close();
  }
});

test("linksToActor() checks the first ActivityStreams self link", () => {
  const actorId = portableId("/actor");
  const compatible =
    `https://gateway.example/.well-known/apgateway/${did}/actor`;
  assert.ok(
    linksToActor({
      subject: "acct:alice@gateway.example",
      links: [
        { rel: "self", type: "text/html", href: "https://example.com/" },
        {
          rel: "self",
          type:
            'application/ld+json;profile="https://www.w3.org/ns/activitystreams"',
          href: compatible,
        },
      ],
    }, actorId),
  );
  assert.ok(
    linksToActor({
      subject: "acct:alice@gateway.example",
      links: [{
        rel: "self",
        type: "application/activity+json",
        href: `ap://${did}/actor`,
      }],
    }, actorId),
  );
  assert.ok(
    !linksToActor({
      subject: "acct:alice@gateway.example",
      links: [
        {
          rel: "self",
          type: "application/activity+json",
          href: `ap://${otherDid}/actor`,
        },
        { rel: "self", type: "application/activity+json", href: compatible },
      ],
    }, actorId),
  );
  assert.ok(
    !linksToActor({
      subject: "acct:alice@gateway.example",
      links: [{
        rel: "self",
        type: "application/activity+json",
        href: "https://gateway.example/users/alice",
      }],
    }, actorId),
  );
});
