// Reviews: what a reviewer sends, what the site shows, and the checks both sides run.
// The store server repeats validateReview() and holds every review until the team approves it.
import { looksLikeEmail } from "../api/email.ts";

export interface Review {
  id: string;
  game: string;
  stars: number;
  headline: string | null;
  body: string;
  /** First name and last initial, as the reviewer typed it. */
  name: string;
  /** ISO date the review was approved. */
  date: string;
  /** The reviewer's email matches a paid order in Square. */
  boughtFromUs: boolean;
  featured: boolean;
}

export interface ReviewInput {
  game: string;
  stars: number;
  headline: string;
  body: string;
  name: string;
  email: string;
  joinVip: boolean;
  /** Hidden from people; bots fill it in. A filled one is thanked and thrown away. */
  website: string;
}

export const LIMITS = { headline: 80, body: 2000, name: 40 };

export type ReviewErrors = Partial<Record<"game" | "stars" | "body" | "name" | "email" | "headline", string>>;

export function validateReview(input: ReviewInput, gameSlugs: string[]): ReviewErrors {
  const errors: ReviewErrors = {};
  if (!gameSlugs.includes(input.game)) errors.game = "Pick the game you’re reviewing.";
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5)
    errors.stars = "Pick 1 to 5 stars.";
  if (input.headline.trim().length > LIMITS.headline)
    errors.headline = `Keep the headline under ${LIMITS.headline} characters.`;
  const body = input.body.trim();
  if (body.length === 0) errors.body = "Tell us what you thought.";
  else if (body.length > LIMITS.body) errors.body = `Keep the review under ${LIMITS.body} characters.`;
  const name = input.name.trim();
  if (name.length === 0) errors.name = "Add your first name and last initial.";
  else if (name.length > LIMITS.name) errors.name = `Keep the name under ${LIMITS.name} characters.`;
  if (!looksLikeEmail(input.email)) errors.email = "Check the email address, like name@example.com.";
  return errors;
}

/** Average stars to one decimal, or null when there are no reviews yet. */
export function averageStars(reviews: Pick<Review, "stars">[]): { average: number; count: number } | null {
  if (reviews.length === 0) return null;
  const total = reviews.reduce((n, r) => n + r.stars, 0);
  return { average: Math.round((total / reviews.length) * 10) / 10, count: reviews.length };
}

export const isBot = (input: Pick<ReviewInput, "website">) => input.website.trim() !== "";
