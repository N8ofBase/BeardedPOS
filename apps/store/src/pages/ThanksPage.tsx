import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { bucksLabel, type OrderBucks, type OrderStatus } from "@bearded/store-core";
import { useStore } from "../api/store.ts";
import { useBuddy } from "../buddy/BuddyProvider.tsx";
import { useCart } from "../cart/CartProvider.tsx";

/** "BBG-" and the start of the order id: enough for a shopper to quote, and for staff to find it. */
export const orderNumber = (id: string) => `BBG-${id.slice(0, 8).toUpperCase()}`;

/** Square can take a moment to record the payment, so the page asks a few times before giving up. */
export const STATUS_TRIES = 5;
export const STATUS_WAIT_MS = 2000;

type Check = "checking" | OrderStatus["status"] | "unknown";

function usePaymentCheck(order: string | null): { check: Check; bucks?: OrderBucks } {
  const store = useStore();
  const [check, setCheck] = useState<Check>("checking");
  const [bucks, setBucks] = useState<OrderBucks>();
  useEffect(() => {
    if (!order) return;
    let live = true;
    let timer: number | undefined;
    const ask = async (tries: number) => {
      try {
        const { status, bucks } = await store.orderStatus(order);
        if (!live) return;
        setBucks(bucks);
        if (status !== "open" || tries <= 1) return setCheck(status);
      } catch {
        if (!live) return;
        if (tries <= 1) return setCheck("unknown");
      }
      timer = window.setTimeout(() => void ask(tries - 1), STATUS_WAIT_MS);
    };
    void ask(STATUS_TRIES);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [store, order]);
  return { check, bucks };
}

/** "You earned 33 Beard Bucks. Your balance is 73." and the birthday gift, once paid. */
function BucksNote({ bucks }: { bucks: OrderBucks }) {
  return (
    <div className="bucks-card thanks-bucks" role="status">
      <p>
        You earned <strong>{bucksLabel(bucks.earned)}</strong>.
        {bucks.balance !== undefined && ` Your balance is ${bucks.balance.toLocaleString("en-US")}.`}
      </p>
      {bucks.birthday > 0 && <p>Happy birthday! {bucksLabel(bucks.birthday)} added.</p>}
      <Link to="/account">See your Beard Bucks</Link>
    </div>
  );
}

const MESSAGES: Record<Check, string> = {
  checking: "Confirming your payment with Square…",
  paid: "Payment received. Square has emailed your receipt, and we’ll email you again when your order ships or is ready for pickup.",
  open: "Square hasn’t confirmed the payment yet. If you paid, Square’s receipt is on its way to your email; refresh this page in a minute to check again.",
  cancelled: "This order was cancelled. If that’s a surprise, email us and quote the order number.",
  unknown:
    "We couldn’t check the payment just now. If you paid, Square’s receipt is on its way to your email.",
};

/** Where Square sends shoppers after paying. */
export function ThanksPage() {
  const [params] = useSearchParams();
  const { clear } = useCart();
  const preview = params.get("preview") === "1";
  const raw = params.get("order");
  const order = raw && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
  // Offline the preview page has already marked it paid, so this only reads the Bucks it earned.
  const { check, bucks } = usePaymentCheck(order);
  const { refresh } = useBuddy();
  const paid = check === "paid";
  useEffect(() => clear(), [clear]);
  // A paid order changes the balance the header and cart show.
  useEffect(() => {
    if (paid) refresh();
  }, [paid, refresh]);
  return (
    <section className="wrap pad thanks">
      <h1>Thanks for your order!</h1>
      {order && (
        <p className="order-number">
          Order number <strong>{orderNumber(order)}</strong>
        </p>
      )}
      {preview ? (
        <p className="lede">
          This is a preview of the store, so no payment was taken. Once Square is connected, Square emails
          your receipt here.
        </p>
      ) : order ? (
        <p className="lede" role="status">
          {MESSAGES[check]}
        </p>
      ) : (
        <p className="lede">
          Square has emailed your receipt. We’ll email you again when your order ships or is ready for pickup.
        </p>
      )}
      {paid && bucks && <BucksNote bucks={bucks} />}
      <Link className="btn go" to="/#games">
        Back to the games
      </Link>
    </section>
  );
}
