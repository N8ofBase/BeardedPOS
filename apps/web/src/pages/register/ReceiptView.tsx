import { formatMoney, formatTaxPercent } from "@pet-pos/core";
import type { Receipt } from "@pet-pos/api";

const W = 32;
const pad = (left: string, right: string) => {
  const room = W - right.length - 1;
  const l = left.length > room ? `${left.slice(0, room - 1)}…` : left;
  return `${l.padEnd(W - right.length)}${right}`;
};

/** The receipt as text, 32 columns wide like a thermal printer (the prototype's format). */
export function receiptText(r: Receipt): string {
  const when = new Date(r.paidAt ?? r.createdAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const out = [r.storeName, r.locationName, `${when}  #${r.receiptNumber}`, "-".repeat(W)];
  for (const l of r.lines) {
    out.push(pad(`${l.qty}× ${l.name}`, formatMoney(l.unitPriceCents * l.qty)));
  }
  for (const d of r.discounts) {
    out.push(pad(`  ${d.name}`, `-${formatMoney(d.amountCents)}`));
    if (d.note) out.push(`    ${d.note}`.slice(0, W));
  }
  out.push("-".repeat(W));
  out.push(pad("Subtotal", formatMoney(r.subtotalCents - r.discountCents)));
  out.push(pad(`Tax ${formatTaxPercent(r.taxRateMpct)}`, formatMoney(r.taxCents)));
  out.push(pad("TOTAL", formatMoney(r.totalCents)));
  for (const p of r.payments) {
    out.push(pad(p.method === "card" ? "Card (Square)" : "Cash", formatMoney(p.amountCents)));
    if (p.method === "cash" && p.changeCents) out.push(pad("Change", formatMoney(p.changeCents)));
    if (p.status === "refunded") out.push(pad("  Refunded", `-${formatMoney(p.amountCents)}`));
  }
  if (r.status === "canceled") out.push("", "*** CANCELED ***");
  if (r.customer) out.push("", `Customer: ${r.customer.name}`);
  if (r.earned.length)
    out.push(`Astro credit: ${r.earned.map((e) => `${e.punches} × ${e.programName}`).join(", ")}`);
  if (r.staffName) out.push(`Served by ${r.staffName}`);
  out.push("", "Thank you!");
  return out.join("\n");
}

export function ReceiptView({ receipt }: { receipt: Receipt }) {
  return (
    <div className="receipt receipt-print" aria-label={`Receipt ${receipt.receiptNumber}`}>
      {receiptText(receipt)}
    </div>
  );
}
