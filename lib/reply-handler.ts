import { isOllamaError } from "./ollama.ts";
import type { OllamaDependencies } from "./ollama.ts";
import { isReplyError } from "./reply.ts";
import { draftReply } from "./reply.ts";
import type { AnalyzeInputIssue, ReplyErrorCode } from "./schemas.ts";
import { replyErrorSchema, replyResponseSchema } from "./schemas.ts";

/**
 * The HTTP edge of reply drafting.
 *
 * Same contract as `lib/analyze-handler.ts`, and the same refusals: this module
 * decides status codes and message text, and nothing else. It must never echo the
 * pasted documents, the report, or the generated draft; disclose `OLLAMA_BASE_URL`;
 * let a Zod issue, an `OllamaError.cause`, or a stack trace reach the client; log
 * anything; or send the message anywhere. Every message it can produce is a constant
 * declared here or a static string from `lib/ollama.ts`.
 */

/**
 * Largest request body accepted, in bytes, checked before `JSON.parse` runs.
 *
 * A reply request carries three things, so the analyze cap's derivation does not
 * apply: the two documents (≤ 20 000 characters each, already bounded by
 * `replyInputSchema`) and one `ScopeReport`.
 *
 * The report's own worst case under the schema — 50 findings × 10 quotes × 2 000
 * characters — is not a realistic body, and buffering it would be a poor trade, so
 * the cap is set from observed reports instead: a real report is tens of kilobytes,
 * so 1 MiB leaves roughly twenty times the headroom while still bounding what the
 * server will read. A report large enough to hit it is rejected with a static
 * message rather than truncated, and never reaches the model.
 */
export const MAX_REPLY_BODY_BYTES = 1024 * 1024;

/** Shown when the handler itself throws something it has no mapping for. */
export const UNKNOWN_ERROR_MESSAGE =
  "ScopeSentry could not write the draft because of an unexpected problem. Nothing was sent anywhere else. Try again.";

/** Shown when the body is not JSON, or is not a JSON object. */
export const INVALID_REQUEST_MESSAGE =
  "ScopeSentry expected a JSON body with an agreement, a conversation, a report, and a finding id. Nothing was sent anywhere else.";

/** Shown when the body is over `MAX_REPLY_BODY_BYTES`, checked before parsing. */
export const REQUEST_TOO_LARGE_MESSAGE =
  "This report is too large to send for reply drafting. Re-run the analysis on shorter documents and try again.";

/**
 * `no-store` on every response.
 *
 * The request body is client material and the response is derived from it, so
 * neither may be retained by a browser cache or an intermediary.
 */
const NO_STORE_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
} as const;

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: NO_STORE_HEADERS });

/**
 * Statuses for the failures `draftReply` raises itself. Everything else comes from
 * `OllamaError.httpStatus`.
 *
 * `missing_context` is 422 because the request was well-formed and the application
 * chose not to act on it; `draft_rejected` is 502 because it is model-side output that
 * failed a check, the same class as `malformed_output`.
 */
const REPLY_ERROR_STATUS: Partial<Record<ReplyErrorCode, number>> = {
  invalid_input: 400,
  missing_context: 422,
  draft_rejected: 502,
};

/**
 * Builds an error body through `replyErrorSchema`, so the shape the browser parses is
 * the shape the handler is structurally guaranteed to produce. A mapping mistake
 * fails here rather than reaching a client that would reject it.
 */
const errorResponse = (
  status: number,
  error: {
    code: ReplyErrorCode;
    message: string;
    retryable: boolean;
    issues?: AnalyzeInputIssue[];
  },
): Response => {
  const parsed = replyErrorSchema.safeParse({
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.issues && error.issues.length > 0 ? { issues: error.issues } : {}),
    },
  });

  if (!parsed.success) {
    return jsonResponse(500, {
      error: { code: "invalid_request", message: UNKNOWN_ERROR_MESSAGE, retryable: true },
    });
  }

  return jsonResponse(status, parsed.data);
};

/**
 * Reads the body under a hard byte cap.
 *
 * `Content-Length` is checked first because it is free, but it is only a hint, so
 * the real limit is enforced on the string that actually arrived.
 */
const readBoundedBody = async (
  request: Request,
): Promise<{ ok: true; raw: string } | { ok: false; tooLarge: true }> => {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_REPLY_BODY_BYTES) {
    return { ok: false, tooLarge: true };
  }

  const raw = await request.text();

  // `text()` measures UTF-16 code units, not bytes, so a multi-byte document counts
  // roughly twice here. That errs toward rejecting rather than accepting.
  if (raw.length * 2 > MAX_REPLY_BODY_BYTES) {
    return { ok: false, tooLarge: true };
  }

  return { ok: true, raw };
};

/**
 * Handles one `POST /api/reply` request.
 *
 * `dependencies` is forwarded to `draftReply` so the whole route can be driven
 * against a stubbed `fetch` in the tests. It is not part of the HTTP surface and the
 * route wrapper never passes it.
 *
 * Returns 200 with a body that satisfies `replyResponseSchema`, or one of the error
 * bodies described by `replyErrorSchema`. It does not throw.
 */
export const handleReplyRequest = async (
  request: Request,
  dependencies: OllamaDependencies = {},
): Promise<Response> => {
  let body: unknown;

  try {
    const bounded = await readBoundedBody(request);

    if (!bounded.ok) {
      return errorResponse(413, {
        code: "invalid_request",
        message: REQUEST_TOO_LARGE_MESSAGE,
        retryable: false,
      });
    }

    body = JSON.parse(bounded.raw) as unknown;
  } catch {
    return errorResponse(400, {
      code: "invalid_request",
      message: INVALID_REQUEST_MESSAGE,
      retryable: false,
    });
  }

  // An array, a string, or null would make the schema report "required" issues for
  // fields the user never mentioned, so it is rejected before validation.
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse(400, {
      code: "invalid_request",
      message: INVALID_REQUEST_MESSAGE,
      retryable: false,
    });
  }

  try {
    // `body` is cast, not validated, on purpose: `draftReply` validates it and throws
    // a `ReplyError` carrying the offending paths, which is the one path that produces
    // the field-level messages the browser shows.
    const result = await draftReply(body, dependencies);

    const parsed = replyResponseSchema.safeParse(result);
    if (!parsed.success) {
      // The pipeline already validated the draft, so this is a backstop rather than an
      // expected path. Reported as bad model output rather than shipping a body the
      // browser would reject.
      return errorResponse(502, {
        code: "malformed_output",
        message:
          "The reply could not be assembled into a valid draft, so no text was shown. Try again or use a different model tag.",
        retryable: false,
      });
    }

    return jsonResponse(200, parsed.data);
  } catch (error) {
    if (isReplyError(error)) {
      // `issues` carry a field path and a static message. `ReplyError` holds no user
      // text, so this is safe to serialize as-is.
      return errorResponse(REPLY_ERROR_STATUS[error.code] ?? 400, {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        issues: [...error.issues],
      });
    }

    if (isOllamaError(error)) {
      // `error.message` is one of the static strings in `lib/ollama.ts`. The `cause`
      // carrying Ollama's own error text is intentionally not attached here: it is for
      // the server console, never for the response body.
      return errorResponse(error.httpStatus, {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      });
    }

    // Anything else is a bug. `error` is not inspected, interpolated, or logged.
    return errorResponse(500, {
      code: "invalid_request",
      message: UNKNOWN_ERROR_MESSAGE,
      retryable: true,
    });
  }
};