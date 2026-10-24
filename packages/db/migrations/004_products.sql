-- Products, stock levels and the append-only log of stock moves.

CREATE TABLE products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  sku               text NOT NULL CHECK (length(trim(sku)) > 0),
  barcode           text CHECK (barcode IS NULL OR length(trim(barcode)) > 0),
  name              text NOT NULL CHECK (length(trim(name)) > 0),
  brand             text,
  category          text NOT NULL DEFAULT 'Supplies',
  price_cents       integer NOT NULL CHECK (price_cents >= 0),
  cost_cents        integer NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  tax_class         text NOT NULL DEFAULT 'standard' CHECK (tax_class IN ('standard', 'exempt')),
  reorder_at        integer NOT NULL DEFAULT 0 CHECK (reorder_at >= 0),
  active            boolean NOT NULL DEFAULT true,
  is_demo           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_business_id_id UNIQUE (business_id, id)
);
CREATE UNIQUE INDEX products_sku_per_business ON products (business_id, lower(sku));
CREATE UNIQUE INDEX products_barcode_per_business ON products (business_id, barcode) WHERE barcode IS NOT NULL;
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY products_own ON products
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

-- Current stock per product per location. Only the move trigger writes it.
CREATE TABLE inventory_levels (
  business_id      uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id       uuid NOT NULL,
  location_id      uuid NOT NULL,
  on_hand          integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, location_id),
  FOREIGN KEY (business_id, product_id) REFERENCES products (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, location_id) REFERENCES locations (business_id, id) ON DELETE CASCADE
);
ALTER TABLE inventory_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_levels FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_levels_own ON inventory_levels
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE INSERT, UPDATE, DELETE ON inventory_levels FROM pos_app;

-- Every stock change, append-only. on_hand is the running sum of these.
CREATE TABLE inventory_moves (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id  uuid NOT NULL,
  location_id uuid NOT NULL,
  qty_change  integer NOT NULL CHECK (qty_change <> 0),
  reason      text NOT NULL CHECK (reason IN ('sale', 'receive', 'adjust', 'return')),
  ref_id      uuid,
  staff_id    uuid REFERENCES staff (id) ON DELETE SET NULL,
  note        text,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, product_id) REFERENCES products (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, location_id) REFERENCES locations (business_id, id) ON DELETE CASCADE
);
CREATE INDEX inventory_moves_product ON inventory_moves (product_id, created_at DESC);
ALTER TABLE inventory_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_moves FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_moves_own ON inventory_moves
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE UPDATE, DELETE ON inventory_moves FROM pos_app;

-- Applies each move to inventory_levels in the same transaction. Runs as the
-- owner because the app role can't write levels directly; row-level security
-- still applies through app.business_id.
CREATE FUNCTION apply_inventory_move() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
BEGIN
  INSERT INTO inventory_levels (business_id, product_id, location_id, on_hand)
  VALUES (NEW.business_id, NEW.product_id, NEW.location_id, NEW.qty_change)
  ON CONFLICT (product_id, location_id)
    DO UPDATE SET on_hand = inventory_levels.on_hand + EXCLUDED.on_hand, updated_at = now();
  RETURN NEW;
END
$$;
CREATE TRIGGER inventory_moves_apply AFTER INSERT ON inventory_moves
  FOR EACH ROW EXECUTE FUNCTION apply_inventory_move();
