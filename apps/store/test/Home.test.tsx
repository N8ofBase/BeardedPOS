import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { App } from "../src/App.tsx";
import { offlineStore, StoreContext, type StoreApi } from "../src/api/store.ts";
import { brand, games } from "../src/content/site.ts";

afterEach(cleanup);

function renderHome(store: StoreApi = offlineStore, path = "/") {
  return render(
    <StoreContext.Provider value={store}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </StoreContext.Provider>,
  );
}

const shelf = () => document.getElementById("games")!;
const shelfNames = () =>
  within(shelf())
    .getAllByRole("heading", { level: 3 })
    .map((h) => h.textContent);

describe("home page", () => {
  it("shows every game on the shelf with box art and alt text", () => {
    renderHome();
    expect(shelfNames()).toEqual(games.map((g) => g.name));
    for (const g of games) expect(within(shelf()).getByAltText(`${g.name} box art`)).toBeTruthy();
  });

  it("filters the shelf by Out now, Pre-order and Coming soon", () => {
    renderHome();
    fireEvent.click(within(shelf()).getByRole("button", { name: "Out now" }));
    expect(shelfNames()).toEqual(["Fences", "Locked Out"]);
    fireEvent.click(within(shelf()).getByRole("button", { name: "Pre-order" }));
    expect(shelfNames()).toEqual(["Soccer Blocker", "Mine & Find"]);
    fireEvent.click(within(shelf()).getByRole("button", { name: "Coming soon" }));
    expect(shelfNames()).toEqual(["Pack Lash", "Fences: The Roll & Write"]);
    expect(within(shelf()).getByRole("button", { name: "Coming soon" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(within(shelf()).getByRole("button", { name: "All" }));
    expect(shelfNames()).toHaveLength(games.length);
  });

  it("lists shop products with prices from Square", async () => {
    renderHome();
    const shop = document.getElementById("shop")!;
    await within(shop).findByText("Fences: The Ranch");
    expect(within(shop).getByText("Mine & Find (Pre-order)")).toBeTruthy();
    expect(within(shop).queryByText("Math Force 5")).toBeNull();
    const ranch = within(shop).getByText("Fences: The Ranch").closest("article")!;
    expect(within(ranch).getByText("$25")).toBeTruthy();
  });

  it("says so when the shop can't load", async () => {
    renderHome({ ...offlineStore, catalog: () => Promise.reject(new Error("down")) });
    expect(await screen.findByText(/couldn’t load the shop/)).toBeTruthy();
  });

  it("rolls the d20 and announces the result", async () => {
    vi.useFakeTimers();
    try {
      renderHome();
      fireEvent.click(screen.getByRole("button", { name: /Roll the die/ }));
      await act(async () => {
        vi.advanceTimersByTime(700);
      });
      expect(document.getElementById("roll-result")!.textContent).not.toContain("Tap it to roll");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("VIP signup", () => {
  it("joins with a valid email and shows the code", async () => {
    const joinVip = vi.fn(async () => {});
    renderHome({ ...offlineStore, joinVip });
    fireEvent.change(screen.getByLabelText("Join the VIP list"), { target: { value: " sam@example.com " } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByText(brand.vipThanks)).toBeTruthy();
    expect(joinVip).toHaveBeenCalledWith("sam@example.com");
  });

  it("catches a mistyped email before sending it", () => {
    const joinVip = vi.fn(async () => {});
    renderHome({ ...offlineStore, joinVip });
    fireEvent.change(screen.getByLabelText("Join the VIP list"), { target: { value: "sam@example" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(screen.getByText(/Check the email address/)).toBeTruthy();
    expect(joinVip).not.toHaveBeenCalled();
  });

  it("lets the visitor try again when the signup fails", async () => {
    renderHome({ ...offlineStore, joinVip: () => Promise.reject(new Error("down")) });
    fireEvent.change(screen.getByLabelText("Join the VIP list"), { target: { value: "sam@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(screen.getByText(/didn’t go through/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Join" })).toBeTruthy();
  });
});

describe("other pages", () => {
  it("shows a friendly page for a bad link", () => {
    renderHome(offlineStore, "/nope");
    expect(screen.getByRole("heading", { name: "Rolled a 1." })).toBeTruthy();
  });
});
