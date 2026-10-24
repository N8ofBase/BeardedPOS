import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Receipt, RefundInput, RefundPlan, SentReceipt } from "@bearded/api";
import { dayRange, refundTag } from "../src/pages/SalesPage.tsx";
import { DEMO_SEND_NOTE, ReceiptSend } from "../src/pages/sales/ReceiptSend.tsx";
import { RefundPanel } from "../src/pages/sales/RefundPanel.tsx";
import { renderAs } from "./render.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A fake preview: $10.00 a unit plus 70¢ tax, cash back; over $50 a manager needs the owner. */
const preview =
  (role: "owner" | "manager") =>
  (input: RefundInput): RefundPlan => {
    const units = input.lines.reduce((s, l) => s + l.qty, 0);
    const total = units * 1070;
    return {
      saleId: "s1",
      receiptNumber: 1001,
      refundable: [
        { saleLineId: "a", name: "Chew toy", qty: 3, refundedQty: 1, lineTotalCents: 3000 },
        { saleLineId: "b", name: "Strategy game", qty: 6, refundedQty: 0, lineTotalCents: 6000 },
      ],
      lines: [],
      amountCents: units * 1000,
      taxCents: units * 70,
      totalCents: total,
      payments: total ? [{ paymentId: "p", method: "cash", amountCents: total }] : [],
      label: `Hand back $${(total / 100).toFixed(2)} cash`,
      restock: input.restock,
      needsApproval: role === "manager" && total > 5000,
      limitCents: 5000,
    };
  };

const staff = [
  { id: "o1", name: "Olive Owner", role: "owner", active: true },
  { id: "m1", name: "Max Manager", role: "manager", active: true },
];

describe("refund panel", () => {
  it("steps up to what's left on each line, and shows the breakdown", async () => {
    renderAs("owner", <RefundPanel saleId="s1" onDone={() => {}} />, { refundPreview: preview("owner") });
    const more = await screen.findByRole("button", { name: "Refund more Chew toy" });
    expect(screen.getByLabelText("Chew toy to refund").textContent).toBe("0 of 2");
    fireEvent.click(more);
    fireEvent.click(more);
    expect(screen.getByLabelText("Chew toy to refund").textContent).toBe("2 of 2");
    expect((more as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(screen.getByLabelText("Refund breakdown").textContent).toContain("$21.40"));
    expect(screen.getByText("Hand back $21.40 cash")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refund $21.40" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Refund everything" }));
    expect(screen.getByLabelText("Strategy game to refund").textContent).toBe("6 of 6");
  });

  it("asks a manager for the owner's OK only when over the limit", async () => {
    renderAs("manager", <RefundPanel saleId="s1" onDone={() => {}} />, {
      refundPreview: preview("manager"),
      listStaff: staff,
    });
    const more = await screen.findByRole("button", { name: "Refund more Strategy game" });
    fireEvent.click(more);
    await waitFor(() => expect(screen.getByRole("button", { name: "Refund $10.70" })).toBeTruthy());
    expect(screen.queryByText(/the owner approves/)).toBeNull();

    for (let i = 0; i < 4; i++) fireEvent.click(more);
    await screen.findByText(/Over the \$50\.00 limit for managers/);
    expect(await screen.findByLabelText("Olive Owner approves this refund")).toBeTruthy();
    expect(screen.queryByLabelText("Max Manager approves this refund")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Changed mind" }));
    const go = screen.getByRole("button", { name: "Refund $53.50" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Olive Owner approves this refund"));
    expect(go.disabled).toBe(false);
  });

  it("unticks restock for damaged goods", async () => {
    renderAs("owner", <RefundPanel saleId="s1" onDone={() => {}} />, { refundPreview: preview("owner") });
    const box = (await screen.findByLabelText("Put the items back in stock")) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Damaged" }));
    expect(box.checked).toBe(false);
  });
});

const receipt = {
  id: "s1",
  receiptNumber: 1001,
  status: "paid",
  customer: { id: "c1", name: "Pat", email: "pat@example.com", phone: "2125550100" },
} as Receipt;

describe("receipt sending", () => {
  it("fills in the customer's email and shows exactly what would go", async () => {
    const sent: SentReceipt = {
      id: "o1",
      channel: "email",
      to: "pat@example.com",
      subject: "Your receipt from Sample Game Shop (DEMO) (#1001)",
      body: "Sample Game Shop (DEMO)\nTOTAL   $13.90",
      status: "preview",
    };
    const { call } = renderAs("cashier", <ReceiptSend receipt={receipt} />, { sendReceipt: sent });
    fireEvent.click(screen.getByRole("button", { name: "Email receipt" }));
    expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe("pat@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send email" }));
    await screen.findByText("Email to pat@example.com");
    expect(call).toHaveBeenCalledWith("sendReceipt", {
      saleId: "s1",
      channel: "email",
      to: "pat@example.com",
    });
    expect(screen.getByText(/Your receipt from Sample Game Shop/)).toBeTruthy();
    expect(screen.getByText(DEMO_SEND_NOTE)).toBeTruthy();
  });

  it("fills in the phone for a text", () => {
    renderAs("cashier", <ReceiptSend receipt={receipt} />);
    fireEvent.click(screen.getByRole("button", { name: "Text receipt" }));
    expect((screen.getByLabelText("Mobile number") as HTMLInputElement).value).toBe("(212) 555-0100");
  });
});

describe("sales list helpers", () => {
  it("tags refunded sales and covers a local day", () => {
    expect(refundTag({ refundedCents: 0, totalCents: 1000 })).toBeNull();
    expect(refundTag({ refundedCents: 1299, totalCents: 4000 })).toBe("Refunded $12.99");
    expect(refundTag({ refundedCents: 4000, totalCents: 4000 })).toBe("Fully refunded");
    const r = dayRange("2026-10-19");
    expect(new Date(r.from).getDate()).toBe(19);
    expect(new Date(r.to).getTime() - new Date(r.from).getTime()).toBeGreaterThanOrEqual(23 * 3600_000);
  });
});
