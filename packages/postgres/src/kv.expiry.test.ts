import { test } from "@fedify/fixture";
import { PostgresKvStore } from "@fedify/postgres/kv";
import * as temporal from "@js-temporal/polyfill";
import { delay } from "@std/async/delay";
import assert from "node:assert/strict";
import process from "node:process";
import postgres from "postgres";

const Temporal = globalThis.Temporal ?? temporal.Temporal;
const dbUrl = process.env.POSTGRES_URL;

// No real waiting for cleanup intervals, and no changes to the public API.
function clock() {
  let offset = 0;
  const realNow = performance.now.bind(performance);
  const descriptor = Object.getOwnPropertyDescriptor(performance, "now");
  Object.defineProperty(performance, "now", {
    configurable: true,
    value: () => realNow() + offset,
  });
  return {
    advance(ms: number) {
      offset += ms;
    },
    restore() {
      if (descriptor) Object.defineProperty(performance, "now", descriptor);
      else Reflect.deleteProperty(performance, "now");
    },
  };
}

// A deadline distinguishes a returned mutation from one awaiting housekeeping.
async function promptly<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Mutation awaited cleanup")),
          1000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function recordingSql(sweep: () => Promise<unknown>) {
  let sweeps = 0;
  let failMutation = false;
  const sql = Object.assign(
    (strings: TemplateStringsArray | string) => {
      if (typeof strings === "string") return strings;
      const query = strings.join("");
      if (
        query.includes("pg_try_advisory_xact_lock") ||
        query.includes("WHERE ttl IS NOT NULL")
      ) {
        sweeps++;
        return sweep().then(() => [{ count: 0 }]);
      }
      if (
        failMutation &&
        (query.includes("INSERT INTO") || query.includes("WHERE key ="))
      ) {
        return Promise.reject(new Error("mutation failed"));
      }
      return Promise.resolve([{ test: '{"foo":1}' }]);
    },
    { json: (value: unknown) => value },
  ) as unknown as postgres.Sql;
  return {
    sql,
    get sweeps() {
      return sweeps;
    },
    failMutations() {
      failMutation = true;
    },
  };
}

test("PostgresKvStore coalesces background expiry and cools down after completion", async () => {
  const time = clock();
  const gate = Promise.withResolvers<void>();
  const recording = recordingSql(() => gate.promise);
  const store = new PostgresKvStore(recording.sql, { initialized: true });
  const mutations: Promise<void>[] = [];
  try {
    await store.initialize();
    mutations.push(
      ...Array.from({ length: 100 }, (_, i) => store.set([`${i}`], i)),
    );
    mutations.push(store.delete(["missing"]));
    await promptly(Promise.all(mutations));
    assert.equal(recording.sweeps, 1, "the first mutation starts cleanup");
    time.advance(121_000);
    mutations.push(store.set(["pending"], true), store.delete(["missing"]));
    await promptly(Promise.all(mutations));
    assert.equal(recording.sweeps, 1, "pending cleanup must not overlap");
    gate.resolve();
    await delay(0);
    time.advance(30_000);
    await store.delete(["missing"]);
    assert.equal(recording.sweeps, 1, "cooldown starts at completion");
    time.advance(91_000);
    await store.set(["next"], true);
    assert.equal(recording.sweeps, 2);
  } finally {
    gate.resolve();
    await Promise.allSettled(mutations);
    await store.drop();
    time.restore();
  }
});

test("PostgresKvStore backs off cleanup failures without hiding mutation failures", async () => {
  const time = clock();
  const recording = recordingSql(() =>
    Promise.reject(new Error("cleanup failed"))
  );
  const store = new PostgresKvStore(recording.sql, { initialized: true });
  try {
    await store.set(["first"], true);
    await delay(0);
    await Promise.all(
      Array.from({ length: 100 }, (_, i) => store.set([`${i}`], i)),
    );
    await store.delete(["missing"]);
    assert.equal(recording.sweeps, 1);
    time.advance(121_000);
    await store.delete(["next"]);
    await delay(0);
    assert.equal(recording.sweeps, 2, "cleanup retries after its interval");
    time.advance(121_000);
    recording.failMutations();
    await assert.rejects(store.set(["failed"], true), /mutation failed/);
    await assert.rejects(store.delete(["failed"]), /mutation failed/);
    assert.equal(
      recording.sweeps,
      2,
      "failed writes do not trigger housekeeping",
    );
  } finally {
    await store.drop();
    time.restore();
  }
});

test("PostgresKvStore.drop() drains background expiry", async () => {
  const time = clock();
  const gate = Promise.withResolvers<void>();
  const recording = recordingSql(() => gate.promise);
  const store = new PostgresKvStore(recording.sql, { initialized: true });
  let mutation: Promise<void> | undefined;
  let dropping: Promise<void> | undefined;
  try {
    mutation = store.set(["first"], true);
    await promptly(mutation);
    let dropped = false;
    dropping = store.drop().then(() => {
      dropped = true;
    });
    await delay(0);
    assert.equal(dropped, false);
    gate.resolve();
    await dropping;
    assert.equal(dropped, true);
  } finally {
    gate.resolve();
    await Promise.allSettled([mutation, dropping]);
    time.restore();
  }
});

function observe(sql: postgres.Sql) {
  let pending: Promise<unknown> | undefined;
  const observed = new Proxy(sql, {
    apply(target, thisArg, args) {
      const result = Reflect.apply(target, thisArg, args);
      if (
        Array.isArray(args[0]) &&
        args[0].join("").includes("pg_try_advisory_xact_lock")
      ) {
        pending = Promise.resolve(result);
        return pending;
      }
      return result;
    },
  });
  return {
    sql: observed,
    async complete() {
      assert(pending, "cleanup must have started");
      await pending;
      await delay(0);
    },
  };
}

function database() {
  const sql = postgres(dbUrl!);
  const tableName = `fedify_kv_expiry_${
    crypto.randomUUID().replaceAll("-", "")
  }`;
  const observed = observe(sql);
  const store = new PostgresKvStore(observed.sql, { tableName });
  return { sql, tableName, observed, store };
}

test("PostgresKvStore bounds expiry batches and makes eventual progress", {
  ignore: !dbUrl,
}, async () => {
  if (!dbUrl) return;
  const time = clock();
  const { sql, tableName, observed, store } = database();
  try {
    await store.initialize();
    await sql`
      INSERT INTO ${sql(tableName)} (key, value, created, ttl)
      SELECT ARRAY['expired', n::text], '1'::jsonb,
        CURRENT_TIMESTAMP - INTERVAL '2 days', INTERVAL '1 day'
      FROM generate_series(1, 2500) n;
    `;
    await sql`
      INSERT INTO ${sql(tableName)} (key, value, ttl)
      VALUES (ARRAY['live'], '1'::jsonb, INTERVAL '1 day'),
        (ARRAY['permanent'], '1'::jsonb, NULL);
    `;
    for (const expected of [1500, 500, 0]) {
      await store.delete(["missing"]);
      await observed.complete();
      const [row] = await sql`
        SELECT count(*)::int AS count FROM ${sql(tableName)}
        WHERE ttl IS NOT NULL AND created + ttl < CURRENT_TIMESTAMP;
      `;
      assert.equal(row.count, expected);
      assert.equal(await store.get(["live"]), 1);
      assert.equal(await store.get(["permanent"]), 1);
      if (expected > 0) {
        time.advance(900);
        await store.delete(["missing"]);
        const [unchanged] = await sql`
          SELECT count(*)::int AS count FROM ${sql(tableName)}
          WHERE ttl IS NOT NULL AND created + ttl < CURRENT_TIMESTAMP;
        `;
        assert.equal(
          unchanged.count,
          expected,
          "full batches still have a cooldown",
        );
        time.advance(1_200);
      }
    }
  } finally {
    await store.drop();
    await sql.end();
    time.restore();
  }
});

test(
  "PostgresKvStore shares an expiry lock across store instances and table aliases",
  { ignore: !dbUrl },
  async () => {
    if (!dbUrl) return;
    const time = clock();
    const { sql, tableName, observed, store } = database();
    const other = observe(sql);
    const alias = new PostgresKvStore(other.sql, {
      tableName: `public.${tableName}`,
      initialized: true,
    });
    const gate = Promise.withResolvers<void>();
    const ready = Promise.withResolvers<void>();
    let holder: Promise<unknown> | undefined;
    try {
      await store.initialize();
      await alias.initialize();
      await sql`
      INSERT INTO ${sql(tableName)} (key, value, created, ttl)
      VALUES (ARRAY['expired'], '1'::jsonb,
        CURRENT_TIMESTAMP - INTERVAL '2 days', INTERVAL '1 day');
    `;
      holder = sql.begin(async (transaction) => {
        const tx = transaction as unknown as postgres.Sql;
        await tx`SELECT pg_advisory_xact_lock(
        (hashtext('fedify.postgres.kv.expire')::bigint << 32) |
        ${tableName}::regclass::oid::bigint
      );`;
        ready.resolve();
        await gate.promise;
      });
      await ready.promise;
      await Promise.all([store.set(["a"], 1), alias.set(["b"], 2)]);
      await Promise.all([observed.complete(), other.complete()]);
      const [row] = await sql`SELECT count(*)::int AS count FROM ${
        sql(tableName)
      } WHERE key = ARRAY['expired'];`;
      assert.equal(
        row.count,
        1,
        "neither store sweeps while another connection holds the lock",
      );
      gate.resolve();
      await holder;
      // A lock miss must also respect the cooldown.
      await alias.delete(["missing"]);
      const [unchanged] = await sql`SELECT count(*)::int AS count FROM ${
        sql(tableName)
      } WHERE key = ARRAY['expired'];`;
      assert.equal(unchanged.count, 1);
      time.advance(121_000);
      await alias.delete(["missing"]);
      await other.complete();
      const [cleaned] = await sql`SELECT count(*)::int AS count FROM ${
        sql(tableName)
      } WHERE key = ARRAY['expired'];`;
      assert.equal(cleaned.count, 0);
    } finally {
      gate.resolve();
      await holder;
      await store.drop();
      await sql.end();
      time.restore();
    }
  },
);

test(
  "PostgresKvStore preserves TTL visibility and refreshes retained expired keys",
  { ignore: !dbUrl },
  async () => {
    if (!dbUrl) return;
    const time = clock();
    const { sql, tableName, store } = database();
    try {
      await store.initialize();
      await sql`
      INSERT INTO ${sql(tableName)} (key, value, created, ttl)
      VALUES (ARRAY['expiry', 'old'], '1'::jsonb,
        CURRENT_TIMESTAMP - INTERVAL '2 days', INTERVAL '1 day');
    `;
      assert.equal(await store.get(["expiry", "old"]), undefined);
      for (const prefix of [undefined, ["expiry"] as const]) {
        const entries = [];
        for await (const entry of store.list(prefix)) entries.push(entry);
        assert.deepEqual(entries, []);
      }
      const [retained] = await sql`SELECT count(*)::int AS count FROM ${
        sql(tableName)
      };`;
      assert.equal(
        retained.count,
        1,
        "logical expiry precedes physical cleanup",
      );
      await store.set(["expiry", "old"], "new", {
        ttl: Temporal.Duration.from({ hours: 1 }),
      });
      assert.equal(await store.get(["expiry", "old"]), "new");
      const entries = [];
      for await (const entry of store.list(["expiry"])) entries.push(entry);
      assert.deepEqual(entries, [{ key: ["expiry", "old"], value: "new" }]);
    } finally {
      await store.drop();
      await sql.end();
      time.restore();
    }
  },
);

test(
  "PostgresKvStore skips locked rows and preserves a concurrent TTL refresh",
  { ignore: !dbUrl },
  async () => {
    if (!dbUrl) return;
    const time = clock();
    const { sql, tableName, observed, store } = database();
    const gate = Promise.withResolvers<void>();
    const ready = Promise.withResolvers<void>();
    let holder: Promise<unknown> | undefined;
    try {
      await store.initialize();
      await sql`
      INSERT INTO ${sql(tableName)} (key, value, created, ttl)
      VALUES (ARRAY['locked'], '1'::jsonb, CURRENT_TIMESTAMP - INTERVAL '2 days', INTERVAL '1 day'),
        (ARRAY['unlocked'], '2'::jsonb, CURRENT_TIMESTAMP - INTERVAL '2 days', INTERVAL '1 day');
    `;
      holder = sql.begin(async (transaction) => {
        const tx = transaction as unknown as postgres.Sql;
        await tx`SELECT key FROM ${
          tx(tableName)
        } WHERE key = ARRAY['locked'] FOR UPDATE;`;
        ready.resolve();
        await gate.promise;
        await tx`UPDATE ${
          tx(tableName)
        } SET created = CURRENT_TIMESTAMP WHERE key = ARRAY['locked'];`;
      });
      await ready.promise;
      await store.delete(["missing"]);
      await promptly(observed.complete());
      const rows = await sql`SELECT key FROM ${sql(tableName)};`;
      assert.deepEqual(rows.map((r) => r.key), [["locked"]]);
      gate.resolve();
      await holder;
      time.advance(121_000);
      await store.delete(["missing"]);
      await observed.complete();
      assert.equal(await store.get(["locked"]), 1);
    } finally {
      gate.resolve();
      await holder;
      await store.drop();
      await sql.end();
      time.restore();
    }
  },
);

test("PostgresKvStore expiry respects transformed table identifiers", {
  ignore: !dbUrl,
}, async () => {
  if (!dbUrl) return;
  const time = clock();
  const sql = postgres(dbUrl!, { transform: postgres.camel });
  const tableName = `fedifyKvExpiry${crypto.randomUUID().replaceAll("-", "")}`;
  const observed = observe(sql);
  const store = new PostgresKvStore(observed.sql, { tableName });
  try {
    await store.initialize();
    await sql`
      INSERT INTO ${sql(tableName)} (key, value, created, ttl)
      VALUES (ARRAY['expired'], '1'::jsonb, CURRENT_TIMESTAMP - INTERVAL '2 days', INTERVAL '1 day');
    `;
    await store.delete(["missing"]);
    await observed.complete();
    const [row] = await sql`SELECT count(*)::int AS count FROM ${
      sql(tableName)
    };`;
    assert.equal(row.count, 0);
  } finally {
    await store.drop();
    await sql.end();
    time.restore();
  }
});

for (const method of ["savepoint", "release"] as const) {
  test(`PostgresKvStore ${method} clients await shared cleanup and preserve errors`, async () => {
    const time = clock();
    const gate = Promise.withResolvers<void>();
    const recording = recordingSql(() => gate.promise);
    // Detect caller ownership without invoking savepoint() or release().
    Object.assign(recording.sql, {
      [method]() {
        throw new Error(`unexpected ${method}`);
      },
    });
    const store = new PostgresKvStore(recording.sql, { initialized: true });
    const mutations: Promise<void>[] = [];
    let outcomes: Promise<PromiseSettledResult<void>[]> | undefined;
    try {
      await store.initialize();
      mutations.push(store.set(["first"], true), store.delete(["second"]));
      let settled = false;
      outcomes = Promise.allSettled(mutations).then((result) => {
        settled = true;
        return result;
      });
      await delay(0);
      assert.equal(recording.sweeps, 1);
      assert.equal(settled, false, "transaction work must wait for cleanup");
      const failure = new Error("transaction cleanup failed");
      gate.reject(failure);
      for (const result of await outcomes) {
        assert.equal(result.status, "rejected");
        if (result.status === "rejected") assert.equal(result.reason, failure);
      }
    } finally {
      gate.resolve();
      await outcomes;
      await store.drop();
      time.restore();
    }
  });
}

test("PostgresKvStore never reports a rolled-back transaction as successful", {
  ignore: !dbUrl,
}, async () => {
  if (!dbUrl) return;
  const { sql, tableName, store } = database();
  const key = ["transaction"] as const;
  let mutationFailed = false;
  try {
    await store.initialize();
    await assert.rejects(
      sql.begin(async (transaction) => {
        const tx = transaction as unknown as postgres.Sql;
        const failingCleanup = new Proxy(tx, {
          apply(target, thisArg, args) {
            if (
              Array.isArray(args[0]) &&
              args[0].join("").includes("pg_try_advisory_xact_lock")
            ) {
              // Use an actual SQL error so the caller-owned transaction aborts.
              return tx`SELECT 1 / 0;`;
            }
            return Reflect.apply(target, thisArg, args);
          },
        });
        const transactionalStore = new PostgresKvStore(failingCleanup, {
          tableName,
          initialized: true,
        });
        try {
          await transactionalStore.set(key, "must roll back");
        } catch (error) {
          mutationFailed = true;
          throw error;
        }
      }),
      { code: "22012" },
    );
    assert.equal(mutationFailed, true);
    assert.equal(await store.get(key), undefined);
    // Successful transaction cleanup also finishes before the callback returns.
    await sql.begin(async (transaction) => {
      const tx = transaction as unknown as postgres.Sql;
      const transactionalStore = new PostgresKvStore(tx, {
        tableName,
        initialized: true,
      });
      await transactionalStore.set(key, "committed");
    });
    assert.equal(await store.get(key), "committed");
  } finally {
    await store.drop();
    await sql.end();
  }
});

test(
  "PostgresKvStore does not backdate a replacement in an older transaction",
  { ignore: !dbUrl },
  async () => {
    if (!dbUrl) return;
    const { sql, tableName, store } = database();
    try {
      await store.initialize();
      await sql.begin(async (transaction) => {
        const tx = transaction as unknown as postgres.Sql;
        await tx`SELECT CURRENT_TIMESTAMP;`;
        // A separate connection commits this row after the transaction began.
        const [inserted] = await sql`
        INSERT INTO ${sql(tableName)} (key, value)
        VALUES (ARRAY['replacement'], '"previous"'::jsonb)
        RETURNING created::text;
      `;
        const transactionalStore = new PostgresKvStore(tx, {
          tableName,
          initialized: true,
        });
        await transactionalStore.set(["replacement"], "fresh", {
          ttl: Temporal.Duration.from({ hours: 1 }),
        });
        const [updated] = await tx`
        SELECT created >= ${inserted.created}::timestamptz AS refreshed
        FROM ${tx(tableName)} WHERE key = ARRAY['replacement'];
      `;
        assert.equal(
          updated.refreshed,
          true,
          "a replacement cannot start its TTL before the preceding write",
        );
        const [beforeInsert] = await tx`
          SELECT statement_timestamp()::text AS started;
        `;
        await transactionalStore.set(["new"], "fresh", {
          ttl: Temporal.Duration.from({ hours: 1 }),
        });
        const [insertedNow] = await tx`
          SELECT created >= ${beforeInsert.started}::timestamptz AS fresh
          FROM ${tx(tableName)} WHERE key = ARRAY['new'];
        `;
        assert.equal(
          insertedNow.fresh,
          true,
          "new keys also measure TTL from their write",
        );
      });
      assert.equal(await store.get(["replacement"]), "fresh");
    } finally {
      await store.drop();
      await sql.end();
    }
  },
);

test(
  "PostgresKvStore hides zero-TTL replacements inside a transaction before cleanup",
  { ignore: !dbUrl },
  async () => {
    if (!dbUrl) return;
    const { sql, tableName, store } = database();
    try {
      await store.initialize();
      await sql.begin(async (transaction) => {
        const tx = transaction as unknown as postgres.Sql;
        const transactionalStore = new PostgresKvStore(tx, {
          tableName,
          initialized: true,
        });
        const key = ["zero", "ttl"] as const;
        // The first mutation completes cleanup and starts its cooldown.
        await transactionalStore.set(key, "live");
        await transactionalStore.set(key, "expired", {
          ttl: Temporal.Duration.from({ seconds: 0 }),
        });
        const [retained] = await tx`SELECT count(*)::int AS count FROM ${
          tx(tableName)
        };`;
        assert.equal(
          retained.count,
          1,
          "the row must remain physically present",
        );
        assert.equal(await transactionalStore.get(key), undefined);
        for (const prefix of [undefined, ["zero"] as const]) {
          const entries = [];
          for await (const entry of transactionalStore.list(prefix)) {
            entries.push(entry);
          }
          assert.deepEqual(entries, []);
        }
      });
    } finally {
      await store.drop();
      await sql.end();
    }
  },
);

test(
  "PostgresKvStore reserved clients propagate manual transaction cleanup errors",
  {
    ignore: !dbUrl,
  },
  async () => {
    if (!dbUrl) return;
    const { sql, tableName, store } = database();
    const key = ["reserved"] as const;
    try {
      await store.initialize();
      await store.set(key, "original");
      for (const mutation of ["set", "delete"] as const) {
        const reserved = await sql.reserve();
        try {
          await reserved`BEGIN`;
          const failingCleanup = new Proxy(reserved, {
            apply(target, thisArg, args) {
              if (
                Array.isArray(args[0]) &&
                args[0].join("").includes("pg_try_advisory_xact_lock")
              ) {
                return reserved`SELECT 1 / 0`;
              }
              return Reflect.apply(target, thisArg, args);
            },
          });
          const reservedStore = new PostgresKvStore(failingCleanup, {
            tableName,
            initialized: true,
          });
          await assert.rejects(
            mutation === "set"
              ? reservedStore.set(key, "must roll back")
              : reservedStore.delete(key),
            { code: "22012" },
          );
          const committed = await reserved`COMMIT`;
          assert.equal(committed.command, "ROLLBACK");
          assert.equal(await store.get(key), "original");
        } finally {
          await reserved`ROLLBACK`;
          reserved.release();
        }
      }
      const reserved = await sql.reserve();
      try {
        await reserved`BEGIN`;
        const reservedStore = new PostgresKvStore(reserved, {
          tableName,
          initialized: true,
        });
        await reservedStore.set(key, "committed");
        await reserved`COMMIT`;
        assert.equal(await store.get(key), "committed");
      } finally {
        await reserved`ROLLBACK`;
        reserved.release();
      }
    } finally {
      await store.drop();
      await sql.end();
    }
  },
);

for (const layout of ["partitioned", "inherited"] as const) {
  test(
    `PostgresKvStore bounds expiry across ${layout} tables with overlapping CTIDs`,
    {
      ignore: !dbUrl,
    },
    async () => {
      if (!dbUrl) return;
      const time = clock();
      const sql = postgres(dbUrl);
      const tableName = `fedify_kv_children_${
        crypto.randomUUID().replaceAll("-", "")
      }`;
      const children = [`${tableName}_a`, `${tableName}_b`];
      const observed = observe(sql);
      const store = new PostgresKvStore(observed.sql, {
        tableName,
        initialized: true,
      });
      try {
        if (layout === "partitioned") {
          await sql`CREATE TABLE ${sql(tableName)} (
          key text[], value jsonb NOT NULL, created timestamptz, ttl interval
        ) PARTITION BY RANGE (created)`;
          await sql`CREATE TABLE ${sql(children[0])} PARTITION OF ${
            sql(tableName)
          }
          FOR VALUES FROM (MINVALUE) TO ('2000-01-01')`;
          await sql`CREATE TABLE ${sql(children[1])} PARTITION OF ${
            sql(tableName)
          }
          FOR VALUES FROM ('2000-01-01') TO (MAXVALUE)`;
        } else {
          await sql`CREATE TABLE ${sql(tableName)} (
          key text[], value jsonb NOT NULL, created timestamptz, ttl interval
        )`;
          for (const child of children) {
            await sql`CREATE TABLE ${sql(child)} () INHERITS (${
              sql(tableName)
            })`;
          }
        }
        for (const [i, child] of children.entries()) {
          await sql`INSERT INTO ${sql(child)} (key, value, created, ttl)
          SELECT ARRAY[n::text], '1'::jsonb, ${
            i ? "2001-01-01" : "1999-01-01"
          }::timestamptz,
            INTERVAL '1 day' FROM generate_series(1, 1500) n`;
        }
        const [overlap] = await sql`SELECT count(*)::int AS count
        FROM ${sql(children[0])} a JOIN ${
          sql(children[1])
        } b ON a.ctid = b.ctid`;
        assert.equal(
          overlap.count,
          1500,
          "child tables must share physical tuple IDs",
        );
        for (const expected of [2000, 1000, 0]) {
          await store.delete(["missing"]);
          await observed.complete();
          const [remaining] = await sql`SELECT count(*)::int AS count FROM ${
            sql(tableName)
          }`;
          assert.equal(
            remaining.count,
            expected,
            "each sweep deletes exactly one batch across all children",
          );
          time.advance(2100);
        }
        // The parent relation, rather than whichever child has rows first,
        // identifies the shared lock, even after one child has been drained.
        await sql`INSERT INTO ${sql(children[1])} (key, value, created, ttl)
        VALUES (ARRAY['locked'], '1', '2001-01-01', INTERVAL '1 day')`;
        time.advance(121_000);
        await sql.begin(async (transaction) => {
          const tx = transaction as unknown as postgres.Sql;
          await tx`SELECT pg_advisory_xact_lock(
          (hashtext('fedify.postgres.kv.expire')::bigint << 32) |
          ${tableName}::regclass::oid::bigint
        )`;
          await store.delete(["missing"]);
          await observed.complete();
          const [retained] = await sql`SELECT count(*)::int AS count FROM ${
            sql(tableName)
          }`;
          assert.equal(
            retained.count,
            1,
            "a parent lock must gate all child scans",
          );
        });
        time.advance(121_000);
        await store.delete(["missing"]);
        await observed.complete();
        const [cleaned] = await sql`SELECT count(*)::int AS count FROM ${
          sql(tableName)
        }`;
        assert.equal(cleaned.count, 0);
      } finally {
        await sql`DROP TABLE IF EXISTS ${sql(tableName)} CASCADE`;
        await sql.end();
        time.restore();
      }
    },
  );
}
