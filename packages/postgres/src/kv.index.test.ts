import { PostgresKvStore } from "@fedify/postgres/kv";
import * as temporal from "@js-temporal/polyfill";
import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";
import postgres from "postgres";

const Temporal = globalThis.Temporal ?? temporal.Temporal;
const dbUrl = process.env.POSTGRES_URL;
const skip = dbUrl == null;

function database(options: postgres.Options<Record<string, never>> = {}) {
  const statements: string[] = [];
  let sweep: { query: string; parameters: postgres.ParameterOrJSON<never>[] };
  let pending: Promise<unknown> | undefined;
  const sql = postgres(dbUrl!, {
    ...options,
    debug(connection, query, parameters, types) {
      if (typeof options.debug === "function") {
        options.debug(connection, query, parameters, types);
      }
      statements.push(query);
      if (
        query.includes("hashtext('fedify.postgres.kv.expire')") &&
        !query.startsWith("EXPLAIN")
      ) {
        sweep = { query, parameters };
      }
    },
  });
  const observed = new Proxy(sql, {
    apply(target, self, args) {
      const result = Reflect.apply(target, self, args);
      if (
        Array.isArray(args[0]) &&
        args[0].join("").includes("hashtext('fedify.postgres.kv.expire')")
      ) {
        pending = Promise.resolve(result);
        return pending;
      }
      return result;
    },
  });
  const tableName = `fedify_kv_index_${
    crypto.randomUUID().replaceAll("-", "")
  }`;
  return {
    sql,
    observed,
    tableName,
    statements,
    async complete() {
      assert(pending, "a sweep must have started");
      await pending;
    },
    async prepared() {
      return await sql`SELECT generic_plans, custom_plans FROM pg_prepared_statements
        WHERE statement = ${sweep.query}`;
    },
    async explain() {
      assert(sweep!, "the actual sweep query must have been captured");
      return await sql.unsafe(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sweep.query}`,
        sweep.parameters,
        { prepare: true },
      );
    },
  };
}

async function legacyTable(sql: postgres.Sql, name: string) {
  await sql`CREATE TABLE ${sql(name)} (
    key text[] PRIMARY KEY, value jsonb NOT NULL,
    created timestamptz DEFAULT CURRENT_TIMESTAMP, ttl interval
  )`;
}

async function indexes(sql: postgres.Sql, name: string) {
  return await sql`
    SELECT i.indisvalid, pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i
    WHERE i.indrelid = (SELECT typrelid FROM pg_type
      WHERE oid = pg_typeof(NULL::${sql(name)})::oid)
      AND NOT i.indisprimary
  `;
}

async function manualIndex(
  sql: postgres.Sql,
  name: string,
  atTimeZone = false,
) {
  const index = `manual_expiry_${crypto.randomUUID().replaceAll("-", "")}`;
  // The exact concurrent migration from the manual; no transaction wrapper.
  if (atTimeZone) {
    await sql`CREATE INDEX CONCURRENTLY ${sql(index)} ON ${sql(name)}
      ((((created AT TIME ZONE 'UTC') + ttl) AT TIME ZONE 'UTC'))
      WHERE ttl IS NOT NULL`;
  } else {
    await sql`CREATE INDEX CONCURRENTLY ${sql(index)} ON ${sql(name)}
      ((timezone('UTC', timezone('UTC', created) + ttl)))
      WHERE ttl IS NOT NULL`;
  }
  await sql`ANALYZE ${sql(name)}`;
}

test(
  "PostgresKvStore provisions a fresh expiry index and accepts both spellings",
  { skip },
  async () => {
    if (!dbUrl) return;
    const { sql, tableName, statements } = database();
    const store = new PostgresKvStore(sql, { tableName });
    try {
      await store.initialize();
      const initial = await indexes(sql, tableName);
      assert.equal(initial.length, 1);
      assert.equal(initial[0].indisvalid, true);
      assert.match(initial[0].definition, /timezone\('UTC'/);
      const [{ name }] = await sql`
      SELECT c.relname AS name FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = ${tableName}::regclass AND NOT i.indisprimary
    `;
      await sql`DROP INDEX ${sql(name)}`;
      await manualIndex(sql, tableName, true);
      statements.length = 0;
      await new PostgresKvStore(sql, { tableName: `public.${tableName}` })
        .initialize();
      assert.equal((await indexes(sql, tableName)).length, 1);
      assert(!statements.some((q) => /LOCK TABLE|CREATE INDEX/.test(q)));
    } finally {
      await store.drop();
      await sql.end();
    }
  },
);

test(
  "PostgresKvStore leaves populated legacy tables unlocked until manual migration",
  { skip },
  async () => {
    if (!dbUrl) return;
    const db = database();
    const { sql, tableName, statements } = db;
    const store = new PostgresKvStore(db.observed, { tableName });
    try {
      await legacyTable(sql, tableName);
      await sql`INSERT INTO ${sql(tableName)} VALUES
      (ARRAY['expired'], '1', '2000-01-01', INTERVAL '1 day'),
      (ARRAY['permanent'], '2', CURRENT_TIMESTAMP, NULL)`;
      statements.length = 0;
      await store.initialize();
      assert.equal((await indexes(sql, tableName)).length, 0);
      assert(!statements.some((q) => /LOCK TABLE|CREATE INDEX/.test(q)));
      // Index creation populates existing keys without a column backfill.
      await manualIndex(sql, tableName);
      const migrated = new PostgresKvStore(db.observed, {
        tableName,
        initialized: true,
      });
      assert.equal(await migrated.get(["expired"]), undefined);
      assert.equal(await migrated.get(["permanent"]), 2);
      await migrated.delete(["missing"]);
      await db.complete();
      const [{ count }] = await sql`SELECT count(*)::int AS count FROM ${
        sql(tableName)
      }`;
      assert.equal(count, 1);
      assert.equal((await indexes(sql, tableName)).length, 1);
    } finally {
      await store.drop();
      await sql.end();
    }
  },
);

test("PostgresKvStore indexed keys track old writers and all TTL transitions", {
  skip,
}, async () => {
  if (!dbUrl) return;
  const db = database();
  const { sql, tableName } = db;
  const store = new PostgresKvStore(db.observed, { tableName });
  try {
    await store.initialize();
    // Start and drain housekeeping before inserting expired rows.  Subsequent
    // operations use #1314's cooldown, so tests exercise logical expiry too.
    await store.delete(["missing"]);
    await db.complete();
    await sql`INSERT INTO ${sql(tableName)} (key, value, created, ttl)
      VALUES (ARRAY['key'], '"old"', '2000-01-01', INTERVAL '1 day')`;
    assert.equal(await store.cas(["key"], "old", "wrong"), false);
    assert.equal(
      await store.cas(["key"], undefined, "new", {
        ttl: Temporal.Duration.from({ hours: 1 }),
      }),
      true,
    );
    assert.equal(await store.get(["key"]), "new");
    await store.set(["key"], "permanent");
    assert.equal(
      await store.cas(["key"], "permanent", "zero", {
        ttl: Temporal.Duration.from({ seconds: 0 }),
      }),
      true,
    );
    assert.equal(await store.get(["key"]), undefined);
    assert.equal(await store.cas(["key"], undefined, "again"), true);
    // Old applications still write only these four columns.
    await sql`UPDATE ${sql(tableName)} SET created = '2000-01-01',
      ttl = INTERVAL '1 day' WHERE key = ARRAY['key']`;
    assert.equal(await store.get(["key"]), undefined);
    assert.deepEqual(await Array.fromAsync(store.list()), []);
    const cleaner = new PostgresKvStore(db.observed, {
      tableName,
      initialized: true,
    });
    await cleaner.delete(["missing"]);
    await db.complete();
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM ${
      sql(tableName)
    }`;
    assert.equal(count, 0);
    await sql`INSERT INTO ${sql(tableName)} VALUES
      (ARRAY['key'], '"negative"', statement_timestamp(), INTERVAL '-1 second')`;
    assert.equal(await store.get(["key"]), undefined);
    await store.set(["key"], "live", {
      ttl: Temporal.Duration.from({ days: 30 }),
    });
    assert.equal(await store.get(["key"]), "live");
    await sql`INSERT INTO ${
      sql(tableName)
    } VALUES (ARRAY['null-created'], '1', NULL, INTERVAL '1 day')`;
    assert.equal(await store.get(["null-created"]), undefined);
    assert.equal(await store.cas(["null-created"], undefined, "wrong"), false);
  } finally {
    await store.drop();
    await sql.end();
  }
});

for (const planMode of ["force_custom_plan", "force_generic_plan"]) {
  test(
    `PostgresKvStore actual sparse expiry plan uses the index (${planMode})`,
    { skip },
    async () => {
      if (!dbUrl) return;
      const db = database({
        max: 1,
        connection: { plan_cache_mode: planMode },
      });
      const { sql, tableName } = db;
      const store = new PostgresKvStore(db.observed, { tableName });
      try {
        await store.initialize();
        await sql`INSERT INTO ${sql(tableName)} (key, value, created, ttl)
        SELECT ARRAY[n::text], '1', statement_timestamp(),
          CASE WHEN n % 2 = 0 THEN INTERVAL '1 day' END
        FROM generate_series(1, 80000) n`;
        await sql`ANALYZE ${sql(tableName)}`;
        await store.delete(["missing"]);
        await db.complete();
        const [prepared] = await db.prepared();
        assert(prepared, "the production sweep must be prepared");
        assert(
          Number(
            prepared[
              planMode === "force_generic_plan"
                ? "generic_plans"
                : "custom_plans"
            ],
          ) > 0,
        );
        for (const expired of [0, 5]) {
          if (expired) {
            await sql`INSERT INTO ${sql(tableName)} (key, value, created, ttl)
            SELECT ARRAY['expired', n::text], '1', '2000-01-01', INTERVAL '1 day'
            FROM generate_series(1, ${expired}) n`;
          }
          const result = await db.explain();
          const [{ Plan: plan }] = result[0]["QUERY PLAN"];
          const nodes: Record<string, unknown>[] = [];
          const visit = (node: Record<string, unknown>) => {
            nodes.push(node);
            for (
              const child of (node.Plans ?? []) as Record<string, unknown>[]
            ) {
              visit(child);
            }
          };
          visit(plan);
          assert(
            nodes.some((n) =>
              /Index|Bitmap/.test(String(n["Node Type"])) &&
              String(n["Index Cond"]).includes("timezone('UTC'")
            ),
            JSON.stringify(plan),
          );
          assert(
            !nodes.some((n) => n["Node Type"] === "Seq Scan"),
            JSON.stringify(plan),
          );
          assert(
            Number(plan["Shared Hit Blocks"]) < 1000,
            JSON.stringify(plan),
          );
          const deleted = nodes.find((n) => n["CTE Name"] === "deleted");
          assert.equal(deleted?.["Actual Rows"], expired);
          const [{ count }] = await sql`SELECT count(*)::int AS count FROM ${
            sql(tableName)
          }`;
          assert.equal(count, 80000);
        }
      } finally {
        await store.drop();
        await sql.end();
      }
    },
  );
}

for (
  const base of [
    { created: "2026-03-07 12:00-05", ttl: "1 day", live: false },
    { created: "2026-10-31 12:00-04", ttl: "1 day", live: true },
    { created: "2026-02-28 23:30-05", ttl: "1 month", live: false },
  ]
) {
  test(
    `PostgresKvStore retains session-calendar TTL semantics (${base.created})`,
    { skip },
    async () => {
      if (!dbUrl) return;
      const db = database({ connection: { TimeZone: "America/New_York" } });
      const { sql, tableName } = db;
      const store = new PostgresKvStore(db.observed, { tableName });
      try {
        await store.initialize();
        // Shift only elapsed seconds, retaining the calendar day/month component.
        // The logical expiry is +/-30 minutes from now, while the UTC index key
        // lies on the other side of now (1h DST skew, or >3d month-end skew).
        await sql`INSERT INTO ${sql(tableName)} (key, value, created, ttl)
        SELECT ARRAY['calendar'], '"calendar"', ${base.created}::timestamptz,
          ${base.ttl}::interval + make_interval(secs => extract(epoch FROM (
            statement_timestamp() - (${base.created}::timestamptz + ${base.ttl}::interval)
          ))::double precision) + ${
          base.live ? "30 minutes" : "-30 minutes"
        }::interval`;
        const [{ live, candidate }] = await sql`
        SELECT created + ttl > statement_timestamp() AS live,
          timezone('UTC', timezone('UTC', created) + ttl) < statement_timestamp() AS candidate
        FROM ${sql(tableName)}
      `;
        assert.equal(live, base.live);
        assert.equal(candidate, base.live);
        await store.delete(["missing"]);
        await db.complete();
        const [{ count }] = await sql`SELECT count(*)::int AS count FROM ${
          sql(tableName)
        }`;
        assert.equal(
          count,
          1,
          "no premature deletion; later physical deletion is permitted",
        );
        assert.equal(
          await store.get(["calendar"]),
          base.live ? "calendar" : undefined,
        );
        assert.equal(
          (await Array.fromAsync(store.list())).length,
          base.live ? 1 : 0,
        );
        assert.equal(
          await store.cas(["calendar"], "calendar", "new"),
          base.live,
        );
        if (!base.live) {
          assert.equal(await store.cas(["calendar"], undefined, "new"), true);
        }
      } finally {
        await store.drop();
        await sql.end();
      }
    },
  );
}

test(
  "PostgresKvStore index provisioning resolves non-idempotent transformed identifiers once",
  { skip },
  async () => {
    if (!dbUrl) return;
    const db = database({
      transform: { column: { to: (name) => `x_${name}` } },
    });
    const { sql, statements } = db;
    const schema = `schema_${crypto.randomUUID().replaceAll("-", "")}`;
    const name = `Mixed"${"a".repeat(48)}`;
    const tableName = `${schema}.${name}`;
    const store = new PostgresKvStore(db.observed, { tableName });
    try {
      await sql`CREATE SCHEMA ${sql(schema)}`;
      await store.initialize();
      assert.equal((await indexes(sql, tableName)).length, 1);
      statements.length = 0;
      await new PostgresKvStore(sql, { tableName }).initialize();
      assert.equal((await indexes(sql, tableName)).length, 1);
      assert(!statements.some((q) => /LOCK TABLE|CREATE INDEX/.test(q)));
      await store.set(["key"], "value");
      await db.complete();
      assert.equal(await store.get(["key"]), "value");
    } finally {
      await store.drop();
      await sql`DROP SCHEMA ${sql(schema)}`;
      await sql.end();
    }
  },
);

test("PostgresKvStore optional index failures preserve usable legacy storage", {
  skip,
}, async () => {
  if (!dbUrl) return;
  const db = database();
  const { sql, tableName } = db;
  const store = new PostgresKvStore(db.observed, { tableName });
  try {
    await legacyTable(sql, tableName);
    const [{ name }] = await sql`
      SELECT 'idx_fedify_kv_expiry_' || substr(md5(format('%I.%I',
        n.nspname, c.relname)), 1, 16) AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.oid = ${tableName}::regclass
    `;
    // A conflicting unrelated index must neither be accepted nor replaced.
    await sql`CREATE INDEX ${sql(name)} ON ${sql(tableName)} (created)`;
    await store.set(["key"], "works");
    await db.complete();
    assert.equal(await store.get(["key"]), "works");
    assert.equal((await indexes(sql, tableName)).length, 1);
    assert.match((await indexes(sql, tableName))[0].definition, /\(created\)/);
  } finally {
    await store.drop();
    await sql.end();
  }
});

test("PostgresKvStore provisioning skips RLS", { skip }, async () => {
  if (!dbUrl) return;
  const { sql, tableName, statements } = database({
    connection: { default_transaction_isolation: "repeatable read" },
  });
  const store = new PostgresKvStore(sql, { tableName });
  try {
    await legacyTable(sql, tableName);
    await sql`ALTER TABLE ${sql(tableName)} ENABLE ROW LEVEL SECURITY`;
    statements.length = 0;
    await store.initialize();
    assert.equal((await indexes(sql, tableName)).length, 0);
    assert(!statements.some((q) => /LOCK TABLE|CREATE INDEX/.test(q)));
  } finally {
    await store.drop();
    await sql.end();
  }
});

test(
  "PostgresKvStore serializes empty-table index provisioning",
  { skip },
  async () => {
    if (!dbUrl) return;
    const { sql, tableName } = database();
    try {
      await legacyTable(sql, tableName);
      await Promise.all(
        Array.from(
          { length: 6 },
          () => new PostgresKvStore(sql, { tableName }).initialize(),
        ),
      );
      assert.equal((await indexes(sql, tableName)).length, 1);
    } finally {
      await sql`DROP TABLE IF EXISTS ${sql(tableName)}`;
      await sql.end();
    }
  },
);

test("PostgresKvStore indexed timestamp overflow rejects writes atomically", {
  skip,
}, async () => {
  if (!dbUrl) return;
  const { sql, tableName } = database();
  const store = new PostgresKvStore(sql, { tableName });
  try {
    await store.set(["key"], "original");
    const ttl = Temporal.Duration.from({ years: 300000 });
    await assert.rejects(
      store.set(["key"], "wrong", { ttl }),
      /timestamp out of range/,
    );
    await assert.rejects(
      store.cas(["key"], "original", "wrong", { ttl }),
      /timestamp out of range/,
    );
    assert.equal(await store.get(["key"]), "original");
  } finally {
    await store.drop();
    await sql.end();
  }
});

test("PostgresKvStore rechecks emptiness after a concurrent writer commits", {
  skip,
}, async () => {
  if (!dbUrl) return;
  const locking = Promise.withResolvers<void>();
  const { sql, tableName } = database({
    connection: { default_transaction_isolation: "repeatable read" },
    debug(_connection, query) {
      if (query.startsWith("LOCK TABLE")) locking.resolve();
    },
  });
  const store = new PostgresKvStore(sql, { tableName });
  let initializing: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await legacyTable(sql, tableName);
    await sql.begin(async (tx) => {
      // The first emptiness probe cannot see this uncommitted row.  SHARE
      // must wait for this writer, then the next probe must see its commit.
      await tx`INSERT INTO ${tx(tableName)} VALUES
        (ARRAY['concurrent'], '1', statement_timestamp(), NULL)`;
      initializing = store.initialize();
      await Promise.race([
        locking.promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("provisioning did not reach its lock")),
            3000,
          );
        }),
      ]);
      clearTimeout(timer);
    });
    await initializing;
    assert.equal(
      (await indexes(sql, tableName)).length,
      0,
      "a stale snapshot must not allow index creation on the populated table",
    );
    assert.equal(await store.get(["concurrent"]), 1);
  } finally {
    clearTimeout(timer);
    await initializing;
    await store.drop();
    await sql.end();
  }
});

for (const layout of ["partitioned", "inherited"] as const) {
  test(
    `PostgresKvStore expiry indexing supports ${layout} tables`,
    { skip },
    async () => {
      if (!dbUrl) return;
      const db = database();
      const { sql, tableName } = db;
      const child = `${tableName}_child`;
      const store = new PostgresKvStore(db.observed, { tableName });
      try {
        if (layout === "partitioned") {
          await sql`CREATE TABLE ${sql(tableName)} (
          key text[], value jsonb NOT NULL, created timestamptz, ttl interval
        ) PARTITION BY RANGE (created)`;
          await sql`CREATE TABLE ${sql(child)} PARTITION OF ${
            sql(tableName)
          } DEFAULT`;
        } else {
          await legacyTable(sql, tableName);
          await sql`CREATE TABLE ${sql(child)} () INHERITS (${sql(tableName)})`;
        }
        await store.initialize();
        assert.equal(
          (await indexes(sql, tableName)).length,
          layout === "partitioned" ? 1 : 0,
        );
        if (layout === "inherited") {
          await manualIndex(sql, tableName);
          await manualIndex(sql, child);
        }
        assert.equal((await indexes(sql, child)).length, 1);
        // A store naming the child directly must recognize its physical index.
        await new PostgresKvStore(sql, { tableName: child }).initialize();
        assert.equal((await indexes(sql, child)).length, 1);
        await sql`INSERT INTO ${sql(child)} VALUES
        (ARRAY['expired'], '1', '2000-01-01', INTERVAL '1 day')`;
        await store.delete(["missing"]);
        await db.complete();
        const [{ count }] = await sql`SELECT count(*)::int AS count FROM ${
          sql(tableName)
        }`;
        assert.equal(count, 0);
      } finally {
        await sql`DROP TABLE IF EXISTS ${sql(tableName)} CASCADE`;
        await sql.end();
      }
    },
  );
}

test(
  "PostgresKvStore keeps a non-owner's existing table usable",
  { skip },
  async () => {
    if (!dbUrl) return;
    const db = database();
    const { sql } = db;
    const schema = `kv_schema_${crypto.randomUUID().replaceAll("-", "")}`;
    const tableName = `${schema}.${db.tableName}`;
    const role = `kv_reader_${crypto.randomUUID().replaceAll("-", "")}`;
    let client: postgres.Sql | undefined;
    try {
      await sql`CREATE SCHEMA ${sql(schema)}`;
      await legacyTable(sql, tableName);
      await sql`CREATE ROLE ${sql(role)}`;
      await sql`GRANT USAGE, CREATE ON SCHEMA ${sql(schema)} TO ${sql(role)}`;
      await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ${sql(tableName)} TO ${
        sql(role)
      }`;
      client = postgres(dbUrl, { connection: { role } });
      const store = new PostgresKvStore(client, { tableName });
      await store.set(["key"], "value");
      assert.equal(await store.get(["key"]), "value");
      assert.equal((await indexes(sql, tableName)).length, 0);
      // Drains background housekeeping without requiring the non-owner to DROP.
      await client.end();
    } finally {
      await client?.end();
      await sql`DROP TABLE IF EXISTS ${sql(tableName)}`;
      await sql`DROP SCHEMA IF EXISTS ${sql(schema)}`;
      await sql`DROP ROLE IF EXISTS ${sql(role)}`;
      await sql.end();
    }
  },
);
