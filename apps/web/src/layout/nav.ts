import { can, type Action, type Role } from "@bearded/core";

export interface NavItem {
  path: string;
  label: string;
  action: Action;
}

/** Sidebar order follows the prototype's tabs. Items a role can't use are hidden, not disabled. */
export const NAV: NavItem[] = [
  { path: "/register", label: "Register", action: "register.use" },
  { path: "/inventory", label: "Inventory", action: "products.view" },
  { path: "/customers", label: "Customers", action: "customers.view" },
  { path: "/email", label: "Email", action: "email.send" },
  { path: "/sales", label: "Sales", action: "sales.view" },
  { path: "/settings", label: "Settings", action: "settings.view" },
];

export function navFor(role: Role): NavItem[] {
  return NAV.filter((n) => can(role, n.action));
}
