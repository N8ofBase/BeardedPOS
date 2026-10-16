import { useQuery } from "@tanstack/react-query";
import { Link, Route, Routes } from "react-router";
import { can, ROLE_LABEL } from "@pet-pos/core";
import { useSession } from "../session.tsx";
import { ImportPage } from "./settings/ImportPage.tsx";

export function SettingsRoutes() {
  return (
    <Routes>
      <Route index element={<Settings />} />
      <Route path="import" element={<ImportPage />} />
    </Routes>
  );
}

/** Tax rate in basis points → "7%", "8.25%". */
export function formatTaxRate(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const frac = String(bp % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""}%`;
}

export function Settings() {
  const { api, me, switchRole } = useSession();
  const staff = useQuery({ queryKey: ["staff", me.business.id], queryFn: () => api.call("listStaff") });

  return (
    <>
      <div className="page-head">
        <h1>Store settings</h1>
        <button type="button" onClick={switchRole}>
          Switch role
        </button>
      </div>

      <section className="panel">
        <h2>Store</h2>
        <p>
          <b>{me.business.name}</b>
        </p>
        {me.location && (
          <p className="muted">
            {me.location.name} · sales tax {formatTaxRate(me.location.taxRateBp)}
          </p>
        )}
        <p className="muted">
          Editing the store name, logo, colors and tax rate comes with the rest of Settings.
        </p>
      </section>

      {can(me.staff.role, "import.run") && (
        <section className="panel">
          <h2>Bulk import</h2>
          <p className="muted">
            Load customers and pets, products, Astro programs and punch balances from a CSV or Excel file. You
            see a preview before anything is saved, and any import can be undone.
          </p>
          <div>
            <Link to="import">Import a file</Link>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Staff</h2>
        {staff.isPending && <p className="muted">Loading staff…</p>}
        {staff.isError && <p className="muted">Couldn't load staff. Reload the page and try again.</p>}
        {staff.data?.map((s) => (
          <p key={s.id}>
            {s.name} <span className="muted">· {ROLE_LABEL[s.role]}</span>
          </p>
        ))}
      </section>
    </>
  );
}
