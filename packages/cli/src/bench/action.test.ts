import {
  createFederation,
  generateCryptoKeyPair,
  MemoryKvStore,
} from "@fedify/fedify";
import { Create, Endpoints, Person } from "@fedify/vocab";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { serve } from "srvx";
import runBench, { withUserAgent } from "./action.ts";
import type { BenchCommand } from "./command.ts";

async function spawnTarget() {
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    benchmarkMode: true,
  });
  let keyPairs: CryptoKeyPair[] | undefined;
  const requests: { method: string; path: string }[] = [];
  federation
    .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
      if (identifier !== "alice") return null;
      const pairs = await ctx.getActorKeyPairs(identifier);
      return new Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
        inbox: ctx.getInboxUri(identifier),
        endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
        publicKey: pairs[0]?.cryptographicKey,
        assertionMethods: pairs.map((p) => p.multikey),
      });
    })
    .mapHandle((_ctx, username) => (username === "alice" ? "alice" : null))
    .setKeyPairsDispatcher(async (_ctx, identifier) => {
      if (identifier !== "alice") return [];
      keyPairs ??= [
        await generateCryptoKeyPair("RSASSA-PKCS1-v1_5"),
        await generateCryptoKeyPair("Ed25519"),
      ];
      return keyPairs;
    });
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox").on(
    Create,
    () => {},
  );
  let inboxUserAgent: string | null = null;
  const server = serve({
    port: 0,
    hostname: "127.0.0.1",
    silent: true,
    fetch: (request: Request) => {
      const url = new URL(request.url);
      requests.push({ method: request.method, path: url.pathname });
      if (request.method === "POST") {
        inboxUserAgent = request.headers.get("user-agent");
      }
      return federation.fetch(request, { contextData: undefined });
    },
  });
  await server.ready();
  return {
    url: new URL(server.url!),
    inboxUserAgent: () => inboxUserAgent,
    requests: () => requests.slice(),
    close: () => server.close(true),
  };
}

function command(overrides: Partial<BenchCommand>): BenchCommand {
  return {
    command: "bench",
    scenario: "",
    target: undefined,
    format: "json",
    output: undefined,
    dryRun: false,
    allowUnsafeTarget: false,
    userAgent: "Fedify-bench-test/1.0",
    ...overrides,
  } as BenchCommand;
}

async function writeSuite(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fedify-bench-"));
  const path = join(dir, "suite.yaml");
  await writeFile(path, content, { encoding: "utf-8" });
  return path;
}

function inboxSuite(target: URL, expectLine: string): string {
  // Uses `${{ target.host }}` templating to form the actor URI (WebFinger is
  // https-only, so an acct: handle would not resolve over http loopback).
  return `version: 1
target: ${target.href}
scenarios:
  - name: inbox-shared
    type: inbox
    recipient: "http://\${{ target.host }}/users/alice"
    inbox: shared
    load: { concurrency: 2 }
    duration: 250ms
    expect:
${expectLine}
`;
}

test("runBench - passing gate exits 0 and writes a valid report", async () => {
  const target = await spawnTarget();
  try {
    const file = await writeSuite(
      inboxSuite(target.url, '      successRate: ">= 99%"'),
    );
    let code = -1;
    let output = "";
    await runBench(command({ scenario: file }), {
      exit: (c) => {
        code = c;
      },
      writeOutput: (c) => {
        output = c;
        return Promise.resolve();
      },
      log: () => {},
    });
    assert.strictEqual(code, 0);
    const report = JSON.parse(output);
    assert.strictEqual(report.passed, true);
    assert.strictEqual(report.scenarios[0].requests.successRate, 1);
    assert.ok(report.target.statsAvailable);
    // The configured User-Agent reached the actual benchmark traffic, not just
    // the document loader.
    assert.strictEqual(target.inboxUserAgent(), "Fedify-bench-test/1.0");
  } finally {
    await target.close();
  }
});

test("withUserAgent - sets the User-Agent on a prebuilt request", async () => {
  let seen: string | null = null;
  const wrapped = withUserAgent((input) => {
    seen = (input as Request).headers.get("user-agent");
    return Promise.resolve(new Response("ok"));
  }, "Bench/9.9");
  await wrapped(new Request("http://x.test/a"));
  assert.strictEqual(seen, "Bench/9.9");
});

test("withUserAgent - sets the User-Agent on a URL request, keeping init headers", async () => {
  let ua: string | null = null;
  let accept: string | null = null;
  const wrapped = withUserAgent((_input, init) => {
    const headers = new Headers(init?.headers);
    ua = headers.get("user-agent");
    accept = headers.get("accept");
    return Promise.resolve(new Response("ok"));
  }, "Bench/9.9");
  await wrapped(new URL("http://x.test/a"), {
    headers: { accept: "application/json" },
  });
  assert.strictEqual(ua, "Bench/9.9");
  assert.strictEqual(accept, "application/json");
});

test("withUserAgent - does not override an explicit User-Agent", async () => {
  let seen: string | null = null;
  const wrapped = withUserAgent((input) => {
    seen = (input as Request).headers.get("user-agent");
    return Promise.resolve(new Response("ok"));
  }, "Bench/9.9");
  await wrapped(
    new Request("http://x.test/a", { headers: { "user-agent": "Custom/1" } }),
  );
  assert.strictEqual(seen, "Custom/1");
});

test("runBench - failing gate exits 1", async () => {
  const target = await spawnTarget();
  try {
    // An impossible latency threshold makes the gate fail.
    const file = await writeSuite(
      inboxSuite(target.url, '      latency.p95: "< 0ms"'),
    );
    let code = -1;
    await runBench(command({ scenario: file }), {
      exit: (c) => {
        code = c;
      },
      writeOutput: () => Promise.resolve(),
      log: () => {},
    });
    assert.strictEqual(code, 1);
  } finally {
    await target.close();
  }
});

test("runBench - dry run prints a plan and sends nothing", async () => {
  const target = await spawnTarget();
  try {
    const file = await writeSuite(
      inboxSuite(target.url, '      successRate: ">= 99%"'),
    );
    let code = -1;
    let output = "";
    await runBench(command({ scenario: file, dryRun: true }), {
      exit: (c) => {
        code = c;
      },
      writeOutput: (c) => {
        output = c;
        return Promise.resolve();
      },
      log: () => {},
    });
    assert.strictEqual(code, 0);
    assert.match(output, /dry run/i);
    assert.match(output, /\/inbox/);
    assert.match(output, /No benchmark load was sent/);
    const requests = target.requests();
    assert.ok(requests.some((r) => r.method === "GET"));
    assert.ok(!requests.some((r) => r.method === "POST"));
  } finally {
    await target.close();
  }
});

test("runBench - unsafe override requires an explicit CLI target", async () => {
  const file = await writeSuite(`version: 1
target: https://example.com
scenarios:
  - name: wf
    type: webfinger
    recipient: "acct:alice@example.com"
    load: { rate: 1/s }
    duration: 1ms
`);
  let code = -1;
  let message = "";
  await runBench(command({ scenario: file, allowUnsafeTarget: true }), {
    exit: (c) => {
      code = c;
    },
    writeOutput: () => Promise.resolve(),
    log: (m) => {
      message = m;
    },
    fetch: (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname.includes("/bench/stats")) {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      return Promise.resolve(new Response("ok"));
    },
  });
  assert.strictEqual(code, 2);
  assert.match(message, /--target/);
});

test("runBench - refuses an unsafe public target (exit 2)", async () => {
  const file = await writeSuite(`version: 1
target: https://example.com
scenarios:
  - name: wf
    type: webfinger
    recipient: "acct:alice@example.com"
`);
  let code = -1;
  await runBench(command({ scenario: file }), {
    exit: (c) => {
      code = c;
    },
    writeOutput: () => Promise.resolve(),
    log: () => {},
    // Probe fails without network, so the target appears non-benchmark.
    fetch: () => Promise.reject(new Error("offline")),
  });
  assert.strictEqual(code, 2);
});

test("runBench - rejects a signed scenario against a public target", async () => {
  const file = await writeSuite(`version: 1
target: https://staging.example
scenarios:
  - name: inbox-shared
    type: inbox
    recipient: "https://staging.example/users/alice"
    load: { concurrency: 2 }
    duration: 100ms
`);
  let code = -1;
  let message = "";
  await runBench(command({ scenario: file }), {
    exit: (c) => {
      code = c;
    },
    writeOutput: () => Promise.resolve(),
    log: (m) => {
      message = m;
    },
    // The target advertises benchmark mode so it passes the safety gate.
    fetch: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ version: 1, source: "server", scopeMetrics: [] }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
  });
  assert.strictEqual(code, 2);
  assert.match(message, /advertise-host/);
});

test("runBench - rejects a signed scenario against a non-loopback target", async () => {
  // A private (non-loopback) target passes the safety gate, but a signed
  // scenario without --advertise-host cannot reach the synthetic actor server,
  // so it is refused (exit 2) before any load.
  const file = await writeSuite(`version: 1
target: http://10.10.0.5:8000
scenarios:
  - name: inbox-shared
    type: inbox
    recipient: "http://10.10.0.5:8000/users/alice"
    load: { concurrency: 2 }
    duration: 100ms
`);
  let code = -1;
  let message = "";
  await runBench(command({ scenario: file }), {
    exit: (c) => {
      code = c;
    },
    writeOutput: () => Promise.resolve(),
    log: (m) => {
      message = m;
    },
    fetch: () => Promise.reject(new Error("offline")),
  });
  assert.strictEqual(code, 2);
  assert.match(message, /advertise-host/);
});

test("runBench - refuses an inbox destination off the gated target (exit 2)", async () => {
  // A loopback target passes the gate, but an explicit public `inbox:` is the
  // actual load destination; it must be gated too, or production could be
  // benchmarked through the back door.
  const target = await spawnTarget();
  try {
    const file = await writeSuite(`version: 1
target: ${target.url.href}
scenarios:
  - name: inbox-shared
    type: inbox
    recipient: "${new URL("/users/alice", target.url).href}"
    inbox: "https://prod.example/inbox"
    load: { concurrency: 2 }
    duration: 250ms
`);
    let code = -1;
    let message = "";
    await runBench(command({ scenario: file }), {
      exit: (c) => {
        code = c;
      },
      writeOutput: () => Promise.resolve(),
      log: (m) => {
        message = m;
      },
    });
    assert.strictEqual(code, 2);
    assert.match(message, /public inbox|allow-unsafe-target/);
  } finally {
    await target.close();
  }
});

test("runBench - malformed expect assertion exits 2 before any load", async () => {
  // The expect typo must be caught in preflight, so the run exits 2 (a config
  // error) without ever probing the target or sending load.
  const file = await writeSuite(`version: 1
target: http://localhost:3000
scenarios:
  - name: wf
    type: webfinger
    recipient: "acct:alice@x"
    expect:
      successRate: "totally not valid"
`);
  let code = -1;
  let message = "";
  let fetched = false;
  await runBench(command({ scenario: file }), {
    exit: (c) => {
      code = c;
    },
    writeOutput: () => Promise.resolve(),
    log: (m) => {
      message = m;
    },
    fetch: () => {
      fetched = true;
      return Promise.reject(new Error("no request should be sent"));
    },
  });
  assert.strictEqual(code, 2);
  assert.match(message, /expect|assertion/i);
  assert.strictEqual(fetched, false);
});

test("runBench - invalid suite exits 2", async () => {
  const file = await writeSuite(`target: http://localhost:3000
scenarios:
  - name: x
    type: inbox
    recipient: "acct:a@x"
`); // missing version
  let code = -1;
  let message = "";
  await runBench(command({ scenario: file }), {
    exit: (c) => {
      code = c;
    },
    writeOutput: () => Promise.resolve(),
    log: (m) => {
      message = m;
    },
  });
  assert.strictEqual(code, 2);
  assert.match(message, /Invalid/);
});
