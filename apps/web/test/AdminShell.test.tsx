import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { Role } from "@pet-pos/core";
import type { Me } from "@pet-pos/api";
import { AdminShell } from "../src/layout/AdminShell.tsx";
import { formatTaxRate } from "../src/pages/Settings.tsx";

afterEach(cleanup);

function me(role: Role): Me {
  return {
    staff: { id: "s1", name: `Sample ${role} (DEMO)`, role },
    business: { id: "b1", name: "Sample Pet Store (DEMO)", brandColor: null, modules: {} },
    location: { id: "l1", name: "Main store (DEMO)", taxRateBp: 700 },
  };
}

function navLabels(role: Role, path = "/") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AdminShell me={me(role)} onSwitchRole={vi.fn()} onResetDemo={vi.fn(async () => {})} />
    </MemoryRouter>,
  );
  return within(screen.getByRole("navigation", { name: "Main" }))
    .getAllByRole("link")
    .map((a) => a.textContent);
}

describe("AdminShell", () => {
  it("shows the owner every section", () => {
    expect(navLabels("owner")).toEqual([
      "Register",
      "Grooming",
      "Inventory",
      "Customers",
      "Sales",
      "Astro",
      "Settings",
    ]);
  });

  it("hides owner-only sections from a cashier", () => {
    expect(navLabels("cashier")).toEqual(["Register", "Grooming", "Inventory", "Customers", "Astro"]);
  });

  it("gives a groomer only what they use", () => {
    expect(navLabels("groomer")).toEqual(["Grooming", "Customers"]);
  });

  it("sends a cashier away from Settings to their first section", () => {
    navLabels("cashier", "/settings");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Register");
  });

  it("always shows the demo banner", () => {
    navLabels("cashier");
    expect(screen.getByText("Demo · data stays on this device")).toBeTruthy();
  });
});

describe("formatTaxRate", () => {
  it("formats basis points", () => {
    expect(formatTaxRate(0)).toBe("0%");
    expect(formatTaxRate(700)).toBe("7%");
    expect(formatTaxRate(825)).toBe("8.25%");
    expect(formatTaxRate(650)).toBe("6.5%");
  });
});
