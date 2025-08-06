/**
 * SQLite database adapter.
 *
 * An abstract interface for SQLite database for different runtime environments.
 */
export interface SqliteDatabaseAdapter {
  /**
   * Prepares a SQL statement.
   * @param sql - The SQL statement to prepare.
   */
  prepare(sql: string): SqliteStatementAdapter;

  /**
   * Executes a SQL statement.
   * @param sql - The SQL statement to execute.
   */
  exec(sql: string): void;

  /**
   * Closes the database connection.
   */
  close(): void;
}

export interface SqliteStatementAdapter {
  /**
   * Executes a SQL statement and returns the number of changes made to the database.
   * @param params - The parameters to bind to the SQL statement.
   */
  run(...params: unknown[]): { changes: number; lastInsertRowid: number };

  /**
   * Executes a SQL statement and returns the first row of the result set.
   * @param params - The parameters to bind to the SQL statement.
   * @returns The first row of the result set, or `undefined` if the result set is empty.
   */
  get(...params: unknown[]): unknown | undefined;

  /**
   * Executes a SQL statement and returns all rows of the result set.
   * @param params - The parameters to bind to the SQL statement.
   */
  all(...params: unknown[]): unknown[];
}
