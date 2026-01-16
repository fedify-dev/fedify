import { PlatformDatabase } from "#sqlite";
import { getRandomKey, testMessageQueue } from "@fedify/testing";
import * as temporal from "@js-temporal/polyfill";
import { SqliteMessageQueue } from "./mq.ts";

let Temporal: typeof temporal.Temporal;
if ("Temporal" in globalThis) {
  Temporal = globalThis.Temporal;
} else {
  Temporal = temporal.Temporal;
}

const dbPath = `/tmp/${getRandomKey("sqlite")}.db`;
const db = new PlatformDatabase(dbPath);
const tableName = getRandomKey("message").replaceAll("-", "_");

testMessageQueue(
  "SqliteMessageQueue",
  () =>
    new SqliteMessageQueue(db, {
      tableName,
      pollInterval: Temporal.Duration.from({ milliseconds: 500 }),
    }),
  ({ controller }) => {
    controller.abort();
    db.close();
  },
);
