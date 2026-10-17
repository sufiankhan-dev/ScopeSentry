import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_OLLAMA_MODEL, OLLAMA_ERROR_CODES } from "../lib/ollama.ts";
import {
  MAX_REPLY_BODY_BYTES,
  handleReplyRequest,
} from "../lib/reply-handler.ts";
import {
  REPLY_ERROR_CODES,
  replyErrorSchema,
  replyResponseSchema,
} from "../lib/schemas.ts";
import type { Finding, ReplyDraft, ScopeReport } from "../lib/schemas.ts";

// ---------------------------------------------------------------------------
// The route's job is not drafting — `tests/reply.test.ts` covers that — it is turning a
// request into a status code and a body that is safe to hand a browser. So every test
// here asserts one of three things: the right status, a body the shared contract
// accepts, or the absence of something that must never be sent.
// ---------------------------------------------------------------------------

const SENTINEL = "ZEBRAFISH-CONFIDENTIAL-CLIENT-MATERIAL";

const AGREEMENT = `Independent Design Services Agreement — Riverside Coffee Roasters

Scope of work

1. Website design: wireframe and high-fidelity design for six (6) page templates.

Not included

- Front-end development, CMS configuration, or hosting setup.`;

const CONVERSATION = `Client thread — Riverside Coffee Roasters

Priya (client) — Mon 09:14
We need an online ordering page on the site. Can you build that?`;

const CONVERSATION_QUOTE = "We need an online ordering page on the site. Can you build that?";
const AGREEMENT_QUOTE = "Front-end development, CMS configuration, or hosting setup.";

const finding = {
  id: "f1",
  title: "Online ordering page",
  classification: "potentially_out_of_scope",
  explanation: "The agreement lists front-end development and CMS configuration as excluded.",
  conversationEvidence: [{ quote: CONVERSATION_QUOTE, source: "conversation" }],
  agreementEvidence: [{ quote: AGREEMENT_QUOTE, source: "agreement" }],
  nextStep: "Quote the ordering page as separate work before starting it.",
  confidenceIsEstimate: true,
  evidenceStatus: "verified",
  evidenceIssues: [],
} satisfies Finding;

const report: ScopeReport = {
  agreement: {
    deliverables: [],
    exclusions: [],
    revisionLimits: [],
    deadlines: [],
    assumptions: [],
    ambiguities: [],
  },
  conversation: { requests: [], commitments: [], decisions: [] },
  findings: [finding],
  summary: {
    overview: "One request was reviewed against the agreement terms.",
    limitations: [{ text: "The documents do not settle the delivery schedule." }],
  },
};

const input = {
  agreement: `${AGREEMENT}\n\n${SENTINEL}`,
  conversation: `${CONVERSATION}\n\n${SENTINEL}`,
  report,
  findingId: "f1",
};

const draft: ReplyDraft = {
  intent: "discuss_additional_work",
  body: "Hi Priya, the ordering page sits outside the templates we agreed, so would you like me to scope it separately?",
};

const envelope = (content: unknown) => ({
  model: DEFAULT_OLLAMA_MODEL,
  created_at: "2026-01-01T00:00:00:00Z",
  message: {
    role: "assistant",
    content: typeof content === "string" ? content : JSON.stringify(content),
  },
  done: true,
  done_reason: "stop",
  eval_count: 96,
  total_duration: 400_000_000,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const stubOllama = (payload: unknown = draft) => {
  const urls: string[] = [];

  const impl = (async (input_: RequestInfo | URL) => {
    urls.push(String(input_));
    return jsonResponse(envelope(payload));
  }) as unknown as typeof fetch;

  return { fetch: impl, urls };
};

const env = {
  OLLAMA_BASE_URL: "http://127.0.0.1:11434",
  OLLAMA_MODEL: DEFAULT_OLLAMA_MODEL,
};

const replyRequest = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const post = (
  body: unknown,
  dependencies: Parameters<typeof handleReplyRequest>[1] = {},
  headers: Record<string, string> = {},
) => handleReplyRequest(replyRequest(body, headers), { env, ...dependencies });

type HandlerBody = {
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    issues?: Array<{ path: string; message: string }>;
  };
  findingId?: string;
  draft?: ReplyDraft;
  groundedQuotes?: string[];
  trimmed?: boolean;
  meta?: { model: string; durationMs: number };
};

/** Reads a response exactly once, so both the parsed body and the raw text are available. */
const capture = async (response: Response) => {
  const text = await response.text();
  let body: HandlerBody;
  try {
    body = JSON.parse(text) as HandlerBody;
  } catch {
    body = {};
  }
  return { status: response.status, headers: response.headers, text, body };
};

const assertNoLeak = (captured: { text: string }) => {
  const { text } = captured;
  assert.equal(text.includes(SENTINEL), false, "response leaked the pasted text");
  assert.equal(text.includes("127.0.0.1"), false, "response leaked the endpoint");
  assert.equal(text.includes("localhost"), false, "response leaked a host");
  assert.equal(text.includes("baseUrl"), false, "response leaked config keys");
  assert.doesNotMatch(text, /\bat [\w.]+ \(/, "response looks like it contains a stack trace");
};

// --- Success ----------------------------------------------------------------

test("a valid request returns 200 with a draft that satisfies the shared contract", async () => {
  const stub = stubOllama();
  const captured = await capture(await post(input, { fetch: stub.fetch }));

  assert.equal(captured.status, 200);
  assert.equal(replyResponseSchema.safeParse(captured.body).success, true);

  assert.equal(captured.body.findingId, "f1");
  assert.deepEqual(captured.body.draft, draft);
  assert.deepEqual(captured.body.groundedQuotes, [CONVERSATION_QUOTE, AGREEMENT_QUOTE]);
  assert.equal(captured.body.trimmed, false);
  assert.equal(captured.body.meta?.model, DEFAULT_OLLAMA_MODEL);
  assert.ok((captured.body.meta?.durationMs ?? -1) >= 0);
  assert.deepEqual(stub.urls, ["http://127.0.0.1:11434/api/chat"]);
});

test("the success body is not cacheable and never carries the endpoint", async () => {
  const captured = await capture(await post(input, { fetch: stubOllama().fetch }));

  assert.equal(captured.headers.get("Cache-Control"), "no-store");
  assert.equal(captured.headers.get("Content-Type"), "application/json");
  assertNoLeak(captured);
});

// --- Request rejection ------------------------------------------------------

test("a body that is not JSON is rejected without calling the model", async () => {
  let called = false;
  const captured = await capture(
    await post("{not json", {
      fetch: (async () => {
        called = true;
        return jsonResponse(envelope(draft));
      }) as unknown as typeof fetch,
    }),
  );

  assert.equal(captured.status, 400);
  assert.equal(called, false);
  assert.equal(captured.body.error?.code, "invalid_request");
  assert.equal(replyErrorSchema.safeParse(captured.body).success, true);
  assertNoLeak(captured);
});

test("a JSON body that is not an object is rejected", async () => {
  for (const body of ["[1,2,3]", '"a string"', "null", "42"]) {
    const captured = await capture(await post(body));
    assert.equal(captured.status, 400, `body ${body} should be rejected`);
    assert.equal(captured.body.error?.code, "invalid_request");
  }
});

test("a body over the size cap is rejected before it is parsed or sent", async () => {
  let called = false;
  const captured = await capture(
    await post(JSON.stringify({ ...input, filler: "a".repeat(MAX_REPLY_BODY_BYTES) }), {
      fetch: (async () => {
        called = true;
        return jsonResponse(envelope(draft));
      }) as unknown as typeof fetch,
    }),
  );

  assert.equal(captured.status, 413);
  assert.equal(called, false);
  assert.equal(captured.body.error?.code, "invalid_request");
  assert.equal(captured.body.error?.retryable, false);
  assertNoLeak(captured);
});

test("an overstated Content-Length is rejected without reaching the model", async () => {
  let called = false;
  const captured = await capture(
    await post(
      JSON.stringify(input),
      {
        fetch: (async () => {
          called = true;
          return jsonResponse(envelope(draft));
        }) as unknown as typeof fetch,
      },
      { "Content-Length": String(MAX_REPLY_BODY_BYTES + 1) },
    ),
  );

  assert.equal(captured.status, 413);
  assert.equal(called, false);
});

test("input that fails the reply contract is reported per field", async () => {
  const cases: Array<[string, unknown, string]> = [
    ["a short agreement", { ...input, agreement: "too short" }, "agreement"],
    ["a missing finding id", { ...input, findingId: "" }, "findingId"],
    ["a report that is not a report", { ...input, report: 7 }, "report"],
  ];

  for (const [name, body, path] of cases) {
    let called = false;
    const captured = await capture(
      await post(body, {
        fetch: (async () => {
          called = true;
          return jsonResponse(envelope(draft));
        }) as unknown as typeof fetch,
      }),
    );

    assert.equal(captured.status, 400, name);
    assert.equal(captured.body.error?.code, "invalid_input");
    assert.ok(
      captured.body.error?.issues?.some((issue) => issue.path === path || issue.path.startsWith(`${path}.`)),
      `${name} should point at ${path}`,
    );
    assert.equal(called, false, `${name} should not reach the model`);
    assertNoLeak(captured);
  }
});

// --- Missing context --------------------------------------------------------

test("a finding id that is not in the report is 422 and never reaches the model", async () => {
  let called = false;
  const captured = await capture(
    await post(
      { ...input, findingId: "f9" },
      {
        fetch: (async () => {
          called = true;
          return jsonResponse(envelope(draft));
        }) as unknown as typeof fetch,
      },
    ),
  );

  assert.equal(captured.status, 422);
  assert.equal(captured.body.error?.code, "missing_context");
  assert.equal(captured.body.error?.retryable, false);
  assert.equal(captured.body.draft, undefined);
  assert.equal(called, false);
  assert.equal(replyErrorSchema.safeParse(captured.body).success, true);
  assertNoLeak(captured);
});

test("a report whose quotes are absent from the documents is 422", async () => {
  let called = false;
  const doctored = {
    ...input,
    report: {
      ...report,
      findings: [
        {
          ...finding,
          conversationEvidence: [{ quote: "The client demanded a rebuild.", source: "conversation" }],
          agreementEvidence: [{ quote: "Clause 12.4 permits unlimited revisions.", source: "agreement" }],
        },
      ],
    },
  };

  const captured = await capture(
    await post(doctored, {
      fetch: (async () => {
        called = true;
        return jsonResponse(envelope(draft));
      }) as unknown as typeof fetch,
    }),
  );

  assert.equal(captured.status, 422);
  assert.equal(captured.body.error?.code, "missing_context");
  assert.equal(called, false);
  assertNoLeak(captured);
});

// --- A draft the guards refused ---------------------------------------------

test("a draft with an unsupported claim is 502 and the draft never appears in the body", async () => {
  const captured = await capture(
    await post(input, {
      fetch: stubOllama({
        intent: "clarify_scope",
        body: "Happy to add the ordering page for $500 on top of the current fee.",
      }).fetch,
    }),
  );

  assert.equal(captured.status, 502);
  assert.equal(captured.body.error?.code, "draft_rejected");
  assert.equal(captured.body.error?.retryable, false);
  assert.equal(captured.body.draft, undefined);
  assert.equal(captured.text.includes("$500"), false, "the rejected draft was echoed back");
  assert.equal(replyErrorSchema.safeParse(captured.body).success, true);
  assertNoLeak(captured);
});

test("an accusation in a draft is discarded too", async () => {
  const captured = await capture(
    await post(input, {
      fetch: stubOllama({
        intent: "clarify_scope",
        body: "You failed to confirm the brief, so this is a breach of the agreement.",
      }).fetch,
    }),
  );

  assert.equal(captured.status, 502);
  assert.equal(captured.body.error?.code, "draft_rejected");
  assertNoLeak(captured);
});

test("a repeated ending is trimmed and the response says so", async () => {
  const body = `${draft.body} 366 words 366 words 366 words 366 words 366 words 366 words`;
  const captured = await capture(await post(input, { fetch: stubOllama({ ...draft, body }).fetch }));

  assert.equal(captured.status, 200);
  assert.equal(captured.body.trimmed, true);
  assert.equal(captured.body.draft?.body, draft.body);
  assert.equal(captured.text.includes("366 words"), false, "the repetition reached the client");
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
    respond: () => jsonResponse({ error: "model 'gemma3:404b' not found, try pulling it first" }, 404),
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
    respond: () => jsonResponse(envelope("Sure! Here's a polite message for your client.")),
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
    assert.equal(replyErrorSchema.safeParse(captured.body).success, true);
    assertNoLeak(captured);
  });
}

test("a misconfigured endpoint is a 500 that names the setting, not the host", async () => {
  const captured = await capture(
    await handleReplyRequest(replyRequest(input), {
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
  const explodingEnv = new Proxy({} as Record<string, string | undefined>, {
    get() {
      throw new Error(`boom: ${SENTINEL} at Object.run (reply-handler.ts:1:1)`);
    },
  });

  const captured = await capture(
    await handleReplyRequest(replyRequest(input), {
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

test("the reply error codes cover every Ollama code plus the three reply-specific ones", () => {
  assert.deepEqual(REPLY_ERROR_CODES, [
    "invalid_request",
    "invalid_input",
    "missing_context",
    ...OLLAMA_ERROR_CODES,
    "draft_rejected",
  ]);
});