import { PlatformDatabase } from "#sqlite";
import { test } from "@fedify/fixture";
import { SqliteMessageQueue } from "@fedify/sqlite/mq";
import { getRandomKey, testMessageQueue } from "@fedify/testing";
import * as temporal from "@js-temporal/polyfill";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const Temporal = globalThis.Temporal ?? temporal.Temporal;

const dbDir = await mkdtemp(join(tmpdir(), "fedify-sqlite-"));
const dbPath = join(dbDir, `${getRandomKey("sqlite")}.db`);
const db = new PlatformDatabase(dbPath);
const tableName = getRandomKey("message").replaceAll("-", "_");

test("SqliteMessageQueue", () =>
  testMessageQueue(
    () => new SqliteMessageQueue(db, { tableName }),
    ({ mq1, mq2, controller }) => {
      controller.abort();
      mq1.drop();
      mq1[Symbol.dispose]();
      mq2[Symbol.dispose]();
    },
    { testOrderingKey: true },
  ));

test("SqliteMessageQueue.getDepth()", async () => {
  const dbPath = join(dbDir, `${getRandomKey("sqlite_depth")}.db`);
  const db = new PlatformDatabase(dbPath);
  const tableName = getRandomKey("message_depth").replaceAll("-", "_");
  const mq = new SqliteMessageQueue(db, { tableName });
  try {
    assert.deepStrictEqual(await mq.getDepth(), {
      queued: 0,
      ready: 0,
      delayed: 0,
    });
    await mq.enqueue("ready");
    await mq.enqueue("delayed", {
      delay: Temporal.Duration.from({ hours: 1 }),
    });
    assert.deepStrictEqual(await mq.getDepth(), {
      queued: 2,
      ready: 1,
      delayed: 1,
    });
  } finally {
    mq.drop();
    mq[Symbol.dispose]();
  }
});
