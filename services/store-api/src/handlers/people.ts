// VIP signups and reviews.
import {
  gameSlugs,
  isBot,
  looksLikeEmail,
  validateReview,
  type Review,
  type ReviewInput,
} from "@bearded/store-core";
import type { StoreCtx } from "../context.ts";
import { withBusiness, type Sql } from "../db.ts";
import { asObject, HttpError, ok, type ApiRequest, type ApiResponse } from "../http.ts";

type VipSource = "band" | "popup" | "review";

async function addVip(ctx: StoreCtx, sql: Sql, email: string, source: VipSource) {
  await sql.query(
    `INSERT INTO store_vip_signups (business_id, email, source) VALUES ($1, $2, $3)
     ON CONFLICT (business_id, lower(email)) DO NOTHING`,
    [ctx.config.businessId, email, source],
  );
}

export async function joinVip(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const body = asObject(req.body);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!looksLikeEmail(email)) throw new HttpError(400, "Check the email address, like name@example.com.");
  const source: VipSource = body.source === "popup" ? "popup" : "band";
  await withBusiness(ctx.db, ctx.config.businessId, (sql) => addVip(ctx, sql, email, source));
  await ctx.square.upsertCustomer(email);
  return ok({ joined: true });
}

interface ReviewRow {
  id: string;
  game: string;
  stars: number;
  headline: string | null;
  body: string;
  name: string;
  email: string;
  status: "pending" | "approved" | "hidden";
  featured: boolean;
  bought_from_us: boolean;
  approved_at: Date | null;
  created_at: Date;
}

export const toReview = (r: ReviewRow): Review => ({
  id: r.id,
  game: r.game,
  stars: r.stars,
  headline: r.headline,
  body: r.body,
  name: r.name,
  date: (r.approved_at ?? r.created_at).toISOString().slice(0, 10),
  boughtFromUs: r.bought_from_us,
  featured: r.featured,
});

export const REVIEW_COLUMNS =
  "id, game, stars, headline, body, name, email, status, featured, bought_from_us, approved_at, created_at";
export type { ReviewRow };

/** Approved reviews only, newest first. Emails never leave the server here. */
export async function listReviews(ctx: StoreCtx): Promise<ApiResponse> {
  const rows = await withBusiness(
    ctx.db,
    ctx.config.businessId,
    async (sql) =>
      (
        await sql.query<ReviewRow>(
          `SELECT ${REVIEW_COLUMNS} FROM store_reviews WHERE status = 'approved' ORDER BY approved_at DESC LIMIT 500`,
        )
      ).rows,
  );
  return ok(rows.map(toReview));
}

/** Reviews one email may send per hour. */
export const REVIEWS_PER_HOUR = 3;

export async function submitReview(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const b = asObject(req.body);
  const input: ReviewInput = {
    game: String(b.game ?? ""),
    stars: Number(b.stars),
    headline: String(b.headline ?? ""),
    body: String(b.body ?? ""),
    name: String(b.name ?? ""),
    email: String(b.email ?? ""),
    joinVip: b.joinVip === true,
    website: String(b.website ?? ""),
  };
  // Bots get the same thank-you as people, so they learn nothing.
  if (isBot(input)) return ok({ received: true }, 202);
  const errors = validateReview(input, gameSlugs);
  const first = Object.values(errors)[0];
  if (first) throw new HttpError(400, first);
  const email = input.email.trim();
  const bought = await ctx.square.hasPaidOrder(email);
  await withBusiness(ctx.db, ctx.config.businessId, async (sql) => {
    const { rows } = await sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM store_reviews
       WHERE lower(email) = lower($1) AND created_at > now() - interval '1 hour'`,
      [email],
    );
    if ((rows[0]?.n ?? 0) >= REVIEWS_PER_HOUR)
      throw new HttpError(429, "You’ve sent a few reviews already. Try again in an hour.");
    await sql.query(
      `INSERT INTO store_reviews (business_id, game, stars, headline, body, name, email, bought_from_us)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        ctx.config.businessId,
        input.game,
        input.stars,
        input.headline.trim() || null,
        input.body.trim(),
        input.name.trim(),
        email,
        bought,
      ],
    );
    if (input.joinVip) await addVip(ctx, sql, email, "review");
  });
  if (input.joinVip) await ctx.square.upsertCustomer(email);
  const staff = ctx.config.staff.find((s) => !s.startsWith("@"));
  if (staff)
    await ctx.mailer.send(
      staff,
      "A new review is waiting in Behind the Beard",
      `${input.name.trim()} gave ${input.game} ${input.stars} stars.`,
    );
  return ok({ received: true }, 202);
}
