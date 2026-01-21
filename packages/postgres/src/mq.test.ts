import { test } from "@fedify/fixture";
import { PostgresMessageQueue } from "@fedify/postgres/mq";
import { getRandomKey, testMessageQueue } from "@fedify/testing";
import process from "node:process";
import postgres from "postgres";

const dbUrl = process.env.POSTGRES_URL;

test("PostgresMessageQueue", { ignore: dbUrl == null }, () => {
  const tableName = getRandomKey("message");
  const channelName = getRandomKey("channel");
  const sqls: postgres.Sql[] = [];

  function createSql() {
    const sql = postgres(dbUrl!);
    sqls.push(sql);
    return sql;
  }

  return testMessageQueue(
    () =>
      new PostgresMessageQueue(
        createSql(),
        { tableName, channelName },
      ),
    async ({ mq1, mq2, controller }) => {
      controller.abort();
      await mq1.drop();
      await mq2.drop();
      for (const sql of sqls) {
        await sql.end();
      }
    },
  );
});

// cspell: ignore sqls
