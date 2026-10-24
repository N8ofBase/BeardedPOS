-- Refunds and receipts sent by email or text.

-- Managers can refund up to this much without an owner's OK (spec: "refunds up to a limit").
ALTER TABLE businesses ADD COLUMN refund_approval_cents integer NOT NULL DEFAULT 5000
  CHECK (refund_approval_cents >= 0);

-- Each line's share of the sale's tax, so a refund gives back exactly the tax paid.
-- Empty for sales rung before this migration; worked out at refund time instead.
ALTER TABLE sale_lines ADD COLUMN tax_cents integer CHECK (tax_cents IS NULL OR tax_cents >= 0);

ALTER TABLE sales ADD COLUMN refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0);
ALTER TABLE sales ADD CONSTRAINT sales_refund_max CHECK (refunded_cents <= total_cents);

CREATE TABLE refunds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  sale_id      uuid NOT NULL,
  staff_id     uuid,
  approved_by  uuid,
  reason       text NOT NULL CHECK (reason IN ('damaged', 'wrong_item', 'changed_mind', 'price_adjustment', 'other')),
  note         text,
  restock      boolean NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  tax_cents    integer NOT NULL CHECK (tax_cents >= 0),
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refunds_business_id_id UNIQUE (business_id, id),
  CONSTRAINT refunds_other_note CHECK (reason <> 'other' OR length(trim(coalesce(note, ''))) > 0),
  FOREIGN KEY (business_id, sale_id) REFERENCES sales (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, staff_id) REFERENCES staff (business_id, id) ON DELETE SET NULL (staff_id),
  FOREIGN KEY (business_id, approved_by) REFERENCES staff (business_id, id) ON DELETE SET NULL (approved_by)
);
CREATE INDEX refunds_sale ON refunds (sale_id);
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY refunds_own ON refunds
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE UPDATE, DELETE ON refunds FROM pos_app;

CREATE TABLE refund_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  refund_id    uuid NOT NULL,
  sale_line_id uuid NOT NULL,
  qty          integer NOT NULL CHECK (qty > 0),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  tax_cents    integer NOT NULL CHECK (tax_cents >= 0),
  FOREIGN KEY (business_id, refund_id) REFERENCES refunds (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, sale_line_id) REFERENCES sale_lines (business_id, id) ON DELETE CASCADE
);
CREATE INDEX refund_lines_sale_line ON refund_lines (sale_line_id);
ALTER TABLE refund_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY refund_lines_own ON refund_lines
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE UPDATE, DELETE ON refund_lines FROM pos_app;

-- Where the money went back: card payments first, then cash.
CREATE TABLE refund_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  refund_id    uuid NOT NULL,
  payment_id   uuid NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
  method       text NOT NULL CHECK (method IN ('card', 'cash')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  provider_ref text,
  FOREIGN KEY (business_id, refund_id) REFERENCES refunds (business_id, id) ON DELETE CASCADE
);
ALTER TABLE refund_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY refund_payments_own ON refund_payments
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE UPDATE, DELETE ON refund_payments FROM pos_app;

-- Receipts sent by email or text. Demo mode only previews them (status preview).
CREATE TABLE receipt_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  sale_id     uuid NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('email', 'sms')),
  to_address  text NOT NULL,
  subject     text,
  body        text NOT NULL,
  status      text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview', 'queued', 'sent', 'failed')),
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, sale_id) REFERENCES sales (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, created_by) REFERENCES staff (business_id, id) ON DELETE SET NULL (created_by)
);
CREATE TRIGGER receipt_outbox_updated_at BEFORE UPDATE ON receipt_outbox
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE receipt_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY receipt_outbox_own ON receipt_outbox
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE DELETE ON receipt_outbox FROM pos_app;
