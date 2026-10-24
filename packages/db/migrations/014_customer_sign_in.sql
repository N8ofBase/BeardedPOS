-- Customer sign-in for the public pages, with a one-time code.

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
