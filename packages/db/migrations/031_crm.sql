-- Customer relationships: people and retailer accounts, tags, a timeline per customer,
-- follow-up dates, and bulk email by customer type and tag (sent through Amazon SES in
-- hosted mode, previewed in the demo).

-- A retailer is a store that buys at wholesale; `name` is the person we deal with there.
ALTER TABLE customers ADD COLUMN kind text NOT NULL DEFAULT 'person'
  CHECK (kind IN ('person', 'retailer'));
ALTER TABLE customers ADD COLUMN company text
  CHECK (company IS NULL OR length(trim(company)) BETWEEN 1 AND 120);
ALTER TABLE customers ADD COLUMN wholesale_terms text
  CHECK (wholesale_terms IS NULL OR length(wholesale_terms) <= 500);
ALTER TABLE customers ADD CONSTRAINT customers_retailer_company
  CHECK (kind = 'person' OR company IS NOT NULL);
-- Agreed to marketing email. Receipts and sign-in codes don't need it.
ALTER TABLE customers ADD COLUMN email_opt_in boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN follow_up_on date;
ALTER TABLE customers ADD COLUMN follow_up_note text
  CHECK (follow_up_note IS NULL OR length(follow_up_note) <= 200);
CREATE INDEX customers_follow_up ON customers (business_id, follow_up_on) WHERE follow_up_on IS NOT NULL;

CREATE TABLE tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tags_business_id_id UNIQUE (business_id, id)
);
CREATE UNIQUE INDEX tags_name_per_business ON tags (business_id, lower(name));
CREATE TRIGGER tags_updated_at BEFORE UPDATE ON tags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags FORCE ROW LEVEL SECURITY;
CREATE POLICY tags_own ON tags
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

CREATE TABLE customer_tags (
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  tag_id      uuid NOT NULL,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, customer_id, tag_id),
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, tag_id) REFERENCES tags (business_id, id) ON DELETE CASCADE
);
CREATE INDEX customer_tags_tag ON customer_tags (business_id, tag_id);
ALTER TABLE customer_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_tags_own ON customer_tags
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE UPDATE ON customer_tags FROM pos_app;

-- What happened with a customer, newest first on their profile. Sales are read from
-- `sales` directly; these are the things that have no other home.
CREATE TABLE customer_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  kind        text NOT NULL
    CHECK (kind IN ('note', 'vip_signup', 'review', 'order', 'email', 'unsubscribed', 'follow_up')),
  summary     text NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 2000),
  -- The row this came from elsewhere (a store review or order, an email campaign).
  ref_id      text,
  staff_id    uuid,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, staff_id) REFERENCES staff (business_id, id) ON DELETE SET NULL (staff_id)
);
CREATE INDEX customer_events_customer ON customer_events (business_id, customer_id, created_at DESC);
ALTER TABLE customer_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_events FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_events_own ON customer_events
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE UPDATE ON customer_events FROM pos_app;

-- A bulk email and who it's for. The audience is rules, not a list: the server works out
-- who gets it when it sends.
CREATE TABLE email_campaigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  subject     text NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 150),
  body        text NOT NULL CHECK (length(body) <= 20000),
  -- {"kinds": ["person"], "anyTags": [ids], "allTags": [ids], "notTags": [ids]}
  audience    jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent')),
  send_at     timestamptz,
  sent_at     timestamptz,
  created_by  uuid,
  sent_by     uuid,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_campaigns_business_id_id UNIQUE (business_id, id),
  CONSTRAINT email_campaigns_scheduled CHECK (status <> 'scheduled' OR send_at IS NOT NULL),
  FOREIGN KEY (business_id, created_by) REFERENCES staff (business_id, id) ON DELETE SET NULL (created_by),
  FOREIGN KEY (business_id, sent_by) REFERENCES staff (business_id, id) ON DELETE SET NULL (sent_by)
);
CREATE INDEX email_campaigns_recent ON email_campaigns (business_id, created_at DESC);
CREATE TRIGGER email_campaigns_updated_at BEFORE UPDATE ON email_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaigns FORCE ROW LEVEL SECURITY;
CREATE POLICY email_campaigns_own ON email_campaigns
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

-- One email to one customer. Deleting the customer deletes these too, so no address
-- outlives them here (the suppression list keeps only addresses that must not be mailed).
CREATE TABLE email_sends (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  campaign_id       uuid NOT NULL,
  customer_id       uuid NOT NULL,
  to_address        text NOT NULL,
  -- In the unsubscribe link. Random, so links can't be guessed.
  unsubscribe_token text NOT NULL UNIQUE,
  status            text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'preview', 'sent', 'delivered', 'bounced', 'complained', 'failed')),
  ses_message_id    text,
  error             text,
  is_demo           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, campaign_id, customer_id),
  FOREIGN KEY (business_id, campaign_id) REFERENCES email_campaigns (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id) ON DELETE CASCADE
);
CREATE INDEX email_sends_queue ON email_sends (business_id, campaign_id) WHERE status = 'queued';
CREATE INDEX email_sends_ses ON email_sends (ses_message_id) WHERE ses_message_id IS NOT NULL;
CREATE TRIGGER email_sends_updated_at BEFORE UPDATE ON email_sends
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE email_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_sends FORCE ROW LEVEL SECURITY;
CREATE POLICY email_sends_own ON email_sends
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());

-- Addresses never to send bulk email to again: unsubscribed, bounced or marked as spam.
-- Kept by address (lower case) so it holds even if the customer is deleted and comes back.
CREATE TABLE email_suppressions (
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  email       text NOT NULL CHECK (email = lower(email)),
  reason      text NOT NULL CHECK (reason IN ('unsubscribed', 'bounced', 'complained')),
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, email)
);
ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_suppressions FORCE ROW LEVEL SECURITY;
CREATE POLICY email_suppressions_own ON email_suppressions
  USING (business_id = current_business_id())
  WITH CHECK (business_id = current_business_id());
REVOKE UPDATE ON email_suppressions FROM pos_app;

-- Who mail comes from, and the mailing address every bulk email must show (CAN-SPAM).
ALTER TABLE businesses ADD COLUMN email_from_name text
  CHECK (email_from_name IS NULL OR length(trim(email_from_name)) BETWEEN 1 AND 80);
ALTER TABLE businesses ADD COLUMN email_from_address text
  CHECK (email_from_address IS NULL OR email_from_address ~ '^[^@[:space:]]+@[^@[:space:]]+$');
ALTER TABLE businesses ADD COLUMN mailing_address text
  CHECK (mailing_address IS NULL OR length(trim(mailing_address)) BETWEEN 1 AND 200);
