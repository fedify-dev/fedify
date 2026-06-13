import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { serve } from "srvx";
import { spawnBenchmarkTarget } from "../../test/bench/fixture.ts";
import runBench, { withUserAgent } from "./action.ts";
import type { BenchRunCommand } from "./command.ts";

function command(overrides: Partial<BenchRunCommand>): BenchRunCommand {
  return {
    command: "bench",
    mode: "run",
    scenario: "",
    target: undefined,
    format: "json",
    output: undefined,
    dryRun: false,
    allowUnsafeTarget: false,
    userAgent: "Fedify-bench-test/1.0",
    ...overrides,
  } as BenchRunCommand;
}

async function writeSuite(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fedify-bench-"));
  const path = join(dir, "suite.yaml");
  await writeFile(path, content, { encoding: "utf-8" });
  return path;
}

function resolvePublicHost(_hostname: string): Promise<readonly string[]> {
  return Promise.resolve(["93.184.216.34"]);
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
  const target = await spawnBenchmarkTarget();
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
  const target = await spawnBenchmarkTarget();
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
  const target = await spawnBenchmarkTarget();
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

test("runBench - repeats a scenario according to runs", async () => {
  const file = await writeSuite(`version: 1
target: http://127.0.0.1:3000
scenarios:
  - name: wf
    type: webfinger
    recipient: "acct:alice@example.com"
    runs: 2
    load: { concurrency: 1 }
    duration: 5ms
`);
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
    fetch: (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      if (url.pathname === "/.well-known/webfinger") {
        return Promise.resolve(
          new Response(JSON.stringify({ subject: "acct:alice@example.com" }), {
            headers: { "content-type": "application/jrd+json" },
          }),
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    },
  });
  const report = JSON.parse(output);
  assert.strictEqual(code, 0);
  assert.strictEqual(report.scenarios[0].runCount, 2);
  assert.strictEqual(report.scenarios[0].runs.length, 2);
});

test("runBench - dry run reports inbox discovery failures and continues", async () => {
  const target = await spawnBenchmarkTarget();
  try {
    const file = await writeSuite(`version: 1
target: ${target.url.href}
scenarios:
  - name: inbox-shared
    type: inbox
    recipient:
      - "${new URL("/users/missing", target.url).href}"
      - "${new URL("/users/alice", target.url).href}"
    inbox: shared
    load: { concurrency: 2 }
    duration: 250ms
`);
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
    assert.match(output, /\/users\/missing/);
    assert.match(output, /discovery failed/);
    assert.match(output, /\/users\/alice/);
    assert.match(output, /\/inbox/);
    assert.match(output, /No benchmark load was sent/);
    assert.ok(!target.requests().some((r) => r.method === "POST"));
  } finally {
    await target.close();
  }
});

test("runBench - dry run resolves actor handles with configured fetch", async () => {
  const file = await writeSuite(`version: 1
target: http://127.0.0.1:3000
scenarios:
  - name: actor-read
    type: actor
    recipient: "acct:alice@example.test"
    load: { concurrency: 1 }
    duration: 1ms
`);
  let code = -1;
  let output = "";
  let webfingerFetched = false;
  let webfingerUserAgent: string | null = null;
  await runBench(command({ scenario: file, dryRun: true }), {
    exit: (c) => {
      code = c;
    },
    writeOutput: (c) => {
      output = c;
      return Promise.resolve();
    },
    log: () => {},
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      if (url.pathname === "/.well-known/webfinger") {
        webfingerFetched = true;
        webfingerUserAgent = headers.get("user-agent");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              subject: url.searchParams.get("resource"),
              links: [{
                rel: "self",
                href: "http://127.0.0.1:3000/users/alice",
              }],
            }),
            {
              headers: { "content-type": "application/jrd+json" },
            },
          ),
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    },
  });

  assert.strictEqual(code, 0);
  assert.strictEqual(webfingerFetched, true);
  assert.strictEqual(webfingerUserAgent, "Fedify-bench-test/1.0");
  assert.match(output, /\/users\/alice/);
});

test("runBench - dry run gates object discovery before fetching", async () => {
  const file = await writeSuite(`version: 1
target: http://127.0.0.1:3000
scenarios:
  - name: object-crawl
    type: object
    source:
      seed: "https://public.example/users/alice"
      collection: outbox
      limit: 1
    load: { concurrency: 1 }
    duration: 1ms
`);
  let code = -1;
  let output = "";
  let publicFetched = false;
  await runBench(command({ scenario: file, dryRun: true }), {
    exit: (c) => {
      code = c;
    },
    writeOutput: (c) => {
      output = c;
      return Promise.resolve();
    },
    log: () => {},
    resolveTargetAddresses: resolvePublicHost,
    fetch: (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.hostname === "public.example") {
        publicFetched = true;
        throw new Error("dry-run fetched an unsafe object source");
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    },
  });

  assert.strictEqual(code, 0);
  assert.strictEqual(publicFetched, false);
  assert.match(output, /object discovery failed/);
  assert.match(output, /Refusing to send benchmark read load/);
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
    resolveTargetAddresses: resolvePublicHost,
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

test("runBench - remote failure needs advertised sink reachability", async () => {
  const file = await writeSuite(`version: 1
target: http://10.10.0.5:8000
scenarios:
  - name: remote-404
    type: failure
    fault: remote-404
    sender: alice
    load: { rate: 1/s }
    duration: 1ms
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

test("runBench - default failure fault needs advertised sink reachability", async () => {
  const file = await writeSuite(`version: 1
target: http://10.10.0.5:8000
scenarios:
  - name: default-failure
    type: failure
    sender: alice
    load: { rate: 1/s }
    duration: 1ms
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

test("runBench - remote failure uses advertised sink reachability", async () => {
  const file = await writeSuite(`version: 1
target: http://10.10.0.5:8000
scenarios:
  - name: remote-404
    type: failure
    fault: remote-404
    sender: alice
    load: { concurrency: 1 }
    duration: 25ms
    queueDrainTimeout: 1s
`);
  let code = -1;
  let message = "";
  let triggerCalls = 0;
  await runBench(command({ scenario: file, advertiseHost: "127.0.0.1" }), {
    exit: (c) => {
      code = c;
    },
    writeOutput: () => Promise.resolve(),
    log: (m) => {
      message = m;
    },
    fetch: (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              version: 1,
              source: "server",
              scopeMetrics: [{
                metrics: [
                  sumMetric("fedify.queue.task.enqueued", triggerCalls),
                  sumMetric("fedify.queue.task.completed", triggerCalls),
                  sumMetric("fedify.queue.task.failed", 0),
                  sumMetric(
                    "activitypub.delivery.permanent_failure",
                    triggerCalls,
                  ),
                ],
              }],
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (url.pathname === "/.well-known/fedify/bench/trigger") {
        triggerCalls++;
        return Promise.resolve(
          new Response(JSON.stringify({ version: 1 }), {
            status: 202,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    },
  });

  assert.strictEqual(code, 0, message);
  assert.ok(triggerCalls > 0);
});

test("runBench - missing-actor failure needs no advertise host", async () => {
  const recipientTarget = await spawnBenchmarkTarget();
  try {
    const file = await writeSuite(`version: 1
target: http://10.10.0.5:8000
scenarios:
  - name: missing-actor
    type: failure
    fault: missing-actor
    recipient: "${new URL("/users/alice", recipientTarget.url).href}"
    load: { rate: 1/s }
    duration: 1ms
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
      fetch: (input) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname === "/.well-known/fedify/bench/stats") {
          return Promise.resolve(new Response("not found", { status: 404 }));
        }
        if (
          url.origin === recipientTarget.url.origin &&
          url.pathname === "/inbox"
        ) {
          return Promise.resolve(
            new Response("actor not found", { status: 401 }),
          );
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      },
    });
    assert.strictEqual(code, 0, message);
  } finally {
    await recipientTarget.close();
  }
});

test("runBench - missing-actor failure allows private inbox without advertise host", async () => {
  const actorServer = serve({
    port: 0,
    hostname: "127.0.0.1",
    silent: true,
    fetch(request: Request): Response {
      const url = new URL(request.url);
      if (url.pathname === "/users/alice") {
        return new Response(
          JSON.stringify({
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Person",
            id: url.href,
            inbox: "http://10.0.0.8/inbox",
          }),
          { headers: { "content-type": "application/activity+json" } },
        );
      }
      return new Response("not found", { status: 404 });
    },
  });
  await actorServer.ready();
  try {
    const actorUrl = new URL("/users/alice", new URL(actorServer.url!));
    const file = await writeSuite(`version: 1
target: http://10.10.0.5:8000
scenarios:
  - name: missing-actor
    type: failure
    fault: missing-actor
    recipient: "${actorUrl.href}"
    load: { rate: 1/s }
    duration: 1ms
`);
    let code = -1;
    let message = "";
    let inboxPosts = 0;
    await runBench(command({ scenario: file }), {
      exit: (c) => {
        code = c;
      },
      writeOutput: () => Promise.resolve(),
      log: (m) => {
        message = m;
      },
      fetch: (input) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname === "/.well-known/fedify/bench/stats") {
          return Promise.resolve(new Response("not found", { status: 404 }));
        }
        if (url.href === "http://10.0.0.8/inbox") {
          inboxPosts++;
          return Promise.resolve(
            new Response("actor not found", { status: 401 }),
          );
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      },
    });
    assert.strictEqual(code, 0, message);
    assert.ok(inboxPosts > 0);
  } finally {
    await actorServer.close(true);
  }
});

test("runBench - unauthenticated actor read needs no advertise host", async () => {
  const file = await writeSuite(`version: 1
target: http://10.10.0.5:8000
scenarios:
  - name: actor-read
    type: actor
    recipient: http://10.10.0.6/users/alice
    load: { rate: 1/s }
    duration: 1ms
`);
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
    fetch: (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });
  assert.strictEqual(code, 0);
  assert.strictEqual(JSON.parse(output).scenarios[0].requests.successRate, 1);
});

test("runBench - refuses an inbox destination off the gated target (exit 2)", async () => {
  // A loopback target passes the gate, but an explicit public `inbox:` is the
  // actual load destination; it must be gated too, or production could be
  // benchmarked through the back door.
  const target = await spawnBenchmarkTarget();
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
      resolveTargetAddresses: resolvePublicHost,
    });
    assert.strictEqual(code, 2);
    assert.match(message, /public inbox|allow-unsafe-target/);
  } finally {
    await target.close();
  }
});

test("runBench - allows a DNS-resolved private inbox off the target", async () => {
  const target = await spawnBenchmarkTarget();
  try {
    const file = await writeSuite(`version: 1
target: ${target.url.href}
scenarios:
  - name: inbox-shared
    type: inbox
    recipient: "${new URL("/users/alice", target.url).href}"
    inbox: "https://shared.staging.example/inbox"
    runs: 1
    load: { concurrency: 2 }
    duration: 250ms
`);
    let code = -1;
    let message = "";
    const resolved: string[] = [];
    await runBench(
      command({
        scenario: file,
        advertiseHost: "127.0.0.1",
      }),
      {
        exit: (c) => {
          code = c;
        },
        writeOutput: () => Promise.resolve(),
        log: (m) => {
          message = m;
        },
        resolveTargetAddresses: (hostname) => {
          resolved.push(hostname);
          return Promise.resolve(
            hostname === "shared.staging.example" ? ["10.0.0.8"] : [],
          );
        },
        fetch: (input) => {
          const url = new URL(input instanceof Request ? input.url : input);
          if (url.hostname === "shared.staging.example") {
            return Promise.resolve(new Response("accepted", { status: 202 }));
          }
          return fetch(input);
        },
      },
    );
    assert.strictEqual(code, 0, message);
    assert.deepStrictEqual(resolved, ["shared.staging.example"]);
  } finally {
    await target.close();
  }
});

test("runBench - unsafe public inbox destination needs an explicit CLI target", async () => {
  const target = await spawnBenchmarkTarget();
  try {
    const file = await writeSuite(`version: 1
target: ${target.url.href}
scenarios:
  - name: inbox-shared
    type: inbox
    recipient: "${new URL("/users/alice", target.url).href}"
    inbox: "https://prod.example/inbox"
    load: { rate: 1/s }
    duration: 1ms
`);
    let code = -1;
    let message = "";
    await runBench(
      command({
        scenario: file,
        allowUnsafeTarget: true,
        advertiseHost: "127.0.0.1",
      }),
      {
        exit: (c) => {
          code = c;
        },
        writeOutput: () => Promise.resolve(),
        log: (m) => {
          message = m;
        },
        resolveTargetAddresses: resolvePublicHost,
      },
    );
    assert.strictEqual(code, 2);
    assert.match(message, /--target/);
  } finally {
    await target.close();
  }
});

test("runBench - unsafe public inbox destination needs explicit load", async () => {
  const target = await spawnBenchmarkTarget();
  try {
    const file = await writeSuite(`version: 1
target: ${target.url.href}
scenarios:
  - name: inbox-shared
    type: inbox
    recipient: "${new URL("/users/alice", target.url).href}"
    inbox: "https://prod.example/inbox"
    duration: 1ms
`);
    let code = -1;
    let message = "";
    await runBench(
      command({
        scenario: file,
        target: target.url.href,
        allowUnsafeTarget: true,
        advertiseHost: "127.0.0.1",
      }),
      {
        exit: (c) => {
          code = c;
        },
        writeOutput: () => Promise.resolve(),
        log: (m) => {
          message = m;
        },
        resolveTargetAddresses: resolvePublicHost,
      },
    );
    assert.strictEqual(code, 2);
    assert.match(message, /load/);
  } finally {
    await target.close();
  }
});

test("runBench - unsafe public inbox destination honors suite defaults", async () => {
  const target = await spawnBenchmarkTarget();
  try {
    const file = await writeSuite(`version: 1
target: ${target.url.href}
defaults:
  duration: 1ms
  load: { rate: 1/s }
scenarios:
  - name: inbox-shared
    type: inbox
    recipient: "${new URL("/users/alice", target.url).href}"
    inbox: "https://prod.example/inbox"
`);
    let code = -1;
    let message = "";
    await runBench(
      command({
        scenario: file,
        target: target.url.href,
        allowUnsafeTarget: true,
        advertiseHost: "127.0.0.1",
      }),
      {
        exit: (c) => {
          code = c;
        },
        writeOutput: () => Promise.resolve(),
        log: (m) => {
          message = m;
        },
        resolveTargetAddresses: resolvePublicHost,
        fetch: (input) => {
          const url = new URL(input instanceof Request ? input.url : input);
          if (url.hostname === "prod.example") {
            return Promise.resolve(new Response("accepted", { status: 202 }));
          }
          return fetch(input);
        },
      },
    );
    assert.strictEqual(code, 0, message);
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

test("runBench - invalid mixed child exits 2 before any probe", async () => {
  const file = await writeSuite(`version: 1
target: http://localhost:3000
scenarios:
  - name: mixed
    type: mixed
    mix:
      - scenario: missing
        weight: 1
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
  assert.match(message, /unknown mixed child/);
  assert.strictEqual(fetched, false);
});

test("runBench - mixed server expectation exits 2 before any probe", async () => {
  const file = await writeSuite(`version: 1
target: http://localhost:3000
scenarios:
  - name: lookup
    type: webfinger
    recipient: acct:alice@example.com
  - name: mixed
    type: mixed
    mix:
      - scenario: lookup
        weight: 1
    expect:
      queueDrain.p95: "< 10ms"
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
  assert.match(message, /queueDrain\.p95/);
  assert.strictEqual(fetched, false);
});

test("runBench - invalid object source exits 2 before any probe", async () => {
  const file = await writeSuite(`version: 1
target: http://localhost:3000
scenarios:
  - name: object
    type: object
    source: objects/1
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
  assert.match(message, /invalid object source URL/);
  assert.strictEqual(fetched, false);
});

test("runBench - invalid actor recipient exits 2 before any probe", async () => {
  const file = await writeSuite(`version: 1
target: http://localhost:3000
scenarios:
  - name: actor
    type: actor
    recipient: alice
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
  assert.match(message, /invalid actor recipient/);
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

function sumMetric(name: string, value: number): Record<string, unknown> {
  return {
    name,
    dataPointType: "sum",
    dataPoints: [{ value }],
  };
}
