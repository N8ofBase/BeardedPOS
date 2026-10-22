-- Online booking: the store's booking settings, which groomers take online bookings,
-- where an appointment came from, and customer sign-in with a one-time code.

ALTER TABLE businesses ADD COLUMN booking_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE businesses ADD COLUMN booking_days_ahead integer NOT NULL DEFAULT 30
  CHECK (booking_days_ahead BETWEEN 1 AND 180);
ALTER TABLE businesses ADD COLUMN booking_notice_minutes integer NOT NULL DEFAULT 120
  CHECK (booking_notice_minutes BETWEEN 0 AND 10080);
ALTER TABLE businesses ADD COLUMN booking_cutoff_hours integer NOT NULL DEFAULT 24
  CHECK (booking_cutoff_hours BETWEEN 0 AND 336);
ALTER TABLE businesses ADD COLUMN booking_step_minutes integer NOT NULL DEFAULT 30
  CHECK (booking_step_minutes IN (15, 30, 60));
ALTER TABLE businesses ADD COLUMN booking_message text CHECK (booking_message IS NULL OR length(booking_message) <= 500);
ALTER TABLE businesses ADD COLUMN public_phone text CHECK (public_phone IS NULL OR public_phone ~ '^[0-9]{10}$');

ALTER TABLE staff ADD COLUMN books_online boolean NOT NULL DEFAULT true;

ALTER TABLE appointments ADD COLUMN source text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'online'));

-- One-time sign-in codes. Only a hash of the code is kept.
CREATE TABLE customer_login_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  -- A 10-digit phone or a lower-case email.
  contact     text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_login_codes_contact ON customer_login_codes (business_id, contact, created_at DESC);
ALTER TABLE customer_login_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_login_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_login_codes_own ON customer_login_codes
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

-- Signed-in customers. Only a hash of the token is kept; the browser holds the token.
CREATE TABLE customer_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id) ON DELETE CASCADE
);
ALTER TABLE customer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_sessions_own ON customer_sessions
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

-- The sample store takes online bookings, so the demo can show it.
UPDATE businesses SET booking_enabled = true, public_phone = '2125550199' WHERE is_demo;
