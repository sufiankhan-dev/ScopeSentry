import assert from "node:assert/strict";
import { test } from "node:test";

import {
  handleAnalyzeRequest,
  MAX_REQUEST_BODY_BYTES,
} from "../lib/analyze-handler.ts";
import { DEFAULT_OLLAMA_MODEL, OLLAMA_ERROR_CODES } from "../lib/ollama.ts";
import {
  ANALYZE_ERROR_CODES,
  analyzeErrorSchema,
  analyzeResponseSchema,
  scopeReportSchema,
} from "../lib/schemas.ts";

// ---------------------------------------------------------------------------
// The route's job is not analysis — `tests/analysis.test.ts` covers that — it is
// turning a request into a status code and a body that is safe to hand a browser.
// So every test here asserts one of three things: the right status, a body the
// shared contract accepts, or the absence of something that must never be sent.
//
// The stubbed local server answers the three pipeline stages in the same way as
// the analysis tests, so no network and no model is involved.
// ---------------------------------------------------------------------------

const SENTINEL = "ZEBRAFISH-CONFIDENTIAL-CLIENT-MATERIAL";

const AGREEMENT = `Independent Design Services Agreement — Riverside Coffee Roasters

Scope of work

1. Website design: wireframe and high-fidelity design for six (6) page templates.
2. Two (2) rounds of revisions per page template.

Not included

- Copywriting, translation, or menu data entry.
- Front-end development, CMS configuration, or hosting setup.`;

const CONVERSATION = `Client thread — Riverside Coffee Roasters

Priya (client) — Mon 09:14
We need an online ordering page on the site. Can you build that?`;

const input = {
  agreement: `${AGREEMENT}\n\n${SENTINEL}`,
  conversation: `${CONVERSATION}\n\n${SENTINEL}`,
};

const agreementExtraction = {
  deliverables: [
    {
      id: "1",
      description: "Website design for six (6) page templates",
      evidence: [
        {
          quote: "wireframe and high-fidelity design for six (6) page templates",
          source: "agreement",
        },
      ],
    },
  ],
  exclusions: [
    {
      id: "1",
      description: "Front-end development, CMS configuration, or hosting setup",
      evidence: [
        {
          quote: "Front-end development, CMS configuration, or hosting setup.",
          source: "agreement",
        },
      ],
    },
  ],
  revisionLimits: [],
  deadlines: [],
  assumptions: [],
  ambiguities: [],
};

const conversationExtraction = {
  requests: [
    {
      id: "1",
      text: "Build an online ordering page",
      speaker: "Priya (client)",
      evidence: [
        {
          quote: "We need an online ordering page on the site.",
          source: "conversation",
        },
      ],
    },
  ],
  commitments: [],
  decisions: [],
};

const comparison = (findings: unknown[]) => ({
  findings,
  summary: {
    overview: "One request was reviewed against the agreement terms.",
    limitations: [{ text: "The documents do not settle the delivery schedule." }],
  },
});

const envelope = (content: unknown) => ({
  model: DEFAULT_OLLAMA_MODEL,
  created_at: "2026-01-01T00:00:00:00Z",
  message: {
    role: "assistant",
    content: typeof content === "string" ? content : JSON.stringify(content),
  },
  done: true,
  done_reason: "stop",
  eval_count: 128,
  total_duration: 1_000_000_000,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const stubOllama = (options: { findings?: unknown[]; rawComparison?: string } = {}) => {
  const urls: string[] = [];

  const impl = (async (input_: RequestInfo | URL, init: RequestInit = {}) => {
    urls.push(String(input_));
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const prompt = (body.messages as Array<{ content: string }>)
      .map((message) => message.content)
      .join("\n");

    if (prompt.includes("<<<AGREEMENT>>>")) {
      return jsonResponse(envelope(agreementExtraction));
    }
    if (prompt.includes("<<<CONVERSATION>>>")) {
      return jsonResponse(envelope(conversationExtraction));
    }
    return jsonResponse(
      envelope(options.rawComparison ?? comparison(options.findings ?? [])),
    );
  }) as unknown as typeof fetch;

  return { fetch: impl, urls };
};

const env = {
  OLLAMA_BASE_URL: "http://127.0.0.1:11434",
  OLLAMA_MODEL: DEFAULT_OLLAMA_MODEL,
};

const analyzeRequest = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const post = (
  body: unknown,
  dependencies: Parameters<typeof handleAnalyzeRequest>[1] = {},
  headers: Record<string, string> = {},
) => handleAnalyzeRequest(analyzeRequest(body, headers), { env, ...dependencies });

/** Loosely typed on purpose: these tests read whatever the handler actually sent. */
type HandlerBody = {
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    issues?: Array<{ path: string; message: string }>;
  };
  meta?: { model: string; durationMs: number };
  report?: unknown;
};

type CapturedResponse = {
  status: number;
  headers: Headers;
  text: string;
  body: HandlerBody;
};

/**
 * Reads a response exactly once.
 *
 * A `Response` body can only be consumed a single time, so every test that needs
 * both the parsed body and the raw text captures both here rather than cloning or
 * re-reading.
 */
const capture = async (response: Response): Promise<CapturedResponse> => {
  const text = await response.text();
  let body: HandlerBody;
  try {
    body = JSON.parse(text) as HandlerBody;
  } catch {
    body = {};
  }
  return { status: response.status, headers: response.headers, text, body };
};

const assertNoLeak = (captured: CapturedResponse) => {
  const { text } = captured;
  assert.equal(text.includes(SENTINEL), false, "response leaked the pasted text");
  assert.equal(text.includes("127.0.0.1"), false, "response leaked the endpoint");
  assert.equal(text.includes("localhost"), false, "response leaked a host");
  assert.equal(text.includes("baseUrl"), false, "response leaked config keys");
  assert.doesNotMatch(text, /\bat [\w.]+ \(/, "response looks like it contains a stack trace");
};

// --- Success ----------------------------------------------------------------

test("a valid analysis returns 200 with a report that satisfies the shared contract", async () => {
  const stub = stubOllama({
    findings: [
      {
        id: "f1",
        title: "Online ordering page",
        classification: "potentially_out_of_scope",
        explanation: "The agreement lists front-end development and CMS configuration as excluded.",
        conversationEvidence: [
          {
            quote: "We need an online ordering page on the site.",
            source: "conversation",
          },
        ],
        agreementEvidence: [
          {
            quote: "Front-end development, CMS configuration, or hosting setup.",
            source: "agreement",
          },
        ],
        nextStep: "Quote the ordering page as separate work before starting it.",
      },
    ],
  });

  const captured = await capture(await post(input, { fetch: stub.fetch }));

  assert.equal(captured.status, 200);
  assert.equal(analyzeResponseSchema.safeParse(captured.body).success, true);
  assert.equal(scopeReportSchema.safeParse(captured.body.report).success, true);

  const report = scopeReportSchema.parse(captured.body.report);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].classification, "potentially_out_of_scope");
  assert.equal(report.findings[0].evidenceStatus, "verified");
});

test("a successful response reports the model tag and a wall-clock duration", async () => {
  const stub = stubOllama({ findings: [] });
  const captured = await capture(await post(input, { fetch: stub.fetch }));

  assert.equal(captured.body.meta?.model, DEFAULT_OLLAMA_MODEL);
  assert.equal(typeof captured.body.meta?.durationMs, "number");
  assert.ok((captured.body.meta?.durationMs ?? -1) >= 0);
});

test("the success body never carries the Ollama endpoint and is not cacheable", async () => {
  const stub = stubOllama({ findings: [] });
  const captured = await capture(await post(input, { fetch: stub.fetch }));

  assert.equal(captured.headers.get("Cache-Control"), "no-store");
  assert.equal(captured.headers.get("Content-Type"), "application/json");
  assertNoLeak(captured);
});

test("a report with no findings is a success, not an error", async () => {
  const stub = stubOllama({ findings: [] });
  const captured = await capture(await post(input, { fetch: stub.fetch }));

  assert.equal(captured.status, 200);

  const report = scopeReportSchema.parse(captured.body.report);
  assert.deepEqual(report.findings, []);
  assert.ok(report.summary.limitations.length >= 1);
});

test("the pipeline still runs all three stages and only calls the local server", async () => {
  const stub = stubOllama({ findings: [] });
  await post(input, { fetch: stub.fetch });

  assert.equal(stub.urls.length, 3);
  assert.deepEqual([...new Set(stub.urls)], ["http://127.0.0.1:11434/api/chat"]);
});

// --- Input rejection --------------------------------------------------------

test("a body that is not JSON is rejected without calling the model", async () => {
  let called = false;
  const captured = await capture(
    await post("{not json", {
      fetch: (async () => {
        called = true;
        return jsonResponse(envelope({}));
      }) as unknown as typeof fetch,
    }),
  );

  assert.equal(captured.status, 400);
  assert.equal(called, false);
  assert.equal(captured.body.error?.code, "invalid_request");
  assert.equal(captured.body.error?.retryable, false);
  assertNoLeak(captured);
});

test("a JSON body that is not an object is rejected", async () => {
  for (const body of ["[1,2,3]", '"a string"', "null", "42"]) {
    const captured = await capture(await post(body));
    assert.equal(captured.status, 400, `body ${body} should be rejected`);
    assert.equal(captured.body.error?.code, "invalid_request");
  }
});

test("short, missing, and over-length fields are reported per field", async () => {
  const captured = await capture(
    await post({ agreement: "too short", conversation: CONVERSATION }),
  );

  assert.equal(captured.status, 400);
  assert.equal(captured.body.error?.code, "invalid_input");
  assert.deepEqual(
    captured.body.error?.issues?.map((issue) => issue.path),
    ["agreement"],
  );
  assertNoLeak(captured);
});

test("both missing fields are reported when the body is empty", async () => {
  const captured = await capture(await post({}));

  assert.equal(captured.status, 400);
  assert.equal(captured.body.error?.code, "invalid_input");
  assert.deepEqual(
    captured.body.error?.issues?.map((issue) => issue.path).toSorted(),
    ["agreement", "conversation"],
  );
});

test("an over-length field is rejected instead of truncated", async () => {
  const captured = await capture(
    await post({ agreement: "x".repeat(20_001), conversation: CONVERSATION }),
  );

  assert.equal(captured.status, 400);
  assert.equal(captured.body.error?.code, "invalid_input");
  assert.match(captured.body.error?.issues?.[0].message ?? "", /under 20,000 characters/);
});

test("a body over the size cap is rejected before it is parsed", async () => {
  let parsed = false;
  const captured = await capture(
    await post(JSON.stringify({ agreement: "a".repeat(MAX_REQUEST_BODY_BYTES), conversation: "b" }), {
      fetch: (async () => {
        parsed = true;
        return jsonResponse(envelope({}));
      }) as unknown as typeof fetch,
    }),
  );

  assert.equal(captured.status, 413);
  assert.equal(parsed, false, "an oversized body must not reach the model");
  assert.equal(captured.body.error?.code, "invalid_request");
  assert.equal(captured.body.error?.retryable, false);
});

test("an overstated Content-Length is rejected without reaching the model", async () => {
  let called = false;
  const captured = await capture(
    await post(
      JSON.stringify(input),
      {
        fetch: (async () => {
          called = true;
          return jsonResponse(envelope({}));
        }) as unknown as typeof fetch,
      },
      { "Content-Length": String(MAX_REQUEST_BODY_BYTES + 1) },
    ),
  );

  assert.equal(captured.status, 413);
  assert.equal(called, false);
});

// --- Model-side failures ----------------------------------------------------

const errorCases: Array<{
  name: string;
  status: number;
  code: string;
  retryable: boolean;
  respond: () => Response;
}> = [
  {
    name: "Ollama is not answering",
    status: 503,
    code: "unavailable",
    retryable: true,
    respond: () => {
      throw new TypeError("fetch failed");
    },
  },
  {
    name: "the configured model is not installed",
    status: 503,
    code: "model_missing",
    retryable: false,
    respond: () =>
      jsonResponse({ error: "model 'gemma3:404b' not found, try pulling it first" }, 404),
  },
  {
    name: "Ollama rejects the request",
    status: 502,
    code: "bad_request",
    retryable: false,
    respond: () => jsonResponse({ error: "invalid request" }, 400),
  },
  {
    name: "Ollama fails while generating",
    status: 502,
    code: "server_error",
    retryable: true,
    respond: () => jsonResponse({ error: "out of memory" }, 500),
  },
  {
    name: "the model returns output that fails the contract",
    status: 502,
    code: "malformed_output",
    retryable: false,
    // A comparison stage that answers in prose instead of the expected JSON.
    respond: () => jsonResponse(envelope("Sure! Everything looks in scope to me.")),
  },
];

for (const testCase of errorCases) {
  test(`${testCase.name} becomes ${testCase.status} ${testCase.code}`, async () => {
    const captured = await capture(
      await post(input, {
        fetch: (async () => testCase.respond()) as unknown as typeof fetch,
      }),
    );

    assert.equal(captured.status, testCase.status);
    assert.equal(captured.body.error?.code, testCase.code);
    assert.equal(captured.body.error?.retryable, testCase.retryable);
    assert.ok((captured.body.error?.message.length ?? 0) > 0);
    assert.equal(captured.headers.get("Cache-Control"), "no-store");

    // Every model-side failure must satisfy the shared error contract, because
    // the browser refuses to render anything that does not.
    assert.equal(
      analyzeErrorSchema.safeParse(captured.body).success,
      true,
      "error body failed the shared contract",
    );
    assertNoLeak(captured);
  });
}

test("a misconfigured endpoint is a 500 that names the setting, not the host", async () => {
  const captured = await capture(
    await handleAnalyzeRequest(analyzeRequest(input), {
      fetch: stubOllama().fetch,
      env: { ...env, OLLAMA_BASE_URL: "https://scopesentry.example.com" },
    }),
  );

  assert.equal(captured.status, 500);
  assert.equal(captured.body.error?.code, "config_invalid");
  assert.match(captured.body.error?.message ?? "", /OLLAMA_BASE_URL/);
  assert.equal(captured.body.error?.message.includes("scopesentry.example.com"), false);

  assertNoLeak(captured);
});

test("an error the pipeline does not classify becomes a generic 500 with no detail", async () => {
  // `analyzeScope` currently raises only `AnalyzeInputError` and `OllamaError`,
  // so this exercises the defensive branch: something that is neither must still
  // produce a response the browser can render, with nothing from the throw
  // attached to it.
  const explodingEnv = new Proxy({} as Record<string, string | undefined>, {
    get() {
      throw new Error(`boom: ${SENTINEL} at Object.run (handler.ts:1:1)`);
    },
  });

  const captured = await capture(
    await handleAnalyzeRequest(analyzeRequest(input), {
      fetch: stubOllama().fetch,
      env: explodingEnv,
    }),
  );

  assert.equal(captured.status, 500);
  assert.match(captured.body.error?.message ?? "", /unexpected problem/);
  assert.equal(captured.body.error?.issues, undefined);

  assertNoLeak(captured);
});

// --- Contract consistency ---------------------------------------------------

test("the analyze error codes cover every Ollama code plus the two pre-model ones", () => {
  assert.deepEqual(ANALYZE_ERROR_CODES, [
    "invalid_request",
    "invalid_input",
    ...OLLAMA_ERROR_CODES,
  ]);
});