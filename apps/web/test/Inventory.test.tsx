import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ProductRow } from "@pet-pos/api";
import { diffLabel } from "../src/pages/inventory/CountPage.tsx";
import { InventoryRoutes } from "../src/pages/inventory/InventoryPage.tsx";
import { renderAs } from "./render.tsx";

afterEach(cleanup);

const food: ProductRow = {
  id: "p1",
  sku: "0001",
  barcode: null,
  name: "Sample Adult Dog Food 24 lb (DEMO)",
  brand: "Sample Brand",
  category: "Dog food",
  priceCents: 6499,
  costCents: 4300,
  wholesaleCents: null,
  royaltyMpct: 0,
  royaltyPayee: null,
  taxClass: "standard",
  reorderAt: 6,
  onHand: 4,
  astroProgramId: "a1",
  astroProgramName: "Sample dry food club (DEMO)",
  offerLabel: "$5 off 24 lb bag",
  offerCents: 500,
  active: true,
};

describe("Inventory", () => {
  it("shows price, margin, Astro tags and a low-stock tag", async () => {
    renderAs("owner", <InventoryRoutes />, { listProducts: [food] });
    expect(await screen.findByText("Sample Adult Dog Food 24 lb (DEMO)")).toBeTruthy();
    expect(screen.getByText("$64.99")).toBeTruthy();
    expect(screen.getByText("34%")).toBeTruthy();
    expect(screen.getByText("4 left")).toBeTruthy();
    expect(screen.getByText("$5.00 offer")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New product" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Receive" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("is read-only for a cashier", async () => {
    renderAs("cashier", <InventoryRoutes />, { listProducts: [food] });
    expect(await screen.findByText("Sample Adult Dog Food 24 lb (DEMO)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New product" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Receive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Count stock" })).toBeNull();
  });
});

describe("count mode", () => {
  it("labels the difference from what's expected", () => {
    expect(diffLabel(4, 6)).toEqual({ text: "+2", kind: "up" });
    expect(diffLabel(30, 27)).toEqual({ text: "−3", kind: "down" });
    expect(diffLabel(14, 14)).toEqual({ text: "Matches", kind: "same" });
  });
});
