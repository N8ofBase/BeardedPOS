import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { autoMatch, type ColumnMapping } from "@pet-pos/core";
import type { ImportResult } from "@pet-pos/api";
import { ColumnMatcher, PreviewView } from "../src/pages/settings/ImportParts.tsx";
import type { Sheet } from "../src/pages/settings/readSheet.ts";

afterEach(cleanup);

const sheet: Sheet = {
  fileName: "customers.csv",
  headers: ["Full Name", "Mobile", "Notes column"],
  rows: [
    ["Pat Lee", "2125550199", "Likes treats"],
    ["Sam Ray", "2125550198", ""],
  ],
};

function Harness({ onMapping }: { onMapping: (m: ColumnMapping) => void }) {
  const [mapping, setMapping] = useState(() => autoMatch("customers", sheet.headers));
  return (
    <ColumnMatcher
      type="customers"
      sheet={sheet}
      mapping={mapping}
      onChange={(m) => {
        setMapping(m);
        onMapping(m);
      }}
    />
  );
}

describe("ColumnMatcher", () => {
  it("selects matched columns and lets one be changed", () => {
    let latest: ColumnMapping = {};
    render(<Harness onMapping={(m) => (latest = m)} />);
    const name = screen.getByLabelText("Column for Name") as HTMLSelectElement;
    const phone = screen.getByLabelText("Column for Phone") as HTMLSelectElement;
    const notes = screen.getByLabelText("Column for Notes") as HTMLSelectElement;
    expect(name.value).toBe("0");
    expect(phone.value).toBe("1");
    expect(notes.value).toBe("");
    expect(screen.getByText("Pat Lee, Sam Ray")).toBeTruthy();

    fireEvent.change(notes, { target: { value: "2" } });
    expect(latest).toMatchObject({ name: 0, phone: 1, notes: 2 });

    // Giving the phone column to Notes takes it away from Phone.
    fireEvent.change(notes, { target: { value: "1" } });
    expect(latest).toEqual({ name: 0, notes: 1 });
  });
});

describe("PreviewView", () => {
  it("shows counts and the reason for each skipped row", () => {
    const result: ImportResult = {
      rows: 3,
      created: 1,
      updated: 1,
      skipped: 1,
      skips: [{ row: 4, reason: "Phone isn't 10 digits" }],
      warnings: [{ row: 2, message: 'Birthday "13/45/90" isn\'t a date, left blank' }],
      sample: [
        { row: 2, action: "update", label: "Sample Customer (DEMO)" },
        { row: 3, action: "new", label: "Pat Lee" },
        { row: 4, action: "skip", label: "Bad", reason: "Phone isn't 10 digits" },
      ],
    };
    render(<PreviewView result={result} />);
    expect(screen.getAllByText("Phone isn't 10 digits")).toHaveLength(2);
    expect(screen.getByText("1 warning: imported, with a note to check")).toBeTruthy();
    expect(screen.getByText("Pat Lee")).toBeTruthy();
    expect(screen.getByText("Skip")).toBeTruthy();
  });
});
