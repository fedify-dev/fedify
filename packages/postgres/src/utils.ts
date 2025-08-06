import type { Sql } from "postgres";

// deno-lint-ignore ban-types
export async function driverSerializesJson(sql: Sql<{}>): Promise<boolean> {
  const result = await sql`SELECT ${sql.json('{"foo":1}')}::jsonb AS test;`;
  return result[0].test === '{"foo":1}';
}
