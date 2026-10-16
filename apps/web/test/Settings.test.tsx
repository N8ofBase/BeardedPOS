import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoData, demoSummary, StaffForm, taxError } from "../src/pages/Settings.tsx";
import { renderAs } from "./render.tsx";

afterEach(cleanup);

describe("settings form", () => {
  it("explains a bad tax rate", () => {
    expect(taxError("8.875")).toBeNull();
    expect(taxError("8.8755")).toBe("Enter the sales tax as a percent, like 8.875.");
    expect(taxError("eight")).not.toBeNull();
  });
});

describe("demo data", () => {
  it("summarizes what will be removed", () => {
    expect(demoSummary({ customers: 3, pets: 5, products: 4, programs: 1, punches: 2 })).toBe(
      "3 customers (5 pets), 4 products, 1 Astro program, and 2 punch balances",
    );
    expect(demoSummary({ customers: 1, pets: 0, products: 0, programs: 0, punches: 0 })).toBe("1 customer");
  });

  it("disables Remove when there's nothing left", async () => {
    renderAs("owner", <DemoData />, {
      demoDataPreview: { customers: 0, pets: 0, products: 0, programs: 0, punches: 0 },
    });
    expect(await screen.findByText("No demo records left")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Remove all demo data" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("enables Remove when there are samples", async () => {
    renderAs("owner", <DemoData />, {
      demoDataPreview: { customers: 3, pets: 5, products: 4, programs: 1, punches: 2 },
    });
    expect(await screen.findByText(/3 customers \(5 pets\)/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Remove all demo data" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe("staff form", () => {
  it("doesn't offer to deactivate yourself", () => {
    renderAs(
      "owner",
      <StaffForm
        staff={{ id: "s1", name: "Me", email: null, role: "owner", active: true }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Active (can sign in)")).toBeNull();
    expect(screen.getByText(/This is you/)).toBeTruthy();
  });

  it("offers it for someone else", () => {
    renderAs(
      "owner",
      <StaffForm
        staff={{ id: "s2", name: "Pat", email: null, role: "cashier", active: true }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Active (can sign in)")).toBeTruthy();
  });
});
