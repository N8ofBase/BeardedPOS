import { describe, expect, it } from "vitest";
import { games } from "../src/content/site.ts";
import { roll, SOCIAL_CHANCE, type Random } from "../src/roll.ts";

/** Plays back the given numbers in order, then repeats the last. */
const seq = (...values: number[]): Random => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
};
// The first number picks the face: face = 1 + floor(r * 20).
const face = (n: number) => (n - 1) / 20 + 0.001;

describe("d20 roller", () => {
  it("a 1 is a critical failure", () => {
    const r = roll(seq(face(1), 0));
    expect(r.kind).toBe("botch");
    expect(r.face).toBe(1);
    expect(r.text).toMatch(/Roll again\.$/);
  });

  it("a 20 links every game on the shelf", () => {
    const r = roll(seq(face(20), 0));
    expect(r.kind).toBe("crit");
    if (r.kind !== "crit") return;
    expect(r.links.map((l) => l.label)).toEqual(games.map((g) => g.name));
    expect(r.links.every((l) => l.href.startsWith("/games/"))).toBe(true);
  });

  it("an ordinary roll lands on a game shown on the shelf, linked to its page", () => {
    for (let i = 0; i < games.length; i++) {
      const r = roll(seq(face(7), SOCIAL_CHANCE, (i + 0.5) / games.length, 0));
      expect(r.kind).toBe("game");
      if (r.kind !== "game") return;
      const game = games.find((g) => g.name === r.name)!;
      expect(game).toBeDefined();
      expect(r.link.href).toBe(`/games/${game.slug}`);
      expect(r.text).toContain(`You rolled ${game.name}`);
    }
  });

  it("sometimes lands on a social account instead, opened in a new tab", () => {
    const r = roll(seq(face(12), SOCIAL_CHANCE - 0.01, 0, 0));
    expect(r.kind).toBe("social");
    if (r.kind !== "social") return;
    expect(r.link.external).toBe(true);
    expect(r.link.label).toBe(`Follow us on ${r.name}`);
  });

  it("never lands on the same game twice running", () => {
    for (const g of games) {
      for (const pickAt of [0, 0.5, 0.999]) {
        const r = roll(seq(face(9), 0.9, pickAt, 0), g.name);
        expect(r.kind === "game" && r.name).not.toBe(g.name);
      }
    }
  });

  it("only rolls 1 to 20", () => {
    expect(roll(seq(0)).face).toBe(1);
    expect(roll(seq(0.99999)).face).toBe(20);
  });
});
