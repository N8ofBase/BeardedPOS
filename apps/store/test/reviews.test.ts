import { describe, expect, it } from "vitest";
import { averageStars, isBot, LIMITS, validateReview, type ReviewInput } from "../src/reviews/reviews.ts";

const good: ReviewInput = {
  game: "fences",
  stars: 5,
  headline: "",
  body: "Our family plays it every Sunday.",
  name: "Sam R.",
  email: "sam@example.com",
  joinVip: false,
  website: "",
};
const slugs = ["fences", "locked-out"];

describe("review checks", () => {
  it("accepts a complete review", () => {
    expect(validateReview(good, slugs)).toEqual({});
  });

  it("names each problem", () => {
    const errors = validateReview(
      {
        ...good,
        game: "monopoly",
        stars: 0,
        body: "   ",
        name: "",
        email: "sam@",
        headline: "x".repeat(LIMITS.headline + 1),
      },
      slugs,
    );
    expect(Object.keys(errors).sort()).toEqual(["body", "email", "game", "headline", "name", "stars"]);
  });

  it("only takes whole stars from 1 to 5", () => {
    for (const stars of [0, 6, 3.5, -1])
      expect(validateReview({ ...good, stars }, slugs).stars).toBeDefined();
    for (const stars of [1, 5]) expect(validateReview({ ...good, stars }, slugs).stars).toBeUndefined();
  });

  it("limits the review length", () => {
    expect(validateReview({ ...good, body: "x".repeat(LIMITS.body) }, slugs).body).toBeUndefined();
    expect(validateReview({ ...good, body: "x".repeat(LIMITS.body + 1) }, slugs).body).toBeDefined();
  });

  it("spots bots by the hidden field", () => {
    expect(isBot(good)).toBe(false);
    expect(isBot({ website: "http://spam.example" })).toBe(true);
  });
});

describe("average stars", () => {
  it("is null with no reviews", () => {
    expect(averageStars([])).toBeNull();
  });

  it("rounds to one decimal", () => {
    expect(averageStars([{ stars: 5 }, { stars: 4 }, { stars: 4 }])).toEqual({ average: 4.3, count: 3 });
    expect(averageStars([{ stars: 5 }, { stars: 4 }])).toEqual({ average: 4.5, count: 2 });
  });
});
