# Task 07 — Analysis API route and scope report UI (form wired to real local inference)

## Goal and user outcome

Tasks 03–06 built the contracts, the Ollama client, the three-stage pipeline, and evidence
verification, but all of it is server-side only with no entry point. Pressing **Analyze scope**
currently shows "Analysis engine not connected yet". After this task the button performs a real
analysis against the local Ollama server and the page renders the resulting report: an overall
summary, one finding per client request, a plain-language status label for each of
`in_scope` / `potentially_out_of_scope` / `unclear` / `needs_review`, the verified source quotes
behind it with attribution, the reasoning, a recommended next step, and the report's stated
limitations.

The user must be able to read that on a phone and on a desktop, must be told the truth when
Ollama is down or the model returns something unusable, and must never be shown a report that did
not come from a real run. Their pasted text stays in the form so they can correct it and retry
without retyping.

Explicitly **out of scope**: the reply generator (`app/api/reply`), any persistence, chunking,
authentication, streaming, a preflight `/api/status` route, `getOllamaStatus()` wiring, a cancel
button, a new npm dependency, and any change to the pipeline, prompts, or evidence rules.

## Skills and documentation consulted

- `AGENTS.md` — §2 approval workflow, §3 required UI states and the accuracy rule for the privacy
  indicator, §5 boundaries, §8 comparison steps 5–8, §9 Ollama integration, §10 evidence
  verification and trust ("clearly distinguish source evidence from AI-generated explanation",
  "show the user enough context to judge the finding themselves"), §11 privacy and security
  ("validate all request bodies and enforce input-size limits", "handle errors without returning
  stack traces, secrets, or sensitive content"), §13 checks.
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` — Route
  Handler conventions for this version: Web `Request`/`Response`, `request.json()`,
  `Response.json()`, auto-generated `OPTIONS`, and automatic 405 for undeclared methods.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/connection.md` and
  `.../05-config/01-next-config-js/cacheComponents.md` — `cacheComponents: true` is enabled in
  `next.config.ts`. A `POST` handler is never prerendered and `request.text()` is a
  request-time read, so no `connection()` call is needed; env values are read through the
  dynamic `getOllamaConfig(process.env)` property access in `lib/ollama.ts`, which cannot be
  statically inlined into a bundle.
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (version
  history) and `typedRoutes.md` — `typedRoutes` is not enabled in this repo, so the client calls
  `/api/analyze` as a plain string.
- `.agents/skills/frontend-design/SKILL.md` — restrained, information-encoding structure; no
  decorative motion; failures explained in the interface's voice; visible keyboard focus;
  responsive to mobile; reduced motion respected.
- `.agents/skills/vercel-react-best-practices/SKILL.md` — §5.1 derive during render, §5.8 put
  interaction logic in the event handler (the fetch lives in `onSubmit`), §5.12 lazy state
  initialization, §6.5/§6.6 no storage-driven hydration mismatch, §6.9 explicit conditional
  rendering (`? :` not `&&`), §4.4 version-and-minimize storage (moot: no storage is used, see
  decision 4).
- `.agents/skills/shadcn/SKILL.md` and `components/ui/**` — reuse `Button`, `Field`,
  `FieldDescription`, `FieldError`, `FieldGroup`, `FieldLabel`, `Textarea`, `Separator`, and the
  `cn` helper. No new primitive is installed from the registry.
- Ollama 0.40.4 and `gemma3:4b` (3.12 GB) confirmed installed and answering on
  `http://127.0.0.1:11434`. No `.env.local` exists, so `lib/ollama.ts` defaults apply.
- No Python and no Playwright are available on this machine, so the `webapp-testing` skill's
  browser automation cannot run. Decided with the user before this file was written: test the
  real HTTP path against live Ollama instead (see "Automated checks").

## Existing code inspected

- `lib/schemas.ts` (254 lines) — `MIN_TEXT_LENGTH` 20, `MAX_TEXT_LENGTH` 20 000,
  `analyzeInputSchema`, `scopeReportSchema` (`strictObject(...).superRefine(...)`),
  `reportFindingSchema` (`classification`, `explanation`, `conversationEvidence` min 1,
  `agreementEvidence`, `nextStep`, optional `impact` / `confidence`, `confidenceIsEstimate`,
  `evidenceStatus`, `evidenceIssues`), `EVIDENCE_SOURCES`, `EVIDENCE_STATUSES`,
  `ADVISORY_NOTICE`. Verified during this investigation that `scopeReportSchema` nests inside
  another `strictObject` without losing its refinement, and that issue paths are correctly
  prefixed (`report.agreement`).
- `lib/analysis.ts` (319 lines) — `analyzeScope(input, dependencies)` runs the three stages
  sequentially with `PIPELINE_STAGE_TIMEOUT_MS = 300_000`, returns a `scopeReportSchema`-valid
  report, and throws `AnalyzeInputError` (issues carry only `path` + static `message`) or
  `OllamaError`. `isAnalyzeInputError` is exported. The per-call `ChatJsonMeta` is discarded, so
  the handler reads the model tag from `getOllamaConfig()` itself.
- `lib/ollama.ts` (541 lines) — `getOllamaConfig(env)` → `{ baseUrl, model, timeoutMs,
  keepAlive }`; `OllamaError` with `code`, `retryable`, `httpStatus` and an already
  user-safe static `message` per code; `OLLAMA_ERROR_CODES`; `ERROR_HTTP_STATUS`
  (`config_invalid` 500, `unavailable` 503, `model_missing` 503, `timeout` 504, `bad_request`
  502, `server_error` 502, `malformed_output` 502); `isOllamaError`.
- `lib/evidence.ts` (350 lines) — the guarantees the UI must not contradict: verified quotes are
  the user's own bytes sliced from the original text, an unverifiable quote is preserved exactly
  as the model wrote it and never swapped, findings are downgrade-only, and
  `countUnverifiedExtractionEvidence` feeds a report limitation.
- `lib/prompts.ts`, `lib/samples.ts` — unchanged; `SAMPLE_AGREEMENT` / `SAMPLE_CONVERSATION` are
  the committed Riverside fixtures used for the end-to-end run.
- `components/scope-form.tsx` (255 lines) — `"use client"`, owns `agreement` / `conversation` /
  `touched` / `submitted`, validates with `agreementTextSchema` / `conversationTextSchema` /
  `analyzeInputSchema`, renders the two `01`/`02` cards and the sample loaders, and currently
  renders the hardcoded "Analysis engine not connected yet" block.
- `components/privacy-indicator.tsx` (65 lines) — currently states "Right now nothing you paste
  is stored or sent anywhere — this page makes no network requests… That connection is not wired
  up yet." **This becomes false in this task and must be rewritten.**
- `app/page.tsx` (101 lines) — hero, three "How it works" steps, `<PrivacyIndicator />`, the
  "Your two source documents" section wrapping `<ScopeForm />`, and a footer whose
  "never example analysis results" sentence stays true.
- `app/globals.css` — oklch tokens, `--destructive`, light and dark, `--radius 0.625rem`.
  `components.json` — `base-nova` / base-ui shadcn style, `lucide` icons.
- `tests/` — `node:test` + `node:assert/strict`, `../lib/x.ts` imports with explicit `.ts`, no
  network, no `process.env`. 99 tests currently, all green. `tests/analysis.test.ts` already has
  a reusable stubbed-`fetch` pattern (three canned chat envelopes over the Riverside fixtures).
- `package.json` — `test`, `typecheck`, `lint`, `build`, `dev`. No new dependency.
- `next.config.ts` — `cacheComponents: true`, `partialPrefetching: true`, pinned Turbopack root,
  `experimental.agentFeedback`.
- Git: branch `main`, HEAD `c4c52cc`, working tree clean. Baseline `npm test` 99/99,
  `npm run typecheck` clean, `npm run lint` clean.

## Decisions and assumptions

1. **One shared request/response contract in `lib/schemas.ts`.** `analyzeResponseSchema`
   (`{ report, meta: { model, durationMs } }`) and `analyzeErrorSchema`
   (`{ error: { code, message, retryable, issues? } }`) are Zod schemas used by the handler to
   build the body and by the client to parse it. The client re-validating the entire report with
   `scopeReportSchema` is the enforcement point for "no unvalidated finding reaches the UI".
   `ANALYZE_ERROR_CODES` adds `invalid_request` and `invalid_input` on top of `OLLAMA_ERROR_CODES`
   so the client's union is closed.
2. **The handler lives in `lib/analyze-handler.ts`; `app/api/analyze/route.ts` is a three-line
   wrapper.** The error-mapping code is the security-sensitive part (no echoed text, no endpoint
   leak), so it must be unit-testable with an injected `fetch` rather than by replacing
   `globalThis.fetch`. `route.ts` exports only `POST(request)` delegating to
   `handleAnalyzeRequest(request)`.
3. **The handler enforces its own byte cap before `JSON.parse`.** `MAX_TEXT_LENGTH` (20 000
   chars per field) bounds the *schema*, not the *request body*, so a body full of junk keys
   would still be fully buffered and parsed. `MAX_REQUEST_BODY_BYTES = 512 * 1024` (derived:
   40 000 characters × 3 bytes worst-case UTF-8 × 2 for JSON escaping, rounded up with headroom)
   is checked against the actual read string, and `Content-Length` is rejected early when present
   and over the cap. Malformed JSON and non-object bodies return `invalid_request` (400).
4. **No client storage.** Decided with the user: the pasted text stays in React state on the same
   page. It therefore survives every retry, error, and report render, and is lost only on reload
   or tab close. Nothing is written to `localStorage`, `sessionStorage`, cookies, IndexedDB, or
   any server-side store, so the privacy copy can stay simple and the
   `vercel-react-best-practices` §4.4 storage rules do not apply. No "Clear" button is added.
5. **`meta` carries the model tag and a server-side wall-clock duration, never the endpoint.**
   `getOllamaConfig()` supplies `model`; `Date.now()` deltas around `analyzeScope` supply
   `durationMs`. Displaying "analysed with gemma3:4b" makes the local-processing claim
   checkable by the user. `baseUrl` must never appear in any response, and a test asserts it.
6. **One discriminated union for the client's request state**, in `lib/schemas.ts` as a type:
   `{ status: "idle" }` / `{ status: "running" }` / `{ status: "succeeded", report, meta }` /
   `{ status: "failed", error: AnalyzeFailure }`. Impossible combinations are unrepresentable,
   which is what keeps four separate UI branches honest.
7. **Explicit request state, not `useTransition`.** This departs from
   `vercel-react-best-practices` §6.11 deliberately: the operation is a multi-minute model
   inference with a discriminated success/failure outcome, not a UI transition, and the states
   must render different panels rather than a pending flag. The fetch still lives in the submit
   handler (§5.8), never in an effect.
8. **No cancel button.** A client-side `AbortController` would stop the browser waiting but not
   the inference, so a control labelled "Cancel" would be a lie; doing it properly means
   threading a signal through `OllamaDependencies` and `sendRequest`, which is a separate change
   to tested code. The loading panel instead shows honest elapsed time. Recorded as a known
   limitation in the close-out report.
9. **The loading copy states the real cost.** "2–4 minutes on a CPU-only machine", matching the
   README, plus a live elapsed readout from a `setInterval` that is cleared on unmount and on
   every terminal state, and a sentence naming the actual path the text travels. No spinner-only
   loading state and no claim of instant or offline-capable behaviour.
10. **Display metadata is a pure, tested module.** `lib/report-display.ts` owns
    classification → `{ label, summary, tone }`, evidence status → `{ label, tone }`, source →
    label, and a `countByClassification` helper. No React, no fetch, no env — so the four status
    labels are covered by `node:test` instead of only by eyeballing the UI.
11. **Prose and quotes are visually and structurally separated.** `FindingCard` renders quoted
    evidence in a `<blockquote>` attributed with `<cite>` naming the source ("your conversation" /
    "your agreement"), and renders `explanation` / `impact` / `nextStep` under explicit
    "Reasoning" / "Recommended next step" headings that mark them as the model's reading, not
    verified source text (AGENTS.md §10). `confidence` renders only when present and is always
    labelled an estimate.
12. **A quote that failed verification is shown, not hidden.** Its card carries a warning border
    and lists `evidenceIssues`; the quote is rendered exactly as the model wrote it, never replaced.
    The card never claims a finding is verified while `evidenceStatus !== "verified"`.
13. **Colour is never the only signal.** All four classifications carry a text label; tones are
    subtle background + border + text pairs that work in light and dark using existing tokens
    (`--primary`, `--destructive`, `--muted-foreground`, `--border`), so no new CSS variables are
    added to `globals.css`.
14. **Single-column findings, wrapping summary.** Evidence quotes need full width to stay
    readable, so findings stay one per row at every breakpoint; the summary's stat row becomes a
    two- and four-column grid from `sm` upward. Quotes use `whitespace-pre-wrap` + `break-words`
    so a long pasted line cannot overflow on a phone.
15. **`components/privacy-indicator.tsx` must be rewritten, not extended.** After this task the
    text *is* sent to the Next.js server on this machine, which forwards it to the local Ollama
    server on this machine. The indicator must say exactly that, keep the "local processing is not
    protection against malware, a compromised machine, or a leaked config" caveat, keep the
    "no cloud AI provider, no database, no third-party analytics" line, and keep the note that
    setup downloads need internet access. It must not claim full offline capability, because that
    still has not been verified with the network disconnected.
16. **Accessibility.** `role="status"` + `aria-live="polite"` for loading, `role="alert"` for
    errors, `<ol>`/`<li>` for findings, `<h3>` for each finding title, `<section aria-labelledby>`
    for the report, visible focus inherited from the existing `Button`, and `prefers-reduced-motion`
    respected on the loading indicator.
17. **No `/api/status` route.** `getOllamaStatus()` exists, but an unreachable Ollama fails in
    milliseconds and a missing model returns 404 on the first `/api/chat`, so the analyze error
    path already covers the required "Ollama unavailable or model missing" state without a second
    route. Decided with the user as part of keeping this task to the smallest working change.
18. **Two new test files**, matching the existing `node:test` style: `tests/report-display.test.ts`
    for the pure mapping helpers, and `tests/analyze-handler.test.ts` for the route's status-code
    mapping and redaction, reusing the canned-envelope stubbed-`fetch` approach from
    `tests/analysis.test.ts` and the Riverside fixture wording only.
19. **README gets a status-table update and one short section.** `package.json`, `package-lock.json`,
    `.env.example`, `next.config.ts`, `app/layout.tsx`, and `app/page.tsx` are untouched — no new
    environment variable is needed, and the form renders the report from inside itself.

## Expected files to change

New:

- `app/api/analyze/route.ts` — `POST` only; delegates to the handler.
- `lib/analyze-handler.ts` — body read + cap, JSON parse, `analyzeScope` call, typed-error
  mapping, success body with `meta`. Exports `handleAnalyzeRequest(request, dependencies?)`,
  `MAX_REQUEST_BODY_BYTES`, and the static unknown-error message.
- `lib/report-display.ts` — classification / evidence-status / source display metadata and
  `countByClassification`.
- `components/analysis-panel.tsx` — `"use client"`; switches on the analysis state across the
  empty, loading, error, and report panels.
- `components/scope-report.tsx` — `"use client"`-free presentational report: summary, stat row,
  limitations, findings list, `ADVISORY_NOTICE`.
- `components/finding-card.tsx` — one finding: status label, evidence status, reasoning, attributed
  quotes, evidence issues, impact, next step, optional confidence estimate.
- `tests/report-display.test.ts`, `tests/analyze-handler.test.ts`.
- `prompts/07-analysis-api-and-report-ui.md` (new, this file).

Modified:

- `lib/schemas.ts` — add `ANALYZE_ERROR_CODES`, `analyzeErrorSchema`, `analyzeResponseSchema`,
  `AnalyzeMeta`, `AnalyzeFailure`, `AnalysisState` types. No existing export changes.
- `components/scope-form.tsx` — replace `submitted` with the analysis state, call
  `handleAnalyze` in `onSubmit`, render `<AnalysisPanel>`, keep the text state untouched so it
  survives every outcome.
- `components/privacy-indicator.tsx` — accurate processing-path copy (decision 15).
- `README.md` — status table rows and a short "Analysis API and report UI" subsection.

Untouched: `lib/analysis.ts`, `lib/ollama.ts`, `lib/prompts.ts`, `lib/evidence.ts`,
`lib/samples.ts`, `lib/utils.ts`, `app/page.tsx`, `app/layout.tsx`, `app/globals.css`,
`next.config.ts`, `package.json`, `package-lock.json`, `.env.example`, `components/ui/**`,
`tests/analysis.test.ts`, `tests/evidence.test.ts`, `tests/ollama.test.ts`,
`tests/schemas.test.ts`.

## Functional requirements

- Submitting a valid form performs `POST /api/analyze` with `{ agreement, conversation }`. A
  successful response replaces the previous state with `{ status: "succeeded", report, meta }`.
- The report renders, in order: an overall summary (`summary.overview`, labelled as the model's
  reading), a stat row with the request count and a per-classification count in the fixed
  `SCOPE_CLASSIFICATIONS` order, one finding per request, `summary.limitations`, and
  `ADVISORY_NOTICE`.
- Each finding shows: title, classification label, a one-line plain-language meaning for that
  classification, evidence status, `explanation` as the reasoning, `conversationEvidence` with
  source attribution, `agreementEvidence` with source attribution when non-empty,
  `evidenceIssues` when non-empty, `impact` when present, `nextStep`, and `confidence` only when
  present and always labelled an estimate.
- All four classifications are reachable and visually distinct: `in_scope`,
  `potentially_out_of_scope`, `unclear`, `needs_review`.
- A report with zero findings renders an honest empty result, not a fabricated one, and still
  shows the summary and limitations.
- Required states, all reachable: empty (before any run), loading, connection error
  (`unavailable`, `model_missing`), configuration error (`config_invalid`), timeout (`timeout`),
  invalid response (a 200 body that fails `analyzeResponseSchema`, a non-JSON body, or a `fetch`
  that rejects), and input rejection (`invalid_request` / `invalid_input`, mapped back onto the
  offending textarea).
- The report is readable at 375 px and at 1280 px, with no horizontal overflow from long pasted
  lines. Loading and error states are announced to assistive technology.
- The pasted agreement and conversation remain in the textareas after a success, an error, and an
  invalid response, so the user can correct and retry. Nothing is cleared or refetched
  automatically.

## Security and privacy requirements

- Model calls happen only in `lib/ollama.ts`, server-side. The browser calls only
  `/api/analyze`. No Ollama URL, model-host detail, or `baseUrl` is ever sent to the client; a
  test asserts the success and error bodies contain no `127.0.0.1`, no `localhost`, and no
  `baseUrl` value.
- The request body is size-capped before `JSON.parse`, and `analyzeInputSchema` bounds each field.
- No error response contains the pasted agreement, the pasted conversation, a prompt, model
  output, a stack trace, or an `OllamaError.cause`. `AnalyzeInputError.issues` carry only field
  paths and static messages; unknown throws collapse to one static message. Tests assert this for
  a body containing a distinctive sentinel string.
- The handler logs nothing — no `console.*`, no file writes, no persistence of any kind.
- The response is `Content-Type: application/json` with no `Cache-Control` override that would let
  a shared cache store a report containing client text; send `no-store` on the analyze response.
- The privacy indicator's description of the processing path must be true of the code in this
  diff. No claim that the app works offline, no claim of legal conclusions, and the "local
  processing is not protection against malware or a compromised machine" caveat stays.
- No fabricated or placeholder analysis result may be rendered in any state, including the empty
  state. The word "sample" stays reserved for the input fixtures in `lib/samples.ts`.

## Acceptance criteria

1. `npm test` passes with the existing 99 tests still green and no test weakened or skipped, plus
   new tests covering: all four classification display entries; all three evidence statuses; the
   source labels; `countByClassification` including absent classifications and a zero-finding
   report; the 200 path; `400 invalid_request` for malformed JSON and for an over-cap body;
   `400 invalid_input` for short, missing, and over-length fields; `503 unavailable`; `503
   model_missing`; `504 timeout`; `502 malformed_output`; `502 server_error`; `500 config_invalid`;
   and a generic `500` for an unexpected throw.
2. No error body contains the sentinel client text, a stack trace, or the Ollama endpoint, and the
   success body contains the model tag but not `baseUrl`.
3. `npm run typecheck`, `npm run lint`, and `npm run build` all pass.
4. `git diff --stat` shows changes only in the files listed above, plus `prompts/07-*.md`.
5. `components/privacy-indicator.tsx` no longer claims the page makes no network requests or that
   the connection is not wired up, and its new text matches what the code actually does.
6. The four classifications and the three evidence statuses are visually distinguishable in light
   and dark mode using only existing tokens, with the text label carrying the meaning.
7. No `console.*`, no `localStorage`, no `sessionStorage`, no `indexedDB`, and no fetch other than
   `POST /api/analyze` appears anywhere in the diff.

## Automated checks and exact manual test steps

Automated (run and record real output):

1. `npm test`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run build`
5. `git status --short` and `git diff --stat`
6. `Select-String` over the diff for `console.`, `localStorage`, `sessionStorage`, `indexedDB`,
   `127.0.0.1`, and `localhost` in `app/` and `components/`, confirming only the intended
   privacy-indicator prose mentions a local address in the UI copy, if at all.

End-to-end against live Ollama (the agreed approach, since Python and Playwright are unavailable):

7. Confirm Ollama is up and the model is present:
   `Invoke-RestMethod http://127.0.0.1:11434/api/tags | % { $_.models.name }`
8. Start the app in the background on port 3000 and wait for it to answer:
   `Start-Process npm -ArgumentList "run","dev" -WorkingDirectory . -RedirectStandardOutput dev.log -RedirectStandardError dev.err.log`
   then poll `http://localhost:3000` until it responds.
9. Happy path with the committed Riverside fixtures: POST `{ agreement, conversation }` read from
   `lib/samples.ts` to `/api/analyze`, record the HTTP status and wall-clock duration. Expect 200
   with `meta.model = "gemma3:4b"` and `meta.durationMs` in the expected multi-minute range for
   CPU inference. Assert the response parses with `scopeReportSchema`, contains at least one
   `potentially_out_of_scope` or `unclear` finding, and that every rendered
   `conversationEvidence` / `agreementEvidence` quote is a substring of the pasted source
   (reusing `findExactQuote`).
10. Connection-error path: stop Ollama (`ollama stop` does not stop the server, so kill the
    `ollama serve` process or use `Stop-Process` on the `ollama app.exe`), POST again, and record
    the status and body. Expect `503` with `code: "unavailable"` and a message that names no
    endpoint and contains no client text. Restart Ollama afterwards.
11. Inspect `dev.log` / `dev.err.log` after both runs for any occurrence of the pasted agreement
    or conversation text, and confirm no request left the machine other than to
    `127.0.0.1:11434`.

Manual browser checklist (to be run by the user, recorded honestly in the close-out report as not
automated here):

12. Load `/`, click **Load both samples**, press **Analyze scope**. Confirm the loading panel
    appears with an elapsed counter, then the report.
13. Confirm each finding shows a status label, attributed quotes, reasoning, and a next step, and
    that the summary, stat row, and limitations are visible.
14. Reload the page and confirm the textareas are empty (decision 4), then load the samples again
    and confirm a second run succeeds while Ollama is warm.
15. Narrow the window to 375 px and confirm no horizontal overflow and that quotes wrap.
16. Toggle the OS to dark mode and confirm all four status tones remain legible.
17. Stop Ollama, press **Analyze scope** again, and confirm the connection-error panel appears,
    the pasted text is still in both textareas, and retrying after restarting Ollama works.

## Close-out report format (per AGENTS.md §2)

- `What I did`
- `Test` (numbered commands with actual results, including the real end-to-end status codes and
  durations; state plainly that steps 12–17 were not automated because Python and Playwright are
  not installed on this machine)
- `Needs your attention`