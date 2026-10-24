import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { formatPhone } from "@bearded/core";
import type { Receipt, SentReceipt } from "@bearded/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";

export const DEMO_SEND_NOTE =
  "In the demo, receipts aren't sent. In the hosted version this goes by email (Amazon SES) or text (Amazon SMS).";

/** Email receipt / Text receipt buttons, filled in with the customer's email or phone. */
export function ReceiptSend({ receipt }: { receipt: Receipt }) {
  const { api } = useSession();
  const [channel, setChannel] = useState<"email" | "sms" | null>(null);
  const [to, setTo] = useState("");
  const [sent, setSent] = useState<SentReceipt | null>(null);

  const send = useMutation({
    mutationFn: () => api.call("sendReceipt", { saleId: receipt.id, channel: channel!, to }),
    onSuccess: setSent,
  });

  function open(c: "email" | "sms") {
    setChannel(c);
    setSent(null);
    send.reset();
    setTo(c === "email" ? (receipt.customer?.email ?? "") : formatPhone(receipt.customer?.phone));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    send.mutate();
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="actions">
        <button type="button" onClick={() => open("email")} aria-pressed={channel === "email"}>
          Email receipt
        </button>
        <button type="button" onClick={() => open("sms")} aria-pressed={channel === "sms"}>
          Text receipt
        </button>
      </div>
      {channel && !sent && (
        <form onSubmit={submit} className="form" style={{ alignItems: "end" }}>
          <label>
            {channel === "email" ? "Email address" : "Mobile number"}
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              type={channel === "email" ? "email" : "tel"}
              inputMode={channel === "email" ? "email" : "tel"}
              placeholder={channel === "email" ? "name@example.com" : "(555) 123-4567"}
              autoFocus
              required
            />
            {send.isError && <span className="field-error">{errorMessage(send.error)}</span>}
          </label>
          <div className="actions">
            <button className="primary" disabled={send.isPending}>
              {channel === "email" ? "Send email" : "Send text"}
            </button>
            <button type="button" onClick={() => setChannel(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {sent && <SentPreview sent={sent} />}
    </div>
  );
}

/** Exactly what would go out, with the demo note. */
export function SentPreview({ sent }: { sent: SentReceipt }) {
  return (
    <div className="panel" aria-label="Receipt preview" style={{ display: "grid", gap: 8 }}>
      <b>{sent.channel === "email" ? `Email to ${sent.to}` : `Text to ${formatPhone(sent.to)}`}</b>
      {sent.subject && (
        <span>
          <span className="muted">Subject: </span>
          {sent.subject}
        </span>
      )}
      <div className="receipt">{sent.body}</div>
      <p className="muted small" style={{ margin: 0 }}>
        {DEMO_SEND_NOTE}
      </p>
    </div>
  );
}
