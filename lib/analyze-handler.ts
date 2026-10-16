import { analyzeScope, isAnalyzeInputError } from "./analysis.ts";
import { getOllamaConfig, isOllamaError } from "./ollama.ts";
import type { OllamaDependencies } from "./ollama.ts";
import type { AnalyzeErrorCode, AnalyzeInput, AnalyzeInputIssue } from "./schemas.ts";
import {
  analyzeErrorSchema,
  analyzeResponseSchema,
} from "./schemas.ts";

/**
 * The HTTP edge of the analysis pipeline.
 *
 * One request in, one validated report out. This module owns four responsibilities
 * and nothing else: bound the body before it is parsed, reject input the pipeline
 * cannot accept, run the pipeline, and translate a thrown error into a status code
 * and a message that is safe to show a stranger.
 *
 * What it must never do:
 * - echo the pasted agreement or conversation back, in a success body, an error
 *   body, or a header;
 * - let an `OllamaError.cause`, a Zod issue, or a stack trace reach the client;
 * - disclose `OLLAMA_BASE_URL`;
 * - log anything, or write anything to disk;
 * - download a model, or fall back to a remote host when the local one fails.
 *
 * Every message it can produce is either a constant declared here or a static
 * string from `lib/ollama.ts`. Nothing user-supplied is ever interpolated into one.
 */

/**
 * Largest request body accepted, in bytes, checked before `JSON.parse` runs.
 *
 * `analyzeInputSchema` already caps each field at 20,000 characters, but that
 * bounds the schema, not the transport: a body whose payload is 200 MB of junk
 * keys would otherwise be fully buffered and parsed before the schema ever saw
 * it. The arithmetic has headroom over the worst legal body:
 *
 *   2 fields x 20,000 characters x 3 bytes (widest UTF-8 sequence)
 *     x 2 (a quote character is doubled by JSON escaping)
 *     = 240,000 bytes
 *
 * rounded up to 512 KiB, which leaves room for the envelope without becoming a
 * limit a legitimate paste can reach.
 */
export const MAX_REQUEST_BODY_BYTES = 512 * 1024;

/** Shown when the handler itself throws something it has no mapping for. */
export const UNKNOWN_ERROR_MESSAGE =
  "ScopeSentry could not complete the analysis because of an unexpected problem. Nothing was sent anywhere else. Try again.";

/** Shown when the body is not JSON, or is not a JSON object. */
export const INVALID_REQUEST_MESSAGE =
  "ScopeSentry expected a JSON body with an agreement and a conversation. Nothing was sent anywhere else.";

/** Shown when the body is over `MAX_REQUEST_BODY_BYTES`, checked before parsing. */
export const REQUEST_TOO_LARGE_MESSAGE =
  "The pasted text is too large to send in one request. Shorten it and try again.";

/**
 * `no-store` on every response.
 *
 * A scope report is derived from client conversations. Without this, an
 * intermediary or the browser cache could retain it after the user navigates
 * away, which would be persistence the user never asked for.
 */
const NO_STORE_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
} as const;

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: NO_STORE_HEADERS });

/**
 * Builds an error body through `analyzeErrorSchema`, so the shape the browser
 * parses is the shape the handler is structurally guaranteed to produce. A
 * mapping mistake fails here, loudly, instead of reaching a client that would
 * reject it as an invalid response.
 */
const errorResponse = (
  status: number,
  error: {
    code: AnalyzeErrorCode;
    message: string;
    retryable: boolean;
    issues?: AnalyzeInputIssue[];
  },
): Response => {
  const parsed = analyzeErrorSchema.safeParse({
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.issues && error.issues.length > 0 ? { issues: error.issues } : {}),
    },
  });

  if (!parsed.success) {
    // A handler bug, not user input: the code or message above did not fit the
    // shared contract. Send the static message under the generic code rather
    // than a body the client cannot parse.
    return jsonResponse(500, {
      error: { code: "invalid_request", message: UNKNOWN_ERROR_MESSAGE, retryable: true },
    });
  }

  return jsonResponse(status, parsed.data);
};

/**
 * Reads the body under a hard byte cap.
 *
 * `Content-Length` is checked first because it is free, but it is only a hint:
 * a client can omit it or understate it, so the real limit is enforced on the
 * string that actually arrived.
 */
const readBoundedBody = async (
  request: Request,
): Promise<{ ok: true; raw: string } | { ok: false; tooLarge: true }> => {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_REQUEST_BODY_BYTES) {
    return { ok: false, tooLarge: true };
  }

  const raw = await request.text();

  // `text()` measures UTF-16 code units, not bytes, so a multi-byte document
  // counts roughly twice here. That errs toward rejecting rather than accepting,
  // which is the safe direction for a limit.
  if (raw.length * 2 > MAX_REQUEST_BODY_BYTES) {
    return { ok: false, tooLarge: true };
  }

  return { ok: true, raw };
};

/**
 * Handles one `POST /api/analyze` request.
 *
 * `dependencies` is forwarded to `analyzeScope` so tests can drive the whole
 * route against a stubbed `fetch` instead of a real model. It is not part of the
 * HTTP surface; the route wrapper never passes it.
 *
 * Returns 200 with a report validated by `analyzeResponseSchema`, or one of the
 * error bodies described by `analyzeErrorSchema`. It does not throw.
 */
export const handleAnalyzeRequest = async (
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

  // An array, a string, or null would make `analyzeInputSchema` report two
  // "required" issues for a field the user never mentioned. Rejecting it here
  // keeps the browser's field-level errors meaningful.
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse(400, {
      code: "invalid_request",
      message: INVALID_REQUEST_MESSAGE,
      retryable: false,
    });
  }

  try {
    const startedAt = Date.now();
    // `body` is cast, not validated, on purpose: `analyzeScope` validates with
    // `analyzeInputSchema` and throws `AnalyzeInputError` listing the offending
    // fields, which is the one path that produces the field-level messages the
    // browser shows under each textarea.
    const report = await analyzeScope(body as AnalyzeInput, dependencies);
    const durationMs = Date.now() - startedAt;

    // The model tag is read here rather than returned by the pipeline: it is
    // configuration, and showing the user which local model produced a report is
    // what makes the "this ran locally" claim checkable. The base URL is read
    // from the same object and deliberately dropped.
    const { model } = getOllamaConfig(dependencies.env);

    const parsed = analyzeResponseSchema.safeParse({ report, meta: { model, durationMs } });
    if (!parsed.success) {
      // The pipeline already validated the report against `scopeReportSchema`,
      // so this is a backstop rather than an expected path. Report it as bad
      // model output rather than shipping a body the client would reject.
      return errorResponse(502, {
        code: "malformed_output",
        message:
          "The analysis could not be assembled into a valid report, so no findings were shown. Try again or use a different model tag.",
        retryable: false,
      });
    }

    return jsonResponse(200, parsed.data);
  } catch (error) {
    if (isAnalyzeInputError(error)) {
      // `issues` carry a field path and a static message. `AnalyzeInputError`
      // deliberately holds no user text, so this is safe to serialize as-is.
      return errorResponse(400, {
        code: "invalid_input",
        message: error.message,
        retryable: false,
        issues: [...error.issues],
      });
    }

    if (isOllamaError(error)) {
      // `error.message` is one of the static strings in `lib/ollama.ts`. The
      // `cause` carrying Ollama's own error text is intentionally not attached
      // here: it is for the server console, never for the response body.
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