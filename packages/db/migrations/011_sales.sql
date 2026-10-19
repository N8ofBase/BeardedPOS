-- Register: sales, their lines and payments, store discounts, and the Astro queue.

ALTER TABLE businesses ADD COLUMN astro_discounts_before_tax boolean NOT NULL DEFAULT true;
ALTER TABLE staff ADD CONSTRAINT staff_business_id_id UNIQUE (business_id, id);

-- Per-business counters (receipt numbers). Incremented with UPDATE … RETURNING under a row lock.
CREATE TABLE business_counters (
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name        text NOT NULL,
  value       integer NOT NULL,
  PRIMARY KEY (business_id, name)
);
ALTER TABLE business_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY business_counters_own ON business_counters
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE DELETE ON business_counters FROM pos_app;

-- Store discounts the owner sets up (cash, employee, …).
CREATE TABLE discounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (length(trim(name)) > 0),
  code           text CHECK (code IS NULL OR code ~ '^[A-Za-z0-9-]{1,20}$'),
  kind           text NOT NULL CHECK (kind IN ('percent', 'fixed')),
  -- Percent in thousandths of a percent (20% = 20000), like tax rates.
  percent_mpct   integer,
  amount_cents   integer,
  scope          text NOT NULL DEFAULT 'ticket' CHECK (scope IN ('ticket', 'line')),
  cash_only      boolean NOT NULL DEFAULT false,
  needs_approval boolean NOT NULL DEFAULT false,
  ask_note       boolean NOT NULL DEFAULT false,
  combinable     boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true,
  archived_at    timestamptz,
  is_demo        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discounts_business_id_id UNIQUE (business_id, id),
  CONSTRAINT discounts_amount CHECK (
    (kind = 'percent' AND percent_mpct BETWEEN 1 AND 100000 AND amount_cents IS NULL) OR
    (kind = 'fixed' AND amount_cents > 0 AND percent_mpct IS NULL))
);
CREATE UNIQUE INDEX discounts_code_per_business ON discounts (business_id, lower(code))
  WHERE code IS NOT NULL AND archived_at IS NULL;
CREATE TRIGGER discounts_updated_at BEFORE UPDATE ON discounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE discounts FORCE ROW LEVEL SECURITY;
CREATE POLICY discounts_own ON discounts
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

CREATE TABLE sales (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  location_id          uuid NOT NULL,
  customer_id          uuid,
  staff_id             uuid,
  receipt_number       integer NOT NULL,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'canceled')),
  source               text NOT NULL DEFAULT 'register' CHECK (source IN ('register', 'import')),
  subtotal_cents       integer NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents       integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_cents            integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents          integer NOT NULL CHECK (total_cents >= 0),
  -- Copied at checkout, so a later settings change doesn't rewrite old sales.
  tax_rate_mpct        integer NOT NULL,
  discounts_before_tax boolean NOT NULL,
  paid_at              timestamptz,
  canceled_at          timestamptz,
  is_demo              boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_business_id_id UNIQUE (business_id, id),
  CONSTRAINT sales_receipt_number UNIQUE (business_id, receipt_number),
  CONSTRAINT sales_total CHECK (total_cents = subtotal_cents - discount_cents + tax_cents),
  FOREIGN KEY (business_id, location_id) REFERENCES locations (business_id, id),
  -- Deleting a customer keeps their sales, without a customer attached.
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id) ON DELETE SET NULL (customer_id),
  FOREIGN KEY (business_id, staff_id) REFERENCES staff (business_id, id) ON DELETE SET NULL (staff_id)
);
CREATE INDEX sales_recent ON sales (business_id, created_at DESC);
CREATE INDEX sales_customer ON sales (customer_id) WHERE customer_id IS NOT NULL;
CREATE TRIGGER sales_updated_at BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_own ON sales
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE DELETE ON sales FROM pos_app;

-- What was sold. Names and prices are copied, so the receipt never changes.
CREATE TABLE sale_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  sale_id           uuid NOT NULL,
  position          integer NOT NULL,
  product_id        uuid,
  appointment_id    uuid,
  name              text NOT NULL,
  sku               text,
  barcode           text,
  tax_class         text NOT NULL CHECK (tax_class IN ('standard', 'exempt')),
  qty               integer NOT NULL CHECK (qty > 0),
  unit_price_cents  integer NOT NULL CHECK (unit_price_cents >= 0),
  discount_cents    integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  line_total_cents  integer NOT NULL CHECK (line_total_cents >= 0),
  astro_program_id  uuid,
  earns_punches     integer NOT NULL DEFAULT 0 CHECK (earns_punches >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sale_lines_business_id_id UNIQUE (business_id, id),
  CONSTRAINT sale_lines_total CHECK (line_total_cents = unit_price_cents * qty - discount_cents),
  FOREIGN KEY (business_id, sale_id) REFERENCES sales (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, product_id) REFERENCES products (business_id, id) ON DELETE SET NULL (product_id)
);
CREATE INDEX sale_lines_sale ON sale_lines (sale_id, position);
CREATE INDEX sale_lines_product ON sale_lines (product_id) WHERE product_id IS NOT NULL;
ALTER TABLE sale_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY sale_lines_own ON sale_lines
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE UPDATE, DELETE ON sale_lines FROM pos_app;

-- Every discount on a sale: store discounts, Astro offers and Astro rewards.
CREATE TABLE sale_discounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  sale_id       uuid NOT NULL,
  sale_line_id  uuid,
  source        text NOT NULL CHECK (source IN ('store', 'astro_offer', 'astro_reward')),
  discount_id   uuid,
  name          text NOT NULL,
  kind          text CHECK (kind IN ('percent', 'fixed')),
  percent_mpct  integer,
  amount_cents  integer NOT NULL CHECK (amount_cents >= 0),
  note          text,
  applied_by    uuid,
  approved_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, sale_id) REFERENCES sales (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, sale_line_id) REFERENCES sale_lines (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, discount_id) REFERENCES discounts (business_id, id) ON DELETE SET NULL (discount_id),
  FOREIGN KEY (business_id, applied_by) REFERENCES staff (business_id, id) ON DELETE SET NULL (applied_by),
  FOREIGN KEY (business_id, approved_by) REFERENCES staff (business_id, id) ON DELETE SET NULL (approved_by)
);
CREATE INDEX sale_discounts_sale ON sale_discounts (sale_id);
CREATE INDEX sale_discounts_discount ON sale_discounts (discount_id) WHERE discount_id IS NOT NULL;
ALTER TABLE sale_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_discounts FORCE ROW LEVEL SECURITY;
CREATE POLICY sale_discounts_own ON sale_discounts
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE UPDATE, DELETE ON sale_discounts FROM pos_app;

-- Card and cash payments. Never card data: only Square's reference and amounts.
CREATE TABLE payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  sale_id        uuid NOT NULL,
  method         text NOT NULL CHECK (method IN ('card', 'cash')),
  provider       text NOT NULL CHECK (provider IN ('square', 'cash')),
  provider_ref   text,
  status         text NOT NULL CHECK (status IN ('pending', 'completed', 'declined', 'canceled', 'refunded')),
  amount_cents   integer NOT NULL CHECK (amount_cents > 0),
  tendered_cents integer CHECK (tendered_cents IS NULL OR tendered_cents >= amount_cents),
  change_cents   integer NOT NULL DEFAULT 0 CHECK (change_cents >= 0),
  refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0 AND refunded_cents <= amount_cents),
  staff_id       uuid,
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, sale_id) REFERENCES sales (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, staff_id) REFERENCES staff (business_id, id) ON DELETE SET NULL (staff_id)
);
CREATE INDEX payments_sale ON payments (sale_id);
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY payments_own ON payments
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE DELETE ON payments FROM pos_app;

-- Sales with Astro activity, to enter in the Astro portal until the live API exists.
CREATE TABLE astro_queue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  sale_id     uuid NOT NULL,
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'entered', 'sent', 'failed')),
  attempts    integer NOT NULL DEFAULT 0,
  error       text,
  entered_by  uuid,
  entered_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT astro_queue_one_per_sale UNIQUE (sale_id),
  FOREIGN KEY (business_id, sale_id) REFERENCES sales (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, entered_by) REFERENCES staff (business_id, id) ON DELETE SET NULL (entered_by)
);
CREATE INDEX astro_queue_pending ON astro_queue (business_id, created_at) WHERE status = 'pending';
CREATE TRIGGER astro_queue_updated_at BEFORE UPDATE ON astro_queue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE astro_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE astro_queue FORCE ROW LEVEL SECURITY;
CREATE POLICY astro_queue_own ON astro_queue
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE DELETE ON astro_queue FROM pos_app;

-- Punches now link back to the sale that earned or redeemed them.
ALTER TABLE astro_punches ADD CONSTRAINT astro_punches_sale
  FOREIGN KEY (business_id, sale_id) REFERENCES sales (business_id, id) ON DELETE SET NULL (sale_id);
