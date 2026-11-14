import { PostgresKvStore } from "@fedify/postgres/kv";
import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";
import postgres from "postgres";

const dbUrl = process.env.POSTGRES_URL;

test(
  "PostgresKvStore rejects active row-level security before partial atomic mutations",
  {
    skip: dbUrl == null,
    timeout: 30_000,
  },
  async () => {
    if (dbUrl == null) return;
    const admin = postgres(dbUrl, { max: 1 });
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const tableName = `atomic_rls_${suffix}`;
    const role = `atomic_rls_role_${suffix}`;
    const owner = new PostgresKvStore(admin, { tableName });
    let client: postgres.Sql | undefined;
    try {
      await owner.setMany([
        { key: ["a"], value: 1 },
        { key: ["b"], value: 2 },
      ]);
      await admin`CREATE ROLE ${admin(role)}`;
      await admin`GRANT SELECT, INSERT, UPDATE, DELETE ON ${admin(tableName)} TO ${admin(role)}`;
      await admin`ALTER TABLE ${admin(tableName)} ENABLE ROW LEVEL SECURITY`;
      await admin`CREATE POLICY read_rows ON ${admin(tableName)} FOR SELECT USING (true)`;
      await admin`CREATE POLICY insert_rows ON ${admin(tableName)} FOR INSERT WITH CHECK (true)`;
      await admin`CREATE POLICY update_rows ON ${admin(tableName)} FOR UPDATE USING (true) WITH CHECK (true)`;
      await admin`CREATE POLICY delete_rows ON ${admin(tableName)} FOR DELETE USING (false)`;
      client = postgres(dbUrl, { max: 1, connection: { role } });
      const store = new PostgresKvStore(client, {
        tableName,
        initialized: true,
      });
      await assert.rejects(
        store.casMany([
          { key: ["a"], expectedValue: 1, newValue: undefined },
          { key: ["b"], expectedValue: 2, newValue: 3 },
        ]),
        TypeError,
      );
      assert.deepEqual(await owner.getMany([["a"], ["b"]]), [1, 2]);
      await assert.rejects(
        store.setMany([{ key: ["b"], value: 4 }]),
        TypeError,
      );
      await assert.rejects(store.deleteMany([["a"], ["b"]]), TypeError);
      await assert.rejects(store.getMany([["a"]]), TypeError);
      assert.deepEqual(await owner.getMany([["a"], ["b"]]), [1, 2]);
      await client.begin(async (transaction) => {
        const scoped = new PostgresKvStore(transaction, {
          tableName,
          initialized: true,
        });
        await assert.rejects(
          scoped.casMany([
            { key: ["a"], expectedValue: 1, newValue: undefined },
            { key: ["b"], expectedValue: 2, newValue: 5 },
          ]),
          TypeError,
        );
        assert.equal((await transaction`SELECT 1 AS healthy`)[0].healthy, 1);
      });
    } finally {
      await client?.end();
      await owner.drop();
      await admin`DROP ROLE IF EXISTS ${admin(role)}`;
      await admin.end();
    }
  },
);
