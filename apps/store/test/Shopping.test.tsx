import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CART_KEY } from "../src/cart/CartProvider.tsx";
import type { Review } from "@bearded/store-core";
import { MEMORY_KEY, SHOWN_KEY } from "../src/vip/VipPopup.tsx";
import { renderStore } from "./render.tsx";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const drawer = () => screen.getByRole("dialog", { name: "Your cart" });

describe("cart", () => {
  it("adds from the shop, opens the cart and totals it", async () => {
    renderStore("/shop");
    fireEvent.click(await screen.findByRole("button", { name: "Add Fences: The Ranch to cart" }));
    expect(within(drawer()).getByText("Fences: The Ranch", { selector: "strong" })).toBeTruthy();
    fireEvent.click(within(drawer()).getByRole("button", { name: "One more Fences: The Ranch" }));
    expect(drawer().querySelector(".subtotal")!.textContent).toContain("$50");
    expect(screen.getByRole("button", { name: /^Cart/ }).textContent).toContain("2");
    expect(JSON.parse(localStorage.getItem(CART_KEY)!)).toEqual([
      { productId: "CODAYIOIDBKGQPILID7GDBIT", qty: 2 },
    ]);
  });

  it("closes with Escape and comes back from the header", async () => {
    renderStore("/shop");
    fireEvent.click(await screen.findByRole("button", { name: "Add Locked Out to cart" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Your cart" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Cart/ }));
    expect(within(drawer()).getByText("Locked Out", { selector: "strong" })).toBeTruthy();
  });

  it("keeps the cart between visits and remembers today's price", async () => {
    localStorage.setItem(CART_KEY, JSON.stringify([{ productId: "NJ65T37BVFHTAAFBCEXI7KNX", qty: 3 }]));
    renderStore("/cart");
    await screen.findByRole("button", { name: "Check out" });
    expect(document.querySelector(".subtotal")!.textContent).toContain("$60");
  });

  it("sends only ids and quantities to checkout, then clears the cart on the thank-you page", async () => {
    const checkout = vi.fn(async () => ({ url: "/thanks?preview=1", orderId: "" }));
    localStorage.setItem(CART_KEY, JSON.stringify([{ productId: "NJ65T37BVFHTAAFBCEXI7KNX", qty: 2 }]));
    renderStore("/cart", { checkout });
    fireEvent.click(await screen.findByRole("button", { name: "Check out" }));
    const guest = screen.getByRole("button", { name: "Check out as a guest" });
    expect(guest.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("Guest orders don’t earn Beard Bucks.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in and earn 40 Beard Bucks" })).toBeTruthy();
    fireEvent.click(guest);
    expect(await screen.findByRole("heading", { name: "Thanks for your order!" })).toBeTruthy();
    expect(checkout).toHaveBeenCalledWith(
      [{ productId: "NJ65T37BVFHTAAFBCEXI7KNX", qty: 2 }],
      expect.any(String),
      0,
    );
    expect(screen.getByText(/no payment was taken/)).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem(CART_KEY)).toBeNull());
  });

  it("says when checkout doesn't open and keeps the cart", async () => {
    localStorage.setItem(CART_KEY, JSON.stringify([{ productId: "NJ65T37BVFHTAAFBCEXI7KNX", qty: 1 }]));
    renderStore("/cart", { checkout: () => Promise.reject(new Error("down")) });
    fireEvent.click(await screen.findByRole("button", { name: "Check out" }));
    fireEvent.click(screen.getByRole("button", { name: "Check out as a guest" }));
    expect(await screen.findByText(/Checkout didn’t open/)).toBeTruthy();
    expect(localStorage.getItem(CART_KEY)).not.toBeNull();
  });

  it("shows an empty cart with a way back to the shop", async () => {
    renderStore("/cart");
    expect(await screen.findByText("Your cart is empty.")).toBeTruthy();
  });
});

describe("shop page", () => {
  it("groups products by game, with extras at the end", async () => {
    renderStore("/shop");
    await screen.findByText("Fences: The Ranch");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Fences", "Locked Out", "Mine & Find", "Pack Lash", "More from the beards"]);
  });
});

const review = (over: Partial<Review>): Review => ({
  id: "r1",
  game: "fences",
  stars: 5,
  headline: "Sheep drama",
  body: "We fought over the cows.",
  name: "Sam R.",
  date: "2026-10-01",
  boughtFromUs: true,
  featured: false,
  ...over,
});

describe("game page", () => {
  it("shows the game, its products and its reviews with the average", async () => {
    const reviews = [
      review({ id: "a", stars: 5 }),
      review({ id: "b", stars: 4 }),
      review({ id: "c", game: "locked-out" }),
    ];
    renderStore("/games/fences", { reviews: async () => reviews });
    expect(screen.getByRole("heading", { level: 1, name: "Fences" })).toBeTruthy();
    expect(await screen.findByText(/4\.5 from 2 reviews/)).toBeTruthy();
    expect(screen.getAllByText("Sheep drama")).toHaveLength(2);
    expect(await screen.findByText("Fences Premium Print & Play")).toBeTruthy();
    expect(screen.queryByText("Locked Out", { selector: "h3" })).toBeNull();
  });

  it("invites the first review when there are none", async () => {
    renderStore("/games/locked-out");
    expect(await screen.findByText("No reviews of Locked Out yet. Be the first.")).toBeTruthy();
  });

  it("says when a game isn't out yet", async () => {
    renderStore("/games/fences-roll-and-write");
    expect(await screen.findByText(/Not on sale yet/)).toBeTruthy();
  });

  it("treats an unknown game as a missing page", () => {
    renderStore("/games/monopoly");
    expect(screen.getByRole("heading", { name: "Rolled a 1." })).toBeTruthy();
  });
});

describe("writing a review", () => {
  it("sends a review from a game page and says it's waiting for approval", async () => {
    const submitReview = vi.fn(async () => {});
    renderStore("/games/fences", { submitReview });
    fireEvent.click(screen.getByRole("radio", { name: "5 stars" }));
    fireEvent.change(screen.getByLabelText("Your review"), {
      target: { value: "  Spicy tile placement.  " },
    });
    fireEvent.change(screen.getByLabelText("First name and last initial"), { target: { value: "Sam R." } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send review" }));
    expect(await screen.findByText(/once someone on the team approves it/)).toBeTruthy();
    expect(submitReview).toHaveBeenCalledWith(
      expect.objectContaining({ game: "fences", stars: 5, body: "Spicy tile placement.", name: "Sam R." }),
    );
  });

  it("points out what's missing and sends nothing", () => {
    const submitReview = vi.fn(async () => {});
    renderStore("/reviews", { submitReview });
    fireEvent.click(screen.getByRole("button", { name: "Send review" }));
    expect(screen.getByText("Pick the game you’re reviewing.")).toBeTruthy();
    expect(screen.getByText("Pick 1 to 5 stars.")).toBeTruthy();
    expect(screen.getByText("Tell us what you thought.")).toBeTruthy();
    expect(submitReview).not.toHaveBeenCalled();
  });

  it("filters the reviews page by game", async () => {
    const reviews = [
      review({ id: "a", headline: "Cows" }),
      review({ id: "b", game: "locked-out", headline: "Betrayal" }),
    ];
    renderStore("/reviews", { reviews: async () => reviews });
    expect(await screen.findByText("Betrayal")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fences" }));
    expect(screen.queryByText("Betrayal")).toBeNull();
    expect(screen.getByText("Cows")).toBeTruthy();
  });

  it("features picked reviews on the home page only when there are some", async () => {
    const { unmount } = renderStore("/", {
      reviews: async () => [review({ featured: true, headline: "Best farm game" })],
    });
    expect(await screen.findByRole("heading", { name: "What players say." })).toBeTruthy();
    unmount();
    renderStore("/");
    await screen.findByText("Mine & Find (Pre-order)");
    expect(screen.queryByRole("heading", { name: "What players say." })).toBeNull();
  });
});

describe("VIP popup", () => {
  const advance = async (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

  it("appears after 20 seconds and stays away 30 days once closed", async () => {
    vi.useFakeTimers();
    renderStore("/");
    await advance(19_000);
    expect(screen.queryByRole("dialog", { name: /Bearded Bundle/ })).toBeNull();
    await advance(1_500);
    const popup = screen.getByRole("dialog", { name: /Bearded Bundle/ });
    fireEvent.click(within(popup).getByRole("button", { name: "Maybe later" }));
    expect(screen.queryByRole("dialog", { name: /Bearded Bundle/ })).toBeNull();
    expect(JSON.parse(localStorage.getItem(MEMORY_KEY)!).snoozedUntil).toBeGreaterThan(
      Date.now() + 29 * 864e5,
    );
    expect(sessionStorage.getItem(SHOWN_KEY)).toBe("1");
  });

  it("doesn't interrupt the cart", async () => {
    vi.useFakeTimers();
    renderStore("/cart");
    await advance(25_000);
    expect(screen.queryByRole("dialog", { name: /Bearded Bundle/ })).toBeNull();
  });

  it("never comes back after joining", async () => {
    vi.useFakeTimers();
    const joinVip = vi.fn(async () => {});
    renderStore("/", { joinVip });
    await advance(21_000);
    const popup = screen.getByRole("dialog", { name: /Bearded Bundle/ });
    fireEvent.change(within(popup).getByLabelText("Your email"), { target: { value: "sam@example.com" } });
    await act(async () => void fireEvent.click(within(popup).getByRole("button", { name: "Join" })));
    expect(within(popup).getByText(/BEARDED10/)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(MEMORY_KEY)!)).toEqual({ joined: true });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(JSON.parse(localStorage.getItem(MEMORY_KEY)!)).toEqual({ joined: true });
  });
});
