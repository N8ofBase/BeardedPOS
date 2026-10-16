export type ErrorCode = "forbidden" | "not_found" | "invalid" | "conflict";

/** An error whose message is safe and plain enough to show staff as-is. */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}
