import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { can } from "@pet-pos/core";
import type { ProgramRow } from "@pet-pos/api";
import { useSession } from "../session.tsx";
import { errorMessage, fieldErrors } from "../ui/errors.ts";
import { useToast } from "../ui/Toast.tsx";

const BLANK = { name: "", brand: "", buyCount: "12", rewardText: "Next bag free" };

export function AstroPage() {
  const { api, me } = useSession();
  const canEdit = can(me.staff.role, "astro.edit");
  const programs = useQuery({ queryKey: ["programs"], queryFn: () => api.call("listPrograms") });
  const [editing, setEditing] = useState<ProgramRow | null>(null);

  return (
    <>
      <div className="page-head">
        <h1>Astro Loyalty</h1>
      </div>
      <div className="note">
        <b>Connection: not linked yet</b>
        <span>
          Astro gives API credentials only to approved POS partners. Until this register is approved, every
          sale with frequent buyer credit or a redeemed offer lands in a queue here. Enter each one in the
          Astro retailer portal, then mark it entered.
        </span>
        <span>
          Once Astro issues credentials, that queue is the single place the live connection plugs in, so
          cashiers won't change how they ring sales.
        </span>
      </div>

      <h2>Frequent buyer programs</h2>
      {canEdit && (
        <ProgramForm key={editing?.id ?? "new"} program={editing} onDone={() => setEditing(null)} />
      )}
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Program</th>
              <th>Brand</th>
              <th className="r">Buy</th>
              <th>Reward</th>
              <th className="r">Products</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {programs.data?.map((p) => (
              <tr key={p.id}>
                <td>
                  <b>{p.name}</b>
                </td>
                <td>{p.brand}</td>
                <td className="r num">{p.buyCount}</td>
                <td>{p.rewardText}</td>
                <td className="r num">{p.productCount}</td>
                {canEdit && (
                  <td>
                    <button type="button" onClick={() => setEditing(p)}>
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {programs.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Add the brand programs this store is enrolled in through Astro, then link products to them
                  in Inventory.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>To enter in Astro</h2>
      <p className="muted">
        Comes with the register in Phase 2: sales with Astro credit or offers will show up here to enter in
        the portal.
      </p>
    </>
  );
}

function ProgramForm({ program, onDone }: { program: ProgramRow | null; onDone: () => void }) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState(
    program
      ? {
          name: program.name,
          brand: program.brand ?? "",
          buyCount: String(program.buyCount),
          rewardText: program.rewardText,
        }
      : BLANK,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () =>
      api.call("saveProgram", {
        id: program?.id,
        name: f.name,
        brand: f.brand,
        buyCount: Number(f.buyCount),
        rewardText: f.rewardText,
      }),
    onSuccess: () => {
      toast(program ? "Program saved" : "Program added");
      setF(BLANK);
      setErrors({});
      void qc.invalidateQueries({ queryKey: ["programs"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      onDone();
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast(errorMessage(err));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <form className="form" style={{ alignItems: "end" }} onSubmit={submit}>
      <label>
        Program name
        <input
          value={f.name}
          onChange={set("name")}
          required
          placeholder="Brand X dry food"
          aria-invalid={!!errors.name}
        />
        {errors.name && <span className="field-error">{errors.name}</span>}
      </label>
      <label>
        Brand
        <input value={f.brand} onChange={set("brand")} />
      </label>
      <label>
        Buy how many
        <input type="number" min={2} step={1} value={f.buyCount} onChange={set("buyCount")} required />
      </label>
      <label>
        Reward
        <input value={f.rewardText} onChange={set("rewardText")} />
      </label>
      <div className="actions">
        <button className="primary" disabled={save.isPending}>
          {program ? "Save program" : "Add program"}
        </button>
        {program && (
          <button type="button" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
