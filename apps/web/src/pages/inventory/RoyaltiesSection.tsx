// Who earns royalties on one game, with a rate for counter, website and wholesale sales.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  BASIS_LABELS,
  parseTaxPercent,
  SALE_TYPE_LABELS,
  SALE_TYPES,
  taxPercentInput,
  type RoyaltyBasis,
  type SaleType,
} from "@bearded/core";
import type { GameRoyalty, RoyaltyPayee, SaveGameRoyaltiesInput } from "@bearded/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { useToast } from "../../ui/Toast.tsx";

const NEW = "new";

interface Row {
  key: number;
  /** A person's id, or NEW to type a name. */
  payeeId: string;
  newName: string;
  basis: RoyaltyBasis;
  rates: Record<SaleType, string>;
}

let seq = 0;

function toRow(g: GameRoyalty): Row {
  return {
    key: seq++,
    payeeId: g.payeeId,
    newName: "",
    basis: g.basis,
    rates: {
      retail: taxPercentInput(g.rates.retail),
      online: taxPercentInput(g.rates.online),
      wholesale: taxPercentInput(g.rates.wholesale),
    },
  };
}

export function RoyaltiesSection({ productId }: { productId: string }) {
  const { api } = useSession();
  const terms = useQuery({
    queryKey: ["gameRoyalties", productId],
    queryFn: () => api.call("gameRoyalties", { productId }),
  });
  const payees = useQuery({
    queryKey: ["royaltyPayees"],
    queryFn: () => api.call("listRoyaltyPayees"),
  });

  return (
    <section style={{ display: "grid", gap: 8 }}>
      <h3>Royalties</h3>
      {(terms.isError || payees.isError) && (
        <p className="error-box">{errorMessage(terms.error ?? payees.error)}</p>
      )}
      {terms.data && payees.data && (
        <RoyaltyRows productId={productId} saved={terms.data} payees={payees.data} />
      )}
    </section>
  );
}

function RoyaltyRows({
  productId,
  saved,
  payees,
}: {
  productId: string;
  saved: GameRoyalty[];
  payees: RoyaltyPayee[];
}) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(() => saved.map(toRow));
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (terms: SaveGameRoyaltiesInput["terms"]) =>
      api.call("saveGameRoyalties", { productId, terms }),
    onSuccess: (after) => {
      toast("Royalties saved");
      setRows(after.map(toRow));
      void qc.invalidateQueries({ queryKey: ["gameRoyalties", productId] });
      void qc.invalidateQueries({ queryKey: ["royaltyPayees"] });
      void qc.invalidateQueries({ queryKey: ["royaltyReport"] });
    },
    onError: (err) => setProblem(errorMessage(err)),
  });

  const change = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function add() {
    const taken = new Set(rows.map((r) => r.payeeId));
    const first = payees.find((p) => p.active && !taken.has(p.id));
    setRows([
      ...rows,
      {
        key: seq++,
        payeeId: first?.id ?? NEW,
        newName: "",
        basis: "profit",
        rates: { retail: "", online: "", wholesale: "" },
      },
    ]);
  }

  function submit() {
    setProblem(null);
    const terms: SaveGameRoyaltiesInput["terms"] = [];
    for (const r of rows) {
      const rates = {} as Record<SaleType, number>;
      for (const st of SALE_TYPES) {
        const v = r.rates[st].trim() ? parseTaxPercent(r.rates[st]) : 0;
        if (v === null)
          return setProblem(`${SALE_TYPE_LABELS[st]} rate: enter a percent from 0 to 100, like 10 or 7.5.`);
        rates[st] = v;
      }
      if (r.payeeId === NEW && !r.newName.trim()) return setProblem("Type the new person's name.");
      terms.push({
        payeeId: r.payeeId === NEW ? null : r.payeeId,
        newPayeeName: r.payeeId === NEW ? r.newName.trim() : null,
        basis: r.basis,
        rates,
      });
    }
    save.mutate(terms);
  }

  return (
    <>
      {rows.length === 0 && <p className="muted">No one earns royalties on this game.</p>}
      {rows.map((r) => (
        <fieldset key={r.key} className="royalty-row" style={{ display: "grid", gap: 8 }}>
          <div className="form">
            <label>
              Paid to
              <select value={r.payeeId} onChange={(e) => change(r.key, { payeeId: e.target.value })}>
                {payees
                  .filter((p) => p.active || p.id === r.payeeId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                <option value={NEW}>+ Someone new…</option>
              </select>
            </label>
            {r.payeeId === NEW && (
              <label>
                New person's name
                <input
                  value={r.newName}
                  maxLength={100}
                  placeholder="e.g. the designer"
                  onChange={(e) => change(r.key, { newName: e.target.value })}
                />
              </label>
            )}
            <label>
              Royalty on
              <select
                value={r.basis}
                onChange={(e) => change(r.key, { basis: e.target.value as RoyaltyBasis })}
              >
                <option value="profit">{BASIS_LABELS.profit}</option>
                <option value="sales">Sales (what was paid)</option>
              </select>
            </label>
          </div>
          <div className="form">
            {SALE_TYPES.map((st) => (
              <label key={st}>
                {SALE_TYPE_LABELS[st]} %
                <input
                  value={r.rates[st]}
                  inputMode="decimal"
                  placeholder="0"
                  onChange={(e) => change(r.key, { rates: { ...r.rates, [st]: e.target.value } })}
                />
              </label>
            ))}
          </div>
          <div>
            <button
              type="button"
              className="link"
              onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
            >
              Remove
            </button>
          </div>
        </fieldset>
      ))}
      {problem && <p className="error-box">{problem}</p>}
      <div className="actions">
        <button type="button" onClick={add}>
          Add a person
        </button>
        <button type="button" className="primary" onClick={submit} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save royalties"}
        </button>
      </div>
      <p className="muted small">
        Counter is sales rung here, Website is online orders, Wholesale is sales to stores at the wholesale
        price. A rate of 0 earns nothing on that kind of sale.
      </p>
    </>
  );
}
