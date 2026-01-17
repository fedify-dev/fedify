import { PlatformDatabase } from "#sqlite";
import { SqliteMessageQueue } from "@fedify/sqlite/mq";
import { getRandomKey, testMessageQueue } from "@fedify/testing";

const dbPath = `/tmp/${getRandomKey("sqlite")}.db`;
const db = new PlatformDatabase(dbPath);
const tableName = getRandomKey("message").replaceAll("-", "_");

testMessageQueue(
  "SqliteMessageQueue",
  () => new SqliteMessageQueue(db, { tableName }),
  ({ controller }) => {
    controller.abort();
    db.close();
  },
);
