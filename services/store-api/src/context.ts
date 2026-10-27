import type { Kysely } from "kysely";
import type { DB } from "@bearded/db";
import type { Database } from "./db.ts";
import type { Mailer } from "./mailer.ts";
import type { SquareStore } from "./square/types.ts";

export interface StoreConfig {
  businessId: string;
  /** Staff who may sign in to Behind the Beard: exact emails, or "@domain" for a whole domain. */
  staff: string[];
  /** Where Square sends shoppers back to, e.g. "https://bearded.pos.prismcortex.net". */
  siteUrl: string;
  /** Mark the staff cookie Secure (everywhere but localhost). */
  secureCookies: boolean;
}

export interface StoreCtx {
  db: Database;
  square: SquareStore;
  mailer: Mailer;
  config: StoreConfig;
  now: () => Date;
  /** The register's database (apps/web over /api/pos), when it's hosted on this server too. */
  pos?: Kysely<DB>;
}
