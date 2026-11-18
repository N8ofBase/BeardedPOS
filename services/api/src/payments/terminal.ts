// The card reader, behind one small interface. Card numbers never reach this code: Square holds
// them, we keep its reference and amounts.
//
// - SimulatedTerminal (the demo and the Sandbox register): the person giving the demo taps
//   Approve / Decline / Customer canceled, and that stands in for the reader.
// - The Square POS app hand-off (the live register, services/store-api/src/square/pos.ts): the
//   register opens Square's own app on the same phone or tablet with the amount, the customer pays
//   there with the Square Reader, and Square sends the browser back with a transaction id. The
//   server then asks Square about that transaction before anything counts as paid.
// - A Square Terminal (Terminal API) would be a third kind, server-driven, if one is ever bought.

export type CardReaderKind = "simulated" | "square-pos";

/** What the register needs to open the Square POS app for one card payment. Nothing here is secret. */
export interface CardHandoff {
  /** The Square app's application id (public; shown in Square's Developer Dashboard). */
  applicationId: string;
  /** Where Square sends the browser back to; must be saved in the Developer Dashboard. */
  callbackUrl: string;
  /** Our one-time reference for this payment; Square hands it back unchanged. */
  state: string;
  amountCents: number;
  currency: string;
  /** Shown on the payment in Square, e.g. "Receipt #1042". */
  note: string;
}

export interface TerminalCharge {
  /** Our reference while the payment is pending (simulated: "sim_…", hand-off: "pos_…"). */
  providerRef: string;
  /** Present when the register must open the Square POS app itself. */
  handoff?: CardHandoff;
}

/** A card payment Square confirmed: its payment id becomes the payment's provider_ref. */
export interface ConfirmedCard {
  paymentRef: string;
}

export interface PaymentTerminal {
  readonly name: string;
  readonly kind: CardReaderKind;
  /** Asks the reader to collect a card payment. The answer arrives later. */
  charge(amountCents: number, saleId: string, note: string): Promise<TerminalCharge>;
  /**
   * Hand-off readers: checks with Square that this transaction is a paid card payment of exactly
   * this amount at our location, taken after `since`. Throws AppError when it isn't.
   */
  confirm?(transactionId: string, amountCents: number, since: Date): Promise<ConfirmedCard>;
  /**
   * Hand-off readers: when Square's answer never came back, the transactions of exactly this
   * amount taken since `since`, newest first, so staff can pick it up instead of charging twice.
   */
  find?(amountCents: number, since: Date): Promise<string[]>;
  /** Refunds part or all of a completed card payment. */
  refund(providerRef: string, amountCents: number): Promise<{ refundRef: string }>;
}

function simRef(prefix: string): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export class SimulatedTerminal implements PaymentTerminal {
  readonly name = "Square Terminal (simulated)";
  readonly kind = "simulated";

  async charge(): Promise<TerminalCharge> {
    return { providerRef: simRef("sim") };
  }

  async refund(): Promise<{ refundRef: string }> {
    return { refundRef: simRef("simrefund") };
  }
}

/**
 * The reader in use. The demo and the Sandbox register keep the simulated one; the live server
 * swaps in the Square POS app hand-off with setTerminal() when it starts.
 */
export let terminal: PaymentTerminal = new SimulatedTerminal();

export function setTerminal(t: PaymentTerminal): void {
  terminal = t;
}

/** A one-time reference for a hand-off payment (128 bits). */
export function handoffRef(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `pos_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
