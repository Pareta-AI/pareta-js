/**
 * Typed error hierarchy for the Pareta SDK — a faithful port of the Python
 * `_exceptions.py`. The backend is FastAPI, so error bodies are
 * `{"detail": "<message>"}` with a standard HTTP status. We map status → a
 * specific class so callers can `catch (e) { if (e instanceof
 * InsufficientCreditsError) … }` instead of sniffing status codes.
 *
 * Status → exception mapping:
 *   400 → BadRequestError
 *   401 → AuthenticationError      ("invalid API key")
 *   402 → InsufficientCreditsError ("organization is out of credit…")
 *   403 → PermissionDeniedError
 *   404 → NotFoundError
 *   409 → ConflictError            (seed/legacy endpoint not deployed)
 *   422 → BadRequestError          (FastAPI validation; `detail` is an array)
 *   429 → RateLimitError
 *   503 → EndpointNotReadyError    (stopped / cold / provider down)
 *   other 5xx → APIStatusError
 */

/** A single FastAPI validation error item (422 `detail` is an array of these). */
export interface ValidationErrorItem {
  loc?: (string | number)[];
  msg?: string;
  type?: string;
}

/** For 422 the server's `detail` is an ARRAY; for every other status a string. */
export type ErrorDetail = string | ValidationErrorItem[] | null | undefined;

/** Base class for every error raised by the SDK. */
export class ParetaError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "ParetaError";
    // Preserve the underlying cause (network error, abort, …) when given.
    if (options && options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
    // Restore the prototype chain so `instanceof` works after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The request never reached the server (DNS, TCP, TLS, network). */
export class APIConnectionError extends ParetaError {
  constructor(message = "connection error", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "APIConnectionError";
  }
}

/** The request timed out before a response was received. */
export class APITimeoutError extends APIConnectionError {
  constructor(message = "request timed out", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "APITimeoutError";
  }
}

export interface APIStatusErrorInit {
  status: number;
  detail?: ErrorDetail;
  requestId?: string | null;
  response?: Response;
}

/** The server returned a non-2xx status. */
export class APIStatusError extends ParetaError {
  /** The HTTP status code. */
  readonly status: number;
  /** The server's `detail` (string, or an array of validation items for 422). */
  readonly detail: ErrorDetail;
  /** Value of the `x-request-id` response header, if present. */
  readonly requestId: string | null;
  /** The underlying `Response` (for advanced use). */
  readonly response?: Response;

  constructor(message: string, init: APIStatusErrorInit) {
    super(message);
    this.name = "APIStatusError";
    this.status = init.status;
    this.detail = init.detail;
    this.requestId = init.requestId ?? null;
    this.response = init.response;
  }
}

export class BadRequestError extends APIStatusError {
  constructor(message: string, init: APIStatusErrorInit) {
    super(message, init);
    this.name = "BadRequestError";
  }
}
export class AuthenticationError extends APIStatusError {
  constructor(message: string, init: APIStatusErrorInit) {
    super(message, init);
    this.name = "AuthenticationError";
  }
}
export class PermissionDeniedError extends APIStatusError {
  constructor(message: string, init: APIStatusErrorInit) {
    super(message, init);
    this.name = "PermissionDeniedError";
  }
}
export class NotFoundError extends APIStatusError {
  constructor(message: string, init: APIStatusErrorInit) {
    super(message, init);
    this.name = "NotFoundError";
  }
}
export class ConflictError extends APIStatusError {
  constructor(message: string, init: APIStatusErrorInit) {
    super(message, init);
    this.name = "ConflictError";
  }
}
/** The org is out of credit. Top up in the dashboard (billing is browser-only). */
export class InsufficientCreditsError extends APIStatusError {
  constructor(message: string, init: APIStatusErrorInit) {
    super(message, init);
    this.name = "InsufficientCreditsError";
  }
}
export class RateLimitError extends APIStatusError {
  constructor(message: string, init: APIStatusErrorInit) {
    super(message, init);
    this.name = "RateLimitError";
  }
}
/** The target endpoint isn't serving yet (stopped, cold-starting, or provider down). */
export class EndpointNotReadyError extends APIStatusError {
  constructor(message: string, init: APIStatusErrorInit) {
    super(message, init);
    this.name = "EndpointNotReadyError";
  }
}

type StatusErrorCtor = new (message: string, init: APIStatusErrorInit) => APIStatusError;

const STATUS_MAP: Record<number, StatusErrorCtor> = {
  400: BadRequestError,
  401: AuthenticationError,
  402: InsufficientCreditsError,
  403: PermissionDeniedError,
  404: NotFoundError,
  409: ConflictError,
  422: BadRequestError,
  429: RateLimitError,
  503: EndpointNotReadyError,
};

/** Construct the most specific `APIStatusError` subclass for a status code. */
export function errorFromResponse(
  status: number,
  opts: { detail?: ErrorDetail; requestId?: string | null; response?: Response },
): APIStatusError {
  const { detail, requestId, response } = opts;
  // Message = `detail` only when it's a non-empty STRING (422's array detail
  // falls through to "HTTP 422"); mirrors error_from_response.
  const message = typeof detail === "string" && detail ? detail : `HTTP ${status}`;
  let cls = STATUS_MAP[status];
  if (!cls) cls = status === 429 ? RateLimitError : APIStatusError;
  return new cls(message, { status, detail, requestId, response });
}
