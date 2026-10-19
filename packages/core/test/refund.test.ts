import { describe, expect, it } from "vitest";
import {
  astroEntryLines,
  receiptEmail,
  receiptSms,
  receiptText,
  refundLine,
  refundSplitLabel,
  splitRefund,
  taxShares,
  type ReceiptData,
  type RefundableLine,
} from "../src/index.ts";

const line = (over: Partial<RefundableLine> = {}): RefundableLine => ({
  id: "l1",
  name: "Chew toy",
  qty: 3,
  lineTotalCents: 1000,
  taxCents: 89,
  rewardUnits: 0,
  refundedQty: 0,
  refundedCents: 0,
  refundedTaxCents: 0,
  ...over,
});

/** Refunds a line in the given goes, carrying the running totals forward. */
function inGoes(l: RefundableLine, goes: number[]) {
  const out = [];
  let cur = l;
  for (const q of goes) {
    const r = refundLine(cur, q);
    out.push(r);
    cur = {
      ...cur,
      refundedQty: cur.refundedQty + q,
      refundedCents: cur.refundedCents + r.amountCents,
      refundedTaxCents: cur.refundedTaxCents + r.taxCents,
    };
  }
  return out;
}

describe("refundLine", () => {
  it("refunds 1 of 3, then 2 of 3, adding up exactly", () => {
    const [a, b] = inGoes(line(), [1, 2]);
    expect(a).toMatchObject({ amountCents: 333, taxCents: 29 });
    expect(b).toMatchObject({ amountCents: 667, taxCents: 60 });
    expect(a!.amountCents + b!.amountCents).toBe(1000);
    expect(a!.taxCents + b!.taxCents).toBe(89);
  });

  it("refunds one unit at a time to the exact total", () => {
    const goes = inGoes(line({ qty: 7, lineTotalCents: 1001, taxCents: 97 }), [1, 1, 1, 1, 1, 1, 1]);
    expect(goes.reduce((s, g) => s + g.amountCents, 0)).toBe(1001);
    expect(goes.reduce((s, g) => s + g.taxCents, 0)).toBe(97);
  });

  it("refunds everything at once", () => {
    expect(refundLine(line(), 3)).toMatchObject({ amountCents: 1000, taxCents: 89, paidUnits: 3 });
  });

  it("refunds paid units first, then the free reward unit for $0", () => {
    const l = line({ qty: 2, lineTotalCents: 3899, taxCents: 346, rewardUnits: 1 });
    const [paid, free] = inGoes(l, [1, 1]);
    expect(paid).toMatchObject({ amountCents: 3899, taxCents: 346, paidUnits: 1, rewardUnits: 0 });
    expect(free).toMatchObject({ amountCents: 0, taxCents: 0, paidUnits: 0, rewardUnits: 1 });
  });

  it("refunds a fully free line for $0", () => {
    expect(refundLine(line({ qty: 1, lineTotalCents: 0, taxCents: 0, rewardUnits: 1 }), 1)).toMatchObject({
      amountCents: 0,
      rewardUnits: 1,
    });
  });

  it("refuses more than is left", () => {
    expect(() => refundLine(line({ refundedQty: 2 }), 2)).toThrow("you can refund 1 to 1");
    expect(() => refundLine(line({ refundedQty: 3 }), 1)).toThrow("already been refunded in full");
    expect(() => refundLine(line(), 0)).toThrow();
  });
});

describe("taxShares", () => {
  it("adds up to the sale's tax, skipping exempt lines", () => {
    const shares = taxShares(178, [
      { lineTotalCents: 1000, taxClass: "standard" },
      { lineTotalCents: 500, taxClass: "exempt" },
      { lineTotalCents: 1000, taxClass: "standard" },
    ]);
    expect(shares).toEqual([89, 0, 89]);
    expect(
      taxShares(100, [
        { lineTotalCents: 333, taxClass: "standard" },
        { lineTotalCents: 667, taxClass: "standard" },
      ]).reduce((a, b) => a + b),
    ).toBe(100);
  });
});

describe("splitRefund", () => {
  const pays = [
    { id: "cash", method: "cash" as const, availableCents: 1000 },
    { id: "card", method: "card" as const, availableCents: 4321 },
  ];

  it("goes back to the card first, then cash", () => {
    expect(splitRefund(5321, pays)).toEqual([
      { paymentId: "card", method: "card", amountCents: 4321 },
      { paymentId: "cash", method: "cash", amountCents: 1000 },
    ]);
    expect(splitRefund(100, pays)).toEqual([{ paymentId: "card", method: "card", amountCents: 100 }]);
    expect(refundSplitLabel(splitRefund(5321, pays))).toBe(
      "Refund $43.21 to the card · Hand back $10.00 cash",
    );
  });

  it("never refunds more than was paid", () => {
    expect(() => splitRefund(5322, pays)).toThrow("Only $53.21 is left");
  });
});

const receipt: ReceiptData = {
  id: "s1",
  receiptNumber: 1001,
  status: "paid",
  createdAt: new Date("2026-10-19T14:00:00"),
  paidAt: new Date("2026-10-19T14:00:00"),
  storeName: "Sample Pet Shop",
  locationName: "Main St",
  staffName: "Sam",
  customer: { id: "c1", name: "Ana", email: "ana@example.com", phone: "5551234567" },
  lines: [
    {
      id: "l1",
      name: "Chew toy",
      sku: "T1",
      qty: 3,
      unitPriceCents: 1000,
      discountCents: 0,
      lineTotalCents: 3000,
    },
  ],
  discounts: [],
  payments: [{ method: "card", status: "completed", amountCents: 3266, tenderedCents: null, changeCents: 0 }],
  subtotalCents: 3000,
  discountCents: 0,
  taxCents: 266,
  taxRateMpct: 8875,
  totalCents: 3266,
  refundedCents: 1089,
  refunds: [
    {
      id: "r1",
      createdAt: new Date("2026-10-19T15:00:00"),
      reason: "damaged",
      note: null,
      restock: false,
      staffName: "Sam",
      approvedByName: null,
      amountCents: 1000,
      taxCents: 89,
      lines: [{ name: "Chew toy", qty: 1, amountCents: 1000 }],
      payments: [{ method: "card", amountCents: 1089 }],
    },
  ],
  earned: [],
};

describe("receipt text", () => {
  it("lists refunds with the reason and the net paid", () => {
    const t = receiptText(receipt);
    expect(t).toContain("REFUND");
    expect(t).toMatch(/1× Chew toy\s+-\$10\.00/);
    expect(t).toMatch(/To card\s+-\$10\.89/);
    expect(t).toContain("Damaged");
    expect(t).toMatch(/NET PAID\s+\$21\.77/);
    for (const row of t.split("\n")) expect(row.length).toBeLessThanOrEqual(32);
  });

  it("builds the email and the short text", () => {
    expect(receiptEmail(receipt).subject).toBe("Your receipt from Sample Pet Shop (#1001)");
    expect(receiptSms(receipt)).toBe(
      "Sample Pet Shop: receipt #1001, total $32.66, refunded $10.89 (net $21.77). Thank you!",
    );
  });
});

describe("astroEntryLines", () => {
  const customer = { name: "Ana", phone: null, email: null, astroCustomerId: null };
  it("writes out a sale", () => {
    expect(
      astroEntryLines("sale", {
        saleId: "s",
        receiptNumber: 1,
        soldAt: "",
        customer,
        items: [],
        earned: [{ programId: "p", programName: "Sample dry food club", punches: 2 }],
        rewards: [{ programId: "p", programName: "x", label: "Next bag free", amountCents: 3899 }],
        offers: [{ label: "$5 off 24 lb bag", amountCents: 500, sku: null }],
      }),
    ).toEqual(["+2 Sample dry food club", "Redeemed: Next bag free (−$38.99)", "Offer: $5 off 24 lb bag"]);
  });

  it("writes out a refund, including punches already spent", () => {
    expect(
      astroEntryLines("refund", {
        refundId: "r",
        saleId: "s",
        receiptNumber: 1,
        refundedAt: "",
        customer,
        items: [],
        amountCents: 1000,
        reversed: [{ programId: "p", programName: "Dry food club", punches: 1, short: 1 }],
        returned: [{ programId: "p", programName: "Dry food club", punches: 12 }],
      }),
    ).toEqual([
      "Refund: −1 punch Dry food club",
      "Refund: 1 punch Dry food club already spent, not taken back",
      "Reward returned: +12 punches Dry food club",
    ]);
  });
});
