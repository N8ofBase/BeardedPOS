// The site against the real store server (in-memory database, offline Square), through fetch.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withBusiness } from "@bearded/store-api";
import { ApiError } from "../src/api/store.ts";
import { CART_KEY } from "../src/cart/CartProvider.tsx";
import { BUSINESS, realServer, renderStore } from "./render.tsx";

// Each test starts a database, which can take a few seconds on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(cleanup);

async function signIn(email = "adam@beardedboardgames.com") {
  fireEvent.change(await screen.findByLabelText("Work email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
  const code = (await screen.findByText(/here is the code/)).querySelector("strong")!.textContent!;
  fireEvent.change(screen.getByLabelText("Code"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByText(email);
}

describe("checkout", () => {
  it("prices the order on the server, previews payment and marks it paid", async () => {
    const { ctx, store } = await realServer();
    localStorage.setItem(CART_KEY, JSON.stringify([{ productId: "NJ65T37BVFHTAAFBCEXI7KNX", qty: 2 }]));
    renderStore("/cart", store);
    fireEvent.click(await screen.findByRole("button", { name: "Check out" }));
    expect(await screen.findByRole("heading", { name: "Checkout preview" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Pay \(preview/ }));
    expect(document.querySelector(".subtotal")?.textContent).toContain("$40");
    expect(await screen.findByRole("heading", { name: "Thanks for your order!" })).toBeTruthy();
    expect(screen.getByText(/^BBG-[0-9A-F]{8}$/)).toBeTruthy();
    const orders = await withBusiness(ctx.db, BUSINESS, (sql) =>
      sql.query<{ status: string; subtotal_cents: number }>(
        "SELECT status, subtotal_cents FROM store_orders",
      ),
    );
    expect(orders.rows).toEqual([{ status: "paid", subtotal_cents: 4000 }]);
  });

  it("shows the server's reason when checkout is refused", async () => {
    localStorage.setItem(CART_KEY, JSON.stringify([{ productId: "NJ65T37BVFHTAAFBCEXI7KNX", qty: 1 }]));
    renderStore("/cart", {
      checkout: () => Promise.reject(new ApiError(409, "Locked Out just sold out. Remove it to check out.")),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Check out" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Locked Out just sold out. Remove it to check out.",
    );
  });
});

describe("Behind the Beard", () => {
  it("approves a shopper's review, which then shows on the game page", async () => {
    const { store } = await realServer();
    const { unmount } = renderStore("/games/fences", store);
    fireEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    fireEvent.change(screen.getByLabelText("Your review"), { target: { value: "Our new family favorite." } });
    fireEvent.change(screen.getByLabelText("First name and last initial"), { target: { value: "Jo K." } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jo@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send review" }));
    await screen.findByText(/once someone on the team approves it/);
    unmount();

    const staff = renderStore("/behind-the-beard", store);
    await signIn();
    const waiting = await screen.findByText("Our new family favorite.");
    const card = waiting.closest("li")!;
    expect(within(card).getByText("jo@example.com")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Approve: review by Jo K." }));
    expect(await screen.findByText("Nothing waiting. Nice work.")).toBeTruthy();
    staff.unmount();

    renderStore("/games/fences", store);
    expect(await screen.findByText("Our new family favorite.")).toBeTruthy();
  });

  it("gives a stranger the same answer and no code", async () => {
    const { store } = await realServer();
    renderStore("/behind-the-beard", store);
    fireEvent.change(await screen.findByLabelText("Work email"), { target: { value: "sam@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    expect(await screen.findByText(/If sam@example.com is on the team list/)).toBeTruthy();
    expect(screen.queryByText(/here is the code/)).toBeNull();
  });

  it("counts cart adds and lists what was added in Stats", async () => {
    const { store } = await realServer();
    const shop = renderStore("/shop", store);
    fireEvent.click(await screen.findByRole("button", { name: "Add Fences: The Ranch to cart" }));
    shop.unmount(); // sends the queued events

    renderStore("/behind-the-beard", store);
    await signIn();
    fireEvent.click(screen.getByRole("tab", { name: "Stats" }));
    const tiles = await screen.findByText("Added to cart", { selector: "dt" });
    expect(tiles.parentElement!.querySelector("dd")!.textContent).toBe("1");
    const ranked = screen.getByRole("heading", { name: "Added to cart" }).closest("section")!;
    await waitFor(() => expect(within(ranked).getByText("Fences: The Ranch")).toBeTruthy());
    expect(
      within(screen.getByRole("heading", { name: "Most clicks" }).closest("section")!).getByText(
        "Add Fences: The Ranch to cart",
      ),
    ).toBeTruthy();
  });

  it("signs out", async () => {
    const { store, jar } = await realServer();
    renderStore("/behind-the-beard", store);
    await signIn();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByLabelText("Work email")).toBeTruthy();
    expect(jar.size).toBe(0);
  });
});
