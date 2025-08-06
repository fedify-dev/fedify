import { Database, type Statement } from "bun:sqlite";
import type {
  SqliteDatabaseAdapter,
  SqliteStatementAdapter,
} from "./adapter.ts";

export { Database as PlatformDatabase };
export type { Statement as PlatformStatement };

export class SqliteDatabase implements SqliteDatabaseAdapter {
  constructor(private readonly db: Database) {}

  prepare(sql: string): SqliteStatementAdapter {
    return new SqliteStatement(this.db.query(sql));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close(false);
  }
}

export class SqliteStatement implements SqliteStatementAdapter {
  constructor(private readonly stmt: Statement) {}

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    return this.stmt.run(...params);
  }

  get(...params: unknown[]): unknown | undefined {
    const result = this.stmt.get(...params);
    // to make the return type compatible with the node version
    if (result === null) {
      return undefined;
    }
    return result;
  }

  all(...params: unknown[]): unknown[] {
    return this.stmt.all(...params);
  }
}
