import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SIZES, type PetSize } from "@pet-pos/core";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { useToast } from "../../ui/Toast.tsx";

interface Row {
  productId: string;
  qty: Record<PetSize, string>;
}

const blank = (): Record<PetSize, string> => ({ S: "", M: "", L: "", XL: "" });

/** "Supplies used": back-bar products a service uses, by pet size. */
export function SuppliesEditor({ serviceId }: { serviceId: string }) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const current = useQuery({
    queryKey: ["serviceSupplies", serviceId],
    queryFn: () => api.call("listServiceSupplies", { serviceId }),
  });
  const products = useQuery({
    queryKey: ["products", "supplies"],
    queryFn: () => api.call("listProducts", {}),
  });
  // What the server has, until someone edits it here.
  const [edited, setRows] = useState<Row[] | null>(null);
  const rows: Row[] | null =
    edited ??
    (current.data
      ? current.data.map((x) => ({
          productId: x.productId,
          qty: Object.fromEntries(SIZES.map((z) => [z, String(x.qty[z])])) as Record<PetSize, string>,
        }))
      : null);

  const save = useMutation({
    mutationFn: () =>
      api.call("saveServiceSupplies", {
        serviceId,
        supplies: (rows ?? [])
          .filter((r) => r.productId)
          .map((r) => ({
            productId: r.productId,
            qty: Object.fromEntries(SIZES.map((z) => [z, Number(r.qty[z] || "0")])) as Record<
              PetSize,
              number
            >,
          })),
      }),
    onSuccess: () => {
      toast("Supplies saved");
      void qc.invalidateQueries({ queryKey: ["serviceSupplies", serviceId] });
    },
    onError: (err) => toast(errorMessage(err)),
  });

  const list = products.data ?? [];
  // Back-bar supplies first, then everything else (a retail product used on grooms).
  const options = [...list.filter((p) => p.backBar), ...list.filter((p) => !p.backBar)];
  const unit = (id: string) => list.find((p) => p.id === id)?.unit ?? "each";
  const set = (i: number, r: Partial<Row>) =>
    setRows((rows ?? []).map((x, j) => (j === i ? { ...x, ...r } : x)));

  return (
    <section style={{ display: "grid", gap: 8 }}>
      <h3 style={{ margin: 0 }}>Supplies used</h3>
      <p className="muted small" style={{ margin: 0 }}>
        These come off stock when a groom is marked ready for pickup, at the pet's size.
      </p>
      {(rows ?? []).map((r, i) => (
        <div key={i} style={{ display: "grid", gap: 6 }}>
          <div className="actions" style={{ alignItems: "center" }}>
            <select
              value={r.productId}
              onChange={(e) => set(i, { productId: e.target.value })}
              aria-label={`Supply ${i + 1}`}
              style={{ flex: 1 }}
            >
              <option value="">Pick a product</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.backBar ? " (back-bar)" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="link"
              onClick={() => setRows((rows ?? []).filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
          <div className="sizegrid">
            <span className="muted">{r.productId ? unit(r.productId) : ""}</span>
            {SIZES.map((z) => (
              <input
                key={z}
                type="number"
                min={0}
                step={1}
                value={r.qty[z]}
                placeholder={z}
                aria-label={`Supply ${i + 1} amount for size ${z}`}
                onChange={(e) => set(i, { qty: { ...r.qty, [z]: e.target.value } })}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="actions">
        <button type="button" onClick={() => setRows([...(rows ?? []), { productId: "", qty: blank() }])}>
          Add supply
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => save.mutate()}
          disabled={save.isPending || rows === null}
        >
          Save supplies
        </button>
      </div>
    </section>
  );
}
