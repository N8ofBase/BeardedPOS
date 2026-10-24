import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STATUS_TRIES, STATUS_WAIT_MS } from "../src/pages/ThanksPage.tsx";
import { renderStore } from "./render.tsx";

const ORDER = "11111111-2222-4333-8444-555555555555";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("thank-you page after Square", () => {
  it("shows the order number and that the payment came through", async () => {
    const orderStatus = vi.fn(async () => ({ status: "paid" as const }));
    renderStore(`/thanks?order=${ORDER}`, { orderStatus });
    expect(screen.getByText("BBG-11111111")).toBeTruthy();
    expect(await screen.findByText(/Payment received/)).toBeTruthy();
    expect(orderStatus).toHaveBeenCalledWith(ORDER);
  });

  it("keeps asking Square for a few seconds, then says it hasn't confirmed yet", async () => {
    vi.useFakeTimers();
    const orderStatus = vi.fn(async () => ({ status: "open" as const }));
    renderStore(`/thanks?order=${ORDER}`, { orderStatus });
    expect(screen.getByText(/Confirming your payment/)).toBeTruthy();
    for (let i = 0; i < STATUS_TRIES; i++) await act(async () => void vi.advanceTimersByTime(STATUS_WAIT_MS));
    expect(screen.getByText(/hasn’t confirmed the payment yet/)).toBeTruthy();
    expect(orderStatus).toHaveBeenCalledTimes(STATUS_TRIES);
  });

  it("doesn't ask Square about preview orders", () => {
    const orderStatus = vi.fn(async () => ({ status: "paid" as const }));
    renderStore(`/thanks?order=${ORDER}&preview=1`, { orderStatus });
    expect(screen.getByText(/no payment was taken/)).toBeTruthy();
    expect(orderStatus).not.toHaveBeenCalled();
  });
});
