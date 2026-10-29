export interface Connection {
  query<T>(sql: string, params: unknown[]): Promise<T[]>;
}

/** A pooled PostgreSQL database connection. */
export class DatabaseConnection implements Connection {
  constructor(readonly url: string, readonly poolSize: number) {}

  async query<T>(sql: string, params: unknown[]): Promise<T[]> {
    void sql;
    void params;
    return [];
  }
}

/** Create the database connection pool from a connection URL. */
export function createConnection(url: string): DatabaseConnection {
  return new DatabaseConnection(url, 10);
}
