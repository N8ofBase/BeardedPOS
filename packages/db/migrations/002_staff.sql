-- Staff who sign in to the register. Cognito handles hosted sign-in (Phase 1f);
-- in demo mode cognito_sub is empty and staff are picked by role.

CREATE TABLE staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  email       text,
  role        text NOT NULL CHECK (role IN ('owner', 'manager', 'cashier')),
  cognito_sub text UNIQUE,
  active      boolean NOT NULL DEFAULT true,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_business ON staff (business_id);
CREATE UNIQUE INDEX staff_email_per_business ON staff (business_id, lower(email)) WHERE email IS NOT NULL;
CREATE TRIGGER staff_updated_at BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_own ON staff
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
