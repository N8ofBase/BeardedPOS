import { receiptText } from "@bearded/core";
import type { Receipt } from "@bearded/api";

export function ReceiptView({ receipt }: { receipt: Receipt }) {
  return (
    <div className="receipt receipt-print" aria-label={`Receipt ${receipt.receiptNumber}`}>
      {receiptText(receipt)}
    </div>
  );
}
