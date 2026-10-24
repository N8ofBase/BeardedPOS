import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductRow, RegisterCustomer } from "@bearded/api";
import { CustomerBox } from "../src/pages/register/CustomerBox.tsx";
import { addProduct, EMPTY_TICKET, priceTicket, toInput } from "../src/pages/register/ticket.ts";
import { renderAs } from "./render.tsx";

afterEach(cleanup);

const game = { id: "p1", name: "Strategy Game", priceCents: 6499, taxClass: "standard" } as ProductRow;

const buddy = (balance: number, birthdayGiftDue = false) =>
  ({
    card: { id: "c1", name: "Pat Lee", phone: "2125550199", birthday: null },
    usuallyBuys: [],
    lastVisit: null,
    loyalty: { balance, birthdayGiftDue },
  }) as unknown as RegisterCustomer;

function box(c: RegisterCustomer, rewards: number, netCents: number) {
  const onUseReward = vi.fn();
  renderAs(
    "cashier",
    <CustomerBox
      customer={c}
      onAttach={vi.fn()}
      onDrop={vi.fn()}
      onAddProduct={vi.fn()}
      rewards={rewards}
      netCents={netCents}
      onUseReward={onUseReward}
    />,
  );
  return onUseReward;
}

describe("Beard Buddy at the register", () => {
  it("shows the balance and what the sale earns, and uses a reward", () => {
    const use = box(buddy(240), 0, 6499);
    expect(screen.getByText(/240 Beard Bucks/)).toBeTruthy();
    expect(screen.getByText("This sale earns 64 Beard Bucks")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use 100 Beard Bucks ($5 off)" }));
    expect(use).toHaveBeenCalledOnce();
  });

  it("counts rewards already on the ticket, and hides the button under 100 Bucks", () => {
    box(buddy(140), 1, 1499);
    expect(screen.getByText(/40 Beard Bucks/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Use 100 Beard Bucks/ })).toBeNull();
  });

  it("can't use a reward on a ticket under $5", () => {
    box(buddy(240), 0, 499);
    expect(
      (screen.getByRole("button", { name: "Use 100 Beard Bucks ($5 off)" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("says when the birthday gift comes with this sale", () => {
    box(buddy(0, true), 0, 1000);
    expect(screen.getByText("Birthday month: +100 Beard Bucks with this sale")).toBeTruthy();
  });

  it("prices the reward on the ticket and sends only the count", () => {
    const t = { ...addProduct(EMPTY_TICKET, game), rewards: 1 };
    expect(priceTicket(t, 7000).priced).toMatchObject({ discountCents: 500, totalCents: 6419 });
    expect(toInput(t).rewards).toBe(1);
  });
});
