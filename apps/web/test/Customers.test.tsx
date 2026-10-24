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
  it("shows the card: formatted phone", async () => {
    renderAs("cashier", <CustomersRoutes />, { searchCustomers: [card] });
    expect(await screen.findByText("Sample Customer (DEMO)")).toBeTruthy();
    expect(screen.getByText("(212) 555-0100")).toBeTruthy();
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
  it("explains a bad phone before saving", () => {
    const { call } = renderAs("cashier", <CustomerForm id={null} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pat" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "555-0100" } });
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));
    expect(screen.getByText("Enter a 10-digit phone number.")).toBeTruthy();
    expect(call).not.toHaveBeenCalledWith("saveCustomer", expect.anything());
  });
});
