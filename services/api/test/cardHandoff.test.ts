// The live register's card payments: the Square POS app hand-off. A fake reader stands in for
// Square; what's tested is that only a payment Square confirmed counts, and that one Square
// payment can't pay for two sales.
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError, type Ctx } from "@bearded/core";
import { ensureDemo, listDemoStaff, withBusiness, type DB } from "@bearded/db";
import { createTestDb } from "@bearded/db/test-db";
import {
  handoffRef,
  setTerminal,
  SimulatedTerminal,
  type PaymentTerminal,
  type TerminalCharge,
} from "../src/payments/terminal.ts";
import { invoke } from "../src/registry.ts";

/** Square, as far as these tests need: transaction id → its card payment id and amount. */
class FakeSquarePos implements PaymentTerminal {
  readonly name = "Square POS app";
  readonly kind = "square-pos";
  readonly paid = new Map<string, { paymentRef: string; amountCents: number; at: Date }>();
  readonly refunds: { paymentRef: string; amountCents: number }[] = [];

  async charge(amountCents: number, _saleId: string, note: string): Promise<TerminalCharge> {
    const state = handoffRef();
    return {
      providerRef: state,
      handoff: {
        applicationId: "sq0idp-test",
        callbackUrl: "https://bbg-live.example/register/square-return",
        state,
        amountCents,
        currency: "USD",
        note,
      },
    };
  }
  async confirm(transactionId: string, amountCents: number, since: Date) {
    const t = this.paid.get(transactionId);
    if (!t) throw new AppError("not_found", "Square doesn't know that transaction yet.");
    if (t.amountCents !== amountCents) throw new AppError("invalid", "Square took a different amount.");
    if (t.at < since) throw new AppError("invalid", "That Square payment is older than this sale.");
    return { paymentRef: t.paymentRef };
  }
  async find(amountCents: number, since: Date) {
    return [...this.paid.entries()]
      .filter(([, t]) => t.amountCents === amountCents && t.at >= since)
      .reverse()
      .map(([id]) => id);
  }
  async refund(paymentRef: string, amountCents: number) {
    this.refunds.push({ paymentRef, amountCents });
    return { refundRef: `refund_${this.refunds.length}` };
  }
  /** The customer pays in the Square app. */
  pay(transactionId: string, amountCents: number, paymentRef = `pay_${transactionId}`) {
    this.paid.set(transactionId, { paymentRef, amountCents, at: new Date() });
  }
}

let db: Kysely<DB>;
let businessId: string;
let cashier: Ctx;
let owner: Ctx;
let square: FakeSquarePos;
let productId: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  businessId = await ensureDemo(db);
  const staff = await listDemoStaff(db);
  const ctx = (role: Ctx["role"]): Ctx => ({
    businessId,
    role,
    staffId: staff.find((s) => s.role === role)!.id,
  });
  cashier = ctx("cashier");
  owner = ctx("owner");
  productId = (await invoke(db, owner, "listProducts", {})).find((p) => p.sku === "0003")!.id;
  square = new FakeSquarePos();
  setTerminal(square);
});

afterEach(() => setTerminal(new SimulatedTerminal()));

async function startCard() {
  const sale = await invoke(db, cashier, "startCheckout", {
    customerId: null,
    lines: [{ key: "1", productId, qty: 1 }],
    discounts: [],
  });
  const card = await invoke(db, cashier, "startCardPayment", {
    saleId: sale.saleId,
    amountCents: sale.totalCents,
  });
  return { sale, card };
}

const payment = (id: string) =>
  withBusiness(db, businessId, (trx) =>
    trx.selectFrom("payments").selectAll().where("id", "=", id).executeTakeFirstOrThrow(),
  );

describe("the Square POS app hand-off", () => {
  it("hands the screen what it needs to open the Square app, and says so in me", async () => {
    const { sale, card } = await startCard();
    expect(card.status).toBe("pending");
    expect(card.handoff).toMatchObject({
      applicationId: "sq0idp-test",
      amountCents: sale.totalCents,
      currency: "USD",
      note: `Receipt #${sale.receiptNumber}`,
    });
    expect((await payment(card.paymentId)).handoff_ref).toBe(card.handoff!.state);
    expect((await invoke(db, cashier, "me", undefined)).cardReader).toBe("square-pos");
  });

  it("pays the sale only once Square confirms the transaction, and keeps Square's payment id", async () => {
    const { sale, card } = await startCard();
    square.pay("T1", sale.totalCents, "PAY1");
    const r = await invoke(db, cashier, "finishCardHandoff", {
      state: card.handoff!.state,
      transactionId: "T1",
    });
    expect(r).toMatchObject({ status: "completed", paid: true, saleId: sale.saleId, remainingCents: 0 });
    const p = await payment(card.paymentId);
    expect(p.status).toBe("completed");
    expect(p.provider_ref).toBe("PAY1");
    // Coming back to the return page again (a reload) just shows the answer.
    const again = await invoke(db, cashier, "finishCardHandoff", {
      state: card.handoff!.state,
      transactionId: "T1",
    });
    expect(again).toMatchObject({ status: "completed", paid: true });
  });

  it("refuses a transaction Square doesn't confirm, and leaves the payment waiting", async () => {
    const { sale, card } = await startCard();
    square.pay("T1", sale.totalCents - 100);
    await expect(
      invoke(db, cashier, "finishCardHandoff", { state: card.handoff!.state, transactionId: "T1" }),
    ).rejects.toThrow("different amount");
    await expect(
      invoke(db, cashier, "finishCardHandoff", { state: card.handoff!.state, transactionId: "nope" }),
    ).rejects.toThrow("doesn't know");
    expect((await payment(card.paymentId)).status).toBe("pending");
  });

  it("won't let one Square payment pay for two sales", async () => {
    const a = await startCard();
    const b = await startCard();
    square.pay("T1", a.sale.totalCents);
    await invoke(db, cashier, "finishCardHandoff", { state: a.card.handoff!.state, transactionId: "T1" });
    await expect(
      invoke(db, cashier, "finishCardHandoff", { state: b.card.handoff!.state, transactionId: "T1" }),
    ).rejects.toThrow("already on another sale");
    expect((await payment(b.card.paymentId)).status).toBe("pending");
  });

  it("ignores answers that don't name one of this register's payments", async () => {
    await expect(
      invoke(db, cashier, "finishCardHandoff", { state: "sim_x", transactionId: "T1" }),
    ).rejects.toThrow("didn't name");
    await expect(
      invoke(db, cashier, "finishCardHandoff", { state: handoffRef(), transactionId: "T1" }),
    ).rejects.toThrow("doesn't exist");
  });

  it("a canceled payment in the Square app leaves the sale open to try again", async () => {
    const { sale, card } = await startCard();
    const r = await invoke(db, cashier, "finishCardHandoff", {
      state: card.handoff!.state,
      errorCode: "payment_canceled",
    });
    expect(r).toMatchObject({ status: "canceled", paid: false });
    expect(r.message).toContain("canceled in the Square app");
    const retry = await invoke(db, cashier, "startCardPayment", {
      saleId: sale.saleId,
      amountCents: sale.totalCents,
    });
    expect(retry.status).toBe("pending");
  });

  it("an answer with no transaction id keeps waiting, and Find it in Square picks the payment up", async () => {
    const { sale, card } = await startCard();
    const r = await invoke(db, cashier, "finishCardHandoff", { state: card.handoff!.state });
    expect(r.status).toBe("pending");
    expect(r.message).toContain("Find it in Square");

    const none = await invoke(db, cashier, "findCardHandoff", { paymentId: card.paymentId });
    expect(none.status).toBe("pending");
    expect(none.message).toContain("no card payment");

    square.pay("T9", sale.totalCents, "PAY9");
    const found = await invoke(db, cashier, "findCardHandoff", { paymentId: card.paymentId });
    expect(found).toMatchObject({ status: "completed", paid: true });
    expect((await payment(card.paymentId)).provider_ref).toBe("PAY9");
  });

  it("Find it in Square skips a payment that's already on another sale", async () => {
    const a = await startCard();
    const b = await startCard();
    square.pay("T1", a.sale.totalCents);
    await invoke(db, cashier, "finishCardHandoff", { state: a.card.handoff!.state, transactionId: "T1" });
    const r = await invoke(db, cashier, "findCardHandoff", { paymentId: b.card.paymentId });
    expect(r.status).toBe("pending");
  });

  it("cancel card payment frees the sale for cash", async () => {
    const { sale, card } = await startCard();
    const r = await invoke(db, cashier, "cancelCardHandoff", { paymentId: card.paymentId });
    expect(r.status).toBe("canceled");
    const cash = await invoke(db, cashier, "payCash", {
      saleId: sale.saleId,
      amountCents: sale.totalCents,
      tenderedCents: sale.totalCents,
    });
    expect(cash.paid).toBe(true);
  });

  it("turns the pretend reader off", async () => {
    const { card } = await startCard();
    await expect(
      invoke(db, cashier, "simulateTerminalResult", { paymentId: card.paymentId, outcome: "approved" }),
    ).rejects.toThrow("pretend reader is off");
  });

  it("picks an open sale back up with what's paid and the card still waiting", async () => {
    const { sale, card } = await startCard();
    const again = await invoke(db, cashier, "saleForPayment", { saleId: sale.saleId });
    expect(again).toMatchObject({
      saleId: sale.saleId,
      receiptNumber: sale.receiptNumber,
      totalCents: sale.totalCents,
      paidCents: 0,
      paid: false,
      pendingCard: { paymentId: card.paymentId, amountCents: sale.totalCents },
    });
  });

  it("refunds through Square with Square's payment id", async () => {
    const { sale, card } = await startCard();
    square.pay("T1", sale.totalCents, "PAY1");
    await invoke(db, cashier, "finishCardHandoff", { state: card.handoff!.state, transactionId: "T1" });
    const [line] = (await invoke(db, owner, "getSale", { id: sale.saleId })).lines;
    await invoke(db, owner, "refundSale", {
      saleId: sale.saleId,
      lines: [{ saleLineId: line!.id, qty: 1 }],
      restock: true,
      reason: "changed_mind",
    });
    expect(square.refunds).toEqual([{ paymentRef: "PAY1", amountCents: sale.totalCents }]);
  });
});
