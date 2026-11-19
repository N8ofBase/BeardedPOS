// Site content from Behind the Beard's "Site content" tab: staff save a draft, preview it, then
// publish it, and the site shows the published version on the next page load. No redeploy.
import {
  changedKeys,
  checkSiteContent,
  imageIds,
  isImageId,
  SITE_IMAGE_MAX_BYTES,
  SITE_IMAGE_TYPES,
  SiteContentError,
  type PublishedSite,
  type SiteContent,
  type SiteImageType,
  type StaffSite,
} from "@bearded/store-core";
import type { StoreCtx } from "../context.ts";
import { withBusiness, type Sql } from "../db.ts";
import { asObject, HttpError, ok, type ApiRequest, type ApiResponse } from "../http.ts";
import { requireStaff } from "./staff.ts";

/** How many earlier publishes the editor lists. All of them stay in the database. */
const HISTORY = 20;

interface VersionRow {
  version: "draft" | "published";
  content: SiteContent;
  saved_by: string;
  updated_at: Date;
}

async function versions(sql: Sql) {
  const { rows } = await sql.query<VersionRow>(
    "SELECT version, content, saved_by, updated_at FROM store_site_content",
  );
  return {
    draft: rows.find((r) => r.version === "draft"),
    published: rows.find((r) => r.version === "published"),
  };
}

async function save(
  sql: Sql,
  businessId: string,
  version: VersionRow["version"],
  content: SiteContent,
  by: string,
) {
  await sql.query(
    `INSERT INTO store_site_content (business_id, version, content, saved_by)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (business_id, version) DO UPDATE
       SET content = EXCLUDED.content, saved_by = EXCLUDED.saved_by`,
    [businessId, version, JSON.stringify(content), by],
  );
}

function readContent(body: unknown): SiteContent {
  try {
    return checkSiteContent(asObject(body).content);
  } catch (e) {
    if (e instanceof SiteContentError) throw new HttpError(400, e.message);
    throw e;
  }
}

/** Every picture the content points to must have been uploaded to this store. */
async function checkImages(sql: Sql, content: SiteContent) {
  const ids = imageIds(content);
  if (ids.length === 0) return;
  const { rows } = await sql.query<{ id: string }>(
    "SELECT id FROM store_site_images WHERE id = ANY($1::uuid[])",
    [ids],
  );
  if (rows.length < new Set(ids).size) throw new HttpError(400, "A picture is missing. Upload it again.");
}

async function staffSite(sql: Sql): Promise<StaffSite> {
  const { draft, published } = await versions(sql);
  const history = await sql.query<{ id: string; published_by: string; created_at: Date; changes: number }>(
    `SELECT id, published_by, created_at, changes FROM store_site_publishes
     ORDER BY created_at DESC LIMIT ${HISTORY}`,
  );
  return {
    draft: draft?.content ?? published?.content ?? {},
    published: published?.content ?? {},
    draftBy: draft?.saved_by ?? null,
    draftAt: draft?.updated_at.toISOString() ?? null,
    publishedBy: published?.saved_by ?? null,
    publishedAt: published?.updated_at.toISOString() ?? null,
    history: history.rows.map((r) => ({
      id: r.id,
      by: r.published_by,
      at: r.created_at.toISOString(),
      changes: r.changes,
    })),
  };
}

/** GET /api/site: what shoppers see. */
export async function publishedSite(ctx: StoreCtx): Promise<ApiResponse> {
  const row = await withBusiness(
    ctx.db,
    ctx.config.businessId,
    async (sql) => (await versions(sql)).published,
  );
  const body: PublishedSite = {
    content: row?.content ?? {},
    publishedAt: row?.updated_at.toISOString() ?? null,
  };
  return ok(body);
}

/** GET /api/staff/site: the draft, the published version and recent publishes. */
export async function getStaffSite(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  await requireStaff(ctx, req);
  return ok(await withBusiness(ctx.db, ctx.config.businessId, staffSite));
}

/** POST /api/staff/site/draft { content }: saves the draft. Shoppers don't see it. */
export async function saveDraft(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const email = await requireStaff(ctx, req);
  const content = readContent(req.body);
  return ok(
    await withBusiness(ctx.db, ctx.config.businessId, async (sql) => {
      await checkImages(sql, content);
      await save(sql, ctx.config.businessId, "draft", content, email);
      return staffSite(sql);
    }),
  );
}

/** POST /api/staff/site/publish: the saved draft becomes what shoppers see. */
export async function publishSite(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const email = await requireStaff(ctx, req);
  return ok(
    await withBusiness(ctx.db, ctx.config.businessId, async (sql) => {
      const { draft, published } = await versions(sql);
      if (!draft) throw new HttpError(400, "Save a draft first.");
      const changes = changedKeys(draft.content, published?.content ?? {}).length;
      if (changes === 0)
        throw new HttpError(400, "The draft is the same as the live site. Nothing to publish.");
      await save(sql, ctx.config.businessId, "published", draft.content, email);
      await sql.query(
        `INSERT INTO store_site_publishes (business_id, content, changes, published_by)
         VALUES ($1, $2::jsonb, $3, $4)`,
        [ctx.config.businessId, JSON.stringify(draft.content), changes, email],
      );
      return staffSite(sql);
    }),
  );
}

/** POST /api/staff/site/restore/:id: puts an earlier publish back in the draft (not live until published). */
export async function restoreVersion(ctx: StoreCtx, req: ApiRequest, id: string): Promise<ApiResponse> {
  const email = await requireStaff(ctx, req);
  if (!isImageId(id)) throw new HttpError(404, "That version isn’t here any more.");
  return ok(
    await withBusiness(ctx.db, ctx.config.businessId, async (sql) => {
      const { rows } = await sql.query<{ content: SiteContent }>(
        "SELECT content FROM store_site_publishes WHERE id = $1",
        [id],
      );
      if (!rows[0]) throw new HttpError(404, "That version isn’t here any more.");
      await save(sql, ctx.config.businessId, "draft", rows[0].content, email);
      return staffSite(sql);
    }),
  );
}

/** The file's first bytes say what it really is; the browser's word alone isn't enough. */
export function sniffImage(bytes: Uint8Array): SiteImageType | null {
  const at = (i: number, ...b: number[]) => b.every((v, j) => bytes[i + j] === v);
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  return null;
}

/** POST /api/staff/site/images { data } (base64): keeps a picture and returns its id. */
export async function uploadImage(ctx: StoreCtx, req: ApiRequest): Promise<ApiResponse> {
  const email = await requireStaff(ctx, req);
  const data = asObject(req.body).data;
  if (typeof data !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(data))
    throw new HttpError(400, "That picture didn’t come through. Try again.");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > SITE_IMAGE_MAX_BYTES)
    throw new HttpError(400, "That picture is too big, even after shrinking. Try a smaller one.");
  const type = sniffImage(bytes);
  if (!type || !SITE_IMAGE_TYPES.includes(type))
    throw new HttpError(400, "Use a photo or picture file: JPEG, PNG or WebP.");
  const id = await withBusiness(ctx.db, ctx.config.businessId, async (sql) => {
    const { rows } = await sql.query<{ id: string }>(
      `INSERT INTO store_site_images (business_id, content_type, bytes, uploaded_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [ctx.config.businessId, type, bytes, email],
    );
    return rows[0]!.id;
  });
  return ok({ id }, 201);
}

/** GET /api/site/images/:id: a picture. Its id never points to different bytes, so browsers keep it. */
export async function siteImage(ctx: StoreCtx, _req: ApiRequest, id: string): Promise<ApiResponse> {
  if (!isImageId(id)) throw new HttpError(404, "Not found.");
  const row = await withBusiness(ctx.db, ctx.config.businessId, async (sql) => {
    const { rows } = await sql.query<{ content_type: string; bytes: Uint8Array }>(
      "SELECT content_type, bytes FROM store_site_images WHERE id = $1",
      [id],
    );
    return rows[0];
  });
  if (!row) throw new HttpError(404, "Not found.");
  return {
    status: 200,
    bytes: row.bytes,
    headers: {
      "Content-Type": row.content_type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  };
}
