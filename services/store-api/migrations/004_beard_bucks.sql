-- Beard Buddy online: shoppers sign in with an email code, earn Beard Bucks on paid web orders and
-- trade 100 for $5 off. The ledger is append-only and a balance is the sum of its entries, as at the
-- register (loyalty_ledger), so the two can be joined once the register shares this database.

CREATE TABLE store_customers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL,
  email            text NOT NULL,
  name             text CHECK (length(name) <= 60),
  birthday         date,
  -- A birthday can't be moved again for a year after it's set, so the gift can't be farmed.
  birthday_set_on  date,
  last_gift_on     date,
  is_demo          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);
CREATE UNIQUE INDEX store_customers_email ON store_customers (business_id, lower(email));

-- Shopper sign-in, kept apart from staff sign-in so a shopper's session can never open Behind the
-- Beard. Only hashes are stored.
CREATE TABLE store_customer_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  email       text NOT NULL,
  code_hash   text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX store_customer_codes_email ON store_customer_codes (business_id, lower(email), created_at);

CREATE TABLE store_customer_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, customer_id) REFERENCES store_customers (business_id, id) ON DELETE CASCADE
);

CREATE TABLE store_loyalty_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('earn', 'birthday', 'redeem', 'take_back', 'give_back', 'adjust')),
  bucks       integer NOT NULL CHECK (bucks <> 0),
  order_id    uuid,
  note        text,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, customer_id) REFERENCES store_customers (business_id, id),
  FOREIGN KEY (business_id, order_id) REFERENCES store_orders (business_id, id)
);
CREATE INDEX store_loyalty_ledger_customer ON store_loyalty_ledger (business_id, customer_id, created_at DESC);
-- A paid order earns, redeems and gives a birthday gift at most once each.
CREATE UNIQUE INDEX store_loyalty_ledger_once ON store_loyalty_ledger (business_id, order_id, kind)
  WHERE order_id IS NOT NULL AND kind IN ('earn', 'birthday', 'redeem');

-- Orders remember who placed them and what reward they use, priced by the server.
ALTER TABLE store_orders
  ADD COLUMN customer_id    uuid,
  ADD COLUMN reward_count   integer NOT NULL DEFAULT 0 CHECK (reward_count >= 0),
  ADD COLUMN reward_bucks   integer NOT NULL DEFAULT 0 CHECK (reward_bucks >= 0),
  ADD COLUMN discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  ADD CONSTRAINT store_orders_discount_fits CHECK (discount_cents <= subtotal_cents),
  ADD CONSTRAINT store_orders_reward_needs_customer CHECK (reward_count = 0 OR customer_id IS NOT NULL),
  ADD CONSTRAINT store_orders_customer FOREIGN KEY (business_id, customer_id) REFERENCES store_customers (business_id, id);
CREATE INDEX store_orders_customer ON store_orders (business_id, customer_id, created_at) WHERE customer_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['store_customers', 'store_customer_codes', 'store_customer_sessions',
                           'store_loyalty_ledger'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = current_business_id()) WITH CHECK (business_id = current_business_id())', t || '_own', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO pos_app', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t || '_updated_at', t);
  END LOOP;
END
$$;

REVOKE UPDATE, DELETE ON store_loyalty_ledger FROM pos_app;
