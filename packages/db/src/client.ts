/**
 * The small slice of PGlite the data layer needs. PGlite itself satisfies it,
 * and so does the browser's worker proxy (apps/web/src/demo/db-client.ts).
 */
export interface QueryClient {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; affectedRows?: number }>;
  /** Runs one or more statements with no parameters. */
  exec(sql: string): Promise<unknown>;
}
