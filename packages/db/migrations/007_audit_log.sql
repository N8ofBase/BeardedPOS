-- Refunds, voids, price changes and customer deletes. Append-only for the app.

CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  staff_id    uuid REFERENCES staff (id) ON DELETE SET NULL,
  action      text NOT NULL CHECK (length(action) > 0),
  entity      text NOT NULL CHECK (length(entity) > 0),
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_business_time ON audit_log (business_id, created_at DESC);
CREATE INDEX audit_log_entity ON audit_log (entity, entity_id);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_log_own ON audit_log
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE UPDATE, DELETE ON audit_log FROM pos_app;
