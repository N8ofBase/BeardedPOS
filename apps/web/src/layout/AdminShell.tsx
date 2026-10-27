import { Navigate, NavLink, Route, Routes, useLocation } from "react-router";
import { ErrorBoundary } from "../ui/ErrorBoundary.tsx";
import { StoreMark } from "../ui/StoreMark.tsx";
import { isHexColor, readableOn, ROLE_LABEL } from "@bearded/core";
import type { Me } from "@bearded/api";
import { CustomersRoutes } from "../pages/customers/CustomersPage.tsx";
import { EmailRoutes } from "../pages/email/EmailPage.tsx";
import { InventoryRoutes } from "../pages/inventory/InventoryPage.tsx";
import { RegisterPage } from "../pages/register/RegisterPage.tsx";
import { SalesRoutes } from "../pages/SalesPage.tsx";
import { SettingsRoutes } from "../pages/Settings.tsx";
import { DemoBanner } from "./DemoBanner.tsx";
import { navFor } from "./nav.ts";

interface Props {
  me: Me;
  onSwitchRole: () => void;
  onResetDemo: () => Promise<void>;
  /** The register on the store's server: a test banner without reset, and the button signs out. */
  hosted?: boolean;
}

const PAGES: Record<string, () => React.ReactNode> = {
  "/register": () => <RegisterPage />,
  "/inventory": () => <InventoryRoutes />,
  "/customers": () => <CustomersRoutes />,
  "/email": () => <EmailRoutes />,
  "/sales": () => <SalesRoutes />,
  "/settings": () => <SettingsRoutes />,
};

export function AdminShell({ me, onSwitchRole, onResetDemo, hosted }: Props) {
  const location = useLocation();
  const nav = navFor(me.staff.role);
  const brand = isHexColor(me.business.brandColor) ? me.business.brandColor! : "#0f6e5a";
  const brandText = readableOn(brand);
  const home = nav[0]?.path ?? "/settings";

  return (
    <div className="shell">
      {hosted ? (
        <div className="demo-banner" role="status">
          <span>Test register · sample data, and card payments are simulated</span>
        </div>
      ) : (
        <DemoBanner onReset={onResetDemo} />
      )}
      <nav className="sidebar" aria-label="Main">
        <div
          className="store-header store"
          data-testid="store-header"
          style={{ background: brand, color: brandText }}
        >
          <StoreMark name={me.business.name} logo={me.business.logo} color={brandText} />
          <span>
            <b>{me.business.name}</b>
            {me.location && <small>{me.location.name}</small>}
          </span>
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
            {hosted ? "Sign out" : "Switch role"}
          </button>
        </div>
      </nav>
      <main className="main">
        <ErrorBoundary resetKey={location.pathname}>
          <Routes>
            {nav.map((n) => (
              <Route key={n.path} path={`${n.path}/*`} element={PAGES[n.path]?.()} />
            ))}
            <Route path="*" element={<Navigate to={home} replace />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
