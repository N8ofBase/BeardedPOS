import { describe, expect, it } from "vitest";
import { squareText } from "../src/staff/BehindTheBeard.tsx";

describe("which Square Behind the Beard says it's on", () => {
  it("says plainly whether money is real", () => {
    expect(squareText({ mode: "offline" })).toMatch(/no money moves/);
    expect(squareText({ mode: "sandbox", merchant: "Default Test Account", location: "Default" })).toBe(
      "Square (Sandbox, test money only): Default Test Account, Default",
    );
    expect(squareText({ mode: "live", merchant: "Bearded Board Games", location: "St. Louis" })).toBe(
      "Square (live, real money): Bearded Board Games, St. Louis",
    );
    expect(squareText({ mode: "live", error: "Square didn’t answer." })).toMatch(/real money\): Square didn/);
  });
});
