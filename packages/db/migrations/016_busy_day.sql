-- Texts to customers about their appointments (ready for pickup, moved, canceled).
-- Demo mode only previews them (status preview); hosted mode sends them.

ALTER TABLE businesses ADD COLUMN text_when_ready boolean NOT NULL DEFAULT true;

CREATE TABLE appointment_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('ready', 'moved', 'canceled')),
  channel        text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms')),
  to_address     text NOT NULL,
  body           text NOT NULL CHECK (length(body) <= 480),
  status         text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview', 'queued', 'sent', 'failed')),
  created_by     uuid,
  is_demo        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, appointment_id) REFERENCES appointments (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, created_by) REFERENCES staff (business_id, id) ON DELETE SET NULL (created_by)
);
-- One ready text per appointment, even if "ready" is undone and redone.
CREATE UNIQUE INDEX appointment_messages_ready_once ON appointment_messages (appointment_id) WHERE kind = 'ready';
CREATE INDEX appointment_messages_appt ON appointment_messages (appointment_id, created_at);
ALTER TABLE appointment_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_messages_own ON appointment_messages
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE UPDATE, DELETE ON appointment_messages FROM pos_app;
