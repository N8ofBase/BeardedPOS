// The monthly royalties statement: what each person earned on each game, by sale type, plus the
// list of people who earn royalties. Rates are set per game in Inventory.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import {
  BASIS_LABELS,
  can,
  centsText,
  formatMoney,
  formatTaxPercent,
  SALE_TYPE_LABELS,
  SALE_TYPES,
  toCsv,
  type RoyaltyBasis,
} from "@bearded/core";
import type { RoyaltyPayee, RoyaltyReport } from "@bearded/api";
import { useSession } from "../../session.tsx";
import { errorMessage, fieldErrors } from "../../ui/errors.ts";
import { useToast } from "../../ui/Toast.tsx";

/** "YYYY-MM" for a date, in local time. */
export function monthOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Local midnight on the 1st of the month to the 1st of the next. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 1).toISOString() };
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** "−$4.00" for a loss, so a negative never hides in the column. */
function money(cents: number): string {
  return cents < 0 ? `−${formatMoney(-cents)}` : formatMoney(cents);
}

const basisNote = (b: RoyaltyBasis) => (b === "profit" ? "of profit" : "of sales");

/** Every line of the statement as spreadsheet rows. */
export function royaltyCsv(report: RoyaltyReport, month: string): string {
  const rows: (string | number)[][] = [
    [
      "Month",
      "Paid to",
      "Email",
      "Game",
      "SKU",
      "Sale type",
      "Units",
      "Sales",
      "Our cost",
      "Net profit",
      "Royalty on",
      "Rate %",
      "Royalty",
    ],
  ];
  for (const p of report.people)
    for (const g of p.games)
      for (const c of g.cells)
        rows.push([
          month,
          p.name,
          p.email ?? "",
          g.name,
          g.sku ?? "",
          SALE_TYPE_LABELS[c.saleType],
          c.units,
          centsText(c.revenueCents),
          centsText(c.costCents),
          centsText(c.profitCents),
          BASIS_LABELS[g.basis],
          formatTaxPercent(c.rateMpct).replace("%", ""),
          centsText(c.royaltyCents),
        ]);
  return toCsv(rows);
}

export function RoyaltiesPage() {
  const { api, me } = useSession();
  const now = new Date();
  const thisMonth = monthOf(now);
  const lastMonth = monthOf(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const [month, setMonth] = useState(lastMonth);
  const report = useQuery({
    queryKey: ["royaltyReport", month],
    queryFn: () => api.call("royaltyReport", monthRange(month)),
  });

  function download() {
    if (!report.data) return;
    const blob = new Blob([royaltyCsv(report.data, month)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `royalties-${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <div className="page-head">
        <h1>Royalties</h1>
        <span className="muted">{monthLabel(month)}</span>
        <Link to="..">Back to sales</Link>
      </div>
      <div className="toolbar">
        <div className="cat-tabs" style={{ marginTop: 0 }}>
          <button type="button" aria-pressed={month === lastMonth} onClick={() => setMonth(lastMonth)}>
            Last month
          </button>
          <button type="button" aria-pressed={month === thisMonth} onClick={() => setMonth(thisMonth)}>
            This month
          </button>
        </div>
        <label>
          <span className="muted small">Month </span>
          <input
            type="month"
            value={month}
            max={thisMonth}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            aria-label="Pick a month"
          />
        </label>
        <button type="button" onClick={download} disabled={!report.data?.people.length}>
          Download CSV
        </button>
        <button type="button" onClick={() => window.print()} disabled={!report.data}>
          Print
        </button>
      </div>
      {report.isError && <p className="error-box">{errorMessage(report.error)}</p>}
      {report.data && (
        <div className="kpis">
          <Kpi label="Royalties owed" value={formatMoney(report.data.totalCents)} />
          {SALE_TYPES.map((t) => (
            <Kpi key={t} label={SALE_TYPE_LABELS[t]} value={formatMoney(report.data.byType[t])} />
          ))}
        </div>
      )}
      {report.data && report.data.people.length === 0 && (
        <p className="muted">No royalties for {monthLabel(month)}: none of the games with royalties sold.</p>
      )}
      {report.data?.people.map((p) => (
        <section key={p.payeeId} className="card" style={{ width: "100%", gap: 8, marginBottom: 16 }}>
          <div className="page-head" style={{ margin: 0 }}>
            <h2 style={{ margin: 0 }}>{p.name}</h2>
            {p.email && <span className="muted">{p.email}</span>}
            <b className="num" style={{ marginLeft: "auto" }}>
              {formatMoney(p.royaltyCents)}
            </b>
          </div>
          <div className="tablewrap">
            <table className="wide">
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Sale type</th>
                  <th className="r">Units</th>
                  <th className="r">Sales</th>
                  <th className="r">Net profit</th>
                  <th className="r">Rate</th>
                  <th className="r">Royalty</th>
                </tr>
              </thead>
              <tbody>
                {p.games.flatMap((g) =>
                  g.cells.map((c, i) => (
                    <tr key={`${g.productId}-${c.saleType}`}>
                      <td>
                        {i === 0 && (
                          <>
                            <b>{g.name}</b>
                            {g.sku && <span className="sub mono">{g.sku}</span>}
                          </>
                        )}
                      </td>
                      <td>{SALE_TYPE_LABELS[c.saleType]}</td>
                      <td className="r num">{c.units}</td>
                      <td className="r num">{money(c.revenueCents)}</td>
                      <td className="r num">{money(c.profitCents)}</td>
                      <td className="r num">
                        {formatTaxPercent(c.rateMpct)}
                        <span className="sub">{basisNote(g.basis)}</span>
                      </td>
                      <td className="r num">
                        <b>{formatMoney(c.royaltyCents)}</b>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="muted small">
        Counter is sales rung on the register, Website is online orders, Wholesale is sales to stores at the
        wholesale price. Sales are after discounts and before tax. Refunds count in the month they're given,
        so a month you've paid never changes. When a game's profit or sales for a sale type is zero or less in
        a month, it earns nothing that month. Set who earns what on each game in Inventory.
      </p>

      {can(me.staff.role, "products.edit") && <People />}
    </>
  );
}

function People() {
  const { api } = useSession();
  const payees = useQuery({
    queryKey: ["royaltyPayees"],
    queryFn: () => api.call("listRoyaltyPayees"),
  });
  const [editing, setEditing] = useState<RoyaltyPayee | "new" | null>(null);

  return (
    <section style={{ display: "grid", gap: 8, marginTop: 24 }}>
      <div className="page-head" style={{ margin: 0 }}>
        <h2 style={{ margin: 0 }}>People who earn royalties</h2>
        <button type="button" onClick={() => setEditing("new")}>
          Add a person
        </button>
      </div>
      {payees.isError && <p className="error-box">{errorMessage(payees.error)}</p>}
      {editing && <PayeeForm payee={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      <div className="tablewrap">
        <table className="wide">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th className="r">Games</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {payees.data?.map((p) => (
              <tr key={p.id} className={p.active ? undefined : "muted"}>
                <td>
                  <b>{p.name}</b>
                  {!p.active && <span className="sub">Not active</span>}
                  {p.notes && <span className="sub">{p.notes}</span>}
                </td>
                <td>{p.email ?? ""}</td>
                <td className="r num">{p.games}</td>
                <td className="r">
                  <button type="button" className="link" onClick={() => setEditing(p)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {payees.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No one yet. Add a person here, or on a game in Inventory.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PayeeForm({ payee, onDone }: { payee: RoyaltyPayee | null; onDone: () => void }) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(payee?.name ?? "");
  const [email, setEmail] = useState(payee?.email ?? "");
  const [notes, setNotes] = useState(payee?.notes ?? "");
  const [active, setActive] = useState(payee?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => api.call("saveRoyaltyPayee", { id: payee?.id, name, email, notes, active }),
    onSuccess: () => {
      toast(payee ? "Saved" : `${name.trim()} added`);
      void qc.invalidateQueries({ queryKey: ["royaltyPayees"] });
      void qc.invalidateQueries({ queryKey: ["royaltyReport"] });
      onDone();
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast(errorMessage(err));
    },
  });

  return (
    <form
      className="card"
      style={{ display: "grid", gap: 10 }}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="form">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus />
          {errors.name && <span className="field-error">{errors.name}</span>}
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {errors.email && <span className="field-error">{errors.email}</span>}
        </label>
      </div>
      <label>
        Notes
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          placeholder="e.g. paid by PayPal, contract signed 2025"
        />
      </label>
      {payee && (
        <label className="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
          (inactive people can't be added to more games; what they earned still shows)
        </label>
      )}
      <div className="actions">
        <button className="primary" disabled={save.isPending}>
          {save.isPending ? "Saving…" : payee ? "Save" : "Add person"}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <span className="muted">{label}</span>
      <b className="num">{value}</b>
    </div>
  );
}
