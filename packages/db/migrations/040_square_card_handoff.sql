-- Card payments on the live register go through the Square POS app. handoff_ref is our one-time
-- reference for the hand-off, which Square's app hands back; once Square confirms the payment,
-- provider_ref holds Square's payment id, used for refunds. One Square payment can pay for only
-- one register payment.
ALTER TABLE payments ADD COLUMN handoff_ref text;
CREATE UNIQUE INDEX payments_handoff_ref ON payments (business_id, handoff_ref)
  WHERE handoff_ref IS NOT NULL;
CREATE UNIQUE INDEX payments_provider_ref ON payments (business_id, provider_ref)
  WHERE provider_ref IS NOT NULL;
