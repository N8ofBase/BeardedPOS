import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomerCard } from "@pet-pos/api";
import { CustomerForm } from "../src/pages/customers/CustomerForm.tsx";
import { CustomersRoutes } from "../src/pages/customers/CustomersPage.tsx";
import { ConfirmTyped } from "../src/ui/ConfirmTyped.tsx";
import { renderAs } from "./render.tsx";

afterEach(cleanup);

const card: CustomerCard = {
  id: "c1",
  name: "Sample Customer (DEMO)",
  phone: "2125550100",
  email: "customer.demo@example.com",
  street: null,
  city: "Springfield",
  state: "IL",
  zip: null,
  birthday: null,
  pets: [{ id: "p1", name: "Biscuit", species: "dog", breed: "Beagle", birthday: null }],
  punchCards: [
    {
      programId: "a1",
      programName: "Sample dry food club (DEMO)",
      balance: 11,
      buyCount: 12,
      rewardText: "Next bag free",
    },
  ],
};

describe("ConfirmTyped", () => {
  it("keeps the button disabled until delete is typed, in any case", async () => {
    const onConfirm = vi.fn(async () => {});
    render(
      <ConfirmTyped title="Delete Pat?" button="Delete customer" onConfirm={onConfirm} onCancel={vi.fn()}>
        <p>Gone for good.</p>
      </ConfirmTyped>,
    );
    const button = screen.getByRole("button", { name: "Delete customer" }) as HTMLButtonElement;
    const input = screen.getByRole("textbox");
    expect(button.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "delet" } });
    expect(button.disabled).toBe(true);
    fireEvent.change(input, { target: { value: " DELETE " } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe("Customers", () => {
  it("shows the card: formatted phone, pet chip and punch card", async () => {
    renderAs("cashier", <CustomersRoutes />, { searchCustomers: [card] });
    expect(await screen.findByText("Sample Customer (DEMO)")).toBeTruthy();
    expect(screen.getByText("(212) 555-0100")).toBeTruthy();
    expect(screen.getByText("Biscuit")).toBeTruthy();
    expect(screen.getByText("11/12")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New customer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("lets a manager delete", async () => {
    renderAs("manager", <CustomersRoutes />, { searchCustomers: [card] });
    expect(await screen.findByRole("button", { name: "Delete" })).toBeTruthy();
  });
});

describe("customer form", () => {
  it("changes the breed hint with the pet type", () => {
    renderAs("cashier", <CustomerForm id={null} onClose={vi.fn()} />);
    const breed = () => screen.getByPlaceholderText(/e\.g\. (beagle|Maine coon|rabbit)/) as HTMLInputElement;
    expect(breed().placeholder).toBe("e.g. beagle");
    fireEvent.click(screen.getByLabelText("Cat"));
    expect(breed().placeholder).toBe("e.g. Maine coon");
    fireEvent.click(screen.getByLabelText("Other"));
    expect(breed().placeholder).toBe("e.g. rabbit, ferret, bird");
  });

  it("explains duplicate pet names before saving", () => {
    const { call } = renderAs("cashier", <CustomerForm id={null} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pat" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "2125550199" } });
    fireEvent.change(screen.getByLabelText("Pet name"), { target: { value: "Max" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add another pet" }));
    fireEvent.change(screen.getAllByLabelText("Pet name")[1]!, { target: { value: "max" } });
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));
    expect(screen.getByText(/Two pets have the same name/)).toBeTruthy();
    expect(call).not.toHaveBeenCalledWith("saveCustomer", expect.anything());
  });
});
