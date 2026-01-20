import { test } from "@fedify/fixture";
import { PostgresMessageQueue } from "@fedify/postgres/mq";
import { getRandomKey, testMessageQueue } from "@fedify/testing";
import process from "node:process";
import postgres from "postgres";

const dbUrl = process.env.POSTGRES_URL;
const sqls: postgres.Sql[] = [];

function createSql() {
  const sql = postgres(dbUrl!);
  sqls.push(sql);
  return sql;
}

test("PostgresMessageQueue", { ignore: dbUrl == null }, () =>
  testMessageQueue(
    () =>
      new PostgresMessageQueue(createSql(), {
        tableName: getRandomKey("message"),
        channelName: getRandomKey("channel"),
      }),
    async ({ mq1, mq2, controller }) => {
      controller.abort();
      await mq1.drop();
      await mq2.drop();
      for (const sql of sqls) {
        await sql.end();
      }
    },
  ));

// cspell: ignore sqls
