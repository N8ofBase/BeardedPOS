// Settings, Square (the hosted register only): bring the store's Square items, prices, stock and
// customers into the register. "Check Square" shows what would change; nothing is saved until
// "Bring these in".
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { formatMoney } from "@bearded/core";
import { posFetch } from "../../api/http.ts";
import { errorMessage } from "../../ui/errors.ts";
import { useToast } from "../../ui/Toast.tsx";

/** What the server says (services/store-api/src/square/registerSync.ts). */
export interface SquareStatus {
  connected: boolean;
  lastSyncAt: Date | null;
  waitingSends: number;
  failedSends: number;
  linkedProducts: number;
}
export interface SyncPreview {
  newProducts: { name: string; priceCents: number; stock: number | null }[];
  priceChanges: { name: string; fromCents: number; toCents: number }[];
  stockChanges: { name: string; from: number; to: number }[];
  linkedProducts: number;
  unchangedProducts: number;
  skipped: { name: string; reason: string }[];
  onlyInRegister: string[];
  newCustomers: number;
  linkedCustomers: number;
  customersToSquare: number;
  duplicateCustomers: number;
}
export interface SyncResult {
  preview: SyncPreview;
  applied?: {
    productsAdded: number;
    pricesChanged: number;
    stockChanged: number;
    customersAdded: number;
    productsLeftOut?: number;
    customersLeftOut?: number;
  };
}

export const squareStatus = () => posFetch<SquareStatus>("square/status", {});
export const squareSync = (apply: boolean) => posFetch<SyncResult>("square/sync", { apply });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** ". 3 couldn't be saved" when the register refused some of Square's rows. */
function leftOut(a: { productsLeftOut?: number; customersLeftOut?: number }): string {
  const n = (a.productsLeftOut ?? 0) + (a.customersLeftOut ?? 0);
  return n > 0 ? `. ${n} couldn't be saved (another customer has the same phone or email, most likely)` : "";
}

export function nothingToDo(p: SyncPreview): boolean {
  return (
    p.newProducts.length + p.priceChanges.length + p.stockChanges.length + p.linkedProducts === 0 &&
    p.newCustomers + p.linkedCustomers + p.customersToSquare === 0
  );
}

export function SquareSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: ["square-status"], queryFn: squareStatus });
  const [preview, setPreview] = useState<SyncPreview | null>(null);

  const check = useMutation({
    mutationFn: () => squareSync(false),
    onSuccess: (r) => setPreview(r.preview),
    onError: (e) => toast(errorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: () => squareSync(true),
    onSuccess: (r) => {
      setPreview(null);
      const a = r.applied;
      toast(
        a
          ? `From Square: ${plural(a.productsAdded, "new product")}, ${plural(a.pricesChanged, "price")} and ${plural(a.stockChanged, "count")} changed, ${plural(a.customersAdded, "new customer")}${leftOut(a)}`
          : "Square sync done",
      );
      for (const key of ["square-status", "products", "product", "customers", "customer"])
        void qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => toast(errorMessage(e)),
  });

  if (status.isError || (status.data && !status.data.connected)) return null;
  const s = status.data;
  return (
    <section className="panel" aria-label="Square">
      <h2>Square</h2>
      <p className="muted">
        Square is the home for items, prices and stock. Bring them in here; the register sends its own sales
        and stock changes back to Square as they happen.
      </p>
      {s && (
        <p className="small">
          {s.lastSyncAt
            ? `Last brought in ${s.lastSyncAt.toLocaleString()}`
            : "Not brought in from Square yet"}
          {" · "}
          {plural(s.linkedProducts, "product")} linked
          {s.waitingSends > 0 && ` · ${plural(s.waitingSends, "stock change")} waiting to send`}
        </p>
      )}
      {s && s.failedSends > 0 && (
        <p className="error-box">
          {plural(s.failedSends, "stock change")} couldn't be sent to Square after 10 tries. Check those
          counts in Square.
        </p>
      )}

      {preview && <PreviewList p={preview} />}

      <div className="actions">
        {preview && !nothingToDo(preview) ? (
          <>
            <button
              type="button"
              className="primary"
              disabled={apply.isPending}
              onClick={() => apply.mutate()}
            >
              {apply.isPending ? "Bringing them in…" : "Bring these in"}
            </button>
            <button type="button" onClick={() => setPreview(null)} disabled={apply.isPending}>
              Not now
            </button>
          </>
        ) : (
          <button type="button" disabled={check.isPending} onClick={() => check.mutate()}>
            {check.isPending ? "Checking Square…" : "Check Square"}
          </button>
        )}
      </div>
    </section>
  );
}

function PreviewList({ p }: { p: SyncPreview }) {
  if (nothingToDo(p))
    return <p>The register already matches Square ({plural(p.unchangedProducts, "product")}).</p>;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <ul>
        {p.newProducts.length > 0 && (
          <li>
            <b>{plural(p.newProducts.length, "new product")}:</b>{" "}
            {p.newProducts
              .slice(0, 8)
              .map((n) => `${n.name} ${formatMoney(n.priceCents)}`)
              .join(", ")}
            {p.newProducts.length > 8 && ", …"}
          </li>
        )}
        {p.linkedProducts > 0 && (
          <li>{plural(p.linkedProducts, "register product")} linked to Square by name or SKU</li>
        )}
        {p.priceChanges.map((c) => (
          <li key={`price-${c.name}`}>
            {c.name}: {formatMoney(c.fromCents)} → {formatMoney(c.toCents)}
          </li>
        ))}
        {p.stockChanges.length > 0 && (
          <li>
            <b>{plural(p.stockChanges.length, "count")} from Square:</b>{" "}
            {p.stockChanges
              .slice(0, 8)
              .map((c) => `${c.name} ${c.from} → ${c.to}`)
              .join(", ")}
            {p.stockChanges.length > 8 && ", …"}
          </li>
        )}
        {p.newCustomers > 0 && <li>{plural(p.newCustomers, "customer")} from Square</li>}
        {p.linkedCustomers > 0 && (
          <li>{plural(p.linkedCustomers, "register customer")} matched by phone or email</li>
        )}
        {p.customersToSquare > 0 && (
          <li>{plural(p.customersToSquare, "register customer")} added to Square</li>
        )}
      </ul>
      {(p.skipped.length > 0 || p.duplicateCustomers > 0 || p.onlyInRegister.length > 0) && (
        <p className="muted small">
          {p.skipped.length > 0 &&
            `Left out: ${p.skipped.map((s) => `${s.name} (${s.reason.toLowerCase()})`).join(", ")}. `}
          {p.duplicateCustomers > 0 &&
            `${plural(p.duplicateCustomers, "Square customer")} share a phone or email with another and were left out. `}
          {p.onlyInRegister.length > 0 &&
            `Only in the register, left as they are: ${p.onlyInRegister.slice(0, 8).join(", ")}${p.onlyInRegister.length > 8 ? ", …" : ""}.`}
        </p>
      )}
    </div>
  );
}

/** How often an open register brings Square's changes in. */
export const AUTO_SYNC_MINUTES = 15;

/**
 * While an owner or manager has the hosted register open, Square's items, prices, counts and
 * customers come in every 15 minutes (and when it opens, if the last sync is older). Quiet: a
 * failure just waits for the next turn.
 */
export function useSquareAutoSync(on: boolean): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!on) return;
    let stopped = false;
    const tick = async () => {
      try {
        const s = await squareStatus();
        if (stopped || !s.connected) return;
        const age = s.lastSyncAt ? Date.now() - s.lastSyncAt.getTime() : Infinity;
        if (age < AUTO_SYNC_MINUTES * 60_000) return;
        const r = await squareSync(true);
        if (r.applied && !stopped)
          for (const key of ["square-status", "products", "product", "customers", "customer"])
            void qc.invalidateQueries({ queryKey: [key] });
      } catch {
        // Square or the network was down: try again next time.
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), AUTO_SYNC_MINUTES * 60_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [on, qc]);
}
