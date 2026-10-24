import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { formatMoney, formatTaxPercent, todayIso } from "@pet-pos/core";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";

/** Local midnight of `from` to the midnight after `to`, both "YYYY-MM-DD". */
export function daysRange(from: string, to: string): { from: string; to: string } {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  return {
    from: new Date(fy, fm - 1, fd).toISOString(),
    to: new Date(ty, tm - 1, td + 1).toISOString(),
  };
}

function monthStart(now = new Date()): string {
  return todayIso(new Date(now.getFullYear(), now.getMonth(), 1));
}

/** "−$4.00" for a loss, so a negative never hides in the column. */
function money(cents: number): string {
  return cents < 0 ? `−${formatMoney(-cents)}` : formatMoney(cents);
}

export function ProfitPage() {
  const { api } = useSession();
  const today = todayIso();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today);
  const range = from <= to ? daysRange(from, to) : null;
  const report = useQuery({
    queryKey: ["profitByGame", range],
    queryFn: () => api.call("profitByGame", range!),
    enabled: !!range,
  });
  const estimated = report.data?.games.some((g) => g.estimatedCostLines > 0);

  return (
    <>
      <div className="page-head">
        <h1>Profit by game</h1>
        <Link to="..">Back to sales</Link>
      </div>
      <div className="toolbar">
        <label>
          <span className="muted small">From </span>
          <input
            type="date"
            value={from}
            max={today}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
            aria-label="From"
          />
        </label>
        <label>
          <span className="muted small">To </span>
          <input
            type="date"
            value={to}
            max={today}
            onChange={(e) => e.target.value && setTo(e.target.value)}
            aria-label="To"
          />
        </label>
      </div>
      {!range && <p className="error-box">Pick a start date on or before the end date.</p>}
      {report.isError && <p className="error-box">{errorMessage(report.error)}</p>}
      {report.data && (
        <div className="kpis">
          <Kpi label="Units sold" value={String(report.data.totals.units)} />
          <Kpi label="Revenue" value={money(report.data.totals.revenueCents)} />
          <Kpi label="Our cost" value={money(report.data.totals.costCents)} />
          <Kpi label="Net profit" value={money(report.data.totals.profitCents)} />
          <Kpi label="Royalties owed" value={formatMoney(report.data.totals.royaltyCents)} />
        </div>
      )}
      <div className="tablewrap">
        <table className="wide">
          <thead>
            <tr>
              <th>Game</th>
              <th className="r">Units</th>
              <th className="r">Revenue</th>
              <th className="r">Our cost</th>
              <th className="r">Net profit</th>
              <th className="r">Royalty</th>
              <th>Paid to</th>
            </tr>
          </thead>
          <tbody>
            {report.data?.games.map((g) => (
              <tr key={g.productId}>
                <td>
                  <b>{g.name}</b>
                  {g.sku && <span className="sub mono">{g.sku}</span>}
                </td>
                <td className="r num">{g.units}</td>
                <td className="r num">{money(g.revenueCents)}</td>
                <td className="r num">
                  {money(g.costCents)}
                  {g.estimatedCostLines > 0 && " *"}
                </td>
                <td className="r num">
                  <b>{money(g.profitCents)}</b>
                </td>
                <td className="r num">
                  {g.royaltyMpct ? (
                    <>
                      {formatMoney(g.royaltyCents)}
                      <span className="sub">{formatTaxPercent(g.royaltyMpct)} of profit</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{g.royaltyPayee ?? (g.royaltyMpct ? "Not set" : "")}</td>
              </tr>
            ))}
            {report.data && report.data.games.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No games sold in these dates.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Revenue is what customers paid after discounts, before tax, less refunds. Our cost counts every unit
        that left the shelf, including refunds that weren't put back. Royalties are the rate on each game's
        net profit; a game with no profit owes none.
        {estimated &&
          " * Some sales were rung before costs were saved on each sale, so they use today's cost."}
      </p>
    </>
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
