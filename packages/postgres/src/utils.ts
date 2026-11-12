import type { Sql, TransactionSql } from "postgres";

export async function driverSerializesJson(
  sql: Sql | TransactionSql,
): Promise<boolean> {
  const result = await sql`SELECT ${sql.json('{"foo":1}')}::jsonb AS test;`;
  return result[0].test === '{"foo":1}';
}
