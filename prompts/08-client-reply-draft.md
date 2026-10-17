# Task 08 — Optional client-reply drafting from a verified finding

## Goal and user outcome

The report currently ends at "recommended next step". A freelancer still has to write the
actual message. After this task, every finding card carries a **Draft a reply** control that
calls the same local Ollama model and returns a short, polite, professional message the
freelancer can edit, copy, and send themselves.

The message is grounded in the finding's *verified* evidence, so it can clarify scope, ask a
real question, or propose discussing extra work without ever stating a price, a deadline, a
contractual clause, or a commitment that the pasted documents do not support — and without
saying anything accusatory about the client.

Explicitly **out of scope**: sending anything (no email/Slack/WhatsApp integration, no SMTP, no
outbound fetch), saving drafts to disk or browser storage, a reply composer for the whole
report instead of one finding, tone/emoji/length pickers, editing the agreement, a "regenerate
until it sounds right" loop, any new npm dependency, and any change to the analysis pipeline,
the extraction prompts, or the evidence rules.

## Skills and documentation consulted

- `AGENTS.md` — §2 approval workflow, §3 required UI states and copy-to-clipboard feedback, §5
  boundaries, §7 fixed decisions ("Reply generation: create an editable, professional message
  based on a selected finding. Never invent fees, deadlines, or contractual obligations"),
  §9 Ollama integration, §10 evidence-first trust rules, §11 privacy and security, §13 checks,
  §15 "keep the scope small".
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` — Route
  Handlers in Next 16.4.1: Web `Request`/`Response`, exported HTTP methods, auto `OPTIONS`,
  automatic 405 for undeclared methods. `app/api/reply/route.ts` follows the same one-line
  delegation shape as `app/api/analyze/route.ts`; `typedRoutes` is not enabled, so the client
  calls `/api/reply` as a plain string.
- `.agents/skills/frontend-design/SKILL.md` — restrained information-encoding layout, no
  decorative motion, honest empty/loading/error states, visible focus, reduced motion.
- `.agents/skills/vercel-react-best-practices/SKILL.md` — §5.8 interaction logic in the event
  handler (the `fetch` lives in the button's `onClick`, never in an effect), §5.12 lazy state
  initialization, §6.9 explicit conditional rendering.
- `.agents/skills/shadcn/SKILL.md` and `components/ui/**` — reuse `Button`, `Field`,
  `FieldLabel`, `FieldDescription`, `Textarea`. No new primitive installed.
- Ollama 0.40.4 with `gemma3:4b` confirmed installed and answering on `http://127.0.0.1:11434`
  (checked during this investigation). No `.env.local` change needed; `OLLAMA_*` defaults apply.

## Existing code inspected

- `lib/schemas.ts` (349 lines) — `agreementTextSchema` / `conversationTextSchema` (20–20 000
  chars), `scopeReportSchema`, `reportFindingSchema` (`evidenceStatus`, `evidenceIssues`),
  `analyzeMetaSchema` (`{ model, durationMs }`, endpoint deliberately absent),
  `analyzeErrorSchema`, `ANALYZE_ERROR_CODES` (= `invalid_request`, `invalid_input`, plus every
  `OLLAMA_ERROR_CODES`), `ADVISORY_NOTICE`.
- `lib/ollama.ts` (541 lines) — `chatJson<T>({ messages, schema, format, options, timeoutMs })`,
  `getOllamaConfig`, `OllamaError` with a static user-safe `message` and `httpStatus` per code.
  Note: `chatJson` accepts `messages`, so a plain-text (non-JSON) reply is *not* expressible
  today; the reply stage therefore uses the same structured-JSON path as the analysis stages.
- `lib/evidence.ts` (350 lines) — `findExactQuote(source, quote)` returns the user's own bytes
  or `{ found: false }`; `CONCRETE_TERM_PATTERNS` (prices, ISO/US/EU dates, month-day) is
  exported and already used by `collectUnsupportedTerms`; `MAX_EVIDENCE_ISSUES`.
- `lib/prompts.ts` (301 lines) — `DOCUMENT_NOTICE` (untrusted-data framing), `fence()`,
  `EVIDENCE_RULES`, `MAX_CONTEXT_ITEMS_PER_CATEGORY`; each stage exports a `*_SYSTEM` constant
  plus a `build*Messages()` that returns an `OllamaChatMessage[]`.
- `lib/analysis.ts` (319 lines) — three sequential `chatJson` calls, `EXTRACTION_OPTIONS`
  (`num_ctx: 8_192`, `num_predict: 1_200`), `PIPELINE_STAGE_TIMEOUT_MS = 300_000`,
  `AnalyzeInputError` carrying only field paths + static messages.
- `lib/analyze-handler.ts` (243 lines) — `MAX_REQUEST_BODY_BYTES = 512 * 1024` derived for two
  20 000-char fields, `readBoundedBody` (checks `Content-Length`, then measures the actual read
  string), `errorResponse` building through `analyzeErrorSchema`, `no-store` on every response,
  and the redaction rules: no echoed text, no `cause`, no endpoint, no stack trace, no logging.
- `lib/report-display.ts` (164 lines) — pure display metadata; `formatDuration`, `formatElapsed`.
- `components/scope-form.tsx` (346 lines) — `"use client"`, owns `agreement` / `conversation` /
  `analysis` state, does the `fetch` in `onSubmit`, renders `<AnalysisPanel state={analysis} />`.
  The pasted text is already in state, so it can be re-sent without any new state.
- `components/analysis-panel.tsx` (186 lines) — `switch` over the closed `AnalysisState` union;
  `succeeded` renders `<ScopeReportView report meta />`.
- `components/scope-report.tsx` (141 lines) — summary, classification counts, findings list,
  limitations, `ADVISORY_NOTICE`.
- `components/finding-card.tsx` (201 lines) — one finding: badges, reasoning, attributed
  `<blockquote>` quotes, evidence issues, next step.
- `tests/` — 137 tests, all green at HEAD `1bab933` (clean tree). `node:test` +
  `node:assert/strict`, `../lib/x.ts` imports with the explicit `.ts` extension, injected
  `fetch`, no network, no `process.env`. `tests/analyze-handler.test.ts` holds the reusable
  stubbed-`fetch` envelope pattern and the `assertNoLeak` sentinel helper.
- `package.json` — `test`, `typecheck`, `lint`, `build`, `dev`. No new dependency.

## Decisions and assumptions

1. **The request body is `{ agreement, conversation, report, findingId }`.** The report is the
   source of the finding; the two pasted documents are re-sent so the route can verify every
   quote *itself* instead of trusting an `evidenceStatus` flag that arrived from the browser.
   `findExactQuote` is already the tested mechanism for that, and it is what makes the "grounded
   in verified evidence" claim mean anything. Both documents are already in `ScopeForm` state,
   so no new client state and no new storage is introduced.
2. **Per-quote re-verification, not trust in `evidenceStatus`.** The route finds the finding by
   `id`, re-checks every `conversationEvidence` / `agreementEvidence` quote against the document
   it declares with `findExactQuote`, and keeps only the ones that matched. A client that sends
   a doctored report with `"evidenceStatus": "verified"` and invented quotes gets an empty
   evidence set and no draft.
3. **`missing_context` when there is nothing to ground a draft on.** No matching finding, a
   `findingId` that is not in the report, or **zero** re-verified quotes → typed error, **and no
   model call at all** (asserted by a test whose stub `fetch` fails if invoked). A finding with
   `evidenceStatus !== "verified"` is still draftable when at least one quote re-verifies; the
   card shows the existing `evidenceIssues` warning above the composer.
4. **Unsupported claims are discarded, not flagged.** Three deterministic checks run on the
   generated draft before it is returned, and any failure discards the whole draft:
   - **unsupported figures** — any `CONCRETE_TERM_PATTERNS` token in the draft that does not
     appear in `agreement + conversation`. Reuses the existing, already-tested patterns.
   - **unsourced quotation** — every quoted span in the draft (`"…"`, `“…”`, `‘…’`) must be
     found by `findExactQuote` in one of the two documents. This is the anti-fabricated-clause
     rule: the model may repeat the user's own words and nothing else.
   - **forbidden phrasing** — a narrow lexicon for accusations and invented commitments
     ("breach", "you failed to", "you owe", "liable", "I will deliver", "I promise",
     "I guarantee", …), plus template placeholders such as `[Name]`, `{{date}}`, `[INSERT …]`.
   The failure response carries a single **static** message. The specific reasons are never put
   in the HTTP body, because a reason would quote the model's own output — the same rule the
   analyze handler follows. A fourth, *non*-discarding repair (`trimDegenerateTail`) was added
   during implementation after the first live run; see the amendment at the end of this file.
5. **Structured output, not free text.** `replyDraftSchema` is `z.strictObject({ intent, body })`
   with `intent` a three-value enum (`clarify_scope`, `ask_question`,
   `discuss_additional_work`) so the UI can label what the draft is doing, and `body` bounded to
   1 500 characters with `.min(1)`. A free-text reply would need a new `chatJson` mode plus a
   second validation path, for no product gain.
6. **The prompt is a fourth stage in `lib/prompts.ts`**, reusing `DOCUMENT_NOTICE` and `fence()`,
   and quoting the finding's re-verified text under an explicit "untrusted DATA" framing. Its
   rules restate the product constraints: no invented price/deadline/clause/commitment, no
   accusation, first person, under 150 words, no placeholders, draft-only, never sent.
7. **One model call per draft**, with `REPLY_OPTIONS = { num_ctx: 4_096, num_predict: 900 }` and
   `timeoutMs = PIPELINE_STAGE_TIMEOUT_MS`, reused from `lib/analysis.ts`. A single short
   generation is far cheaper than the three-stage analysis, so the composer says "up to a minute
   on a CPU-only machine" rather than reusing the analysis copy. Both option values were changed
   during implementation after the live model failed in ways the unit tests could not predict;
   see the amendment.
8. **The draft is a starting point the freelancer owns.** `DRAFT_NOTICE` (a constant next to
   `ADVISORY_NOTICE` in `lib/schemas.ts`) states: written by the local model, edit before
   sending, ScopeSentry cannot send it for you. The composer renders an editable `<textarea>`
   seeded with the draft, never a read-only block, plus a **Copy draft** button that writes to
   `navigator.clipboard` and confirms in an `aria-live` region. Nothing is sent automatically
   and no `mailto:`/`fetch`/SMTP path exists anywhere in the diff.
9. **Editing is respected.** The composer tracks whether the textarea still matches the generated
   draft. While untouched the secondary button is **Regenerate**; once edited it becomes
   **Regenerate (replaces your edits)** so a regeneration never silently destroys the user's
   wording. There is no "clear" button and no browser storage, matching the analyze form.
10. **Reply request body cap is 1 MiB**, `MAX_REPLY_BODY_BYTES`, checked before `JSON.parse` the
    same way `MAX_REQUEST_BODY_BYTES` is. Derivation: two 20 000-char documents plus a report
    whose realistic size is tens of KB; 1 MiB is ~20× headroom over an observed report while
    still bounding what the server buffers. The analyze cap cannot be reused because its 512 KiB
    was derived for two fields only. An over-cap body is rejected with a static 413 message and
    never reaches the model.
11. **`app/api/reply/route.ts` is a one-line delegation to `lib/reply-handler.ts`**, mirroring the
    analyze route, so the status-code mapping and redaction rules are testable with a stubbed
    `fetch`. `lib/reply-handler.ts` reuses `analyzeMetaSchema`, `analyzeErrorSchema`'s shape
    (via the new `replyErrorSchema`), and the same `no-store` headers; it does **not** refactor
    `lib/analyze-handler.ts`, so the 137 existing tests are untouched.
12. **`REPLY_ERROR_CODES = ["invalid_request", "invalid_input", "missing_context",
    ...OLLAMA_ERROR_CODES, "draft_rejected"]`**, mirroring the analyze list. Status mapping:
    `invalid_request` 400 (malformed JSON, non-object body) and 413 (over cap);
    `invalid_input` 400 (with a `path` per field, so the browser can point at the offending
    input); `missing_context` 422; `draft_rejected` 502 (model-side output failure, next to
    `malformed_output`); every Ollama code keeps its own status from `OllamaError.httpStatus`. A
    test asserts the list still covers every `OLLAMA_ERROR_CODES` entry.
13. **One error class, `ReplyError`**, carrying `code`, `retryable`, and a static `message` plus
    an optional `issues` array of `{ path, message }` — never user text — mirroring
    `AnalyzeInputError` / `OllamaError`. The handler maps it; it never inspects a thrown value it
    does not recognise.
14. **Prop drilling of one small object, not React context.** `ScopeForm` → `AnalysisPanel` →
    `ScopeReportView` → `FindingCard` → `ReplyComposer` receive
    `documents: { agreement, conversation }`. The repo has no context providers, and the whole
    report subtree is already client-side.
15. **`FindingCard` becomes interactive** but keeps its presentational shape: it gains an optional
    `documents` prop and renders `<ReplyComposer>` beneath "Recommended next step". A finding card
    rendered without `documents` (no current caller) renders no composer.
16. **`components/privacy-indicator.tsx` gets one honest sentence.** It currently says "When you
    run an analysis, the text you pasted is sent to this app's own server…" — after this task a
    reply draft does the same, so the sentence must name both. No new privacy claim, and the
    "not tested with the network disconnected" caveat stays.
17. **`README.md`** gets the status-table row flipped to Working, a short "Client reply drafting"
    section (request shape, status table, the four discard rules), and a project-layout line. No
    other doc change.
18. **Two new test files** in the existing `node:test` style: `tests/reply.test.ts` (pipeline +
    the four deterministic guards, with the "missing context" and "unsupported claims" cases the
    request asks for) and `tests/reply-handler.test.ts` (status mapping, caps, redaction, local
    only).

## Expected files to change

New:

- `lib/reply.ts` — `draftReply(input, dependencies?)`: validate input, locate the finding,
  re-verify its quotes, build the context, one `chatJson` call, run the four guards, return
  `{ findingId, draft, meta }`. Exports `ReplyError`, `replyDraftSchema`'s guards
  (`findUnsupportedFigures`, `extractQuotedSpans`, `findForbiddenPhrasing`), and
  `isReplyError`.
- `lib/reply-handler.ts` — `handleReplyRequest(request, dependencies?)`, `MAX_REPLY_BODY_BYTES`,
  and the static messages. Mirrors `lib/analyze-handler.ts`'s structure.
- `app/api/reply/route.ts` — `POST` only; delegates to the handler.
- `components/reply-composer.tsx` — `"use client"`; idle, loading, error, and draft states.
- `tests/reply.test.ts`, `tests/reply-handler.test.ts`.
- `prompts/08-client-reply-draft.md` (new, this file).

Modified:

- `lib/schemas.ts` — `REPLY_INTENTS`, `replyInputSchema`, `replyDraftSchema`, `replyResponseSchema`,
  `replyErrorSchema`, `REPLY_ERROR_CODES`, `DRAFT_NOTICE`, and the `ReplyState` union. No
  existing export changes.
- `lib/prompts.ts` — `REPLY_SYSTEM`, `REPLY_OPTIONS`-independent message builder
  `buildReplyMessages(context)`.
- `components/finding-card.tsx` — optional `documents` prop; renders `<ReplyComposer>`.
- `components/scope-report.tsx`, `components/analysis-panel.tsx`, `components/scope-form.tsx` —
  thread `documents` down.
- `components/privacy-indicator.tsx` — name reply drafting in the processing-path sentence.
- `README.md` — status row, section, layout line.

Untouched: `lib/analysis.ts` (only `PIPELINE_STAGE_TIMEOUT_MS` imported), `lib/evidence.ts`,
`lib/ollama.ts`, `lib/samples.ts`, `lib/utils.ts`, `lib/report-display.ts`, `app/page.tsx`,
`app/layout.tsx`, `app/globals.css`, `next.config.ts`, `package.json`, `.env.example`,
`components/ui/**`, and all six existing test files.

## Functional requirements

- Every finding card shows a **Draft a reply** button. Clicking it calls
  `POST /api/reply` with `{ agreement, conversation, report, findingId }`.
- The model receives **only** the re-verified quote text and the finding's own classification,
  title, explanation, and next step. A quote that failed verification is never placed in the
  prompt (asserted by a test).
- A successful response renders: a persistent **draft** label, the intent badge (clarify scope /
  ask a question / discuss additional work), an **editable** textarea seeded with `draft.body`,
  a **Copy draft** button with `aria-live` confirmation, a **Regenerate** button whose label
  changes once the user edits, the `DRAFT_NOTICE` copy, and — when the finding is not fully
  verified — the existing evidence warning so the user checks the wording themselves.
- The composer has four states: idle (button only), running (spinner + honest timing copy +
  `aria-live`), failed (`role="alert"` + the static server message + Retry, the report and the
  pasted text untouched), and draft.
- Copy-to-clipboard shows "Copied" on success and a distinct "select the text and copy it
  manually" message when `navigator.clipboard` is unavailable or rejects.
- Nothing is sent anywhere by the app: there is no `mailto:`, no outbound `fetch` from the
  client other than `POST /api/reply`, and no integration of any kind.
- Server-side failures map to the documented status codes; the browser parses both
  `replyResponseSchema` and `replyErrorSchema` before rendering anything, exactly as the analyze
  form does with its two contracts. A 200 whose body fails validation is treated as an invalid
  response, not partially rendered.

## Security considerations and privacy requirements

- The reply is generated only through the configured local Ollama endpoint, server-side, by the
  existing `chatJson` helper. No cloud fallback, no model download, no second destination.
- The browser never sees `OLLAMA_BASE_URL`. `meta.model` is returned so the "this ran locally"
  claim stays checkable, exactly as with the analysis.
- The request body is capped at 1 MiB **before** `JSON.parse`, and `replyInputSchema` bounds the
  documents, the `findingId`, and the report.
- No error response contains the pasted agreement, the pasted conversation, the report, the
  generated draft, a prompt, model output, an `OllamaError.cause`, a stack trace, or a reason
  string from a guard check. Only codes, static messages, and field paths.
- Nothing is logged. No `console.*`, no file writes, no database, no `localStorage`,
  `sessionStorage`, `indexedDB`, or cookies. The draft lives in React state in the open tab only.
- Responses are `Cache-Control: no-store`, because the request body and the draft are derived
  from client material.
- The discard rules mean an unsourced price, date, invented quotation, accusation, or invented
  commitment **cannot** reach the user as a sendable draft; it is dropped server-side and the
  user is told only that the draft was discarded.
- The privacy indicator must describe the real path after this change (text goes to the app's
  own server and from there to the local Ollama instance, for analysis *and* for drafting a
  reply) and must keep the "not protection against malware or a compromised machine" and "not
  tested with the network disconnected" caveats. No claim that the app works offline, no claim of
  legal conclusions, no claim the drafted message is safe to send without reading it.
- Guard patterns are heuristics for phrasing, not a legal or safety guarantee; the file must say
  so in a comment, and the UI must keep the "read it before you send it" instruction.

## Acceptance criteria

1. `npm test` passes with all 137 existing tests still green and none weakened or skipped, plus
   new tests covering at minimum: `missing_context` for an unknown `findingId`, for a finding
   with zero re-verified quotes, and for a report whose quotes are absent from the documents
   (each asserting **no** model call); `draft_rejected` for an invented price, an invented date,
   an unsourced quotation, a placeholder, an accusation, and an invented commitment; each guard
   passing when the claim *is* supported by the documents; the verified happy path with
   `intent` + `body`; unknown keys rejected; the prompt containing the verified quote and
   *not* containing the unverifiable one; every request going to
   `http://127.0.0.1:11434/api/chat`; and the full status mapping in `tests/reply-handler.test.ts`
   (200, 400 `invalid_request`, 413, 400 `invalid_input`, 422 `missing_context`,
   502 `draft_rejected`, 502 `malformed_output`, 502 `server_error`, 503 `unavailable`,
   503 `model_missing`, 500 `config_invalid`).
2. No response body contains the sentinel client text, the report, the draft, a stack trace, or
   the endpoint; the success body contains the model tag but no `baseUrl`.
3. `npm run typecheck`, `npm run lint`, and `npm run build` all pass.
4. `git diff --stat` shows changes only in the files listed above, plus this prompt.
5. The diff contains no `console.`, no `localStorage`, no `sessionStorage`, no `indexedDB`, no
   `mailto:`, no `<form action=`, and no client `fetch` other than `POST /api/reply`.
6. `DRAFT_NOTICE` is rendered with every draft, the textarea is editable, and no code path sends
   the message anywhere.
7. The privacy indicator's copy is true of this diff.

## Automated checks and exact manual test steps

Automated (run and record real output):

1. `npm test`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run build`
5. `git status --short` and `git diff --stat`
6. `git diff | Select-String -Pattern 'console\.|localStorage|sessionStorage|indexedDB|mailto:|
   Authorization|https?://(?!127\.0\.0\.1|localhost)'` over `app/` and `components/` to confirm
   nothing new leaves the machine.
7. `node node_modules/next/dist/bin/next internal agent-feedback-instructions` once, before the
   final report, and act on its output.

End-to-end against live Ollama:

8. `curl -s http://127.0.0.1:11434/api/tags` to confirm `gemma3:4b` is present.
9. Start the app in the background (`npm run dev`, output redirected to a log file) and wait for
   it to answer on `http://localhost:3000`.
10. `POST /api/analyze` with the committed Riverside fixtures from `lib/samples.ts` (expect a
    multi-minute CPU run, `meta.model = "gemma3:4b"`), keep the returned report, then
    `POST /api/reply` twice with `{ agreement, conversation, report, findingId }` for one
    `potentially_out_of_scope` finding and one `in_scope` finding. Record both statuses, bodies,
    intents, and whether the draft contains any figure not present in the fixtures.
11. `POST /api/reply` with an unknown `findingId` (expect 422 `missing_context`) and with a doctored
    report whose `evidenceStatus` is `"verified"` but whose quote is absent from the pasted text
    (expect 422 `missing_context`, no model call).
12. Stop Ollama, repeat step 10's reply call, expect 503 `unavailable` with no client text in the
    body; restart Ollama afterwards.
13. Inspect the dev log for any occurrence of the pasted agreement, conversation, or generated
    draft, and confirm the only outbound destination was `127.0.0.1:11434`.

Manual browser checklist (run by the user; recorded honestly in the close-out report as not
automated here, because Python and Playwright are not installed on this machine):

14. Load `/`, click **Load both samples**, press **Analyze scope**, wait for the report.
15. Press **Draft a reply** on a finding: the loading state appears, then the draft, labelled as a
    draft, with an editable textarea, a Copy button, and the intent badge.
16. Edit the textarea, confirm the regenerate button now warns that it replaces your edits, copy
    the text, and confirm the "Copied" confirmation appears.
17. Confirm the drafted text contains no figure that is not in the sample documents, and that no
    message is sent anywhere by pressing anything.
18. Narrow the window to 375 px and confirm no horizontal overflow; toggle dark mode and confirm
    the draft block stays legible.

## Amendment after the first live end-to-end run

The first real run against `gemma3:4b` returned `502 malformed_output` for **both** drafts,
and the cause was not what the unit tests could have predicted. Recorded here because the
fix changes two of the decisions above.

**What the model did.** A reply is long free prose inside a JSON string — the only output in
this app that is. On `gemma3:4b` with llama.cpp at `temperature: 0` and llama.cpp's default
`repeat_penalty` of 1.1, it wrote a perfectly good message and then appended a word count and
looped on it:

```text
done_reason: "length", eval_count: 400
"...for this additional development?" 366 words 366 words 366 words 366 words … (never closed)
```

The JSON never closed, so `chatJson` rejected it as `malformed_output` and the user got
nothing — the feature looked broken rather than degraded.

**Fix 1 — `num_predict: 900`, not a tighter budget.** The measured problem was the opposite
of running out of room. When the model ran past the end of the message it kept going until
the limit, and the token it needed to close the JSON object was the one it ran out of, so the
whole draft came back `malformed_output`. At 900 tokens the measured runs finished on their
own in 92–340 tokens; at 400 and 512 several runs hit the limit with the closing brace never
written.

**Fix 1b — `repeat_penalty` was raised, then reverted.** At 1.15 both drafts came back clean
in 22 s and 29 s, which looked like the real fix. It was not: Ollama's own llama.cpp sampler
then aborted three of five later runs with `prediction aborted, token repeat limit reached`,
which surfaces to the user as `server_error`. Trading a tail that can be trimmed for an
outright failure is the wrong trade, so the penalty stays at the default. Recorded because the
intuition "raise the penalty to stop loops" is wrong for this stack.

**Fix 2 — `trimDegenerateTail`, which repairs instead of discarding.** The spill can still
happen, and in the run that first showed it up, the draft *validated* with the whole tail
inside the body string. A guard that discards the draft would turn a cosmetic defect into no
draft at all, so the pipeline now cuts the spill off, drops a half-written sentence and a
dangling quote behind it, reports `trimmed: true`, and shows the user a sentence saying the
ending was removed.

The spill takes two measured shapes and the repair handles both:
1. the model closes the JSON inside the body and keeps writing — `"…integrations separately."} 214
   characters. 3 sentences. First person…"` — detected by the stray `"}`, which is exact;
2. a bare block repetition with no close brace to cut on — `"…this additional development?" 366 words
   366 words 366 words…"` — detected by scanning for any block repeated three times back to
   back, of any length. The first version of this only looked at 2–8 word windows and missed
   the 35-word rule recital; the bodies captured from the live runs are now regression
   fixtures in `tests/reply.test.ts`.

This is the one place where the draft is *not* thrown away, and the distinction is deliberate:
truncation can only remove text, so it cannot introduce a claim the documents do not support.
The guards run on the trimmed body, so an invented figure that only appeared inside the spill
does not cause a false rejection, and one that survives trimming is still rejected. Both halves
are covered in `tests/reply.test.ts`. A trimmed body shorter than 40 characters is discarded as
useless.

The wording of `REPLY_SYSTEM` was also tightened during this: "under 150 words" was replaced
with "three to five sentences", plus an explicit "never append a word count, a postscript, a
summary, or a repeat", because the original length instruction is what triggered the count.

## Close-out report format (per AGENTS.md §2)

- `What I did`
- `Test` (numbered commands with actual results, including the real HTTP status codes, the real
  generated drafts, and a plain statement that steps 14–18 were not automated here)
- `Needs your attention`