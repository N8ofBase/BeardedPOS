-- Ship it or pick up in St. Louis, chosen in the cart. Shipped orders have Square ask for the address
-- on its payment page; Square keeps the address, not us. Orders from before this were never asked.
ALTER TABLE store_orders
  ADD COLUMN delivery text CHECK (delivery IN ('ship', 'pickup'));
