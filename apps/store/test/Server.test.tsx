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
    fireEvent.click(screen.getByRole("button", { name: "Check out as a guest" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Check out as a guest" }));
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

  it("marks old-site items keep, update or drop, with a note", async () => {
    const { store } = await realServer();
    renderStore("/behind-the-beard", store);
    await signIn();
    fireEvent.click(screen.getByRole("tab", { name: "Old site" }));
    const item = (await screen.findByRole("heading", { name: "Tim’s bio" })).closest("li")!;
    fireEvent.change(within(item).getByLabelText("Note"), { target: { value: "Add his photo too." } });
    fireEvent.click(within(item).getByRole("button", { name: "Keep" }));
    expect(await within(item).findByText(/^Keep · adam@beardedboardgames.com/)).toBeTruthy();
    expect(within(item).getByRole("button", { name: "Keep" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/1 of \d+ decided/)).toBeTruthy();

    const show = screen.getByRole("group", { name: "Show items" });
    fireEvent.click(within(show).getByRole("button", { name: "Not decided" }));
    expect(screen.queryByRole("heading", { name: "Tim’s bio" })).toBeNull();
    fireEvent.click(within(show).getByRole("button", { name: "Keep" }));
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Tim’s bio"]);
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

describe("Beard Buddy", () => {
  const LOCKED_OUT = "NJ65T37BVFHTAAFBCEXI7KNX"; // $20

  async function buddySignIn(email: string) {
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: email } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    const code = (await screen.findByText(/here is the code/)).querySelector("strong")!.textContent!;
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  }

  it("signs in from the cart, gets the welcome Bucks, earns, then spends Bucks for $5 off", async () => {
    const { store } = await realServer();
    localStorage.setItem(CART_KEY, JSON.stringify([{ productId: LOCKED_OUT, qty: 2 }]));
    const first = renderStore("/cart", store);
    fireEvent.click(await screen.findByRole("button", { name: "Check out" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in and earn 40 Beard Bucks" }));
    await buddySignIn("rae@example.com");
    expect(await screen.findByText("Welcome to Beard Buddy! We added 100 Beard Bucks.")).toBeTruthy();
    expect(screen.getByText("You have 100 Beard Bucks. Use 100 for $5 off?")).toBeTruthy();
    expect(screen.getByText("This order earns 40 Beard Bucks.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    fireEvent.click(await screen.findByRole("button", { name: /Pay \(preview/ }));
    expect((await screen.findByText(/You earned/)).textContent).toBe(
      "You earned 40 Beard Bucks. Your balance is 140.",
    );
    await waitFor(() => expect(screen.getByRole("link", { name: /Beard Buddy · 140 Bucks/ })).toBeTruthy());
    first.unmount();

    // One $20 game is under the $25 minimum for Bucks.
    localStorage.setItem(CART_KEY, JSON.stringify([{ productId: LOCKED_OUT, qty: 1 }]));
    const small = renderStore("/cart", store);
    expect(
      await screen.findByText("Beard Bucks work on orders of $25 or more. Add $5 more to use yours."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "One more reward" })).toBeNull();
    small.unmount();

    localStorage.setItem(CART_KEY, JSON.stringify([{ productId: LOCKED_OUT, qty: 2 }]));
    renderStore("/cart", store);
    expect(await screen.findByText("You have 140 Beard Bucks. Use 100 for $5 off?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "One more reward" }));
    expect(screen.getByText("You have 140 Beard Bucks. Use 100 for $5 off.")).toBeTruthy();
    expect(screen.getByText("This order earns 35 Beard Bucks.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    expect(await screen.findByRole("heading", { name: "Checkout preview" })).toBeTruthy();
    expect(await screen.findByText("Beard Bucks reward")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Pay \(preview/ }));
    expect((await screen.findByText(/You earned/)).textContent).toBe(
      "You earned 35 Beard Bucks. Your balance is 75.",
    );
  });

  it("shows the account page and the Beard Buddies tab", async () => {
    const { store } = await realServer();
    const account = renderStore("/account", store);
    await buddySignIn("sam@example.com");
    expect(await screen.findByText("100 Beard Bucks")).toBeTruthy();
    expect(
      screen.getByText("Welcome to Beard Buddy! We added 100 Beard Bucks to get you started."),
    ).toBeTruthy();
    expect(screen.getByText("Welcome gift")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sam" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    account.unmount();

    renderStore("/behind-the-beard", store);
    await signIn();
    fireEvent.click(screen.getByRole("tab", { name: "Beard Buddies" }));
    const card = (await screen.findByText("Sam")).closest("li")!;
    expect(within(card).getByText("sam@example.com")).toBeTruthy();
    expect(within(card).getByText("100 Beard Bucks")).toBeTruthy();
  });
});
