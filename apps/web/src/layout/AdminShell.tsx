import { Navigate, NavLink, Route, Routes } from "react-router";
import { ROLE_LABEL } from "@pet-pos/core";
import type { Me } from "@pet-pos/api";
import { AstroPage } from "../pages/AstroPage.tsx";
import { ComingSoon } from "../pages/ComingSoon.tsx";
import { CustomersRoutes } from "../pages/customers/CustomersPage.tsx";
import { InventoryRoutes } from "../pages/inventory/InventoryPage.tsx";
import { Settings } from "../pages/Settings.tsx";
import { DemoBanner } from "./DemoBanner.tsx";
import { navFor } from "./nav.ts";

interface Props {
  me: Me;
  onSwitchRole: () => void;
  onResetDemo: () => Promise<void>;
}

const PAGES: Record<string, () => React.ReactNode> = {
  "/register": () => (
    <ComingSoon title="Register" phase={2}>
      Scan items, attach a customer by phone, and take card or cash payments on the Square Terminal.
    </ComingSoon>
  ),
  "/grooming": () => (
    <ComingSoon title="Grooming" phase={3}>
      Day and week calendar per groomer, check-in, and sending a finished groom to the register.
    </ComingSoon>
  ),
  "/inventory": () => <InventoryRoutes />,
  "/customers": () => <CustomersRoutes />,
  "/sales": () => (
    <ComingSoon title="Sales" phase={2}>
      Today's sales by payment type, refunds and the end-of-day drawer count.
    </ComingSoon>
  ),
  "/astro": () => <AstroPage />,
  "/settings": () => <Settings />,
};

export function AdminShell({ me, onSwitchRole, onResetDemo }: Props) {
  const nav = navFor(me.staff.role);
  const home = nav[0]?.path ?? "/settings";

  return (
    <div className="shell">
      <DemoBanner onReset={onResetDemo} />
      <nav className="sidebar" aria-label="Main">
        <div className="store">
          <b>{me.business.name}</b>
          {me.location && <small>{me.location.name}</small>}
        </div>
        {nav.map((n) => (
          <NavLink key={n.path} to={n.path}>
            {n.label}
          </NavLink>
        ))}
        <div className="who">
          <span>
            {me.staff.name} · {ROLE_LABEL[me.staff.role]}
          </span>
          <button type="button" onClick={onSwitchRole}>
            Switch role
          </button>
        </div>
      </nav>
      <main className="main">
        <Routes>
          {nav.map((n) => (
            <Route key={n.path} path={`${n.path}/*`} element={PAGES[n.path]?.()} />
          ))}
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
    </div>
  );
}
