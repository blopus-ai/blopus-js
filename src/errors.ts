// Typed error hierarchy. The API always returns { error: { code, message } };
// errorFromResponse maps that (plus HTTP status) onto a concrete class.

export class BlopusError extends Error {
  code?: string;
  status?: number;
  retryAfter?: number;
  response?: unknown;

  constructor(
    message: string,
    opts: { code?: string; status?: number; retryAfter?: number; response?: unknown } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = opts.code;
    this.status = opts.status;
    this.retryAfter = opts.retryAfter;
    this.response = opts.response;
    // Restore prototype chain for extending built-ins under some TS targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The request never got an HTTP response (DNS, TCP, TLS, timeout, abort). */
export class APIConnectionError extends BlopusError {}
/** Missing / invalid / revoked key, or key not permitted (401 / 403). */
export class AuthError extends BlopusError {}
/** Malformed or too-large request (400 / 413). */
export class BadRequestError extends BlopusError {}
/** No indexed content for a URL (404). */
export class NotFoundError extends BlopusError {}
/** Rate limit exceeded (429). See `retryAfter`. */
export class RateLimitError extends BlopusError {}
/** Monthly quota exhausted (402). */
export class QuotaError extends BlopusError {}
/** Gateway/backend failure (>= 500). */
export class ServerError extends BlopusError {}

const CODE_MAP: Record<string, typeof BlopusError> = {
  unauthorized: AuthError,
  forbidden: AuthError,
  bad_request: BadRequestError,
  payload_too_large: BadRequestError,
  not_found: NotFoundError,
  rate_limited: RateLimitError,
  quota_exceeded: QuotaError,
  upstream_unavailable: ServerError,
  internal_error: ServerError,
};

function classForStatus(status: number): typeof BlopusError {
  if (status === 401 || status === 403) return AuthError;
  if (status === 402) return QuotaError;
  if (status === 404) return NotFoundError;
  if (status === 429) return RateLimitError;
  if (status === 400 || status === 413 || status === 422) return BadRequestError;
  if (status >= 500) return ServerError;
  return BlopusError;
}

export function errorFromResponse(
  status: number,
  body: unknown,
  retryAfter?: number,
): BlopusError {
  let code: string | undefined;
  let message: string | undefined;
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error: unknown }).error;
    if (err && typeof err === "object") {
      code = (err as { code?: string }).code;
      message = (err as { message?: string }).message;
    } else if (typeof err === "string") {
      message = err;
    }
  }
  const Cls = (code && CODE_MAP[code]) || classForStatus(status);
  return new Cls(message || `Blopus API error (HTTP ${status})`, {
    code,
    status,
    retryAfter,
    response: body,
  });
}
