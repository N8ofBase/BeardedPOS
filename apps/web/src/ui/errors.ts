import { AppError } from "@bearded/core";

/** A message staff can act on. Unexpected errors get a generic line instead of a stack trace. */
export function errorMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;
  return "Something went wrong. Try again, and reload the page if it keeps happening.";
}

export function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof AppError ? err.fields : {};
}
