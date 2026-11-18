import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { cashSuggestions, changeDue, formatMoney, parseMoney } from "@bearded/core";
import type { CardHandoff, CheckoutResult, PaymentResult } from "@bearded/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { useToast } from "../../ui/Toast.tsx";
import { TwoTapButton } from "../../ui/TwoTapButton.tsx";
import { openSquarePos, rememberHandoff, thisDevice } from "./squareHandoff.ts";

export type PayMode = "cash" | "card" | "split";

/** A card payment waiting on the reader; `handoff` when it's waiting in the Square POS app. */
export interface PendingCard {
  paymentId: string;
  amountCents: number;
  handoff?: CardHandoff;
}

/** Taking payment for an open sale: cash with change, the card reader, or both. */
export function PaymentPanel({
  sale,
  mode: initialMode,
  onPaid,
  onCanceled,
  pendingCard: initialPending = null,
  message = null,
}: {
  sale: CheckoutResult;
  mode: PayMode;
  onPaid: (saleId: string, changeCents: number) => void;
  onCanceled: () => void;
  /** Picked up again after the Square app: the card still waiting there, if any. */
  pendingCard?: PendingCard | null;
  /** What happened in the Square app, to show at the top. */
  message?: string | null;
}) {
  const { api, me } = useSession();
  const toast = useToast();
  const [mode, setMode] = useState<PayMode>(initialMode);
  const [paidCents, setPaidCents] = useState(sale.paidCents ?? 0);
  const [pendingCard, setPendingCard] = useState<PendingCard | null>(initialPending);
  const [declined, setDeclined] = useState<string | null>(message);
  const handoff = me.cardReader === "square-pos";

  // The live register: leave for the Square POS app as soon as the payment is started.
  const started = (p: PendingCard) => {
    setDeclined(null);
    setPendingCard(p);
    if (p.handoff && !openSquarePos({ saleId: sale.saleId, ...p, handoff: p.handoff }))
      setDeclined("This device can't open the Square POS app. Use the phone or tablet that has it.");
  };
  const remaining = sale.totalCents - paidCents;

  const after = (r: PaymentResult) => {
    setPaidCents(r.paidCents);
    if (r.paid) onPaid(sale.saleId, r.changeCents);
  };

  const cancel = useMutation({
    mutationFn: () => api.call("cancelSale", { saleId: sale.saleId, reason: "Canceled at the register" }),
    onSuccess: (r) => {
      if (r.refundedCents) toast(`Sale canceled · hand back ${formatMoney(r.refundedCents)}`);
      onCanceled();
    },
    onError: (err) => toast(errorMessage(err)),
  });

  return (
    <div className="pay-panel" style={{ display: "grid", gap: 12 }}>
      <div className="totals">
        <div>
          <span>Receipt</span>
          <span className="num">#{sale.receiptNumber}</span>
        </div>
        <div className="grand">
          <span>Total</span>
          <span className="num">{formatMoney(sale.totalCents)}</span>
        </div>
        {paidCents > 0 && (
          <>
            <div>
              <span>Paid</span>
              <span className="num">{formatMoney(paidCents)}</span>
            </div>
            <div>
              <b>Left to pay</b>
              <b className="num">{formatMoney(remaining)}</b>
            </div>
          </>
        )}
      </div>

      {declined && <p className="error-box">{declined}</p>}

      {pendingCard && handoff ? (
        <HandoffPanel
          saleId={sale.saleId}
          card={pendingCard}
          onResult={(r) => {
            if (r.status === "pending") return setDeclined(r.message ?? null);
            setPendingCard(null);
            rememberHandoff(null);
            setDeclined(r.status === "completed" ? null : (r.message ?? "The card payment was canceled."));
            after(r);
          }}
        />
      ) : pendingCard ? (
        <TerminalPanel
          amountCents={pendingCard.amountCents}
          paymentId={pendingCard.paymentId}
          onResult={(r) => {
            setPendingCard(null);
            if (r.status === "declined") setDeclined("Card declined. Try another card or take cash.");
            else if (r.status === "canceled") setDeclined("The customer canceled on the card reader.");
            else setDeclined(null);
            after(r);
          }}
        />
      ) : mode === "cash" ? (
        <CashForm saleId={sale.saleId} amountCents={remaining} fixedAmount onDone={after} />
      ) : mode === "card" ? (
        <CardStart
          saleId={sale.saleId}
          amountCents={remaining}
          cashOnly={sale.cashOnly}
          onStarted={started}
        />
      ) : (
        <SplitForm
          saleId={sale.saleId}
          remainingCents={remaining}
          cashOnly={sale.cashOnly}
          onCash={after}
          onCard={started}
        />
      )}

      {!pendingCard && (
        <div className="actions">
          {mode !== "cash" && (
            <button type="button" onClick={() => setMode("cash")}>
              Pay cash instead
            </button>
          )}
          {mode !== "card" && !sale.cashOnly && (
            <button type="button" onClick={() => setMode("card")}>
              {paidCents ? "Rest by card" : "Pay by card instead"}
            </button>
          )}
          {mode !== "split" && !sale.cashOnly && paidCents === 0 && (
            <button type="button" onClick={() => setMode("split")}>
              Split cash and card
            </button>
          )}
          <span style={{ marginLeft: "auto" }}>
            {paidCents > 0 ? (
              <TwoTapButton
                className="danger"
                label="Cancel sale"
                confirmLabel={`Tap again: hand back ${formatMoney(paidCents)}`}
                onConfirm={() => cancel.mutate()}
              />
            ) : (
              <button type="button" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                Back to ticket
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function CashForm({
  saleId,
  amountCents,
  fixedAmount,
  onDone,
}: {
  saleId: string;
  amountCents: number;
  fixedAmount: boolean;
  onDone: (r: PaymentResult) => void;
}) {
  const { api } = useSession();
  const toast = useToast();
  const [tendered, setTendered] = useState("");
  const tenderedCents = tendered.trim() ? parseMoney(tendered) : amountCents;
  const change = tenderedCents === null ? null : changeDue(amountCents, tenderedCents);

  const pay = useMutation({
    mutationFn: (t: number) => api.call("payCash", { saleId, amountCents, tenderedCents: t }),
    onSuccess: onDone,
    onError: (err) => toast(errorMessage(err)),
  });

  return (
    <form
      style={{ display: "grid", gap: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (tenderedCents !== null && change !== null) pay.mutate(tenderedCents);
      }}
    >
      <b>{fixedAmount ? "Cash" : `Cash ${formatMoney(amountCents)}`}</b>
      <div className="actions">
        {cashSuggestions(amountCents).map((c) => (
          <button key={c} type="button" onClick={() => pay.mutate(c)} disabled={pay.isPending}>
            {c === amountCents ? `Exact ${formatMoney(c)}` : formatMoney(c)}
          </button>
        ))}
      </div>
      <label>
        Cash received ($)
        <input
          value={tendered}
          onChange={(e) => setTendered(e.target.value)}
          inputMode="decimal"
          placeholder={formatMoney(amountCents).slice(1)}
        />
      </label>
      {tenderedCents === null ? (
        <span className="field-error">Enter an amount like 20.00.</span>
      ) : change === null ? (
        <span className="field-error">That's less than {formatMoney(amountCents)}.</span>
      ) : (
        <p className="change-due">
          Change due <b className="num">{formatMoney(change)}</b>
        </p>
      )}
      <div>
        <button className="primary big" disabled={change === null || pay.isPending}>
          Complete cash payment
        </button>
      </div>
    </form>
  );
}

function CardStart({
  saleId,
  amountCents,
  cashOnly,
  onStarted,
}: {
  saleId: string;
  amountCents: number;
  cashOnly: boolean;
  onStarted: (p: PendingCard) => void;
}) {
  const { api } = useSession();
  const toast = useToast();
  const start = useMutation({
    mutationFn: () => api.call("startCardPayment", { saleId, amountCents }),
    onSuccess: (r) => onStarted({ paymentId: r.paymentId, amountCents, handoff: r.handoff }),
    onError: (err) => toast(errorMessage(err)),
  });
  const { me } = useSession();
  if (cashOnly)
    return (
      <p className="error-box">
        This sale has a cash-only discount. Take cash, or go back and remove the discount.
      </p>
    );
  if (me.cardReader === "square-pos" && thisDevice() === "other")
    return (
      <p className="error-box">
        Cards are taken in the Square POS app. Ring this sale up on the phone or tablet that has the Square
        app and the card reader, or take cash.
      </p>
    );
  return (
    <div>
      <button type="button" className="primary big" disabled={start.isPending} onClick={() => start.mutate()}>
        {me.cardReader === "square-pos"
          ? `Charge ${formatMoney(amountCents)} in the Square app`
          : `Send ${formatMoney(amountCents)} to the card reader`}
      </button>
    </div>
  );
}

function SplitForm({
  saleId,
  remainingCents,
  cashOnly,
  onCash,
  onCard,
}: {
  saleId: string;
  remainingCents: number;
  cashOnly: boolean;
  onCash: (r: PaymentResult) => void;
  onCard: (p: PendingCard) => void;
}) {
  const [cash, setCash] = useState("");
  const cashCents = cash.trim() ? parseMoney(cash) : null;
  const valid = cashCents !== null && cashCents > 0 && cashCents < remainingCents;

  if (cashOnly)
    return <p className="error-box">This sale has a cash-only discount, so it can't be split with a card.</p>;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <label>
        How much in cash? ($)
        <input value={cash} onChange={(e) => setCash(e.target.value)} inputMode="decimal" autoFocus />
      </label>
      {cash.trim() && !valid && (
        <span className="field-error">Enter an amount less than {formatMoney(remainingCents)}.</span>
      )}
      {valid && (
        <>
          <p className="muted">
            The rest, {formatMoney(remainingCents - cashCents!)}, goes on the card next.
          </p>
          <CashForm saleId={saleId} amountCents={cashCents!} fixedAmount={false} onDone={onCash} />
        </>
      )}
      {!cash.trim() && <CardStartSmall saleId={saleId} remainingCents={remainingCents} onStarted={onCard} />}
    </div>
  );
}

function CardStartSmall({
  saleId,
  remainingCents,
  onStarted,
}: {
  saleId: string;
  remainingCents: number;
  onStarted: (p: PendingCard) => void;
}) {
  const [amount, setAmount] = useState("");
  const cents = amount.trim() ? parseMoney(amount) : null;
  const { api } = useSession();
  const toast = useToast();
  const start = useMutation({
    mutationFn: (c: number) => api.call("startCardPayment", { saleId, amountCents: c }),
    onSuccess: (r, c) => onStarted({ paymentId: r.paymentId, amountCents: c, handoff: r.handoff }),
    onError: (err) => toast(errorMessage(err)),
  });
  const ok = cents !== null && cents > 0 && cents < remainingCents;
  return (
    <details>
      <summary className="small">Card first instead</summary>
      <div className="actions" style={{ marginTop: 8 }}>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          aria-label="Card amount"
          placeholder="Card amount"
        />
        <button type="button" disabled={!ok || start.isPending} onClick={() => start.mutate(cents!)}>
          Charge card
        </button>
      </div>
    </details>
  );
}

/**
 * Demo only: stands in for the Square Terminal. The person giving the demo picks
 * what the customer's card does. The real reader replaces this in hosted mode.
 */
function TerminalPanel({
  amountCents,
  paymentId,
  onResult,
}: {
  amountCents: number;
  paymentId: string;
  onResult: (r: PaymentResult) => void;
}) {
  const { api } = useSession();
  const toast = useToast();
  const answer = useMutation({
    mutationFn: (outcome: "approved" | "declined" | "canceled") =>
      api.call("simulateTerminalResult", { paymentId, outcome }),
    onSuccess: onResult,
    onError: (err) => toast(errorMessage(err)),
  });
  return (
    <section className="terminal" aria-label="Square Terminal (simulated)">
      <span className="tag low">Demo only</span>
      <b>Square Terminal (simulated)</b>
      <span className="terminal-amount num">{formatMoney(amountCents)}</span>
      <span className="muted">Waiting for the customer to tap, insert or swipe…</span>
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={answer.isPending}
          onClick={() => answer.mutate("approved")}
        >
          Approve
        </button>
        <button type="button" disabled={answer.isPending} onClick={() => answer.mutate("declined")}>
          Decline
        </button>
        <button type="button" disabled={answer.isPending} onClick={() => answer.mutate("canceled")}>
          Customer canceled
        </button>
      </div>
    </section>
  );
}

/**
 * The live register while a card payment is in the Square POS app. Normally Square's app comes
 * straight back to the return page; these buttons cover the times it doesn't.
 */
function HandoffPanel({
  saleId,
  card,
  onResult,
}: {
  saleId: string;
  card: PendingCard;
  onResult: (r: PaymentResult) => void;
}) {
  const { api } = useSession();
  const toast = useToast();
  const find = useMutation({
    mutationFn: () => api.call("findCardHandoff", { paymentId: card.paymentId }),
    onSuccess: onResult,
    onError: (err) => toast(errorMessage(err)),
  });
  const cancel = useMutation({
    mutationFn: () => api.call("cancelCardHandoff", { paymentId: card.paymentId }),
    onSuccess: onResult,
    onError: (err) => toast(errorMessage(err)),
  });
  const busy = find.isPending || cancel.isPending;
  return (
    <section className="terminal" aria-label="Square POS app">
      <b>Waiting for the Square app</b>
      <span className="terminal-amount num">{formatMoney(card.amountCents)}</span>
      <span className="muted">
        Take the card in the Square POS app. It comes back here when the customer has paid.
      </span>
      <div className="actions">
        {card.handoff && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => openSquarePos({ saleId, ...card, handoff: card.handoff! })}
          >
            Open the Square app again
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => find.mutate()}>
          Find it in Square
        </button>
        <TwoTapButton
          label="Cancel card payment"
          confirmLabel="Tap again: the customer didn't pay"
          onConfirm={() => cancel.mutate()}
        />
      </div>
    </section>
  );
}
