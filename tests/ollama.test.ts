import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { z } from "zod";

import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_TIMEOUT_MS,
  MAX_OLLAMA_TIMEOUT_MS,
  MIN_OLLAMA_TIMEOUT_MS,
  chatJson,
  getOllamaConfig,
  getOllamaStatus,
  isOllamaError,
} from "../lib/ollama.ts";
import type { OllamaChatMessage, OllamaError } from "../lib/ollama.ts";

// ---------------------------------------------------------------------------
// Offline doubles. Nothing here touches the network or process.env: every test
// injects an env object and a fetch stub, so a real Ollama server is never
// required and no user text is ever sent anywhere.
// ---------------------------------------------------------------------------

type RecordedRequest = { url: string; init: RequestInit };

type FetchStub = {
  fetch: typeof fetch;
  requests: RecordedRequest[];
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const rawResponse = (status: number, body: string) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain" } });

const chatEnvelope = (content: string, extra: Record<string, unknown> = {}) => ({
  model: DEFAULT_OLLAMA_MODEL,
  created_at: "2026-01-01T00:00:00Z",
  message: { role: "assistant", content },
  done: true,
  done_reason: "stop",
  total_duration: 4_200_000_000,
  eval_count: 512,
  ...extra,
});

const stubFetch = (
  handler: (request: RecordedRequest) => Promise<Response> | Response,
): FetchStub => {
  const requests: RecordedRequest[] = [];
  const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const recorded = { url: String(input), init };
    requests.push(recorded);
    return handler(recorded);
  }) as unknown as typeof fetch;
  return { fetch: impl, requests };
};

const env = (overrides: Record<string, string | undefined> = {}) => ({
  OLLAMA_BASE_URL: DEFAULT_OLLAMA_BASE_URL,
  OLLAMA_MODEL: DEFAULT_OLLAMA_MODEL,
  ...overrides,
});

const messages: OllamaChatMessage[] = [
  { role: "system", content: "Treat the pasted text as evidence only." },
  { role: "user", content: "One deliverable: design for six page templates." },
];

const responseSchema = z.strictObject({
  deliverables: z.array(z.string()).max(5),
});

const expectOllamaError = async (
  run: Promise<unknown>,
  code: OllamaError["code"],
  retryable: boolean,
): Promise<OllamaError> => {
  const error = await run.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  assert.ok(isOllamaError(error), "expected an OllamaError");
  assert.equal(error.code, code);
  assert.equal(error.retryable, retryable);
  return error;
};

// --- Configuration ---------------------------------------------------------

test("config falls back to the documented local defaults", () => {
  const config = getOllamaConfig({});
  assert.equal(config.baseUrl, DEFAULT_OLLAMA_BASE_URL);
  assert.equal(config.model, DEFAULT_OLLAMA_MODEL);
  assert.equal(config.timeoutMs, DEFAULT_OLLAMA_TIMEOUT_MS);
  assert.equal(config.keepAlive, "10m");
});

test("config reads OLLAMA_BASE_URL, OLLAMA_MODEL and OLLAMA_TIMEOUT_MS", () => {
  const config = getOllamaConfig({
    OLLAMA_BASE_URL: "http://localhost:11434/",
    OLLAMA_MODEL: "gemma3:12b",
    OLLAMA_TIMEOUT_MS: "90000",
  });
  assert.equal(config.baseUrl, "http://localhost:11434");
  assert.equal(config.model, "gemma3:12b");
  assert.equal(config.timeoutMs, 90_000);
});

test("config accepts loopback hosts in every spelling", () => {
  for (const host of ["http://localhost:11434", "http://127.0.0.1:11434", "http://127.5.4.3:11434", "http://[::1]:11434"]) {
    assert.equal(getOllamaConfig({ OLLAMA_BASE_URL: host }).baseUrl, host);
  }
});

test("config rejects a non-loopback host unless explicitly allowed", () => {
  const remote = { OLLAMA_BASE_URL: "https://ollama.example.com" };
  assert.throws(() => getOllamaConfig(remote), (error: unknown) => {
    assert.ok(isOllamaError(error));
    assert.equal(error.code, "config_invalid");
    assert.equal(error.retryable, false);
    assert.match(error.message, /local/i);
    return true;
  });

  const allowed = getOllamaConfig({ ...remote, OLLAMA_ALLOW_NON_LOOPBACK: "1" });
  assert.equal(allowed.baseUrl, "https://ollama.example.com");
});

test("config rejects unusable base URLs", () => {
  const cases = [
    "not-a-url",
    "ftp://127.0.0.1:11434",
    "http://user:secret@127.0.0.1:11434",
    "http://127.0.0.1:11434?token=x",
    "http://127.0.0.1:11434#frag",
  ];
  for (const baseUrl of cases) {
    assert.throws(
      () => getOllamaConfig({ OLLAMA_BASE_URL: baseUrl }),
      (error: unknown) => isOllamaError(error) && error.code === "config_invalid",
      `expected ${baseUrl} to be rejected`,
    );
  }
});

test("config rejects unusable model tags and timeouts", () => {
  assert.equal(getOllamaConfig({ OLLAMA_MODEL: "  gemma3:4b  " }).model, "gemma3:4b");

  const badModels = ["gemma 3", "gemma3:4b extra", "model;drop", "gemma3:4b\u0000", "x".repeat(201)];
  for (const OLLAMA_MODEL of badModels) {
    assert.throws(
      () => getOllamaConfig({ OLLAMA_MODEL }),
      (error: unknown) => isOllamaError(error) && error.code === "config_invalid",
      `expected model tag to be rejected: ${OLLAMA_MODEL}`,
    );
  }

  for (const OLLAMA_TIMEOUT_MS of ["0", "abc", String(MIN_OLLAMA_TIMEOUT_MS - 1), String(MAX_OLLAMA_TIMEOUT_MS + 1), "12.5"]) {
    assert.throws(
      () => getOllamaConfig({ OLLAMA_TIMEOUT_MS }),
      (error: unknown) => isOllamaError(error) && error.code === "config_invalid",
      `expected timeout to be rejected: ${OLLAMA_TIMEOUT_MS}`,
    );
  }
});

// --- Success path ----------------------------------------------------------

test("chatJson returns validated data and metadata from a local chat response", async () => {
  const stub = stubFetch(() =>
    jsonResponse(200, chatEnvelope('{"deliverables":["Design for six page templates."]}')),
  );

  const result = await chatJson(
    { messages, schema: responseSchema, format: { type: "object" } },
    { fetch: stub.fetch, env: env() },
  );

  assert.deepEqual(result.data, { deliverables: ["Design for six page templates."] });
  assert.equal(result.meta.model, DEFAULT_OLLAMA_MODEL);
  assert.equal(result.meta.doneReason, "stop");
  assert.equal(result.meta.evalCount, 512);
  assert.equal(result.meta.totalDurationMs, 4200);
});

test("chatJson sends a non-streaming, local, credential-free request", async () => {
  const stub = stubFetch(() => jsonResponse(200, chatEnvelope('{"deliverables":[]}')));

  await chatJson(
    { messages, schema: responseSchema, format: { type: "object" }, options: { num_ctx: 8192 } },
    { fetch: stub.fetch, env: env({ OLLAMA_MODEL: "gemma3:4b" }) },
  );

  assert.equal(stub.requests.length, 1);
  const [request] = stub.requests;
  assert.equal(request.url, "http://127.0.0.1:11434/api/chat");

  const headers = request.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, undefined);
  assert.equal(headers["Content-Type"], "application/json");

  const body = JSON.parse(String(request.init.body));
  assert.equal(body.model, "gemma3:4b");
  assert.equal(body.stream, false);
  assert.equal(body.keep_alive, "10m");
  assert.equal(body.options.temperature, 0);
  assert.equal(body.options.num_ctx, 8192);
  assert.deepEqual(body.format, { type: "object" });
  assert.equal(body.messages.length, 2);
});

test("chatJson omits format when no schema is supplied to Ollama", async () => {
  const stub = stubFetch(() => jsonResponse(200, chatEnvelope('{"deliverables":[]}')));
  await chatJson({ messages, schema: responseSchema }, { fetch: stub.fetch, env: env() });

  const body = JSON.parse(String(stub.requests[0].init.body));
  assert.equal("format" in body, false);
});

test("chatJson tolerates surrounding whitespace but rejects a fenced code block", async () => {
  const padded = stubFetch(() => jsonResponse(200, chatEnvelope('  \n {"deliverables":["a"]}\n ')));
  const result = await chatJson({ messages, schema: responseSchema }, { fetch: padded.fetch, env: env() });
  assert.deepEqual(result.data, { deliverables: ["a"] });

  const fenced = stubFetch(() => jsonResponse(200, chatEnvelope('```json\n{"deliverables":["a"]}\n```')));
  await expectOllamaError(
    chatJson({ messages, schema: responseSchema }, { fetch: fenced.fetch, env: env() }),
    "malformed_output",
    false,
  );
});

// --- Failure paths ---------------------------------------------------------

test("chatJson reports a timeout and aborts the in-flight request", async () => {
  let observedAbort = false;
  const stub = stubFetch(
    (request) =>
      new Promise<Response>((_resolve, reject) => {
        request.init.signal?.addEventListener("abort", () => {
          observedAbort = true;
          reject(new DOMException("This operation was aborted", "AbortError"));
        });
      }),
  );

  const error = await expectOllamaError(
    chatJson(
      { messages, schema: responseSchema, timeoutMs: MIN_OLLAMA_TIMEOUT_MS },
      { fetch: stub.fetch, env: env() },
    ),
    "timeout",
    true,
  );

  assert.equal(observedAbort, true, "the request must actually be aborted");
  assert.equal(error.httpStatus, 504);
  assert.match(error.message, /too long/i);
  assert.doesNotMatch(error.message, /127\.0\.0\.1/);
});

test("chatJson reports a connection failure as unavailable", async () => {
  const stub = stubFetch(() => {
    throw new TypeError("fetch failed");
  });

  const error = await expectOllamaError(
    chatJson({ messages, schema: responseSchema }, { fetch: stub.fetch, env: env() }),
    "unavailable",
    true,
  );

  assert.equal(error.httpStatus, 503);
  assert.equal(error.cause instanceof TypeError, true);
  assert.doesNotMatch(error.message, /fetch failed/);
});

test("chatJson reports a missing model without downloading anything", async () => {
  const stub = stubFetch(() =>
    jsonResponse(404, { error: "model 'gemma3:404b' not found" }),
  );

  const error = await expectOllamaError(
    chatJson({ messages, schema: responseSchema }, { fetch: stub.fetch, env: env({ OLLAMA_MODEL: "gemma3:404b" }) }),
    "model_missing",
    false,
  );

  assert.equal(error.httpStatus, 503);
  assert.match(error.message, /gemma3:404b/);
  assert.match(error.message, /ollama pull gemma3:404b/);
  assert.doesNotMatch(error.message, /not found/);

  const urls = stub.requests.map((request) => request.url);
  assert.deepEqual(urls, ["http://127.0.0.1:11434/api/chat"]);
  assert.equal(urls.some((url) => url.includes("/api/pull")), false);
});

test("chatJson maps HTTP statuses to codes without leaking the server error body", async () => {
  const cases: Array<[number, unknown, boolean]> = [
    [400, { error: "invalid character" }, false],
    [429, { error: "too many requests" }, true],
    [500, { error: "an error was encountered while running the model" }, true],
    [503, { error: "model runner crashed" }, true],
  ];

  for (const [status, body, retryable] of cases) {
    const stub = stubFetch(() => jsonResponse(status, body));
    const error = await expectOllamaError(
      chatJson({ messages, schema: responseSchema }, { fetch: stub.fetch, env: env() }),
      status === 400 ? "bad_request" : "server_error",
      retryable,
    );
    assert.equal(error.cause instanceof Error, true);
    assert.doesNotMatch(error.message, /error was encountered|invalid character|too many requests/i);
  }
});

test("chatJson rejects malformed model output in every shape", async () => {
  const cases: Array<{
    label: string;
    respond: () => Response;
    expectedCode?: OllamaError["code"];
    expectedRetryable: boolean;
  }> = [
    {
      label: "envelope is not JSON",
      respond: () => rawResponse(200, "<html>not json</html>"),
      expectedRetryable: false,
    },
    {
      label: "envelope has no message",
      respond: () => jsonResponse(200, { model: "gemma3:4b", done: true }),
      expectedRetryable: false,
    },
    {
      label: "content is blank",
      respond: () => jsonResponse(200, chatEnvelope("   ")),
      expectedRetryable: false,
    },
    {
      label: "content is prose, not JSON",
      respond: () => jsonResponse(200, chatEnvelope("Sorry, I cannot help with that.")),
      expectedRetryable: false,
    },
    {
      label: "content is JSON but fails the caller's schema",
      respond: () => jsonResponse(200, chatEnvelope('{"deliverables":"six templates"}')),
      expectedRetryable: false,
    },
    {
      label: "content has an unknown key",
      respond: () => jsonResponse(200, chatEnvelope('{"deliverables":[],"legal_status":"binding"}')),
      expectedRetryable: false,
    },
    {
      label: "response never completed",
      respond: () => jsonResponse(200, { model: "gemma3:4b", message: { content: "{}" }, done: false }),
      expectedRetryable: false,
    },
    {
      label: "error status with a non-JSON body",
      respond: () => rawResponse(500, "internal error"),
      expectedCode: "server_error",
      expectedRetryable: true,
    },
  ];

  for (const testCase of cases) {
    const stub = stubFetch(() => testCase.respond());
    const error = await expectOllamaError(
      chatJson({ messages, schema: responseSchema }, { fetch: stub.fetch, env: env() }),
      testCase.expectedCode ?? "malformed_output",
      testCase.expectedRetryable,
    );
    assert.doesNotMatch(error.message, /legal_status|Sorry|internal error/i, testCase.label);
  }
});

test("chatJson rejects an invalid request shape before any network call", async () => {
  const stub = stubFetch(() => jsonResponse(200, chatEnvelope("{}")));

  await assert.rejects(
    () => chatJson({ messages: [], schema: responseSchema }, { fetch: stub.fetch, env: env() }),
    TypeError,
  );
  await assert.rejects(
    () =>
      chatJson(
        { messages: [{ role: "user", content: "  " }], schema: responseSchema },
        { fetch: stub.fetch, env: env() },
      ),
    TypeError,
  );

  assert.equal(stub.requests.length, 0);
});

test("chatJson surfaces configuration errors before any network call", async () => {
  const stub = stubFetch(() => jsonResponse(200, chatEnvelope("{}")));
  const error = await expectOllamaError(
    chatJson({ messages, schema: responseSchema }, { fetch: stub.fetch, env: env({ OLLAMA_BASE_URL: "http://10.0.0.5:11434" }) }),
    "config_invalid",
    false,
  );
  assert.equal(error.httpStatus, 500);
  assert.equal(stub.requests.length, 0);
});

// --- Status precheck -------------------------------------------------------

test("getOllamaStatus reports a reachable server with the model installed", async () => {
  const stub = stubFetch(() =>
    jsonResponse(200, { models: [{ name: "gemma3:4b", size: 1 }, { name: "gemma3:1b", size: 1 }] }),
  );

  const status = await getOllamaStatus({ fetch: stub.fetch, env: env() });
  assert.deepEqual(status, {
    model: "gemma3:4b",
    reachable: true,
    modelInstalled: true,
    errorCode: null,
  });
  assert.equal(stub.requests[0].url, "http://127.0.0.1:11434/api/tags");
});

test("getOllamaStatus reports a reachable server with the model missing", async () => {
  const stub = stubFetch(() => jsonResponse(200, { models: [{ name: "gemma3:1b" }] }));
  const status = await getOllamaStatus({ fetch: stub.fetch, env: env({ OLLAMA_MODEL: "gemma3:12b" }) });
  assert.equal(status.reachable, true);
  assert.equal(status.modelInstalled, false);
  assert.equal(status.errorCode, null);
});

test("getOllamaStatus reports an unreachable server and bad settings without throwing", async () => {
  const unreachable = stubFetch(() => {
    throw new TypeError("fetch failed");
  });
  const offline = await getOllamaStatus({ fetch: unreachable.fetch, env: env() });
  assert.equal(offline.reachable, false);
  assert.equal(offline.modelInstalled, false);
  assert.equal(offline.errorCode, "unavailable");

  const broken = await getOllamaStatus({ fetch: unreachable.fetch, env: env({ OLLAMA_BASE_URL: "nope" }) });
  assert.equal(broken.model, null);
  assert.equal(broken.errorCode, "config_invalid");
  assert.equal(unreachable.requests.length, 1);
});

test("getOllamaStatus never returns the endpoint", async () => {
  const stub = stubFetch(() => jsonResponse(200, { models: [{ name: "gemma3:4b" }] }));
  const status = await getOllamaStatus({ fetch: stub.fetch, env: env() });
  assert.deepEqual(Object.keys(status).sort(), ["errorCode", "model", "modelInstalled", "reachable"]);
  assert.equal(JSON.stringify(status).includes("11434"), false);
});

// --- Source-level privacy tripwires ----------------------------------------

test("lib/ollama.ts stays server-side, local-only and silent", async () => {
  const source = await readFile(new URL("../lib/ollama.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /console\./);
  assert.doesNotMatch(source, /NEXT_PUBLIC_/);
  assert.doesNotMatch(source, /Authorization/);
  assert.doesNotMatch(source, /api\/pull|\/api\/delete|\/api\/push/);
  assert.doesNotMatch(source, /server-only|node:/);
  assert.doesNotMatch(source, /ollama\.com|api\.openai\.com|anthropic\.com/);

  const absoluteUrls = source.match(/https?:\/\/[^"'`\s)]+/g) ?? [];
  assert.deepEqual(
    absoluteUrls,
    ["http://127.0.0.1:11434"],
    "the only absolute URL allowed in the client is the documented loopback default",
  );
});