export type ErrorCode = "forbidden" | "not_found" | "invalid" | "conflict";

/** An error whose message is safe and plain enough to show staff as-is. */
export class AppError extends Error {
  readonly code: ErrorCode;
  /** Problems by form field, when the error is about specific inputs. */
  readonly fields: Record<string, string>;

  constructor(code: ErrorCode, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.fields = fields;
  }
}

/** True when a database error is a unique violation on the named index or constraint. */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; message?: string; constraint?: string };
  return e?.code === "23505" && (e.constraint === constraint || !!e.message?.includes(constraint));
}
