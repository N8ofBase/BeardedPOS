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

export interface AstroClient {
  readonly connected: boolean;
  /** Sends one sale. Returns false while not connected; the queue row stays pending. */
  sendSale(payload: AstroSalePayload): Promise<{ sent: boolean }>;
}

class NotConnectedAstroClient implements AstroClient {
  readonly connected = false;
  async sendSale(): Promise<{ sent: boolean }> {
    return { sent: false };
  }
}

export const astroClient: AstroClient = new NotConnectedAstroClient();
