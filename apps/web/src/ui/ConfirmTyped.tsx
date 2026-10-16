import { useState, type ReactNode } from "react";

/**
 * For destructive actions (delete customer, remove demo data): the button stays
 * disabled until "delete" is typed, as CLAUDE.md requires.
 */
export function ConfirmTyped({
  title,
  children,
  button,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  button: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = typed.trim().toLowerCase() === "delete";

  async function go() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel danger" role="alertdialog" aria-label={title}>
      <h2 style={{ color: "var(--bad)" }}>{title}</h2>
      <div style={{ display: "grid", gap: 6, maxWidth: "70ch" }}>{children}</div>
      <label style={{ maxWidth: 320 }}>
        <span>
          Type <b style={{ color: "var(--fg)" }}>delete</b> to confirm
        </span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void go()}
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
      </label>
      <div className="actions">
        <button type="button" className="dangerbtn" disabled={!ready || busy} onClick={() => void go()}>
          {busy ? "Deleting…" : button}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
