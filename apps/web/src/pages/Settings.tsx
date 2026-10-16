import { useQuery } from "@tanstack/react-query";
import { ROLE_LABEL } from "@pet-pos/core";
import { useSession } from "../session.tsx";

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
