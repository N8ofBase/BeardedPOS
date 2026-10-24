// Plain request/response shapes, so the same handlers run under Vite in development and Lambda when hosted.

export interface ApiRequest {
  method: string;
  /** Path without the query, e.g. "/api/reviews". */
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
  cookies: Record<string, string>;
  body: unknown;
}

export interface ApiResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** An error whose message is safe to show to the shopper as is. */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const ok = (body: unknown, status = 200): ApiResponse => ({ status, body });

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}

export const asObject = (body: unknown): Record<string, unknown> => {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new HttpError(400, "That request didn’t make sense. Refresh the page and try again.");
  return body as Record<string, unknown>;
};
