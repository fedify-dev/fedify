import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import type {
  SqliteDatabaseAdapter,
  SqliteStatementAdapter,
} from "./adapter.ts";

export { DatabaseSync as PlatformDatabase };
export type { StatementSync as PlatformStatement };

export class SqliteDatabase implements SqliteDatabaseAdapter {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string): SqliteStatementAdapter {
    return new SqliteStatement(this.db.prepare(sql));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}

export class SqliteStatement implements SqliteStatementAdapter {
  constructor(private readonly stmt: StatementSync) {}

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const result = this.stmt.run(...params as SQLInputValue[]);
    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  get(...params: unknown[]): unknown | undefined {
    return this.stmt.get(...params as SQLInputValue[]);
  }

  all(...params: unknown[]): unknown[] {
    return this.stmt.all(...params as SQLInputValue[]);
  }
}
