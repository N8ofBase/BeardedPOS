// Mine & Find online, just for Beard Buddies: guests sign in on the page, Buddies get the Play button.
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeAccount, fakeStore, renderStore } from "./render.tsx";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(cleanup);

const signedIn = { buddy: { ...fakeStore().buddy, account: async () => fakeAccount() } };

describe("Play Mine & Find online", () => {
  it("asks a guest to sign in and has no way into the game", async () => {
    renderStore("/play/mine-and-find");
    expect(await screen.findByRole("heading", { name: "Play Mine & Find online" })).toBeTruthy();
    expect(await screen.findByText(/just for Beard Buddies, and joining is free/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Play Mine & Find" })).toBeNull();
  });

  it("shows the Play button once the guest signs in", async () => {
    renderStore("/play/mine-and-find", {
      buddy: {
        ...fakeStore().buddy,
        requestCode: async () => ({ sent: true, devCode: "123456" }),
        signIn: async () => fakeAccount({ welcomeBucks: 200 }),
      },
    });
    const page = (await screen.findByRole("heading", { name: "Play Mine & Find online" })).closest(
      "section",
    )!;
    fireEvent.change(await within(page).findByLabelText("Email"), { target: { value: "sam@example.com" } });
    await act(
      async () => void fireEvent.click(within(page).getByRole("button", { name: "Email me a code" })),
    );
    fireEvent.change(within(page).getByLabelText("Code"), { target: { value: "123456" } });
    await act(async () => void fireEvent.click(within(page).getByRole("button", { name: "Sign in" })));
    expect(within(page).getByRole("link", { name: "Play Mine & Find" }).getAttribute("href")).toBe(
      "/api/play/mine-and-find",
    );
  });

  it("gives a signed-in Buddy the Play button straight away", async () => {
    renderStore("/play/mine-and-find", signedIn);
    const play = await screen.findByRole("link", { name: "Play Mine & Find" });
    expect(play.getAttribute("href")).toBe("/api/play/mine-and-find");
    expect(screen.getByText(/Signed in as sam@example.com/)).toBeTruthy();
  });

  it("is only for games with an online version", async () => {
    renderStore("/play/fences", signedIn);
    expect(await screen.findByRole("heading", { name: "Rolled a 1." })).toBeTruthy();
  });

  it("is linked from the game's page", async () => {
    renderStore("/games/mine-and-find");
    const link = await screen.findByRole("link", { name: "Play Mine & Find online" });
    expect(link.getAttribute("href")).toBe("/play/mine-and-find");
  });
});
