import { PlatformDatabase } from "#sqlite";
import { test } from "@fedify/fixture";
import { SqliteMessageQueue } from "@fedify/sqlite/mq";
import { getRandomKey, testMessageQueue } from "@fedify/testing";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      mq2.drop();
      mq1[Symbol.dispose]();
    },
  ));
