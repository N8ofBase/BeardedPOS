// Kysely dialect over a single PGlite connection. The community adapter stops at
// PGlite 0.4, so this is our own. PGlite is one session, so connections are handed
// out one at a time; a transaction holds the connection until it commits or rolls back.
import {
  CompiledQuery,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type Kysely,
  type QueryResult,
} from "kysely";
import type { QueryClient } from "./client.ts";

class PGliteConnection implements DatabaseConnection {
  constructor(private readonly client: QueryClient) {}

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const res = await this.client.query<R>(compiled.sql, [...compiled.parameters]);
    return res.affectedRows === undefined
      ? { rows: res.rows }
      : { rows: res.rows, numAffectedRows: BigInt(res.affectedRows) };
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("Streaming queries aren't supported with PGlite");
  }
}

class PGliteDriver implements Driver {
  private readonly connection: PGliteConnection;
  private queue: Promise<void> = Promise.resolve();
  private release: (() => void) | null = null;

  constructor(client: QueryClient) {
    this.connection = new PGliteConnection(client);
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => (release = resolve));
    await previous;
    this.release = release;
    return this.connection;
  }

  async beginTransaction(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledQuery.raw("BEGIN"));
  }

  async commitTransaction(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledQuery.raw("COMMIT"));
  }

  async rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledQuery.raw("ROLLBACK"));
  }

  async releaseConnection(): Promise<void> {
    const release = this.release;
    this.release = null;
    release?.();
  }

  async destroy(): Promise<void> {}
}

export class PGliteDialect implements Dialect {
  constructor(private readonly client: QueryClient) {}

  createAdapter() {
    return new PostgresAdapter();
  }

  createDriver(): Driver {
    return new PGliteDriver(this.client);
  }

  createIntrospector(db: Kysely<unknown>) {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }
}
