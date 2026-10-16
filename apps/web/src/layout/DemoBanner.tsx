import { useEffect, useState } from "react";

/** Shown on every screen in demo mode. Reset asks for a second tap (it's demo data only, so no typed confirm). */
export function DemoBanner({ onReset }: { onReset: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 8000);
    return () => clearTimeout(t);
  }, [confirming]);

  async function click() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    await onReset();
  }

  return (
    <div className="demo-banner" role="status">
      <span>Demo · data stays on this device</span>
      <button type="button" onClick={click} disabled={busy}>
        {busy ? "Resetting…" : confirming ? "Tap again to reset the demo" : "Reset demo"}
      </button>
    </div>
  );
}
