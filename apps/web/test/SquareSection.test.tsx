// Settings, Square: check what would change, then bring it in.
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SquareSection } from "../src/pages/settings/SquareSection.tsx";
import { renderAs } from "./render.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const preview = {
  newProducts: [{ name: "Brand New Game", priceCents: 2500, stock: 4 }],
  priceChanges: [{ name: "Fences", fromCents: 3000, toCents: 3100 }],
  stockChanges: [{ name: "Fences", from: 10, to: 7 }],
  linkedProducts: 1,
  unchangedProducts: 0,
  skipped: [{ name: "Donation", reason: "Variable price in Square" }],
  onlyInRegister: [],
  newCustomers: 2,
  linkedCustomers: 0,
  customersToSquare: 1,
  duplicateCustomers: 0,
};

function fakeServer(connected = true) {
  const bodies: { path: string; body: unknown }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const path = String(url).replace("/api/pos/", "");
    const body = JSON.parse(String(init?.body ?? "{}")) as { apply?: boolean };
    bodies.push({ path, body });
    const out =
      path === "square/status"
        ? { connected, lastSyncAt: null, waitingSends: 0, failedSends: 0, linkedProducts: 0 }
        : body.apply
          ? { preview, applied: { productsAdded: 1, pricesChanged: 1, stockChanged: 1, customersAdded: 2 } }
          : { preview };
    return new Response(JSON.stringify(out), { status: 200 });
  });
  return bodies;
}

describe("SquareSection", () => {
  it("previews Square's changes, then brings them in", async () => {
    const bodies = fakeServer();
    renderAs("owner", <SquareSection />);
    await screen.findByText(/Not brought in from Square yet/);
    fireEvent.click(screen.getByRole("button", { name: "Check Square" }));
    await screen.findByText(/1 new product:/);
    expect(screen.getByText("Fences: $30.00 → $31.00")).toBeTruthy();
    expect(screen.getByText(/1 register customer added to Square/)).toBeTruthy();
    expect(screen.getByText(/Donation \(variable price in square\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Bring these in" }));
    await waitFor(() =>
      expect(bodies.some((b) => (b.body as { apply?: boolean }).apply === true)).toBe(true),
    );
  });

  it("shows nothing when the register isn't connected to Square", async () => {
    const bodies = fakeServer(false);
    const { container } = renderAs("owner", <SquareSection />);
    await waitFor(() => expect(bodies.length).toBe(1));
    await waitFor(() => expect(container.textContent).toBe(""));
  });
});
