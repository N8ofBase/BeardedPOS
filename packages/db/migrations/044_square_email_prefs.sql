-- What Square last said about a customer's marketing email: true = not unsubscribed there, false =
-- unsubscribed there, null = not checked yet. The first time a Square customer is checked and Square
-- hasn't unsubscribed them, the register marks them OK to email (owner's choice, 2026-11-24); after
-- that only an unsubscribe in Square changes it, so a choice made in the register sticks.
ALTER TABLE customers ADD COLUMN square_email_ok boolean;
