import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_OLLAMA_MODEL } from "../lib/ollama.ts";
import {
  DRAFT_REJECTED_MESSAGE,
  MISSING_CONTEXT_MESSAGE,
  ReplyError,
  REPLY_OPTIONS,
  draftReply,
  extractQuotedSpans,
  findForbiddenPhrasing,
  findUnsupportedFigures,
  findUnsupportedQuotations,
  isReplyError,
  trimDegenerateTail,
  verifyReplyFinding,
} from "../lib/reply.ts";
import { replyInputSchema, scopeReportSchema } from "../lib/schemas.ts";
import type { ModelFinding, ReplyDraft, ScopeReport } from "../lib/schemas.ts";

// ---------------------------------------------------------------------------
// Reply drafting has one job: never hand back text that asserts something the two
// pasted documents do not support. So every test below asserts either that the draft
// is grounded and clean, or that the pipeline refuses it *before* the user sees
// anything — and, for the refusals decided without a model, that no model was called.
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

const CONVERSATION_QUOTE = "We need an online ordering page on the site. Can you build that?";
const AGREEMENT_QUOTE = "Front-end development, CMS configuration, or hosting setup.";

const sources = { agreement: AGREEMENT, conversation: CONVERSATION };

const baseFinding = {
  id: "f1",
  title: "Online ordering page",
  classification: "potentially_out_of_scope",
  explanation:
    "The agreement lists front-end development and CMS configuration as excluded, so an ordering page looks like separate work.",
  conversationEvidence: [{ quote: CONVERSATION_QUOTE, source: "conversation" }],
  agreementEvidence: [{ quote: AGREEMENT_QUOTE, source: "agreement" }],
  nextStep: "Quote the ordering page as separate work before starting it.",
  confidenceIsEstimate: true,
} satisfies ModelFinding;

const reportWith = (
  findings: ScopeReport["findings"],
): ScopeReport =>
  scopeReportSchema.parse({
    agreement: { deliverables: [], exclusions: [], revisionLimits: [], deadlines: [], assumptions: [], ambiguities: [] },
    conversation: { requests: [], commitments: [], decisions: [] },
    findings,
    summary: {
      overview: "One request was reviewed against the agreement terms.",
      limitations: [{ text: "The documents do not settle the delivery schedule." }],
    },
  });

const report = reportWith([
  { ...baseFinding, evidenceStatus: "verified", evidenceIssues: [] },
]);

const input = {
  agreement: `${AGREEMENT}\n\n${SENTINEL}`,
  conversation: `${CONVERSATION}\n\n${SENTINEL}`,
  report,
  findingId: "f1",
};

const VALID_DRAFT: ReplyDraft = {
  intent: "discuss_additional_work",
  body: `Hi Priya, thanks for the note about the ordering page. Our agreement lists front-end development, CMS configuration, and hosting setup as not included, so an ordering page sits outside the six page templates we agreed. Would you like me to scope it as a separate piece of work so you can see what it would involve?`,
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
  total_duration: 500_000_000,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const env = { OLLAMA_BASE_URL: "http://127.0.0.1:11434", OLLAMA_MODEL: DEFAULT_OLLAMA_MODEL };

type Stub = { fetch: typeof fetch; urls: string[]; prompts: string[] };

const stubOllama = (draft: unknown = VALID_DRAFT): Stub => {
  const urls: string[] = [];
  const prompts: string[] = [];

  const impl = (async (input_: RequestInfo | URL, init: RequestInit = {}) => {
    urls.push(String(input_));
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ content: string }>;
      format?: unknown;
      options?: Record<string, unknown>;
    };
    prompts.push(body.messages.map((message) => message.content).join("\n"));
    return jsonResponse(envelope(draft));
  }) as unknown as typeof fetch;

  return { fetch: impl, urls, prompts };
};

/** A stub that fails the test if the pipeline decides to call the model at all. */
const forbiddenFetch = (): { fetch: typeof fetch; calls: () => number } => {
  let calls = 0;
  const impl = (async () => {
    calls += 1;
    throw new Error("the model must not be called for this input");
  }) as unknown as typeof fetch;

  return { fetch: impl, calls: () => calls };
};

const draft = (body: unknown, deps: Partial<Parameters<typeof draftReply>[1]> = {}) =>
  draftReply(body, { env, ...deps });

/** Asserts the thrown value is a `ReplyError` with the given code, and returns it. */
const expectRejection = async (
  promise: Promise<unknown>,
  code: string,
): Promise<ReplyError> => {
  try {
    await promise;
  } catch (error) {
    assert.equal(isReplyError(error), true, `expected a ReplyError, got ${String(error)}`);
    const replyError = error as ReplyError;
    assert.equal(replyError.code, code);
    return replyError;
  }
  assert.fail(`expected the draft to be rejected with ${code}`);
};

// --- Missing context: decided before any model call --------------------------

test("an unknown finding id is missing context and never reaches the model", async () => {
  const guard = forbiddenFetch();
  const error = await expectRejection(
    draft({ ...input, findingId: "f9" }, { fetch: guard.fetch }),
    "missing_context",
  );

  assert.equal(guard.calls(), 0);
  assert.equal(error.message, MISSING_CONTEXT_MESSAGE);
  assert.equal(error.message.includes(SENTINEL), false);
});

test("a finding whose quotes are absent from the pasted text is missing context", async () => {
  // The report claims everything is verified, but none of its quotes exist in the
  // documents the caller sent. `evidenceStatus` is a flag from the browser, not
  // evidence, so the route must not believe it.
  const doctored = reportWith([
    {
      ...baseFinding,
      conversationEvidence: [{ quote: "The client demanded a full rebuild by Friday.", source: "conversation" }],
      agreementEvidence: [{ quote: "Clause 12.4 permits unlimited revisions.", source: "agreement" }],
      evidenceStatus: "verified",
      evidenceIssues: [],
    },
  ]);

  const guard = forbiddenFetch();
  await expectRejection(
    draft({ ...input, report: doctored }, { fetch: guard.fetch }),
    "missing_context",
  );

  assert.equal(guard.calls(), 0);
});

test("a finding with no conversation quote left cannot be drafted from", async () => {
  const unverified = reportWith([
    {
      ...baseFinding,
      conversationEvidence: [
        { quote: "The client refused every deadline we proposed.", source: "conversation" },
      ],
      agreementEvidence: [],
      evidenceStatus: "unverified",
      evidenceIssues: ["A conversation quote could not be found in the pasted conversation text."],
    },
  ]);

  const guard = forbiddenFetch();
  await expectRejection(
    draft({ ...input, report: unverified }, { fetch: guard.fetch }),
    "missing_context",
  );

  assert.equal(guard.calls(), 0);
});

test("a finding with one surviving quote is still draftable", () => {
  const partial = reportWith([
    {
      ...baseFinding,
      agreementEvidence: [
        { quote: AGREEMENT_QUOTE, source: "agreement" },
        { quote: "Per clause 12.4 of the master contract.", source: "agreement" },
      ],
      evidenceStatus: "partial",
      evidenceIssues: ["An agreement quote could not be found in the pasted agreement text."],
    },
  ]);

  const { finding, sources: used } = verifyReplyFinding({ ...input, report: partial });

  assert.equal(finding.findingId, "f1");
  assert.equal(finding.droppedQuotes, 1);
  assert.deepEqual(finding.context.conversationQuotes, [CONVERSATION_QUOTE]);
  assert.deepEqual(finding.context.agreementQuotes, [AGREEMENT_QUOTE]);
  assert.deepEqual(used, { agreement: input.agreement, conversation: input.conversation });
});

test("input that fails the reply contract is invalid_input, not a model call", async () => {
  const cases: Array<[string, unknown, string]> = [
    ["a short agreement", { ...input, agreement: "too short" }, "agreement"],
    ["a missing finding id", { ...input, findingId: undefined }, "findingId"],
    ["a report that is not a report", { ...input, report: { findings: "none" } }, "report"],
    ["an unknown key", { ...input, send: true }, ""],
  ];

  for (const [name, body, path] of cases) {
    const guard = forbiddenFetch();
    const error = await expectRejection(draft(body, { fetch: guard.fetch }), "invalid_input");

    assert.equal(guard.calls(), 0, `${name} should not reach the model`);
    assert.ok(error.issues.length > 0, `${name} should report at least one field`);

    if (path !== "") {
      assert.ok(
        error.issues.some((issue) => issue.path === path || issue.path.startsWith(`${path}.`)),
        `${name} should point at ${path}, got ${error.issues.map((issue) => issue.path).join(", ")}`,
      );
    }
  }
});

test("the reply contract accepts a full report and rejects unknown top-level keys", () => {
  assert.equal(replyInputSchema.safeParse(input).success, true);
  assert.equal(replyInputSchema.safeParse({ ...input, tone: "formal" }).success, false);
});

// --- The happy path ---------------------------------------------------------

test("a verified finding produces a labelled draft with its grounding", async () => {
  const stub = stubOllama();
  const result = await draft(input, { fetch: stub.fetch });

  assert.deepEqual(result.draft, VALID_DRAFT);
  assert.equal(result.findingId, "f1");
  assert.equal(result.meta.model, DEFAULT_OLLAMA_MODEL);
  assert.ok(result.meta.durationMs >= 0);
  assert.equal(result.droppedQuotes, 0);
  assert.equal(result.trimmed, false);
  assert.deepEqual(result.groundedQuotes, [CONVERSATION_QUOTE, AGREEMENT_QUOTE]);
});

test("the draft is generated by one call to the configured local server", async () => {
  const stub = stubOllama();
  await draft(input, { fetch: stub.fetch });

  assert.deepEqual(stub.urls, ["http://127.0.0.1:11434/api/chat"]);
});

test("the prompt carries the verified quotes and never the unverifiable one", async () => {
  const invented = "Per clause 12.4 of the master contract, revisions are unlimited.";
  const partial = reportWith([
    {
      ...baseFinding,
      agreementEvidence: [
        { quote: AGREEMENT_QUOTE, source: "agreement" },
        { quote: invented, source: "agreement" },
      ],
      evidenceStatus: "partial",
      evidenceIssues: ["An agreement quote could not be found in the pasted agreement text."],
    },
  ]);

  const prompts: string[] = [];
  const options: Array<Record<string, unknown>> = [];
  const impl = (async (_input_: RequestInfo | URL, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ content: string }>;
      options?: Record<string, unknown>;
    };
    prompts.push(body.messages.map((message) => message.content).join("\n"));
    options.push(body.options ?? {});
    return jsonResponse(envelope(VALID_DRAFT));
  }) as unknown as typeof fetch;

  await draft({ ...input, report: partial }, { fetch: impl });

  const prompt = prompts.join("\n");
  assert.ok(prompt.includes(CONVERSATION_QUOTE));
  assert.ok(prompt.includes(AGREEMENT_QUOTE));
  assert.equal(prompt.includes(invented), false, "an unverifiable quote reached the prompt");
  assert.equal(prompt.includes(SENTINEL), false, "the raw documents reached the prompt");

  // These two options are load-bearing for long prose in a JSON string: a budget too
  // small means the model never gets to close the object. See REPLY_OPTIONS.
  assert.equal(options[0]?.num_predict, REPLY_OPTIONS.num_predict);
  assert.equal(options[0]?.temperature, 0);
});

test("the prompt forbids the things a draft must not invent", async () => {
  const stub = stubOllama();
  await draft(input, { fetch: stub.fetch });

  const prompt = stub.prompts.join("\n");
  for (const rule of ["Never state a fee", "Never commit the freelancer", "Never accuse the client", "draft"]) {
    assert.ok(prompt.includes(rule), `prompt should state: ${rule}`);
  }
});

// --- Unsupported claims: the draft is discarded ------------------------------

const rejected: Array<[string, string]> = [
  ["an invented price", "I can add the ordering page for $500, which seems reasonable for the extra work."],
  ["an invented percentage-fee", "Happy to fold this in for 250 USD of the existing fee."],
  ["an invented date", "Our current deadline is January 15, so we have time to add it."],
  ["an invented ISO date", "The handover date of 2026-03-01 means this fits inside the schedule."],
  ["a fabricated clause", 'Our agreement says "Clause 12.4 permits unlimited revisions", so this is already covered.'],
  ["an accusation", "You failed to mention this earlier, which put the schedule at risk."],
  ["breach language", "This is a clear breach of what we agreed, so I would raise it formally."],
  ["legal language", "You are liable for the delay, so this needs to go to a lawyer."],
  ["an invented commitment", "I will deliver the ordering page alongside the template work."],
  ["a promise", "I promise the extra page will be in the next delivery."],
  ["an ability commitment", "I can deliver that by Friday without extra cost."],
  ["a template placeholder", "Hi [Client name], happy to talk about the ordering page."],
  ["a curly-brace placeholder", "Hi {{client_name}}, happy to talk about the ordering page."],
];

for (const [name, body] of rejected) {
  test(`a draft with ${name} is discarded instead of shown`, async () => {
    const error = await expectRejection(
      draft(input, { fetch: stubOllama({ intent: "clarify_scope", body }).fetch }),
      "draft_rejected",
    );

    assert.equal(error.message, DRAFT_REJECTED_MESSAGE);
    assert.equal(error.message.includes(body), false, "the draft was echoed in the error");
    assert.equal(error.message.includes(SENTINEL), false);
    assert.equal(error.retryable, false);
  });
}

const accepted: Array<[string, string]> = [
  [
    "a figure that the documents do contain",
    "Fees are paid in two instalments as the agreement describes, and the ordering page would sit outside them. Shall we park it?",
  ],
  [
    "a quotation copied from the documents",
    'Our agreement lists "Front-end development, CMS configuration, or hosting setup" as not included, so I would treat the ordering page as separate work. Happy to scope it if you want.',
  ],
  [
    "a question that commits to nothing",
    "Could you tell me whether the ordering page is a launch requirement for this month or something we can look at after the template work? Either way I would rather agree it up front.",
  ],
];

for (const [name, body] of accepted) {
  test(`a draft with ${name} is kept`, async () => {
    const result = await draft(input, {
      fetch: stubOllama({ intent: "ask_question", body }).fetch,
    });

    assert.equal(result.draft.body, body);
  });
}

test("a figure in the draft is allowed when the documents contain it", async () => {
  const agreementWithFee = `${AGREEMENT}\n\nFees: paid in two instalments, 2400 USD on signing.`;
  const body = "Fees are 2400 USD on signing under the agreement, and the ordering page would sit outside that scope.";

  const result = await draftReply(
    { ...input, agreement: agreementWithFee },
    { env, fetch: stubOllama({ intent: "clarify_scope", body }).fetch },
  );

  assert.equal(result.draft.body, body);
});

// --- Guards, tested directly ----------------------------------------------

test("findUnsupportedFigures flags figures the documents do not contain", () => {
  assert.deepEqual(findUnsupportedFigures("We can do it for $500 by March 3.", sources), ["$500", "March 3"]);
  assert.deepEqual(findUnsupportedFigures("Nothing numeric here at all.", sources), []);
  assert.deepEqual(findUnsupportedFigures("Fees are 2400 USD today.", { ...sources, agreement: "Fees are 2400 USD." }), []);
});

test("extractQuotedSpans reads double and curly quotes but not apostrophes", () => {
  assert.deepEqual(extractQuotedSpans('He said "that is excluded" and left.'), ["that is excluded"]);
  assert.deepEqual(extractQuotedSpans("She wrote “we agreed” twice."), ["we agreed"]);
  assert.deepEqual(
    extractQuotedSpans('An unterminated "quote stays out of it.'),
    [],
  );
  // A contraction is not a quotation.
  assert.deepEqual(extractQuotedSpans("I don't think we'll need it, won't we?"), []);
});

test("findUnsupportedQuotations separates the user's words from invented ones", () => {
  const draft = `You wrote "We need an online ordering page", but your agreement only lists "Section 4.2 of the statement of work".`;

  assert.deepEqual(findUnsupportedQuotations(draft, sources), [
    "Section 4.2 of the statement of work",
  ]);
});

test("findForbiddenPhrasing names the categories it catches", () => {
  assert.deepEqual(findForbiddenPhrasing("I will deliver the page."), ["commitment"]);
  assert.deepEqual(findForbiddenPhrasing("You failed to confirm the brief."), ["accusation"]);
  assert.deepEqual(findForbiddenPhrasing("Hello [Your name]."), ["placeholder"]);
  assert.deepEqual(
    findForbiddenPhrasing("I will deliver this and you failed to pay."),
    ["accusation", "commitment"],
  );
  assert.deepEqual(findForbiddenPhrasing("Could Tuesday work for you?"), []);
});

test("findForbiddenPhrasing separates a promise from an observation about scope", () => {
  // The live model produced the middle one unprompted. It reads as "this is doable as
  // extra work", not "I promise to do it", and rejecting it would make the feature look
  // broken on the most ordinary phrasing there is.
  assert.deepEqual(findForbiddenPhrasing("I can provide this as a small addition to the work."), []);
  assert.deepEqual(findForbiddenPhrasing("I can deliver that by Friday."), ["commitment"]);
  assert.deepEqual(findForbiddenPhrasing("I can get that done next week."), ["commitment"]);
  assert.deepEqual(findForbiddenPhrasing("I could complete this before the launch."), ["commitment"]);
  assert.deepEqual(findForbiddenPhrasing("I will include the extra page in this round."), ["commitment"]);
});

// --- A generation that collapsed into repetition ---------------------------

test("trimDegenerateTail removes the loop a CPU model fell into and keeps the message", () => {
  // Verbatim shape of a real gemma3:4b run: a good message, then a word count
  // repeated until num_predict stopped it.
  const degenerated =
    'Hi, thanks for bringing this to my attention. I understand you’d like to explore an online ordering page, and that it sits outside the six templates in our agreement. Could we schedule a brief call to discuss it?” 366 words 366 words 366 words 366 words 366 words 366 words 366 words 366 words';

  const result = trimDegenerateTail(degenerated);

  assert.equal(result.trimmed, true);
  assert.equal(
    result.body,
    "Hi, thanks for bringing this to my attention. I understand you’d like to explore an online ordering page, and that it sits outside the six templates in our agreement. Could we schedule a brief call to discuss it?”",
  );
  assert.equal(result.body.includes("366 words"), false);
  assert.ok(result.body.length > 40);
});

test("trimDegenerateTail leaves a normal message alone", () => {
  const clean =
    "Thanks for the note about the ordering page. It sits outside the six templates we agreed, so would you like me to scope it separately?";
  const result = trimDegenerateTail(clean);

  assert.equal(result.trimmed, false);
  assert.equal(result.body, clean);
});

test("trimDegenerateTail ignores a phrase that merely recurs", () => {
  const recurring =
    "The agreement lists front-end development as not included, and the agreement lists CMS configuration as not included. Shall we talk?";
  const result = trimDegenerateTail(recurring);

  assert.equal(result.trimmed, false);
  assert.equal(result.body, recurring);
});

test("trimDegenerateTail catches a repeated block longer than a short n-gram", () => {
  // The other shape this actually takes: the model closes the JSON and then recites the
  // drafting rules back, repeating a ~35-word block. A window-based detector misses it.
  const rules =
    "76 words. 8 sentences. First person. Addressed to client. Plain text. No markdown. No bullet points. No signature block. No placeholders. No quotes from the conversation or agreement. No summary. No postscript.";
  const message =
    "Regarding your request for a brand guideline PDF, I understand this falls outside the initial six templates. Could you please outline what you would like included in the document?";
  const result = trimDegenerateTail(`${message} ${rules} ${rules} ${rules}`);

  assert.equal(result.trimmed, true);
  assert.equal(result.body, message);
});

test("trimDegenerateTail repairs the exact body a live gemma3:4b run produced", () => {
  // Captured verbatim from a real run on this machine: a good message, then the JSON
  // closed inside the body and the model recited the drafting rules until the token
  // limit. Without the repair this whole tail reaches the user's textarea.
  const live = `Hi! I understand you’d like to explore developing an online ordering system with payment processing and a back office. This request appears to involve significantly more development than the six templates we initially agreed upon. To ensure we’re aligned on the scope of work, perhaps we could discuss the specific requirements for this new system in more detail? It might be helpful to outline the necessary features and integrations separately.”} 214 characters. 3 sentences. First person. Addressed to client. Plain text. No subject line, no markdown, no bullet points, no signature block. No promises or commitments. No fees, prices, rates, discounts, deposits, deadlines, or delivery dates. No legal language. Calm and collaborative tone. No accusations. No second versions or alternatives. No placeholders. No appended phrases. End of message. 214 characters. 3 sentences. First person. Addressed to client. Plain text. No subject line, no markdown, no bullet points, no signature block. No promises or commitments. No fees, prices, rates, discounts, deposits, deadlines, or delivery dates. No legal language. Calm and collaborative tone. No accusations. No second versions or alternatives. No placeholders. No appended phrases. 214 characters. 3 sentences. First person.`;

  const result = trimDegenerateTail(live);

  assert.equal(result.trimmed, true);
  assert.equal(
    result.body,
    "Hi! I understand you’d like to explore developing an online ordering system with payment processing and a back office. This request appears to involve significantly more development than the six templates we initially agreed upon. To ensure we’re aligned on the scope of work, perhaps we could discuss the specific requirements for this new system in more detail? It might be helpful to outline the necessary features and integrations separately.",
  );
  assert.equal(result.body.includes("characters"), false);
  assert.deepEqual(findForbiddenPhrasing(result.body), []);
});

test("a draft that degenerates is trimmed before it is shown", async () => {
  const body = `${VALID_DRAFT.body} 366 words 366 words 366 words 366 words 366 words 366 words 366 words 366 words`;
  const result = await draft(input, { fetch: stubOllama({ intent: "clarify_scope", body }).fetch });

  assert.equal(result.trimmed, true);
  assert.equal(result.draft.body, VALID_DRAFT.body);
});

test("a draft that is nothing but repetition is discarded", async () => {
  const body = "366 words 366 words 366 words 366 words 366 words 366 words 366 words 366 words";

  await expectRejection(
    draft(input, { fetch: stubOllama({ intent: "clarify_scope", body }).fetch }),
    "draft_rejected",
  );
});

test("trimming is fast enough to run on every draft", () => {
  const words = Array.from({ length: 240 }, (_, index) => `word${index % 7}`).join(" ");
  const started = Date.now();

  for (let run = 0; run < 20; run += 1) trimDegenerateTail(words);

  const perCall = (Date.now() - started) / 20;
  assert.ok(perCall < 250, `trimming took ${perCall.toFixed(1)}ms per call`);
});

test("an invented figure inside the trimmed tail does not reject an otherwise clean draft", async () => {
  // The figure is real text the model wrote, but it is inside the loop, so the user
  // never sees it. Rejecting for text that was removed would be a false alarm.
  const body = `${VALID_DRAFT.body} I can add $500 $500 $500 $500 $500 $500 to the invoice.`;
  const result = await draft(input, { fetch: stubOllama({ intent: "ask_question", body }).fetch });

  assert.equal(result.trimmed, true);
  assert.equal(result.draft.body, VALID_DRAFT.body);
});

test("an invented figure in the part that survives is still rejected", async () => {
  const body = `${VALID_DRAFT.body} I can add $500 to the invoice. 500 500 500 500 500 500`;

  await expectRejection(
    draft(input, { fetch: stubOllama({ intent: "ask_question", body }).fetch }),
    "draft_rejected",
  );
});

// --- Model-side failures ---------------------------------------------------

test("a model answer that is not the draft contract is malformed output", async () => {
  const cases: Array<[string, unknown]> = [
    ["prose instead of JSON", "Sure! Here is a polite message you can send to your client."],
    ["an unknown intent", { intent: "escalate", body: "Hello there." }],
    ["an unknown field", { intent: "ask_question", body: "Hello there.", sendTo: "client@example.com" }],
    ["an empty body", { intent: "ask_question", body: "   " }],
    ["a body over the cap", { intent: "ask_question", body: "x".repeat(1_501) }],
  ];

  for (const [name, payload] of cases) {
    await assert.rejects(
      draft(input, { fetch: stubOllama(payload).fetch }),
      (error: unknown) => {
        assert.equal(
          isReplyError(error),
          false,
          `${name} should surface as an Ollama error, not a ReplyError`,
        );
        assert.equal((error as { code?: string }).code, "malformed_output", name);
        return true;
      },
      name,
    );
  }
});

test("every intent in the contract is accepted", async () => {
  for (const intent of ["clarify_scope", "ask_question", "discuss_additional_work"] as const) {
    const result = await draft(input, {
      fetch: stubOllama({ intent, body: "Could we talk about the ordering page this week?" }).fetch,
    });

    assert.equal(result.draft.intent, intent);
  }
});

test("a misconfigured endpoint fails as an Ollama configuration error, not a ReplyError", async () => {
  await assert.rejects(
    draftReply(input, {
      env: { ...env, OLLAMA_BASE_URL: "https://scopesentry.example.com" },
      fetch: stubOllama().fetch,
    }),
    (error: unknown) => {
      assert.equal(isReplyError(error), false);
      assert.equal((error as { code?: string }).code, "config_invalid");
      assert.equal((error as Error).message.includes("scopesentry.example.com"), false);
      return true;
    },
  );
});