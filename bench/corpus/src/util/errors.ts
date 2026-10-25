/** Base class for errors that map to an HTTP status. */
export class AppError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Convert any thrown value into an HTTP status and JSON body. */
export function handleError(error: unknown): { status: number; body: { error: string } } {
  if (error instanceof AppError) return { status: error.status, body: { error: error.message } };
  return { status: 500, body: { error: "internal error" } };
}
