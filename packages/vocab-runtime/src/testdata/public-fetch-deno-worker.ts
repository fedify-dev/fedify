/**
 * A worker for the Deno test of `openPublicFetch()` in
 * *../public-fetch.test.ts*.  The debug log about unpinned connections is
 * emitted once per runtime and protocol in a module instance, and other tests
 * in the same process may already have emitted it for Deno, so the test runs
 * this module in a worker, which has its own module instances.
 *
 * It opens three sessions through the global `fetch()`, which it replaces
 * with a recording function, for `https://deno-host.invalid/1`, `/2`, and
 * `http://deno-host.invalid/3`, and posts the results as a message.
 * @module
 */
import { configure, type LogRecord } from "@logtape/logtape";
import { openPublicFetch } from "../public-fetch.ts";

const records: LogRecord[] = [];
await configure({
  sinks: { buffer: (record) => records.push(record) },
  loggers: [
    {
      category: ["fedify", "runtime", "fetch"],
      sinks: ["buffer"],
      lowestLevel: "debug",
    },
    { category: ["logtape", "meta"], sinks: [] },
  ],
});

const calls: [string, string | undefined][] = [];
globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  calls.push([url, init?.redirect]);
  return Promise.resolve(new Response("ok"));
};

const hostnames: string[] = [];
const lookup = (hostname: string) => {
  hostnames.push(hostname);
  return Promise.resolve([{ address: "93.184.215.14", family: 4 }]);
};

const bodies: string[] = [];
for (
  const url of [
    "https://deno-host.invalid/1",
    "https://deno-host.invalid/2",
    "http://deno-host.invalid/3",
  ]
) {
  const session = await openPublicFetch(url, { lookup });
  try {
    const response = await session.fetch(url, { redirect: "follow" });
    bodies.push(await response.text());
  } finally {
    await session.close();
  }
}

(globalThis as unknown as { postMessage(message: unknown): void })
  .postMessage({
    calls,
    hostnames,
    bodies,
    logs: records
      .filter((record) =>
        typeof record.rawMessage === "string" &&
        record.rawMessage.startsWith("Outbound {protocol} connections are not")
      )
      .map((record) => [
        record.level,
        record.properties.runtime,
        record.properties.protocol,
      ]),
  });
