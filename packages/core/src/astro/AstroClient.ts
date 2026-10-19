// The only code that talks to Astro Loyalty (CLAUDE.md rule). Astro gives API access
// only to approved POS partners, so until credentials exist this client is "not
// connected": sales with Astro activity wait in astro_queue for manual entry.
// Credentials will come from Secrets Manager, never the browser.

export interface AstroSaleItem {
  sku: string | null;
  upc: string | null;
  name: string;
  qty: number;
  unitPriceCents: number;
}

export interface AstroSalePayload {
  saleId: string;
  receiptNumber: number;
  soldAt: string;
  customer: {
    name: string;
    phone: string | null;
    email: string | null;
    astroCustomerId: string | null;
  } | null;
  items: AstroSaleItem[];
  earned: { programId: string; programName: string; punches: number }[];
  rewards: { programId: string; programName: string; label: string; amountCents: number }[];
  offers: { label: string; amountCents: number; sku: string | null }[];
}

/** A refund that changes Astro credit, so staff reverse it in the portal too. */
export interface AstroRefundPayload {
  refundId: string;
  saleId: string;
  receiptNumber: number;
  refundedAt: string;
  customer: AstroSalePayload["customer"];
  items: (AstroSaleItem & { amountCents: number })[];
  amountCents: number;
  /** Punches taken back. `short` is how many couldn't be, because the customer had already spent them. */
  reversed: { programId: string; programName: string; punches: number; short: number }[];
  /** Punches given back because the free reward item came back. */
  returned: { programId: string; programName: string; punches: number }[];
}

export interface AstroClient {
  readonly connected: boolean;
  /** Sends one sale. Returns false while not connected; the queue row stays pending. */
  sendSale(payload: AstroSalePayload): Promise<{ sent: boolean }>;
  /** Sends one refund, the same way. */
  sendRefund(payload: AstroRefundPayload): Promise<{ sent: boolean }>;
}

class NotConnectedAstroClient implements AstroClient {
  readonly connected = false;
  async sendSale(): Promise<{ sent: boolean }> {
    return { sent: false };
  }

  async sendRefund(): Promise<{ sent: boolean }> {
    return { sent: false };
  }
}

export const astroClient: AstroClient = new NotConnectedAstroClient();

const money = (c: number) => `$${Math.trunc(c / 100)}.${String(c % 100).padStart(2, "0")}`;
const punches = (n: number) => `${n} punch${n === 1 ? "" : "es"}`;

/** What staff type into the Astro portal for one queue row, written out plainly. */
export function astroEntryLines(
  kind: "sale" | "refund",
  payload: AstroSalePayload | AstroRefundPayload,
): string[] {
  if (kind === "refund") {
    const r = payload as AstroRefundPayload;
    const out: string[] = [];
    for (const v of r.reversed) {
      if (v.punches) out.push(`Refund: −${punches(v.punches)} ${v.programName}`);
      if (v.short) out.push(`Refund: ${punches(v.short)} ${v.programName} already spent, not taken back`);
    }
    for (const g of r.returned) out.push(`Reward returned: +${punches(g.punches)} ${g.programName}`);
    if (!out.length) out.push(`Refund: −${money(r.amountCents)}, no punch changes`);
    return out;
  }
  const s = payload as AstroSalePayload;
  return [
    ...s.earned.map((e) => `+${e.punches} ${e.programName}`),
    ...s.rewards.map((r) => `Redeemed: ${r.label} (−${money(r.amountCents)})`),
    ...s.offers.map((o) => `Offer: ${o.label}`),
  ];
}
