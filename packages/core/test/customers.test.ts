import { describe, expect, it } from "vitest";
import { cleanCustomer, validateCustomer, type CustomerInput, addressLine } from "../src/customer.ts";
import { addDays, ageText, birthdayTag, daysUntilBirthday, formatDate, isIsoDate } from "../src/dates.ts";
import { DUPLICATE_PET_MESSAGE, duplicatePetName, rabiesLapsed, vaccineStatus } from "../src/pets.ts";

describe("dates", () => {
  it("checks real calendar dates", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("10/15/2026")).toBe(false);
  });

  it("adds days across months and years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("formats with the year only when it isn't this year", () => {
    expect(formatDate("2026-03-03", "2026-10-15")).toBe("Mar 3");
    expect(formatDate("2027-03-03", "2026-10-15")).toBe("Mar 3, 2027");
  });
});

describe("birthdays", () => {
  const today = "2026-10-15";

  it("counts days to the next birthday", () => {
    expect(daysUntilBirthday("1990-10-15", today)).toBe(0);
    expect(daysUntilBirthday("1990-10-16", today)).toBe(1);
    expect(daysUntilBirthday("1990-10-14", today)).toBe(364);
    expect(daysUntilBirthday("1990-01-02", "2026-12-30")).toBe(3);
  });

  it("treats Feb 29 as Feb 28 outside leap years", () => {
    expect(daysUntilBirthday("2020-02-29", "2027-02-27")).toBe(1);
    expect(daysUntilBirthday("2020-02-29", "2028-02-27")).toBe(2);
  });

  it("tags birthdays within a week, as in the prototype", () => {
    expect(birthdayTag("1990-10-15", today)).toBe("birthday today");
    expect(birthdayTag("1990-10-16", today)).toBe("birthday tomorrow");
    expect(birthdayTag("1990-10-22", today)).toBe("birthday in 7 days");
    expect(birthdayTag("1990-10-23", today)).toBeNull();
    expect(birthdayTag(null, today)).toBeNull();
  });

  it("writes ages in months, then years", () => {
    expect(ageText("2026-02-20", today)).toBe("7 mo");
    expect(ageText("2025-10-15", today)).toBe("1 yr");
    expect(ageText("2023-10-16", today)).toBe("2 yrs");
    expect(ageText("2027-01-01", today)).toBe("");
  });
});

describe("pets", () => {
  it("finds duplicate names in any letter case", () => {
    expect(duplicatePetName(["Biscuit", "Mo"])).toBeNull();
    expect(duplicatePetName(["Biscuit", " biscuit "])).toBe(DUPLICATE_PET_MESSAGE);
    expect(duplicatePetName(["", ""])).toBeNull();
  });

  it("sorts vaccines into expired, due within 30 days, and ok", () => {
    const today = "2026-10-15";
    expect(vaccineStatus("2026-10-14", today)).toBe("expired");
    expect(vaccineStatus("2026-10-15", today)).toBe("due");
    expect(vaccineStatus("2026-11-14", today)).toBe("due");
    expect(vaccineStatus("2026-11-15", today)).toBe("ok");
  });

  it("knows when rabies has lapsed", () => {
    const today = "2026-10-15";
    expect(rabiesLapsed([{ vaccine: "Rabies", expiresOn: "2026-09-01" }], today)).toBe(true);
    expect(rabiesLapsed([{ vaccine: "rabies", expiresOn: "2027-09-01" }], today)).toBe(false);
    expect(rabiesLapsed([{ vaccine: "DHPP", expiresOn: "2020-01-01" }], today)).toBe(false);
  });
});

describe("customers", () => {
  const base: CustomerInput = {
    name: "Pat Lee",
    phone: "(212) 555-0100",
    email: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    birthday: "",
    smsOptIn: false,
    notes: "",
  };

  it("accepts a name and a phone", () => {
    expect(validateCustomer(base)).toEqual({});
  });

  it("explains each problem", () => {
    expect(
      validateCustomer(
        {
          ...base,
          name: "",
          phone: "555-0100",
          email: "pat@",
          state: "New York",
          zip: "123",
          birthday: "2099-01-01",
        },
        "2026-10-15",
      ),
    ).toEqual({
      name: "Name is required.",
      phone: "Enter a 10-digit phone number.",
      email: "Enter an email like name@example.com.",
      state: "Use the 2-letter state, like NY.",
      zip: "Enter a 5-digit ZIP.",
      birthday: "Birthday can't be in the future.",
    });
  });

  it("needs a phone or an email", () => {
    expect(validateCustomer({ ...base, phone: "" }).phone).toMatch(/phone number or an email/);
    expect(validateCustomer({ ...base, phone: "", email: "pat@example.com" })).toEqual({});
  });

  it("stores the phone as 10 digits and blanks as null", () => {
    expect(cleanCustomer({ ...base, phone: "+1 212 555 0100", state: "ny", city: " " })).toMatchObject({
      phone: "2125550100",
      state: "NY",
      city: null,
      email: null,
    });
  });

  it("builds the address line from what's filled in", () => {
    expect(addressLine({ street: "12 Main St", city: "Springfield", state: "IL", zip: "62701" })).toBe(
      "12 Main St, Springfield, IL 62701",
    );
    expect(addressLine({ street: null, city: null, state: "IL", zip: null })).toBe("IL");
  });
});
