import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { can } from "@bearded/core";
import type { ProductRow } from "@bearded/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { CameraButton } from "../../ui/scanner/CameraScanner.tsx";
import { useToast } from "../../ui/Toast.tsx";

interface Line {
  product: ProductRow;
  counted: string;
}

/** "+3", "−2" or "Matches", comparing the shelf count to what the system expects. */
export function diffLabel(expected: number, counted: number): { text: string; kind: "up" | "down" | "same" } {
  const d = counted - expected;
  if (d === 0) return { text: "Matches", kind: "same" };
  return d > 0 ? { text: `+${d}`, kind: "up" } : { text: `−${-d}`, kind: "down" };
}

/** Count mode for a phone: scan or type a code, type what's on the shelf, save them all at once. */
export function CountPage() {
  const { api, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  const navigate = useNavigate();
  const scanRef = useRef<HTMLInputElement>(null);
  const countRefs = useRef(new Map<string, HTMLInputElement>());
  // After a scan, the count box for that item gets focus once its row has rendered.
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    const el = countRefs.current.get(id);
    el?.focus();
    el?.select();
  }, [lines]);

  const save = useMutation({
    mutationFn: () =>
      api.call("saveCounts", {
        lines: lines.map((l) => ({ productId: l.product.id, counted: Number(l.counted) })),
      }),
    onSuccess: (res) => {
      toast(`Saved ${res.counted} count${res.counted === 1 ? "" : "s"} · ${res.changed.length} changed`);
      setLines([]);
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["product"] });
      scanRef.current?.focus();
    },
    onError: (err) => toast(errorMessage(err)),
  });

  if (!can(me.staff.role, "inventory.adjust"))
    return <p className="muted">Counting stock is for owners and managers.</p>;

  async function scan(e: FormEvent) {
    e.preventDefault();
    const c = code.trim();
    setCode("");
    await lookup(c);
  }

  async function lookup(c: string) {
    if (!c) return;
    const product = await api.call("findByCode", { code: c }).catch(() => null);
    if (!product) {
      setUnknown(c);
      setMessage(`No product with code "${c}". Check the label, or add it as a new product.`);
      return;
    }
    setUnknown(null);
    setMessage(null);
    focusNext.current = product.id;
    // Scanning an item already in the list moves it to the top again, so its box is easy to find.
    setLines((ls) => [
      ls.find((l) => l.product.id === product.id) ?? { product, counted: "" },
      ...ls.filter((l) => l.product.id !== product.id),
    ]);
  }

  const invalid = lines.some(
    (l) => l.counted === "" || !Number.isInteger(Number(l.counted)) || Number(l.counted) < 0,
  );

  return (
    <>
      <div className="page-head">
        <h1>Count stock</h1>
        <Link to="..">Back to Inventory</Link>
      </div>
      <p className="muted" style={{ maxWidth: "60ch" }}>
        Scan each item (or type its SKU), then type how many are on the shelf. Nothing changes until you tap
        Save counts.
      </p>

      <form className="count-scan" onSubmit={scan}>
        <input
          ref={scanRef}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Scan or type SKU / barcode"
          aria-label="Scan or type SKU or barcode"
          autoComplete="off"
          enterKeyHint="go"
        />
        <button className="primary">Find</button>
        <CameraButton continuous title="Count with camera" onCode={(c) => void lookup(c)} />
      </form>
      {message && (
        <div className="error-box" style={{ display: "grid", gap: 6 }}>
          <span>{message}</span>
          {unknown && can(me.staff.role, "products.edit") && (
            <div>
              <button
                type="button"
                onClick={() => navigate("..", { relative: "path", state: { newBarcode: unknown } })}
              >
                New product with barcode {unknown}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="count-lines">
        {lines.map((l) => {
          const n = Number(l.counted);
          const d = l.counted !== "" && Number.isInteger(n) && n >= 0 ? diffLabel(l.product.onHand, n) : null;
          return (
            <div className="count-line" key={l.product.id}>
              <div>
                <b>{l.product.name}</b>
                <span className="sub">
                  {l.product.sku} · expected {l.product.onHand}
                </span>
              </div>
              <input
                ref={(el) => {
                  if (el) countRefs.current.set(l.product.id, el);
                }}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                aria-label={`Counted ${l.product.name}`}
                value={l.counted}
                onChange={(e) =>
                  setLines((ls) =>
                    ls.map((x) => (x.product.id === l.product.id ? { ...x, counted: e.target.value } : x)),
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    scanRef.current?.focus();
                  }
                }}
              />
              <span className={`diff ${d?.kind ?? ""}`} style={{ minWidth: 70, textAlign: "right" }}>
                {d?.text ?? ""}
              </span>
            </div>
          );
        })}
        {lines.length === 0 && <p className="muted">Nothing scanned yet.</p>}
      </div>

      {lines.length > 0 && (
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={invalid || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : `Save counts (${lines.length})`}
          </button>
          <button type="button" onClick={() => setLines([])}>
            Clear
          </button>
          {invalid && <span className="muted">Type a count for every item.</span>}
        </div>
      )}
    </>
  );
}
