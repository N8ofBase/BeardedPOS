-- Customers.

CREATE TABLE customers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(trim(name)) > 0),
  -- Always 10 digits; formatted only for display.
  phone             text CHECK (phone ~ '^[0-9]{10}$'),
  email             text CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  street            text,
  city              text,
  state             text CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  zip               text CHECK (zip IS NULL OR zip ~ '^[0-9]{5}(-[0-9]{4})?$'),
  birthday          date,
  sms_opt_in        boolean NOT NULL DEFAULT false,
  notes             text,
  is_demo           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Phone is the counter's lookup key, email the fallback; a customer needs one.
  CONSTRAINT customers_contact CHECK (phone IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT customers_business_id_id UNIQUE (business_id, id)
);
CREATE UNIQUE INDEX customers_phone_per_business ON customers (business_id, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX customers_email_per_business ON customers (business_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX customers_name ON customers (business_id, lower(name));
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY customers_own ON customers
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
