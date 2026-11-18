// The live register's card payments in the Square POS app: what the screens do around the hand-off.
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardHandoff, CheckoutResult, PaymentResult } from "@bearded/api";
import { PaymentPanel } from "../src/pages/register/PaymentPanel.tsx";
import { SquareReturn } from "../src/pages/register/SquareReturn.tsx";
import { renderAs } from "./render.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

const sale: CheckoutResult = {
  saleId: "s1",
  receiptNumber: 1042,
  subtotalCents: 2500,
  discountCents: 0,
  taxCents: 175,
  totalCents: 2675,
  cashOnly: false,
  paid: false,
};
const handoff: CardHandoff = {
  applicationId: "sq0idp-abc",
  callbackUrl: "https://bbg-live.prismcortex.net/register/square-return",
  state: "pos_1",
  amountCents: 2675,
  currency: "USD",
  note: "Receipt #1042",
};
const live = { cardReader: "square-pos" as const };
const paid: PaymentResult = {
  saleId: "s1",
  paymentId: "p1",
  status: "completed",
  changeCents: 0,
  paidCents: 2675,
  remainingCents: 0,
  paid: true,
};

describe("card payments through the Square POS app", () => {
  it("on a laptop, says to use the phone or tablet with the Square app", () => {
    renderAs(
      "cashier",
      <PaymentPanel sale={sale} mode="card" onPaid={vi.fn()} onCanceled={vi.fn()} />,
      {},
      "/",
      live,
    );
    expect(screen.getByText(/Cards are taken in the Square POS app/)).toBeTruthy();
    expect(screen.queryByText(/to the card reader/)).toBeNull();
  });

  it("while the card waits in Square, Find it in Square can finish the sale", async () => {
    const onPaid = vi.fn();
    const { call } = renderAs(
      "cashier",
      <PaymentPanel
        sale={sale}
        mode="card"
        onPaid={onPaid}
        onCanceled={vi.fn()}
        pendingCard={{ paymentId: "p1", amountCents: 2675, handoff }}
        message="Square didn't send an answer back. Tap Find it in Square."
      />,
      { findCardHandoff: paid },
      "/",
      live,
    );
    expect(screen.getByText("Waiting for the Square app")).toBeTruthy();
    expect(screen.getByText(/didn't send an answer back/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open the Square app again" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Find it in Square" }));
    await waitFor(() => expect(onPaid).toHaveBeenCalledWith("s1", 0));
    expect(call).toHaveBeenCalledWith("findCardHandoff", { paymentId: "p1" });
  });

  it("the return page hands Square's answer to the server to check", async () => {
    const data = encodeURIComponent(JSON.stringify({ status: "ok", transaction_id: "T1", state: "pos_1" }));
    const { call } = renderAs(
      "cashier",
      <SquareReturn />,
      { finishCardHandoff: paid },
      `/square-return?data=${data}`,
      live,
    );
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("finishCardHandoff", { state: "pos_1", transactionId: "T1" }),
    );
  });

  it("the return page without an answer from Square offers the way back", () => {
    renderAs("cashier", <SquareReturn />, {}, "/square-return", live);
    expect(screen.getByText("This page is for answers from the Square app.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to the register" })).toBeTruthy();
  });
});
