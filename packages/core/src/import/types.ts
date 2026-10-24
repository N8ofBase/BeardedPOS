// What each import file can hold. Aliases come from the prototype's IMP table and the
// spec's accepted columns; header names are compared after normalizeHeader().

export const IMPORT_TYPE_KEYS = ["customers", "products", "orders"] as const;
export type ImportType = (typeof IMPORT_TYPE_KEYS)[number];

export interface FieldDef {
  key: string;
  label: string;
  aliases: string[];
  /** Shown in the template's example row. */
  sample: string;
}

export interface ImportTypeDef {
  label: string;
  help: string;
  fields: FieldDef[];
  /** Mapping problems that stop the import, e.g. no column for the SKU. */
  needs: { message: string; anyOf: string[] }[];
}

const f = (key: string, label: string, sample: string, aliases: string[]): FieldDef => ({
  key,
  label,
  sample,
  aliases: [label, key, ...aliases],
});

export const IMPORT_TYPES: Record<ImportType, ImportTypeDef> = {
  customers: {
    label: "Customers",
    help: "One row per customer. Existing customers are matched by phone, then email, so importing again updates them.",
    fields: [
      f("name", "Name", "Pat Lee", ["customer", "customer name", "full name"]),
      f("first", "First name", "", ["first", "firstname", "given name"]),
      f("last", "Last name", "", ["last", "lastname", "surname", "family name"]),
      f("phone", "Phone", "(212) 555-0199", ["mobile", "cell", "phone number", "telephone", "mobile phone"]),
      f("email", "Email", "pat@example.com", ["e mail", "email address"]),
      f("street", "Street address", "1 Oak Ave", [
        "street",
        "address",
        "address 1",
        "address1",
        "address line 1",
      ]),
      f("city", "City", "Springfield", ["town"]),
      f("state", "State", "IL", ["st", "province"]),
      f("zip", "ZIP", "62701", ["zip code", "zipcode", "postal code", "postcode"]),
      f("birthday", "Birthday", "1985-04-12", ["birth date", "birthdate", "dob", "date of birth"]),
      f("smsOptIn", "SMS opt-in", "yes", [
        "sms",
        "text opt in",
        "texts ok",
        "sms opt in",
        "opt in",
        "text messages",
      ]),
      f("notes", "Notes", "", ["note", "comments"]),
    ],
    needs: [
      { message: "Pick the column with the customer's name (or first name).", anyOf: ["name", "first"] },
      { message: "Pick the phone or email column, so customers can be matched.", anyOf: ["phone", "email"] },
    ],
  },
  products: {
    label: "Products",
    help: "One row per product. Existing products are matched by SKU, then barcode. On hand sets the stock count; blank cells leave what's there.",
    fields: [
      f("sku", "SKU", "B-100", ["item code", "item number", "item #"]),
      f("barcode", "Barcode", "012345678905", ["upc", "ean", "gtin"]),
      f("name", "Name", "Test Kibble 5 lb", ["description", "product", "item name", "product name"]),
      f("brand", "Brand", "Test Brand", ["vendor", "manufacturer"]),
      f("category", "Category", "Dog food", ["department", "dept"]),
      f("price", "Price", "19.99", ["retail", "retail price", "sell price"]),
      f("wholesale", "Wholesale price", "15.00", ["wholesale", "retailer price", "dealer price"]),
      f("cost", "Our cost", "12.00", ["cost", "unit cost", "landed cost"]),
      f("royalty", "Royalty %", "10", ["royalty", "royalty percent", "royalty rate"]),
      f("royaltyPayee", "Royalty payee", "", ["royalty to", "payee", "designer"]),
      f("onHand", "On hand", "8", ["qty", "quantity", "stock", "on hand qty"]),
      f("reorderAt", "Reorder at", "3", ["reorder", "reorder point", "min"]),
    ],
    needs: [{ message: "Pick the SKU or barcode column.", anyOf: ["sku", "barcode"] }],
  },
  orders: {
    label: "Past orders",
    help: "One row per item sold. Rows for the same customer and receipt number become one order (with no receipt number, the same date). Customers must already be here; they're matched by phone, then email. Items are matched to products by SKU, then barcode; others keep their name. Past orders fill in order history and \"usually buys\" but don't change stock or payments. Importing the same orders again skips them.",
    fields: [
      f("date", "Date", "2025-03-14", ["order date", "sale date", "date sold", "transaction date"]),
      f("receipt", "Receipt number", "A-1043", [
        "receipt",
        "receipt #",
        "order number",
        "order #",
        "order",
        "invoice",
        "invoice number",
        "ticket",
      ]),
      f("phone", "Customer phone", "(212) 555-0199", ["phone", "mobile", "cell", "phone number"]),
      f("email", "Customer email", "", ["email"]),
      f("customer", "Customer name", "Pat Lee", ["customer", "name"]),
      f("sku", "SKU", "B-100", ["item code", "item number", "item #"]),
      f("barcode", "Barcode", "", ["upc", "ean", "gtin"]),
      f("item", "Item name", "Test Kibble 5 lb", ["item", "description", "product", "product name"]),
      f("qty", "Quantity", "2", ["qty", "quantity sold", "units"]),
      f("unitPrice", "Unit price", "19.99", ["price", "unit price", "each"]),
      f("lineTotal", "Line total", "39.98", ["total", "amount", "extended price", "line amount"]),
    ],
    needs: [
      { message: "Pick the date column.", anyOf: ["date"] },
      { message: "Pick the customer phone or email column.", anyOf: ["phone", "email"] },
      { message: "Pick the item name, SKU or barcode column.", anyOf: ["item", "sku", "barcode"] },
      { message: "Pick the unit price or line total column.", anyOf: ["unitPrice", "lineTotal"] },
    ],
  },
};

/** Template CSV for a type: headers plus one example row. */
export function templateCsv(type: ImportType): string {
  const fields = IMPORT_TYPES[type].fields.filter(
    (x) => !(type === "customers" && (x.key === "first" || x.key === "last")),
  );
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return `${fields.map((x) => cell(x.label)).join(",")}\r\n${fields.map((x) => cell(x.sample)).join(",")}\r\n`;
}
