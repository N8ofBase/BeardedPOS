import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, Route, Routes, useLocation, useNavigate } from "react-router";
import { can, CATEGORIES, formatMoney, marginPercent, stockLabel, stockStatus } from "@bearded/core";
import type { ProductRow } from "@bearded/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { CameraButton } from "../../ui/scanner/CameraScanner.tsx";
import { useToast } from "../../ui/Toast.tsx";
import { CountPage } from "./CountPage.tsx";
import { ProductPanel } from "./ProductPanel.tsx";

export function InventoryRoutes() {
  return (
    <Routes>
      <Route index element={<InventoryPage />} />
      <Route path="count" element={<CountPage />} />
    </Routes>
  );
}

function InventoryPage() {
  const { api, me } = useSession();
  const canEdit = can(me.staff.role, "products.edit");
  const canAdjust = can(me.staff.role, "inventory.adjust");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  // Count mode or the register can send an unknown barcode here to start a new product.
  const fromScan = (location.state as { newBarcode?: string } | null)?.newBarcode ?? null;
  const [editing, setEditing] = useState<string | "new" | null>(fromScan && canEdit ? "new" : null);
  const [newBarcode, setNewBarcode] = useState<string | null>(fromScan);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<{ text: string; code: string | null } | null>(null);
  const toast = useToast();

  async function scanned(code: string) {
    const p = await api.call("findByCode", { code }).catch(() => null);
    if (p) {
      setScanMessage(null);
      setQ(p.sku);
      if (canAdjust) setReceivingId(p.id);
      else toast(`${p.name}: ${p.onHand} on hand`);
      return;
    }
    setScanMessage({ text: `No product with barcode ${code}.`, code: canEdit ? code : null });
  }

  const filters = { q, category: category || undefined, lowOnly, includeArchived: showArchived };
  const products = useQuery({
    queryKey: ["products", filters],
    queryFn: () => api.call("listProducts", filters),
    placeholderData: (prev) => prev,
  });
  const lowCount = useQuery({
    queryKey: ["products", { lowOnly: true }],
    queryFn: () => api.call("listProducts", { lowOnly: true }),
  });

  return (
    <>
      <div className="page-head">
        <h1>Inventory</h1>
        <div className="actions">
          {canAdjust && <Link to="count">Count stock</Link>}
          <CameraButton
            label={canAdjust ? "Scan to receive" : "Scan"}
            title="Scan an item"
            onCode={(c) => void scanned(c)}
          />
          {canEdit && (
            <button type="button" className="primary" onClick={() => setEditing("new")}>
              New product
            </button>
          )}
        </div>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Filter by name, SKU, brand"
          aria-label="Filter products"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          Low stock only{lowCount.data ? ` (${lowCount.data.length})` : ""}
        </label>
        {canEdit && (
          <label className="check">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
        )}
      </div>

      {products.isError && <p className="error-box">{errorMessage(products.error)}</p>}
      {scanMessage && (
        <div className="error-box" style={{ display: "grid", gap: 6 }}>
          <span>{scanMessage.text}</span>
          {scanMessage.code && (
            <div>
              <button
                type="button"
                onClick={() => {
                  setNewBarcode(scanMessage.code);
                  setEditing("new");
                  setScanMessage(null);
                }}
              >
                New product with barcode {scanMessage.code}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="tablewrap">
        <table className="wide">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Product</th>
              <th className="r">Sell price</th>
              <th className="r">Margin</th>
              <th className="r">On hand</th>
              {(canEdit || canAdjust) && <th />}
            </tr>
          </thead>
          <tbody>
            {products.data?.map((p) => (
              <ProductTableRow
                key={p.id}
                p={p}
                canEdit={canEdit}
                canAdjust={canAdjust}
                onEdit={() => setEditing(p.id)}
                receiving={receivingId === p.id}
                onReceiving={(on) => setReceivingId(on ? p.id : null)}
              />
            ))}
            {products.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {q || category || lowOnly
                    ? "No products match. Clear the filters to see everything."
                    : canEdit
                      ? "No products yet. Tap New product to add the first one."
                      : "No products yet."}
                </td>
              </tr>
            )}
            {products.isPending && (
              <tr>
                <td colSpan={6} className="muted">
                  Loading products…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <ProductPanel
          id={editing === "new" ? null : editing}
          initialBarcode={editing === "new" ? newBarcode : null}
          onClose={() => {
            setEditing(null);
            setNewBarcode(null);
            if (fromScan) navigate(".", { replace: true, state: null });
          }}
        />
      )}
    </>
  );
}

function ProductTableRow({
  p,
  canEdit,
  canAdjust,
  onEdit,
  receiving,
  onReceiving,
}: {
  p: ProductRow;
  canEdit: boolean;
  canAdjust: boolean;
  onEdit: () => void;
  receiving: boolean;
  onReceiving: (on: boolean) => void;
}) {
  const setReceiving = onReceiving;
  const margin = p.costCents ? marginPercent(p.priceCents, p.costCents) : null;
  const status = stockStatus(p.onHand, p.reorderAt);

  return (
    <tr>
      <td className="mono">{p.sku}</td>
      <td>
        <b>{p.name}</b>
        {!p.active && <span className="tag muted"> Archived</span>}
        <span className="sub">{[p.brand, p.category].filter(Boolean).join(" · ")}</span>
      </td>
      <td className="r num">
        {formatMoney(p.priceCents)}
        {p.wholesaleCents !== null && <span className="sub">Wholesale {formatMoney(p.wholesaleCents)}</span>}
      </td>
      <td className="r num">{margin === null ? "—" : `${margin}%`}</td>
      <td className="r">
        <span className={`tag ${status}`}>{stockLabel(p.onHand, p.reorderAt)}</span>
      </td>
      {(canEdit || canAdjust) && (
        <td style={{ whiteSpace: "nowrap" }}>
          {receiving ? (
            <ReceiveForm productId={p.id} name={p.name} onDone={() => setReceiving(false)} />
          ) : (
            <div className="actions">
              {canAdjust && p.active && (
                <button type="button" onClick={() => setReceiving(true)}>
                  Receive
                </button>
              )}
              {canEdit && (
                <button type="button" onClick={onEdit}>
                  Edit
                </button>
              )}
            </div>
          )}
        </td>
      )}
    </tr>
  );
}

function ReceiveForm({ productId, name, onDone }: { productId: string; name: string; onDone: () => void }) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [qty, setQty] = useState("12");
  const receive = useMutation({
    mutationFn: (n: number) => api.call("receiveStock", { productId, qty: n }),
    onSuccess: (_res, n) => {
      toast(`Received ${n} × ${name}`);
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["product", productId] });
      onDone();
    },
    onError: (err) => toast(errorMessage(err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 1) return toast("Enter how many arrived, 1 or more.");
    receive.mutate(n);
  }

  return (
    <form className="actions" onSubmit={submit}>
      <input
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        aria-label="Quantity received"
        style={{ width: 80 }}
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        autoFocus
        onFocus={(e) => e.target.select()}
      />
      <button className="primary" disabled={receive.isPending}>
        Add
      </button>
      <button type="button" onClick={onDone}>
        Cancel
      </button>
    </form>
  );
}
