// Separate real database handles run on concurrent threads. Coordination and
// cleanup must remain sequential; no same-event-loop race is counted here.
import { PlatformDatabase } from "#sqlite";
import { SqliteKvStore } from "@fedify/sqlite/kv";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { Worker } from "node:worker_threads";

interface Message {
  kind: "ready" | "held" | "begin" | "starting" | "result" | "error";
  id?: number;
  value?: unknown;
  time?: number;
  message?: string;
  busy?: boolean;
}
interface Result {
  result: unknown;
  completedAt: number;
  beginAt: number;
  beginWait: number;
  overlap?: number;
  busyCount?: number;
}

const workerSource = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const temporal = await import(workerData.temporal);
  globalThis.Temporal ??= temporal.Temporal ?? temporal.default.Temporal;
  const { PlatformDatabase } = await import(workerData.sqlite);
  const { SqliteKvStore } = await import(workerData.store);
  const db = new PlatformDatabase(workerData.file);
  db.exec("PRAGMA busy_timeout=" + workerData.timeout);
  const gate = new Int32Array(workerData.gate);
  let currentId = 0;
  let pause = false;
  let beginAt = 0;
  let beginWait = 0;
  const wrapped = new Proxy(db, {
    get(target, property) {
      const member = target[property];
      if (typeof member !== "function") return member;
      if (property === "exec") return (sql) => {
        if (sql !== "BEGIN IMMEDIATE") return member.call(target, sql);
        beginAt = Date.now();
        parentPort.postMessage({ kind: "begin", id: currentId, time: beginAt });
        const result = member.call(target, sql);
        beginWait = Date.now() - beginAt;
        return result;
      };
      if (property === "prepare" || property === "query") return (sql) => {
        const statement = member.call(target, sql);
        return new Proxy(statement, {
          get(statementTarget, method) {
            const fn = statementTarget[method];
            if (typeof fn !== "function") return fn;
            if (method !== "get" || !sql.includes("SELECT value")) return fn.bind(statementTarget);
            return (...parameters) => {
              const result = fn.apply(statementTarget, parameters);
              if (pause) {
                pause = false;
                parentPort.postMessage({ kind: "held", id: currentId, time: Date.now() });
                if (Atomics.wait(gate, 1, 0, 10000) === "timed-out") throw new Error("holder release timeout");
              }
              return result;
            };
          }
        });
      };
      return member.bind(target);
    }
  });
  const store = new SqliteKvStore(wrapped, { initialized: true });
  parentPort.on("message", async ({ id, command, entries, keys, iterations }) => {
    currentId = id;
    beginAt = 0;
    beginWait = 0;
    try {
      let result;
      let overlap = 0;
      let busyCount = 0;
      if (command === "hold-cas" || command === "hold-single") pause = true;
      if (command === "hold-single") {
        const entry = entries[0];
        result = await store.cas(entry.key, entry.expectedValue, entry.newValue);
      } else if (command === "cas" || command === "hold-cas") {
        result = await store.casMany(entries);
      } else if (command === "writer" || command === "reader") {
        const own = command === "writer" ? 5 : 6;
        const other = own === 5 ? 6 : 5;
        // Contention retries belong to this test driver, between complete calls.
        // The production store deliberately never retries backend failures.
        db.exec("PRAGMA busy_timeout=0");
        Atomics.store(gate, own, 1);
        parentPort.postMessage({ kind: "starting", id });
        if (Atomics.wait(gate, 4, 0, 10000) === "timed-out") throw new Error("stress start timeout");
        try {
          const deadline = Date.now() + 25000;
          for (let index = 0; index < iterations;) {
            if (Date.now() > deadline) throw new Error("stress contention deadline exceeded after " + index + " successes and " + busyCount + " busy rejections");
            try {
              if (command === "writer") {
                await store.setMany(keys.map(key => ({ key, value: index })));
              } else {
                const values = await store.getMany(keys);
                if (values[0] !== values[1] || values[0] === undefined) throw new Error("torn snapshot: " + JSON.stringify(values));
              }
              if (Atomics.load(gate, other) === 1) overlap++;
              index++;
            } catch (error) {
              const busy = error?.code === "SQLITE_BUSY" || error?.errno === 5 || error?.errcode === 5 || /SQLITE_BUSY|database(?: table)? is locked/i.test(String(error?.message));
              if (!busy) throw error;
              busyCount++;
            }
            // A scheduling opportunity avoids favoring one synchronous client.
            await new Promise(resolve => setTimeout(resolve, 1));
          }
          result = true;
        } finally { Atomics.store(gate, own, 0); }
      } else throw new Error("unknown worker command");
      parentPort.postMessage({ kind: "result", id, value: { result, completedAt: Date.now(), beginAt, beginWait, overlap, busyCount } });
    } catch (error) {
      const busy = error?.code === "SQLITE_BUSY" || error?.errno === 5 || error?.errcode === 5 || /SQLITE_BUSY|database(?: table)? is locked/i.test(String(error?.message));
      parentPort.postMessage({ kind: "error", id, message: String(error?.stack ?? error), busy });
    }
  });
  parentPort.postMessage({ kind: "ready" });
})().catch(error => { parentPort.postMessage({ kind: "error", message: String(error?.stack ?? error) }); });
`;

function client(file: string, gate: SharedArrayBuffer, timeout: number) {
  const worker = new Worker(workerSource, {
    eval: true,
    workerData: {
      file,
      gate,
      timeout,
      sqlite: import.meta.resolve("#sqlite"),
      store: import.meta.resolve("@fedify/sqlite/kv"),
      temporal: import.meta.resolve("@js-temporal/polyfill"),
    },
  });
  let sequence = 0;
  let stopping = false;
  const errors: Error[] = [];
  const waits = new Map<
    string,
    {
      resolve: (message: Message) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const buffered = new Map<string, Message>();
  const fail = (error: Error) => {
    errors.push(error);
    for (const wait of waits.values()) {
      clearTimeout(wait.timer);
      wait.reject(error);
    }
    waits.clear();
  };
  // These listeners live through termination, including after a result message.
  worker.on("error", fail);
  worker.on("exit", (code) => {
    if (!stopping) fail(new Error(`unexpected worker exit ${code}`));
  });
  worker.on("message", (message: Message) => {
    if (message.kind === "error" && message.id === undefined) {
      fail(new Error(message.message));
      return;
    }
    const kind = message.kind === "error" ? "result" : message.kind;
    const key = `${kind}:${message.id ?? 0}`;
    const wait = waits.get(key);
    if (wait) {
      waits.delete(key);
      clearTimeout(wait.timer);
      wait.resolve(message);
    } else buffered.set(key, message);
  });
  const next = (kind: string, id = 0): Promise<Message> => {
    if (errors.length) return Promise.reject(errors[0]);
    const key = `${kind}:${id}`;
    const message = buffered.get(key);
    if (message) {
      buffered.delete(key);
      return Promise.resolve(message);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waits.delete(key);
        reject(new Error(`worker ${key} timed out`));
      }, 30000);
      waits.set(key, { resolve, reject, timer });
    });
  };
  return {
    ready: () => next("ready"),
    call(command: string, data: Record<string, unknown> = {}) {
      const id = ++sequence;
      const value = next("result", id).then((message) => {
        if (message.kind === "error")
          throw Object.assign(new Error(message.message), {
            busy: message.busy,
          });
        return message.value as Result;
      });
      // A deliberate hold has a separately awaited handshake; prevent a timeout
      // from becoming an unhandled rejection before its result is drained.
      void value.catch(() => {});
      worker.postMessage({ id, command, ...data });
      return {
        id,
        value,
        held: () => next("held", id),
        begin: () => next("begin", id),
        starting: () => next("starting", id),
      };
    },
    async close() {
      stopping = true;
      await worker.terminate();
      for (const wait of waits.values()) {
        clearTimeout(wait.timer);
        wait.reject(new Error("worker terminated"));
      }
      waits.clear();
      assert.deepStrictEqual(
        errors,
        [],
        "worker errors must fail even after a success message",
      );
    },
  };
}

type Client = ReturnType<typeof client>;

async function withClients(
  journal: "DELETE" | "WAL",
  secondTimeout: number,
  run: (
    a: Client,
    b: Client,
    gate: Int32Array,
    store: SqliteKvStore,
  ) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "fedify-sqlite-concurrent-"));
  const db = new PlatformDatabase(join(directory, "kv.sqlite"));
  const clients: Client[] = [];
  const shared = new SharedArrayBuffer(8 * Int32Array.BYTES_PER_ELEMENT);
  const gate = new Int32Array(shared);
  const failures: unknown[] = [];
  try {
    db.exec(`PRAGMA journal_mode=${journal}`);
    db.exec("PRAGMA busy_timeout=5000");
    const store = new SqliteKvStore(db);
    store.initialize();
    const a = client(join(directory, "kv.sqlite"), shared, 5000);
    clients.push(a);
    const b = client(join(directory, "kv.sqlite"), shared, secondTimeout);
    clients.push(b);
    await Promise.all(clients.map((value) => value.ready()));
    await run(a, b, gate, store);
  } catch (error) {
    failures.push(error);
  }
  Atomics.store(gate, 1, 1);
  Atomics.notify(gate, 1);
  Atomics.store(gate, 4, 1);
  Atomics.notify(gate, 4);
  const settled = await Promise.allSettled(
    clients.map((value) => value.close()),
  );
  for (const result of settled)
    if (result.status === "rejected") failures.push(result.reason);
  try {
    db.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      "concurrent operation and cleanup failed",
    );
}

for (const journal of ["DELETE", "WAL"] as const) {
  // Bun 1.2.22 ignores node:test's options.skip; use the actual skip method.
  const concurrentTest =
    journal === "WAL" && process.versions.bun ? test.skip : test;
  const options = { timeout: 60000 };
  concurrentTest(
    `SqliteKvStore genuine threaded absent-key busy contention (${journal})`,
    options,
    () =>
      withClients(journal, 0, async (a, b, gate, store) => {
        const entries = [
          { key: ["a"], expectedValue: undefined, newValue: 1 },
          { key: ["b"], expectedValue: undefined, newValue: 1 },
        ];
        const holder = a.call("hold-cas", { entries });
        try {
          await holder.held();
          const contender = b.call("cas", { entries });
          await assert.rejects(
            () => contender.value,
            (error) => (error as { busy?: boolean }).busy === true,
          );
        } finally {
          Atomics.store(gate, 1, 1);
          Atomics.notify(gate, 1);
        }
        assert.equal((await holder.value).result, true);
        assert.deepStrictEqual(await store.getMany([["a"], ["b"]]), [1, 1]);
      }),
  );

  for (const existing of [false, true]) {
    concurrentTest(
      `SqliteKvStore waiting ${existing ? "single/batch existing" : "absent batch"} CAS observes winner (${journal})`,
      options,
      () =>
        withClients(journal, 5000, async (a, b, gate, store) => {
          if (existing)
            await store.setMany([
              { key: ["a"], value: 1 },
              { key: ["b"], value: 1 },
            ]);
          const expectedValue = existing ? 1 : undefined;
          const entries = [
            { key: ["a"], expectedValue, newValue: 2 },
            { key: ["b"], expectedValue, newValue: 2 },
          ];
          const holder = a.call(existing ? "hold-single" : "hold-cas", {
            entries,
          });
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await holder.held();
            const contender = b.call("cas", { entries });
            const attempted = await contender.begin();
            timer = setTimeout(() => {
              Atomics.store(gate, 1, 1);
              Atomics.notify(gate, 1);
            }, 150);
            const [winner, loser] = await Promise.all([
              holder.value,
              contender.value,
            ]);
            assert.equal(winner.result, true);
            assert.equal(loser.result, false);
            assert.ok(
              attempted.time! <= winner.completedAt,
              "contender must begin while holder owns transaction",
            );
            assert.ok(
              loser.beginWait >= 25,
              `no actual waiting overlap observed (${loser.beginWait} ms)`,
            );
            assert.deepStrictEqual(
              await store.getMany([["a"], ["b"]]),
              existing ? [2, 1] : [2, 2],
            );
          } finally {
            if (timer !== undefined) clearTimeout(timer);
            Atomics.store(gate, 1, 1);
            Atomics.notify(gate, 1);
            await Promise.allSettled([holder.value]);
          }
        }),
    );
  }

  concurrentTest(
    `SqliteKvStore threaded snapshots never tear across batch writes (${journal})`,
    options,
    () =>
      withClients(journal, 5000, async (a, b, gate, store) => {
        const keys = [["a"], ["b"]];
        await store.setMany(
          keys.map((key) => ({ key: key as [string], value: 0 })),
        );
        const writer = a.call("writer", { keys, iterations: 100 });
        const reader = b.call("reader", { keys, iterations: 100 });
        try {
          await Promise.all([writer.starting(), reader.starting()]);
          Atomics.store(gate, 4, 1);
          Atomics.notify(gate, 4);
          const results = await Promise.all([writer.value, reader.value]);
          for (const result of results) {
            assert.equal(result.result, true);
            assert.ok(
              result.overlap! > 0,
              "no overlapping worker workload observed",
            );
          }
          assert.deepStrictEqual(await store.getMany([["a"], ["b"]]), [99, 99]);
        } finally {
          Atomics.store(gate, 4, 1);
          Atomics.notify(gate, 4);
          await Promise.allSettled([writer.value, reader.value]);
        }
      }),
  );
}

const processTest =
  process.versions.bun || process.versions.deno ? test.skip : test;
processTest(
  "SqliteKvStore Node.js cross-process file lock",
  { timeout: 30000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "fedify-sqlite-process-"));
    const file = join(directory, "kv.sqlite");
    const db = new PlatformDatabase(file);
    const store = new SqliteKvStore(db);
    let child: ReturnType<typeof spawn> | undefined;
    try {
      await store.set(["a"], 1);
      db.exec("PRAGMA busy_timeout=0");
      child = spawn(
        process.execPath,
        [
          "-e",
          `
      const {DatabaseSync}=require('node:sqlite');
      const db=new DatabaseSync(${JSON.stringify(file)});
      db.exec('BEGIN IMMEDIATE');
      console.log('held');
      process.stdin.once('data',()=>{db.exec('ROLLBACK');db.close();process.stdin.pause();});
    `,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      const processChild = child;
      let stderr = "";
      processChild.stderr!.on("data", (data) => {
        stderr += String(data);
      });
      const closed = new Promise<number | null>((resolve, reject) => {
        processChild.once("error", reject);
        processChild.once("close", resolve);
      });
      void closed.catch(() => {});
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`process readiness timeout: ${stderr}`)),
          10000,
        );
        processChild.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        processChild.stdout!.once("data", (data) => {
          clearTimeout(timer);
          if (String(data).trim() === "held") resolve();
          else reject(new Error(`unexpected child output: ${String(data)}`));
        });
      });
      await assert.rejects(
        () => store.cas(["a"], 1, 2),
        (error) => /database is locked/i.test(String(error)),
      );
      processChild.stdin!.end("release\n");
      assert.equal(await closed, 0, stderr);
      assert.equal(await store.cas(["a"], 1, 2), true);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill();
        await new Promise<void>((resolve) =>
          child!.once("close", () => resolve()),
        );
      }
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
