-- Online store tables: reviews, VIP signups, web orders, stats events and Behind the Beard sign-in.
-- Same rules as the POS: every row has business_id, row-level security limits queries to
-- current_business_id(), and the app runs as pos_app. Written to run on its own database (store
-- dev and tests) or beside the POS tables, so shared pieces are created only if missing.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    CREATE ROLE pos_app NOLOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO pos_app;

CREATE OR REPLACE FUNCTION current_business_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.business_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- Reviews wait as 'pending' until staff approve them. Email is never shown on the site.
CREATE TABLE store_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL,
  game           text NOT NULL,
  stars          integer NOT NULL CHECK (stars BETWEEN 1 AND 5),
  headline       text CHECK (length(headline) <= 80),
  body           text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  name           text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  email          text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'hidden')),
  featured       boolean NOT NULL DEFAULT false,
  bought_from_us boolean NOT NULL DEFAULT false,
  approved_at    timestamptz,
  is_demo        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);
CREATE INDEX store_reviews_status ON store_reviews (business_id, status, approved_at DESC);
CREATE INDEX store_reviews_email ON store_reviews (business_id, lower(email), created_at);

-- Signups also go to Square Customers once Square is connected; this keeps our own copy.
CREATE TABLE store_vip_signups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  email       text NOT NULL,
  source      text NOT NULL CHECK (source IN ('band', 'popup', 'review')),
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX store_vip_signups_email ON store_vip_signups (business_id, lower(email));

-- One row per checkout started. Lines and prices are what the server priced, never the browser's.
CREATE TABLE store_orders (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id             uuid NOT NULL,
  visitor_id              text,
  status                  text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
  lines                   jsonb NOT NULL,
  subtotal_cents          integer NOT NULL CHECK (subtotal_cents >= 0),
  square_order_id         text,
  square_payment_link_id  text,
  paid_at                 timestamptz,
  is_demo                 boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);
CREATE INDEX store_orders_visitor ON store_orders (business_id, visitor_id, created_at);
CREATE UNIQUE INDEX store_orders_square ON store_orders (business_id, square_order_id) WHERE square_order_id IS NOT NULL;

-- Stats events. Append-only for the app; old rows are pruned by the owner after 13 months.
CREATE TABLE store_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id uuid NOT NULL,
  visitor_id  text NOT NULL,
  type        text NOT NULL,
  path        text NOT NULL,
  label       text,
  product_id  text,
  qty         integer,
  source      text,
  is_demo     boolean NOT NULL DEFAULT false,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX store_events_at ON store_events (business_id, at);
CREATE INDEX store_events_visitor ON store_events (business_id, visitor_id, at);

-- Behind the Beard sign-in: a one-time code by email, then a session. Only hashes are stored.
CREATE TABLE store_staff_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  email       text NOT NULL,
  code_hash   text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX store_staff_codes_email ON store_staff_codes (business_id, lower(email), created_at);

CREATE TABLE store_staff_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  email       text NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['store_reviews', 'store_vip_signups', 'store_orders', 'store_events',
                           'store_staff_codes', 'store_staff_sessions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = current_business_id()) WITH CHECK (business_id = current_business_id())', t || '_own', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO pos_app', t);
    IF t <> 'store_events' THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t || '_updated_at', t);
    END IF;
  END LOOP;
END
$$;

REVOKE UPDATE, DELETE ON store_events FROM pos_app;
GRANT USAGE ON SEQUENCE store_events_id_seq TO pos_app;
