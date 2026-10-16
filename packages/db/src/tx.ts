import { sql, type Kysely, type Transaction } from "kysely";
import type { DB } from "./schema.ts";

/**
 * Runs fn in a transaction scoped to one business: switches to the restricted pos_app
 * role (so row-level security applies) and sets app.business_id. Every app query goes
 * through here; nothing should query the database as the owner except migrations and seeds.
 */
export function withBusiness<T>(
  db: Kysely<DB>,
  businessId: string,
  fn: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SET LOCAL ROLE pos_app`.execute(trx);
    await sql`SELECT set_config('app.business_id', ${businessId}, true)`.execute(trx);
    return fn(trx);
  });
}
