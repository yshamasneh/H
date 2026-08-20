/**
 * The API error contract, kept in its own leaf module (no react-native / i18n
 * imports) so pure logic modules — and their node:test unit suites — can depend
 * on `ApiError` without dragging the whole native `api.ts` module graph in.
 *
 * `statusCode` carries the meaning the refresh/session logic keys off of:
 *   - `0`   → the request never reached the server (network failure / offline).
 *   - `401` → the server actively rejected the credentials.
 * The difference is load-bearing: a 401 means "log out", a 0 means "try again later".
 */
export type ApiErrorPayload = {
  statusCode?: number;
  code?: string;
  message?: string;
  details?: unknown;
  requestId?: string;
};

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** A genuine credential rejection (as opposed to a network/other failure). */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.statusCode === 401;
}
