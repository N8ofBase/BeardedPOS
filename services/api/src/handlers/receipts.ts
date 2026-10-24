// Receipts by email or text. Demo mode never sends: the message is saved in
// receipt_outbox with status "preview" and shown on screen exactly as it would go.
// In hosted mode an SQS worker sends "queued" rows (Amazon SES / Amazon SMS).
import { AppError, normalizePhone, receiptEmail, receiptSms } from "@bearded/core";
import { defineHandler } from "../handler.ts";
import { getSale } from "./register.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SendReceiptInput {
  saleId: string;
  channel: "email" | "sms";
  /** An email address, or a phone number in any format. */
  to: string;
}

export interface SentReceipt {
  id: string;
  channel: "email" | "sms";
  /** Normalized: lower-case email, or 10 digits. */
  to: string;
  subject: string | null;
  body: string;
  status: "preview" | "queued";
}

export const sendReceipt = defineHandler<SendReceiptInput, SentReceipt>({
  action: "register.use",
  async run(trx, ctx, { saleId, channel, to }) {
    let address: string;
    if (channel === "email") {
      address = to.trim().toLowerCase();
      if (!EMAIL.test(address)) throw new AppError("invalid", "Enter an email like name@example.com.");
    } else if (channel === "sms") {
      const phone = normalizePhone(to);
      if (!phone) throw new AppError("invalid", "Enter a 10-digit phone number.");
      address = phone;
    } else {
      throw new AppError("invalid", "Pick email or text.");
    }
    const receipt = await getSale.run(trx, ctx, { id: saleId });
    if (receipt.status === "open") throw new AppError("invalid", "This sale isn't paid yet.");
    const msg = channel === "email" ? receiptEmail(receipt) : { subject: null, body: receiptSms(receipt) };
    const row = await trx
      .insertInto("receipt_outbox")
      .values({
        business_id: ctx.businessId,
        sale_id: saleId,
        channel,
        to_address: address,
        subject: msg.subject,
        body: msg.body,
        status: "preview",
        created_by: ctx.staffId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { id: row.id, channel, to: address, subject: msg.subject, body: msg.body, status: "preview" };
  },
});
