import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderStore } from "./render.tsx";

afterEach(cleanup);

const info = (alreadyOff: boolean) => ({
  storeName: "Bearded Board Games",
  email: "p•••@example.com",
  alreadyOff,
});

describe("unsubscribe page", () => {
  it("asks first, then turns news email off", async () => {
    const unsubscribeStatus = vi.fn(async () => info(false));
    const unsubscribe = vi.fn(async () => info(true));
    renderStore("/unsubscribe?b=biz&t=tok", { unsubscribeStatus, unsubscribe });
    expect(
      await screen.findByText(/Stop news emails from Bearded Board Games to p•••@example.com/),
    ).toBeTruthy();
    expect(unsubscribeStatus).toHaveBeenCalledWith("biz", "tok");
    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect(await screen.findByText("You’re unsubscribed")).toBeTruthy();
    expect(unsubscribe).toHaveBeenCalledWith("biz", "tok");
  });

  it("says when the link is incomplete", () => {
    renderStore("/unsubscribe?b=biz");
    expect(screen.getByText(/isn’t complete/)).toBeTruthy();
  });
});
