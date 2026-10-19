import { receiptText } from "@pet-pos/core";
import type { Receipt } from "@pet-pos/api";

export function ReceiptView({ receipt }: { receipt: Receipt }) {
  return (
    <div className="receipt receipt-print" aria-label={`Receipt ${receipt.receiptNumber}`}>
      {receiptText(receipt)}
    </div>
  );
}
