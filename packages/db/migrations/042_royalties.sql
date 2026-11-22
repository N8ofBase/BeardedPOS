-- Royalties by sale type. People who earn royalties (designers, artists), and per game who earns
-- what: a rate for counter sales, one for website orders and one for wholesale to stores, on net
-- profit or on sales. Register sales say whether they were retail or wholesale; website orders get
-- their lines copied here when they're paid, so a month's royalties come from one place.

-- A wholesale sale is rung for a retailer at the games' wholesale prices.
ALTER TABLE sales ADD COLUMN sale_type text NOT NULL DEFAULT 'retail'
  CHECK (sale_type IN ('retail', 'wholesale'));

CREATE TABLE royalty_payees (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  email       text CHECK (email IS NULL OR length(email) <= 200),
  notes       text CHECK (notes IS NULL OR length(notes) <= 500),
  active      boolean NOT NULL DEFAULT true,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT royalty_payees_business_id_id UNIQUE (business_id, id)
);
CREATE UNIQUE INDEX royalty_payees_name ON royalty_payees (business_id, lower(name));

-- Rates are thousandths of a percent, like tax rates: 7.5% = 7500.
CREATE TABLE game_royalties (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id     uuid NOT NULL,
  payee_id       uuid NOT NULL,
  basis          text NOT NULL DEFAULT 'profit' CHECK (basis IN ('profit', 'sales')),
  retail_mpct    integer NOT NULL DEFAULT 0 CHECK (retail_mpct BETWEEN 0 AND 100000),
  online_mpct    integer NOT NULL DEFAULT 0 CHECK (online_mpct BETWEEN 0 AND 100000),
  wholesale_mpct integer NOT NULL DEFAULT 0 CHECK (wholesale_mpct BETWEEN 0 AND 100000),
  is_demo        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, product_id, payee_id),
  FOREIGN KEY (business_id, product_id) REFERENCES products (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, payee_id) REFERENCES royalty_payees (business_id, id) ON DELETE CASCADE
);
CREATE INDEX game_royalties_payee ON game_royalties (business_id, payee_id);

-- Paid website orders, one row per line matched to a register product. Line totals are after the
-- order's Beard Bucks reward, spread across lines in proportion, before tax.
CREATE TABLE web_sale_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  order_id         uuid NOT NULL,
  position         integer NOT NULL CHECK (position > 0),
  product_id       uuid NOT NULL,
  qty              integer NOT NULL CHECK (qty > 0),
  line_total_cents integer NOT NULL CHECK (line_total_cents >= 0),
  unit_cost_cents  integer NOT NULL CHECK (unit_cost_cents >= 0),
  sold_at          timestamptz NOT NULL,
  is_demo          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, order_id, position),
  FOREIGN KEY (business_id, product_id) REFERENCES products (business_id, id) ON DELETE CASCADE
);
CREATE INDEX web_sale_lines_sold ON web_sale_lines (business_id, sold_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['royalty_payees', 'game_royalties', 'web_sale_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = current_business_id()) WITH CHECK (business_id = current_business_id())', t || '_own', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t || '_updated_at', t);
  END LOOP;
END
$$;
REVOKE UPDATE ON web_sale_lines FROM pos_app;

-- Move the one royalty per game from migration 030 over: same person, same rate for every sale
-- type, on net profit as before. Then drop the old columns. Row-level security is lifted for the
-- table owner only while this runs, so the copy sees every business.
ALTER TABLE products NO FORCE ROW LEVEL SECURITY;
ALTER TABLE royalty_payees NO FORCE ROW LEVEL SECURITY;
ALTER TABLE game_royalties NO FORCE ROW LEVEL SECURITY;

INSERT INTO royalty_payees (business_id, name, is_demo)
SELECT business_id, min(trim(royalty_payee)), bool_and(is_demo)
FROM products
WHERE royalty_payee IS NOT NULL AND royalty_mpct > 0
GROUP BY business_id, lower(trim(royalty_payee));

INSERT INTO game_royalties (business_id, product_id, payee_id, basis, retail_mpct, online_mpct, wholesale_mpct, is_demo)
SELECT p.business_id, p.id, r.id, 'profit', p.royalty_mpct, p.royalty_mpct, p.royalty_mpct, p.is_demo
FROM products p
JOIN royalty_payees r ON r.business_id = p.business_id AND lower(r.name) = lower(trim(p.royalty_payee))
WHERE p.royalty_payee IS NOT NULL AND p.royalty_mpct > 0;

ALTER TABLE products FORCE ROW LEVEL SECURITY;
ALTER TABLE royalty_payees FORCE ROW LEVEL SECURITY;
ALTER TABLE game_royalties FORCE ROW LEVEL SECURITY;

ALTER TABLE products DROP COLUMN royalty_mpct;
ALTER TABLE products DROP COLUMN royalty_payee;
