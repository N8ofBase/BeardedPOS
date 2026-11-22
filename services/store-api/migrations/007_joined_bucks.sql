-- One Beard Buddy balance everywhere. When the register shares this database, each shopper is joined
-- to the register customer with the same email (one is made when there's none), their website Bucks
-- are copied into the register's loyalty_ledger once, and from then on every website entry is written
-- there too (src/loyalty.ts). No foreign key: on its own database (store dev and tests) there's no
-- customers table, and the shopper's Bucks stay in store_loyalty_ledger.
ALTER TABLE store_customers
  ADD COLUMN register_customer_id uuid,
  -- When their website Bucks were copied to the register's ledger. Set once; never copied again.
  ADD COLUMN bucks_joined_at      timestamptz;
