import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { CATEGORIES, centsToInput, parseMoney, type ProductInput } from "@pet-pos/core";
import type { MoveRow, ProductRow } from "@pet-pos/api";
import { useSession } from "../../session.tsx";
import { errorMessage, fieldErrors } from "../../ui/errors.ts";
import { SlideOver } from "../../ui/SlideOver.tsx";
import { useToast } from "../../ui/Toast.tsx";
import { CameraButton } from "../../ui/scanner/CameraScanner.tsx";
import { TwoTapButton } from "../../ui/TwoTapButton.tsx";

interface Form {
  sku: string;
  barcode: string;
  name: string;
  brand: string;
  category: string;
  price: string;
  cost: string;
  taxClass: "standard" | "exempt";
  reorderAt: string;
  onHand: string;
  astroProgramId: string;
  offerLabel: string;
  offerAmount: string;
}

const EMPTY: Form = {
  sku: "",
  barcode: "",
  name: "",
  brand: "",
  category: "Dog food",
  price: "",
  cost: "",
  taxClass: "standard",
  reorderAt: "3",
  onHand: "0",
  astroProgramId: "",
  offerLabel: "",
  offerAmount: "",
};

function toForm(p: ProductRow): Form {
  return {
    sku: p.sku,
    barcode: p.barcode ?? "",
    name: p.name,
    brand: p.brand ?? "",
    category: p.category,
    price: centsToInput(p.priceCents),
    cost: p.costCents ? centsToInput(p.costCents) : "",
    taxClass: p.taxClass,
    reorderAt: String(p.reorderAt),
    onHand: String(p.onHand),
    astroProgramId: p.astroProgramId ?? "",
    offerLabel: p.offerLabel ?? "",
    offerAmount: p.offerCents ? centsToInput(p.offerCents) : "",
  };
}

/** Turns the form into handler input. Money goes through parseMoney, so it's cents from here on. */
function toInput(f: Form): { input: ProductInput; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const price = parseMoney(f.price);
  if (price === null) errors.priceCents = "Enter a price like 12.99.";
  const cost = f.cost.trim() ? parseMoney(f.cost) : 0;
  if (cost === null) errors.costCents = "Enter a cost like 8.50, or leave it blank.";
  const offer = f.offerAmount.trim() ? parseMoney(f.offerAmount) : null;
  if (f.offerAmount.trim() && offer === null) errors.offerCents = "Enter an amount like 5.00.";
  const reorder = Number(f.reorderAt || "0");
  return {
    errors,
    input: {
      sku: f.sku,
      barcode: f.barcode,
      name: f.name,
      brand: f.brand,
      category: f.category,
      priceCents: price ?? 0,
      costCents: cost ?? 0,
      taxClass: f.taxClass,
      reorderAt: reorder,
      astroProgramId: f.astroProgramId || null,
      offerLabel: f.offerLabel,
      offerCents: offer,
    },
  };
}

export function ProductPanel({
  id,
  initialBarcode = null,
  onClose,
}: {
  id: string | null;
  initialBarcode?: string | null;
  onClose: () => void;
}) {
  const { api } = useSession();
  const existing = useQuery({
    queryKey: ["product", id],
    queryFn: () => api.call("getProduct", { id: id! }),
    enabled: !!id,
  });

  if (id && existing.isPending)
    return (
      <SlideOver title="Edit product" onClose={onClose}>
        <p className="muted">Loading…</p>
      </SlideOver>
    );
  if (id && existing.isError)
    return (
      <SlideOver title="Edit product" onClose={onClose}>
        <p className="error-box">{errorMessage(existing.error)}</p>
      </SlideOver>
    );

  return (
    <ProductForm
      key={id ?? "new"}
      product={existing.data?.product ?? null}
      moves={existing.data?.moves ?? []}
      initialBarcode={initialBarcode}
      onClose={onClose}
    />
  );
}

function ProductForm({
  product,
  moves,
  initialBarcode,
  onClose,
}: {
  product: ProductRow | null;
  moves: MoveRow[];
  initialBarcode: string | null;
  onClose: () => void;
}) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<Form>(product ? toForm(product) : { ...EMPTY, barcode: initialBarcode ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const programs = useQuery({ queryKey: ["programs"], queryFn: () => api.call("listPrograms") });

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["products"] });
    void qc.invalidateQueries({ queryKey: ["product"] });
    void qc.invalidateQueries({ queryKey: ["programs"] });
  };

  const save = useMutation({
    mutationFn: (input: ProductInput) =>
      api.call(
        "saveProduct",
        product ? { ...input, id: product.id } : { ...input, openingOnHand: Number(f.onHand) },
      ),
    onSuccess: () => {
      toast("Product saved");
      refresh();
      onClose();
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast(errorMessage(err));
    },
  });

  const archive = useMutation({
    mutationFn: (archived: boolean) => api.call("archiveProduct", { id: product!.id, archived }),
    onSuccess: (_r, archived) => {
      toast(archived ? "Product archived" : "Product restored");
      refresh();
      onClose();
    },
    onError: (err) => toast(errorMessage(err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const { input, errors: parseErrors } = toInput(f);
    if (!product && (!Number.isInteger(Number(f.onHand)) || Number(f.onHand) < 0))
      parseErrors.onHand = "On hand must be 0 or more.";
    setErrors(parseErrors);
    if (Object.keys(parseErrors).length) return;
    save.mutate(input);
  }

  const err = (k: string) =>
    errors[k] ? (
      <span className="field-error" id={`err-${k}`}>
        {errors[k]}
      </span>
    ) : null;
  const inv = (k: string) => ({
    "aria-invalid": !!errors[k],
    "aria-describedby": errors[k] ? `err-${k}` : undefined,
  });

  return (
    <SlideOver title={product ? `Edit ${product.name}` : "New product"} onClose={onClose}>
      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <div className="form">
          <label>
            SKU
            <input value={f.sku} onChange={set("sku")} required autoFocus={!product} {...inv("sku")} />
            {err("sku")}
          </label>
          <label>
            Barcode (UPC)
            <span className="actions" style={{ flexWrap: "nowrap" }}>
              <input value={f.barcode} onChange={set("barcode")} inputMode="numeric" {...inv("barcode")} />
              <CameraButton
                label="Scan"
                title="Scan the barcode"
                onCode={(c) => setF((x) => ({ ...x, barcode: c }))}
              />
            </span>
            {err("barcode")}
          </label>
        </div>
        <label>
          Name
          <input value={f.name} onChange={set("name")} required {...inv("name")} />
          {err("name")}
        </label>
        <div className="form">
          <label>
            Brand
            <input value={f.brand} onChange={set("brand")} />
          </label>
          <label>
            Category
            <select value={f.category} onChange={set("category")}>
              {[...new Set([...CATEGORIES, f.category])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Price ($)
            <input
              value={f.price}
              onChange={set("price")}
              inputMode="decimal"
              required
              {...inv("priceCents")}
            />
            {err("priceCents")}
          </label>
          <label>
            Cost ($)
            <input value={f.cost} onChange={set("cost")} inputMode="decimal" {...inv("costCents")} />
            {err("costCents")}
          </label>
          {!product && (
            <label>
              On hand
              <input
                type="number"
                min={0}
                step={1}
                value={f.onHand}
                onChange={set("onHand")}
                inputMode="numeric"
                {...inv("onHand")}
              />
              {err("onHand")}
            </label>
          )}
          <label>
            Reorder at
            <input
              type="number"
              min={0}
              step={1}
              value={f.reorderAt}
              onChange={set("reorderAt")}
              inputMode="numeric"
              {...inv("reorderAt")}
            />
            {err("reorderAt")}
          </label>
          <label>
            Sales tax
            <select value={f.taxClass} onChange={set("taxClass")}>
              <option value="standard">Taxable</option>
              <option value="exempt">Not taxed</option>
            </select>
          </label>
        </div>
        {product && (
          <p className="muted" style={{ fontSize: ".88rem" }}>
            On hand: {product.onHand}. Change stock with Receive or Count stock, so every change is recorded.
          </p>
        )}

        <fieldset className="form" style={{ border: 0, padding: 0, margin: 0 }}>
          <label>
            Astro frequent buyer program
            <select value={f.astroProgramId} onChange={set("astroProgramId")}>
              <option value="">None</option>
              {programs.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Astro offer label
            <input
              value={f.offerLabel}
              onChange={set("offerLabel")}
              placeholder="e.g. $5 off 24 lb bag"
              {...inv("offerLabel")}
            />
            {err("offerLabel")}
          </label>
          <label>
            Astro offer amount ($)
            <input
              value={f.offerAmount}
              onChange={set("offerAmount")}
              inputMode="decimal"
              {...inv("offerCents")}
            />
            {err("offerCents")}
          </label>
        </fieldset>

        <div className="actions">
          <button className="primary" type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save product"}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {product && (
            <span style={{ marginLeft: "auto" }}>
              {product.active ? (
                <TwoTapButton
                  className="danger"
                  label="Archive"
                  confirmLabel="Tap again to archive"
                  onConfirm={() => archive.mutate(true)}
                  disabled={archive.isPending}
                />
              ) : (
                <button type="button" onClick={() => archive.mutate(false)} disabled={archive.isPending}>
                  Restore
                </button>
              )}
            </span>
          )}
        </div>
      </form>

      {product && (
        <section style={{ display: "grid", gap: 6 }}>
          <h3>Stock history</h3>
          {moves.length === 0 && <p className="muted">No stock changes yet.</p>}
          {moves.map((m) => (
            <p key={m.id} style={{ fontSize: ".9rem" }}>
              <b className={`diff ${m.qtyChange > 0 ? "up" : "down"}`}>
                {m.qtyChange > 0 ? `+${m.qtyChange}` : `−${-m.qtyChange}`}
              </b>{" "}
              {REASON[m.reason]}
              {m.note && m.note !== REASON[m.reason] ? ` · ${m.note}` : ""}
              <span className="sub">
                {new Date(m.createdAt).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {m.staffName ? ` · ${m.staffName}` : ""}
              </span>
            </p>
          ))}
        </section>
      )}
    </SlideOver>
  );
}

const REASON: Record<MoveRow["reason"], string> = {
  sale: "Sold",
  receive: "Received",
  adjust: "Adjusted",
  return: "Returned",
};
