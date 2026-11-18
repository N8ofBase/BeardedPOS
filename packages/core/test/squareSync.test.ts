import { describe, expect, it } from "vitest";
import {
  planCustomers,
  planProducts,
  squareCustomer,
  squareSku,
  type ShelfCustomer,
  type ShelfProduct,
  type SquareShelfItem,
} from "../src/squareSync.ts";

const sq = (over: Partial<SquareShelfItem>): SquareShelfItem => ({
  variationId: "VAR00000001",
  name: "Fences",
  sku: null,
  barcode: null,
  priceCents: 3000,
  costCents: null,
  category: null,
  tracksStock: true,
  stock: 5,
  ...over,
});
const shelf = (over: Partial<ShelfProduct>): ShelfProduct => ({
  id: "p1",
  sku: "BBG-001",
  barcode: null,
  name: "Fences",
  priceCents: 3000,
  costCents: 0,
  onHand: 5,
  squareVariationId: null,
  squareTracksStock: false,
  ...over,
});

describe("planProducts", () => {
  it("matches by link, then SKU, then barcode, then name", () => {
    const plan = planProducts(
      [
        sq({ variationId: "V1", name: "Renamed in Square" }),
        sq({ variationId: "V2", name: "Two", sku: "abc" }),
        sq({ variationId: "V3", name: "Three", barcode: "123" }),
        sq({ variationId: "V4", name: "four" }),
      ],
      [
        shelf({ id: "a", name: "Old name", squareVariationId: "V1", squareTracksStock: true }),
        shelf({ id: "b", sku: "ABC", name: "x" }),
        shelf({ id: "c", sku: "c", barcode: "123", name: "y" }),
        shelf({ id: "d", sku: "d", name: "Four" }),
      ],
    );
    expect(plan.update.map((u) => [u.productId, u.match])).toEqual([
      ["a", "linked"],
      ["b", "sku"],
      ["c", "barcode"],
      ["d", "name"],
    ]);
    expect(plan.update[0]!.changes).toEqual({ name: "Renamed in Square" });
    expect(plan.create).toEqual([]);
  });

  it("takes Square's price, cost and count, and leaves a count alone while changes wait to send", () => {
    const item = sq({ variationId: "V1", priceCents: 3500, costCents: 1200, stock: 2 });
    const linked = shelf({ squareVariationId: "V1", squareTracksStock: true, onHand: 5 });
    const plan = planProducts([item], [linked]);
    expect(plan.update[0]).toMatchObject({
      changes: { priceCents: 3500, costCents: 1200 },
      stockTo: 2,
      stockFrom: 5,
    });
    expect(planProducts([item], [linked], new Set(["p1"])).update[0]!.stockTo).toBeNull();
  });

  it("counts a linked product that already matches as unchanged", () => {
    const plan = planProducts(
      [sq({ variationId: "V1" })],
      [shelf({ squareVariationId: "V1", squareTracksStock: true })],
    );
    expect(plan).toMatchObject({ update: [], unchanged: 1, create: [] });
  });

  it("creates new products with Square's SKU and barcode unless another product has them", () => {
    const plan = planProducts(
      [
        sq({ variationId: "NEWVAR000001", name: "New", sku: "BBG-001", barcode: "999" }),
        sq({ variationId: "NEWVAR000002", name: "Newer", sku: "fresh", barcode: "777" }),
        sq({ variationId: "ELSEWHERE", name: "Other" }),
      ],
      [shelf({ name: "Other", barcode: "999", squareVariationId: "ELSEWHERE" })],
    );
    expect(plan.create.map((c) => [c.sku, c.barcode])).toEqual([
      [squareSku("NEWVAR000001"), null],
      ["fresh", "777"],
    ]);
    expect(squareSku("NEWVAR000001")).toBe("SQ-AR000001");
  });

  it("skips variable prices and lists register products Square doesn't sell", () => {
    const plan = planProducts([sq({ priceCents: null, name: "Donation" })], [shelf({ name: "Only here" })]);
    expect(plan.skipped).toEqual([
      { item: expect.objectContaining({ name: "Donation" }), reason: "Variable price in Square" },
    ]);
    expect(plan.onlyInRegister).toEqual([{ id: "p1", name: "Only here" }]);
  });

  it("never gives one register product to two Square items", () => {
    const plan = planProducts(
      [sq({ variationId: "V1", name: "Fences" }), sq({ variationId: "V2", name: "Fences" })],
      [shelf({ name: "Fences" })],
    );
    expect(plan.update.map((u) => u.item.variationId)).toEqual(["V1"]);
    expect(plan.create.map((c) => c.item.variationId)).toEqual(["V2"]);
  });

  it("won't take a product linked to another Square item that still exists", () => {
    const plan = planProducts(
      [sq({ variationId: "V1", name: "Fences" }), sq({ variationId: "V2", name: "Fences" })],
      [shelf({ id: "a", name: "Fences", squareVariationId: "V2" })],
    );
    expect(plan.update.map((u) => [u.item.variationId, u.productId])).toEqual([["V2", "a"]]);
    expect(plan.create.map((c) => c.item.variationId)).toEqual(["V1"]);
  });
});

describe("squareCustomer", () => {
  it("tidies Square's fields the register's way", () => {
    expect(
      squareCustomer({
        id: "C1",
        given_name: " Pat ",
        family_name: "Lee",
        phone_number: "+1 (314) 555-0101",
        email_address: "P@X.COM",
      }),
    ).toEqual({ id: "C1", name: "Pat Lee", phone: "3145550101", email: "p@x.com" });
    expect(squareCustomer({ id: "C2", company_name: "Game Shop", email_address: "a@b.c" })?.name).toBe(
      "Game Shop",
    );
    expect(squareCustomer({ id: "C3" })).toBeNull();
  });
});

describe("planCustomers", () => {
  const reg = (over: Partial<ShelfCustomer>): ShelfCustomer => ({
    id: "r1",
    name: "Pat",
    phone: null,
    email: null,
    squareCustomerId: null,
    ...over,
  });

  it("matches on phone, then email, and fills in what the register is missing", () => {
    const plan = planCustomers(
      [
        { id: "C1", name: "Pat Lee", phone: "3145550101", email: "pat@x.com" },
        { id: "C2", name: "Sam", phone: null, email: "sam@x.com" },
      ],
      [reg({ id: "r1", phone: "3145550101" }), reg({ id: "r2", email: "SAM@x.com" })],
    );
    expect(plan.link).toEqual([
      { customerId: "r1", square: expect.objectContaining({ id: "C1" }), fill: { email: "pat@x.com" } },
      { customerId: "r2", square: expect.objectContaining({ id: "C2" }), fill: {} },
    ]);
    expect(plan.create).toEqual([]);
    expect(plan.push).toEqual([]);
  });

  it("adds Square's new customers, sends the register's to Square, and leaves linked ones alone", () => {
    const plan = planCustomers(
      [
        { id: "C1", name: "Known", phone: null, email: "k@x.com" },
        { id: "C9", name: "New", phone: "3145550109", email: null },
      ],
      [reg({ id: "r1", squareCustomerId: "C1" }), reg({ id: "r2", phone: "3145550111" }), reg({ id: "r3" })],
    );
    expect(plan.unchanged).toBe(1);
    expect(plan.create.map((c) => c.id)).toEqual(["C9"]);
    // r3 has no phone or email: nothing for Square to match on, so it stays in the register only.
    expect(plan.push.map((c) => c.id)).toEqual(["r2"]);
  });

  it("leaves out a Square customer whose phone or email the register already has on someone else", () => {
    const plan = planCustomers(
      [
        { id: "C1", name: "A", phone: "3145550101", email: null },
        { id: "C2", name: "B", phone: "3145550101", email: null },
      ],
      [reg({ id: "r1", phone: "3145550199", squareCustomerId: "C0" })],
    );
    expect(plan.create.map((c) => c.id)).toEqual(["C1"]);
    expect(plan.duplicates.map((c) => c.id)).toEqual(["C2"]);
  });
});
