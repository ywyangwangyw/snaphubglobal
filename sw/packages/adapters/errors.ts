/**
 * Thrown by an adapter when the retailer responds with a rate-limit status
 * (HTTP 429, or a 503 carrying Retry-After). Carries the retailer's requested
 * back-off so callers (the poller) can defer the next attempt instead of
 * hammering and extending the block.
 */
export class RateLimitError extends Error {
  /** HTTP status code returned by the retailer (typically 429). */
  readonly status: number;
  /** Requested back-off in milliseconds, parsed from `Retry-After` when present. */
  readonly retryAfterMs: number | null;
  /** Absolute time the retailer said it would accept a retry, or null. */
  readonly retryAfterAt: Date | null;

  constructor(opts: { status: number; retryAfterMs?: number | null; url: string }) {
    const { status, retryAfterMs = null, url } = opts;
    super(`retailer ${status} rate-limit for ${url}`);
    this.name = "RateLimitError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.retryAfterAt =
      retryAfterMs != null ? new Date(Date.now() + retryAfterMs) : null;
  }
}
