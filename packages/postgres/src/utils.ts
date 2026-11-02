import type { Sql } from "postgres";

// postgres.js uses Sql<{}> to mean an untyped SQL client.
// oxlint-disable-next-line typescript/no-empty-object-type
export async function driverSerializesJson(sql: Sql<{}>): Promise<boolean> {
  const result = await sql`SELECT ${sql.json('{"foo":1}')}::jsonb AS test;`;
  return result[0].test === '{"foo":1}';
}
