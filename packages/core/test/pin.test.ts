import { describe, expect, it } from "vitest";
import { pinProblem } from "../src/pin.ts";

describe("staff PINs", () => {
  it("takes 4 to 6 digits", () => {
    expect(pinProblem("2580")).toBeNull();
    expect(pinProblem("258013")).toBeNull();
    expect(pinProblem("258")).toMatch(/4 to 6 digits/);
    expect(pinProblem("2580136")).toMatch(/4 to 6 digits/);
    expect(pinProblem("25a0")).toMatch(/4 to 6 digits/);
    expect(pinProblem(" 2580")).toMatch(/4 to 6 digits/);
    expect(pinProblem("")).toMatch(/4 to 6 digits/);
  });

  it("refuses the first guesses anyone makes", () => {
    for (const p of ["1111", "000000", "1234", "456789", "9876", "3210"])
      expect(pinProblem(p)).toMatch(/harder to guess/);
    expect(pinProblem("1235")).toBeNull();
    expect(pinProblem("1122")).toBeNull();
  });
});
