import { z } from "zod";

/**
 * The only module in ScopeSentry that talks to a model.
 *
 * Rules this file exists to enforce:
 * - The endpoint and model come from the environment, never from the browser.
 * - The endpoint must be a local (loopback) Ollama server. There is no cloud fallback.
 * - Nothing is logged, written to disk, or cached. Pasted agreements, conversations, and
 *   generated replies must never reach a log line or an error message.
 * - Models are never downloaded here. A missing model is an error the user fixes with
 *   `ollama pull`; there is no code path that pulls, retries a 404, or reroutes remotely.
 * - Every response is validated: the Ollama envelope first, then the caller's schema.
 *   Failures become a typed `OllamaError` with a static, user-safe message.
 */

// --- Configuration ---------------------------------------------------------

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_MODEL = "gemma3:4b";
export const DEFAULT_OLLAMA_TIMEOUT_MS = 120_000;
export const DEFAULT_OLLAMA_KEEP_ALIVE = "10m";

export const MIN_OLLAMA_TIMEOUT_MS = 1_000;
export const MAX_OLLAMA_TIMEOUT_MS = 600_000;

const MAX_MODEL_TAG_LENGTH = 200;

/** Values the app reads from the server environment. Injectable so tests stay offline. */
export type OllamaEnv = Record<string, string | undefined>;

export type OllamaConfig = {
  /** Normalized origin plus optional path prefix, never with a trailing slash. */
  baseUrl: string;
  model: string;
  timeoutMs: number;
  keepAlive: string;
};

export type OllamaDependencies = {
  fetch?: typeof fetch;
  env?: OllamaEnv;
};

const LOOPBACK_HOSTNAME = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|\[?0:0:0:0:0:0:0:1\]?)$/i;

const isLoopbackHostname = (hostname: string) => LOOPBACK_HOSTNAME.test(hostname.trim());

const allowNonLoopback = (env: OllamaEnv) => {
  const flag = (env.OLLAMA_ALLOW_NON_LOOPBACK ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true";
};

const parseBaseUrl = (raw: string, nonLoopbackAllowed: boolean): string => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OllamaError(
      "config_invalid",
      `OLLAMA_BASE_URL must be an absolute URL such as ${DEFAULT_OLLAMA_BASE_URL}.`,
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OllamaError(
      "config_invalid",
      "OLLAMA_BASE_URL must use http or https, because ScopeSentry only calls a local Ollama server.",
    );
  }

  if (url.username || url.password) {
    throw new OllamaError(
      "config_invalid",
      "OLLAMA_BASE_URL must not contain credentials. A local Ollama server does not use them.",
    );
  }

  if (url.search || url.hash) {
    throw new OllamaError(
      "config_invalid",
      "OLLAMA_BASE_URL must not contain a query string or fragment.",
    );
  }

  if (!isLoopbackHostname(url.hostname) && !nonLoopbackAllowed) {
    throw new OllamaError(
      "config_invalid",
      "OLLAMA_BASE_URL must point at a local Ollama server on this machine. ScopeSentry refuses to send agreement text to another host. Set OLLAMA_ALLOW_NON_LOOPBACK=1 only if you have deliberately moved inference to your own network.",
    );
  }

  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
};

const parseModelTag = (raw: string | undefined): string => {
  const value = (raw ?? "").trim();
  if (value === "") {
    return DEFAULT_OLLAMA_MODEL;
  }
  if (value.length > MAX_MODEL_TAG_LENGTH) {
    throw new OllamaError("config_invalid", "OLLAMA_MODEL is too long to be a model tag.");
  }
  if (!/^[A-Za-z0-9._:/-]+$/.test(value)) {
    throw new OllamaError(
      "config_invalid",
      "OLLAMA_MODEL must be a model tag such as gemma3:4b, using only letters, numbers, and . _ : / -",
    );
  }
  return value;
};

const parseTimeoutMs = (raw: string | undefined): number => {
  const value = (raw ?? "").trim();
  if (value === "") {
    return DEFAULT_OLLAMA_TIMEOUT_MS;
  }
  if (!/^\d+$/.test(value)) {
    throw new OllamaError(
      "config_invalid",
      "OLLAMA_TIMEOUT_MS must be a whole number of milliseconds.",
    );
  }
  const parsed = Number(value);
  if (parsed < MIN_OLLAMA_TIMEOUT_MS || parsed > MAX_OLLAMA_TIMEOUT_MS) {
    throw new OllamaError(
      "config_invalid",
      `OLLAMA_TIMEOUT_MS must be between ${MIN_OLLAMA_TIMEOUT_MS} and ${MAX_OLLAMA_TIMEOUT_MS} milliseconds.`,
    );
  }
  return parsed;
};

/**
 * Reads and validates the local Ollama settings. Called per request rather than cached in
 * module scope, so a misconfigured value surfaces as a typed error instead of a stale one.
 */
export const getOllamaConfig = (env: OllamaEnv = process.env): OllamaConfig => {
  const baseUrl = parseBaseUrl(
    (env.OLLAMA_BASE_URL ?? "").trim() || DEFAULT_OLLAMA_BASE_URL,
    allowNonLoopback(env),
  );
  return {
    baseUrl,
    model: parseModelTag(env.OLLAMA_MODEL),
    timeoutMs: parseTimeoutMs(env.OLLAMA_TIMEOUT_MS),
    keepAlive: (env.OLLAMA_KEEP_ALIVE ?? "").trim() || DEFAULT_OLLAMA_KEEP_ALIVE,
  };
};

// --- Errors ----------------------------------------------------------------

export const OLLAMA_ERROR_CODES = [
  "config_invalid",
  "unavailable",
  "model_missing",
  "timeout",
  "bad_request",
  "server_error",
  "malformed_output",
] as const;

export type OllamaErrorCode = (typeof OLLAMA_ERROR_CODES)[number];

/** What a route handler should return for each code. */
const ERROR_HTTP_STATUS: Record<OllamaErrorCode, number> = {
  config_invalid: 500,
  unavailable: 503,
  model_missing: 503,
  timeout: 504,
  bad_request: 502,
  server_error: 502,
  malformed_output: 502,
};

/** Only transient failures are worth retrying; a bad prompt or missing model is not. */
const ERROR_RETRYABLE: Record<OllamaErrorCode, boolean> = {
  config_invalid: false,
  unavailable: true,
  model_missing: false,
  timeout: true,
  bad_request: false,
  server_error: true,
  malformed_output: false,
};

/**
 * Every failure a user can see is one of these static messages. They never contain the
 * prompt, the pasted text, the model's output, or the endpoint.
 */
const ERROR_MESSAGES: Record<OllamaErrorCode, string> = {
  config_invalid:
    "ScopeSentry's local AI settings are not valid. Check OLLAMA_BASE_URL and OLLAMA_MODEL in .env.local and restart the app.",
  unavailable:
    "Local Ollama is not answering on the configured local address. Start Ollama on your machine and try again. Your text was not sent anywhere else.",
  model_missing: "",
  timeout:
    "The local model took too long to respond, so the request was stopped. Try a smaller model tag or a shorter input.",
  bad_request:
    "The local model rejected the analysis request. Try again, or set a different model tag in OLLAMA_MODEL.",
  server_error:
    "The local model reported an error while generating a response. Try again, or set a different model tag in OLLAMA_MODEL.",
  malformed_output:
    "The local model returned output ScopeSentry could not validate, so no findings were shown. Try again or use a different model tag.",
};

const modelMissingMessage = (model: string) =>
  `Local model "${model}" is not installed. Run \`ollama pull ${model}\` in your terminal, then try again. ScopeSentry never downloads models on your behalf.`;

export class OllamaError extends Error {
  readonly code: OllamaErrorCode;
  readonly retryable: boolean;
  readonly httpStatus: number;

  constructor(code: OllamaErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options && "cause" in options ? { cause: options.cause } : undefined);
    this.name = "OllamaError";
    this.code = code;
    this.retryable = ERROR_RETRYABLE[code];
    this.httpStatus = ERROR_HTTP_STATUS[code];
  }
}

export const isOllamaError = (value: unknown): value is OllamaError => value instanceof OllamaError;

const timeoutError = (timeoutMs: number) =>
  new OllamaError(
    "timeout",
    `${ERROR_MESSAGES.timeout} (limit: ${Math.round(timeoutMs / 1000)}s)`,
  );

const statusToErrorCode = (status: number): OllamaErrorCode => {
  if (status === 404) return "model_missing";
  if (status === 408) return "timeout";
  if (status >= 500 || status === 429) return "server_error";
  return "bad_request";
};

const errorBodySchema = z.object({ error: z.string() }).loose();

/**
 * Ollama's error detail is attached as `cause` only, for the Next.js server-side error
 * output. It never reaches `message`, so a route can serialize this error without a
 * redaction step.
 */
const serverErrorCause = (rawBody: string): Error | undefined => {
  try {
    const parsed = errorBodySchema.safeParse(JSON.parse(rawBody));
    return parsed.success ? new Error(parsed.data.error) : undefined;
  } catch {
    return undefined;
  }
};

// --- HTTP ------------------------------------------------------------------

export type OllamaChatRole = "system" | "user" | "assistant";

export type OllamaChatMessage = {
  role: OllamaChatRole;
  content: string;
};

export type OllamaJsonSchema = Record<string, unknown>;

export type OllamaModelOptions = Record<string, number | string | boolean | string[]>;

export type ChatJsonRequest<TSchema extends z.ZodType> = {
  messages: OllamaChatMessage[];
  /** Validates the model's JSON. The caller owns the contract, not this module. */
  schema: TSchema;
  /** JSON Schema sent as Ollama's `format` to constrain generation. */
  format?: OllamaJsonSchema;
  options?: OllamaModelOptions;
  timeoutMs?: number;
};

export type ChatJsonMeta = {
  model: string;
  doneReason: string | null;
  evalCount: number | null;
  totalDurationMs: number | null;
};

export type ChatJsonResult<T> = {
  data: T;
  meta: ChatJsonMeta;
};

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.strictObject({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().trim().min(1),
      }),
    )
    .min(1),
  format: z.record(z.string(), z.unknown()).optional(),
  options: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.array(z.string())])).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

/**
 * Ollama's chat envelope. Loose on purpose: the server adds fields over time, and a new
 * diagnostic field must not fail an otherwise valid analysis.
 */
const chatResponseSchema = z.object({
  model: z.string(),
  message: z.object({
    role: z.string().optional(),
    content: z.string(),
  }),
  done: z.boolean().optional(),
  done_reason: z.string().nullish(),
  eval_count: z.number().nullish(),
  total_duration: z.number().nullish(),
});

const tagsResponseSchema = z.object({
  models: z.array(z.looseObject({ name: z.string() })),
});

const resolveFetch = (dependencies: OllamaDependencies): typeof fetch =>
  dependencies.fetch ?? globalThis.fetch;

const joinApiPath = (baseUrl: string, path: string) => `${baseUrl}${path}`;

type HttpResult = { ok: boolean; status: number; body: string };

/**
 * Performs one bounded HTTP request. The abort covers body reading as well, so a server
 * that accepts the connection and then stalls still fails fast instead of hanging a route.
 * The timeout is detected with our own flag rather than by matching error messages,
 * because Node, undici, and test doubles report aborts differently. A redirect is refused
 * outright: it would move a request carrying client text to another host.
 */
const sendRequest = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<HttpResult> => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      redirect: "error",
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  } catch (cause) {
    if (timedOut) {
      throw timeoutError(timeoutMs);
    }
    throw new OllamaError("unavailable", ERROR_MESSAGES.unavailable, { cause });
  } finally {
    clearTimeout(timer);
  }
};

const statusError = (result: HttpResult, model: string): OllamaError => {
  const code = statusToErrorCode(result.status);
  const message = code === "model_missing" ? modelMissingMessage(model) : ERROR_MESSAGES[code];
  return new OllamaError(code, message, { cause: serverErrorCause(result.body) });
};

const listLocalModelTags = async (
  config: OllamaConfig,
  fetchImpl: typeof fetch,
): Promise<string[]> => {
  const result = await sendRequest(
    joinApiPath(config.baseUrl, "/api/tags"),
    { method: "GET", headers: { Accept: "application/json" } },
    config.timeoutMs,
    fetchImpl,
  );

  if (!result.ok) {
    throw statusError(result, config.model);
  }

  const parsed = tagsResponseSchema.safeParse(safeJsonParse(result.body));
  if (!parsed.success) {
    throw new OllamaError("malformed_output", ERROR_MESSAGES.malformed_output, {
      cause: parsed.error,
    });
  }
  return parsed.data.models.map((entry) => entry.name);
};

export type OllamaStatus = {
  /** The configured tag, or null when the settings themselves are unusable. */
  model: string | null;
  reachable: boolean;
  modelInstalled: boolean;
  errorCode: OllamaErrorCode | null;
};

/**
 * Cheap, download-free precheck for the "Ollama unavailable or model missing" UI state.
 * Reads `GET /api/tags` only, and never throws: a broken setup is a value, not an exception.
 * The endpoint is deliberately not returned, so a route cannot leak it to the browser.
 */
export const getOllamaStatus = async (
  dependencies: OllamaDependencies = {},
): Promise<OllamaStatus> => {
  let config: OllamaConfig;
  try {
    config = getOllamaConfig(dependencies.env);
  } catch (error) {
    const code = isOllamaError(error) ? error.code : "config_invalid";
    return { model: null, reachable: false, modelInstalled: false, errorCode: code };
  }

  try {
    const installed = await listLocalModelTags(config, resolveFetch(dependencies));
    return {
      model: config.model,
      reachable: true,
      modelInstalled: installed.includes(config.model),
      errorCode: null,
    };
  } catch (error) {
    return {
      model: config.model,
      reachable: false,
      modelInstalled: false,
      errorCode: isOllamaError(error) ? error.code : "unavailable",
    };
  }
};

// --- Structured chat -------------------------------------------------------

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new OllamaError("malformed_output", ERROR_MESSAGES.malformed_output, { cause });
  }
}

const parseContent = (content: string): unknown => {
  const trimmed = content.trim();
  if (trimmed === "") {
    throw new OllamaError("malformed_output", ERROR_MESSAGES.malformed_output);
  }
  return safeJsonParse(trimmed);
};

/**
 * Sends one non-streaming chat request to the local Ollama server and returns
 * schema-validated JSON plus safe metadata.
 *
 * Structured output is requested through Ollama's `format` field when the caller supplies
 * a JSON Schema, but the result is still parsed and validated here: schema-constrained
 * output is a strong hint, not a guarantee, and an unvalidated finding must never reach
 * the UI. Throws `OllamaError` for every failure; returns nothing partially built.
 */
export const chatJson = async <TSchema extends z.ZodType>(
  request: ChatJsonRequest<TSchema>,
  dependencies: OllamaDependencies = {},
): Promise<ChatJsonResult<z.output<TSchema>>> => {
  const validated = chatRequestSchema.safeParse({
    messages: request.messages,
    format: request.format,
    options: request.options,
    timeoutMs: request.timeoutMs,
  });
  if (!validated.success) {
    throw new TypeError("chatJson received an invalid request shape.", { cause: validated.error });
  }

  const config = getOllamaConfig(dependencies.env);
  const timeoutMs = validated.data.timeoutMs ?? config.timeoutMs;
  const fetchImpl = resolveFetch(dependencies);

  const result = await sendRequest(
    joinApiPath(config.baseUrl, "/api/chat"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: validated.data.messages,
        stream: false,
        keep_alive: config.keepAlive,
        ...(validated.data.format ? { format: validated.data.format } : {}),
        options: { temperature: 0, ...validated.data.options },
      }),
    },
    timeoutMs,
    fetchImpl,
  );

  if (!result.ok) {
    throw statusError(result, config.model);
  }

  const envelope = chatResponseSchema.safeParse(safeJsonParse(result.body));
  if (!envelope.success) {
    throw new OllamaError("malformed_output", ERROR_MESSAGES.malformed_output, {
      cause: envelope.error,
    });
  }

  const { message, done, done_reason, eval_count, total_duration } = envelope.data;
  if (done === false) {
    throw new OllamaError("malformed_output", ERROR_MESSAGES.malformed_output);
  }

  const data = request.schema.safeParse(parseContent(message.content));
  if (!data.success) {
    throw new OllamaError("malformed_output", ERROR_MESSAGES.malformed_output, {
      cause: data.error,
    });
  }

  return {
    data: data.data,
    meta: {
      model: config.model,
      doneReason: done_reason ?? null,
      evalCount: eval_count ?? null,
      totalDurationMs:
        typeof total_duration === "number" ? Math.round(total_duration / 1_000_000) : null,
    },
  };
};