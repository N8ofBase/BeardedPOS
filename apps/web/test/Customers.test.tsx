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
  kind: "person",
  company: null,
  emailOptIn: true,
  followUpOn: null,
  tags: [{ id: "t1", name: "VIP" }],
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
  it("shows the card: formatted phone and punch card", async () => {
    renderAs("cashier", <CustomersRoutes />, { searchCustomers: [card], listTags: [], followUps: [] });
    expect(await screen.findByText("Sample Customer (DEMO)")).toBeTruthy();
    expect(screen.getByText("VIP")).toBeTruthy();
    expect(screen.getByText("(212) 555-0100")).toBeTruthy();
    expect(screen.getByText("11/12")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New customer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("lets a manager delete", async () => {
    renderAs("manager", <CustomersRoutes />, { searchCustomers: [card], listTags: [], followUps: [] });
    expect(await screen.findByRole("button", { name: "Delete" })).toBeTruthy();
  });
});

describe("Customers: retailers and follow-ups", () => {
  it("shows a retailer by store name and lists follow-ups due this week", async () => {
    const shop: CustomerCard = {
      ...card,
      id: "c2",
      name: "Ann Buyer",
      kind: "retailer",
      company: "Dice Den",
      tags: [],
    };
    renderAs("cashier", <CustomersRoutes />, {
      searchCustomers: [shop],
      listTags: [],
      followUps: [{ id: "c2", name: "Ann Buyer", company: "Dice Den", on: "2000-01-01", note: "Reorder" }],
    });
    expect(await screen.findByText("Overdue")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dice Den (Ann Buyer)" })).toBeTruthy();
    expect(screen.getByText("Retailer")).toBeTruthy();
  });
});

describe("customer form", () => {
  it("asks for the store name for a retailer", () => {
    const { call } = renderAs("cashier", <CustomerForm id={null} onClose={vi.fn()} />, { listTags: [] });
    fireEvent.click(screen.getByLabelText("Retailer (a store that buys wholesale)"));
    fireEvent.change(screen.getByLabelText("Contact person"), { target: { value: "Ann" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ann@shop.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));
    expect((screen.getByLabelText("Store name") as HTMLInputElement).required).toBe(true);
    expect(call).not.toHaveBeenCalledWith("saveCustomer", expect.anything());
  });

  it("explains a bad phone before saving", () => {
    const { call } = renderAs("cashier", <CustomerForm id={null} onClose={vi.fn()} />, { listTags: [] });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pat" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "555-0100" } });
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));
    expect(screen.getByText("Enter a 10-digit phone number.")).toBeTruthy();
    expect(call).not.toHaveBeenCalledWith("saveCustomer", expect.anything());
  });
});
