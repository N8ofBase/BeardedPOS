// The card reader, behind one small interface. Demo mode uses SimulatedTerminal:
// the person giving the demo taps Approve / Decline / Customer canceled, and that
// stands in for Square's webhook. Hosted mode (Phase 2d) swaps in a Square Terminal
// API adapter that holds the store's access token on the server. Card numbers never
// reach this code either way: Square holds them, we keep its reference and amounts.

export interface TerminalCharge {
  /** Square's checkout reference (simulated: "sim_…"). */
  providerRef: string;
}

export interface PaymentTerminal {
  readonly name: string;
  /** Asks the reader to collect a card payment. The result arrives later (webhook or simulation). */
  charge(amountCents: number, saleId: string): Promise<TerminalCharge>;
  /** Refunds a completed card payment in full. */
  refund(providerRef: string, amountCents: number): Promise<{ refundRef: string }>;
}

function simRef(prefix: string): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export class SimulatedTerminal implements PaymentTerminal {
  readonly name = "Square Terminal (simulated)";

  async charge(): Promise<TerminalCharge> {
    return { providerRef: simRef("sim") };
  }

  async refund(): Promise<{ refundRef: string }> {
    return { refundRef: simRef("simrefund") };
  }
}

/** The terminal in use. Demo mode only has the simulated one. */
export const terminal: PaymentTerminal = new SimulatedTerminal();
