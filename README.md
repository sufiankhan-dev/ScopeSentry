# ScopeSentry

A local-first scope review tool for freelancers. Paste the agreement you signed and the
client conversation; ScopeSentry compares the requests against what was actually agreed,
shows the source text behind every finding, and drafts a reply you can edit.

All AI inference runs on your own machine through Ollama. There is no cloud AI provider
and no database.

## Status

| Area | State |
| --- | --- |
| Input workspace (agreement + conversation, validation, sample data, privacy notice) | Working |
| Report contracts and types (Zod schemas for agreement, conversation, findings, summary) | Working |
| Ollama / Gemma client (`lib/ollama.ts`: config, timeouts, validated JSON, typed errors) | Working |
| Analysis pipeline (prompts, extraction, comparison, evidence verification) | Working |
| Analysis API (`POST /api/analyze`, validated request/response, redacted errors) | Working |
| Scope report UI (summary, per-request findings, status labels, evidence, reasoning, next steps) | Working |
| Reply drafting (`POST /api/reply`, editable client message, unsupported claims discarded) | Working |

Pressing **Analyze scope** runs a real analysis against your local Ollama server and
renders the report. Every finding shows the classification, the source quotes behind
it, the reasoning, and a next step. Findings are advisory review aids, never legal
conclusions.

Every finding also offers an optional **Draft a reply**: the local model writes one
short message from that finding's verified quotes, you edit it, and you send it. The
app never sends anything.

Expect a slow first run: `gemma3:4b` on a CPU-only machine takes roughly eight minutes
end to end, because the pipeline makes three sequential model calls. See
["Tuning for a CPU-only laptop"](#tuning-for-a-cpu-only-laptop) — in particular you
probably need `OLLAMA_TIMEOUT_MS=600000`.

## Requirements

- Node.js 20+ (developed on Node 24, npm 11)
- [Ollama](https://ollama.com/download) running locally on `http://127.0.0.1:11434`
- A Gemma instruction-tuned model pulled locally (see below)

## Setup

### 1. Install Ollama (Windows)

```powershell
winget install --id Ollama.Ollama --exact
```

The installer runs in your user account (no Administrator needed), adds `ollama` to your
user `PATH`, and starts Ollama in the background. Alternative: download
`OllamaSetup.exe` from <https://ollama.com/download>.

Verify it is up:

```powershell
ollama --version
Invoke-RestMethod http://127.0.0.1:11434/api/version
```

### 2. Pull a Gemma model

Model sizes come in instruction-tuned (`-it`) quantised variants. Pick by available RAM,
not VRAM, if you are CPU-only:

| Tag | Download | Context | Use when |
| --- | --- | --- | --- |
| `gemma3:1b` | 806 MB | 32K | Fast smoke tests while building prompts |
| `gemma3:4b` | 3.4 GB | 128K | **Default choice.** Best quality/speed balance |
| `gemma3:12b` | 8.2 GB | 128K | You can accept minutes-long analyses |
| `gemma3:27b` | 17 GB | 128K | Not practical without a large GPU |

```powershell
ollama pull gemma3:4b
ollama list
```

If the model is not listed, inference cannot start — the app will report a missing model
rather than downloading one.

### 3. Configure the app

Copy the example file and edit it if your values differ:

```powershell
Copy-Item .env.example .env.local
```

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma3:4b
# optional: OLLAMA_TIMEOUT_MS=120000, OLLAMA_KEEP_ALIVE=10m
```

`.env.local` is gitignored. Both variables are read server-side only; never prefix them
with `NEXT_PUBLIC_`. See `.env.example` for every supported value.

### 4. Run

```powershell
npm install
npm run dev
```

Open <http://localhost:3000>.

### 5. Confirm Ollama answers a structured request

This is the exact shape ScopeSentry will use — non-streaming, `temperature: 0`, and a JSON
schema in `format`:

```powershell
$body = @'
{
  "model": "gemma3:4b",
  "messages": [{ "role": "user", "content": "List one deliverable from: two page templates, one round of revisions." }],
  "stream": false,
  "format": {
    "type": "object",
    "properties": { "deliverables": { "type": "array", "items": { "type": "string" } } },
    "required": ["deliverables"]
  },
  "options": { "temperature": 0, "num_ctx": 8192, "num_predict": 512 },
  "keep_alive": "10m"
}
'@
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:11434/api/chat -Body $body -ContentType "application/json" |
  Select-Object -ExpandProperty message | Select-Object -ExpandProperty content
```

Expect a JSON object on stdout. If this fails, the model or the server is the problem —
not the app.

## Ollama client

`lib/ollama.ts` is the only module that talks to a model. Route handlers will call it like
this once the analysis pipeline lands:

```ts
const { data, meta } = await chatJson({
  messages,
  schema: agreementExtractionSchema, // the caller's Zod contract
  format: z.toJSONSchema(agreementExtractionSchema), // constrains generation
  options: { num_ctx: 8192 },
});
```

Behaviour worth knowing:

- **One request, one destination.** Only `POST /api/chat` and `GET /api/tags` are ever
  called, always against `OLLAMA_BASE_URL`. No cloud provider, no API key, no
  `Authorization` header, no redirects.
- **Local by default.** The base URL must be a loopback host. Anything else is refused with
  `config_invalid` unless `OLLAMA_ALLOW_NON_LOOPBACK=1` is set deliberately.
- **Never downloads.** There is no `/api/pull` path. A missing model returns `model_missing`
  and names the exact `ollama pull <tag>` command.
- **Always bounded.** Every request is aborted after `OLLAMA_TIMEOUT_MS` (default 120000,
  range 1000–600000); the abort covers reading the response body, not just the handshake.
- **Always validated.** The Ollama envelope is parsed, then `message.content` is parsed as
  JSON and validated by the caller's schema. Anything unexpected becomes
  `malformed_output` and shows no findings.
- **Silent.** No logging, no files, no cross-request cache. Error `message`s are static and
  contain no prompt, no pasted text, no model output, and no endpoint; Ollama's own error
  text is attached as `cause` for the Next.js server console only.

Errors are one `OllamaError` with a `code`, a `retryable` flag, and an `httpStatus` a route
can return as-is:

| Code | HTTP | Retryable | Meaning |
| --- | --- | --- | --- |
| `config_invalid` | 500 | no | `OLLAMA_*` values are unusable |
| `unavailable` | 503 | yes | Ollama is not answering on the local address |
| `model_missing` | 503 | no | The configured tag is not installed |
| `timeout` | 504 | yes | The model took longer than the limit |
| `bad_request` | 502 | no | Ollama rejected the request (HTTP 400) |
| `server_error` | 502 | yes | Ollama failed while generating (HTTP 429/5xx) |
| `malformed_output` | 502 | no | Output did not match the expected contract |

`getOllamaStatus()` is the cheap precheck a route can use for the "Ollama unavailable or
model missing" state: it reads `/api/tags`, never throws, and does not return the endpoint.

## Analysis API

`POST /api/analyze` is the only browser-facing endpoint. It takes
`{ agreement, conversation }` and returns a validated report or a typed error.

`app/api/analyze/route.ts` is a one-line delegation to `lib/analyze-handler.ts`, which
holds the logic so it can be tested against a stubbed `fetch` rather than a real model.

```ts
// 200
{ "report": ScopeReport, "meta": { "model": "gemma3:4b", "durationMs": 485974 } }

// error
{ "error": { "code": "unavailable", "message": "...", "retryable": true } }
```

Both shapes are Zod schemas in `lib/schemas.ts`, and both are checked in **both**
directions: the handler builds through them, and the browser parses through them before
rendering. A 200 whose body fails `analyzeResponseSchema` is treated as an invalid
response rather than partially rendered.

| Situation | Status | `code` |
| --- | --- | --- |
| Success | 200 | — |
| Body is not a JSON object | 400 | `invalid_request` |
| Body over 512 KiB | 413 | `invalid_request` |
| Field too short, too long, or missing | 400 | `invalid_input` (with a `path` per field) |
| `OLLAMA_*` values unusable | 500 | `config_invalid` |
| Ollama not answering | 503 | `unavailable` |
| Model tag not installed | 503 | `model_missing` |
| Model took longer than `OLLAMA_TIMEOUT_MS` | 504 | `timeout` |
| Ollama rejected the request / failed while generating | 502 | `bad_request` / `server_error` |
| Output did not match the contract | 502 | `malformed_output` |

Rules the handler holds to:

- **The body is capped before it is parsed.** `analyzeInputSchema` bounds each *field*,
  which does nothing for a body full of junk keys, so the raw text is measured first.
- **Nothing user-supplied is echoed.** Error bodies carry a code, a static message, and
  field paths. Never the agreement, the conversation, a prompt, model output, an
  `OllamaError.cause`, or a stack trace.
- **`OLLAMA_BASE_URL` never reaches the browser.** `meta.model` is returned on purpose so
  you can see which local model ran; the endpoint is not.
- **Nothing is logged or persisted.** Responses are sent `Cache-Control: no-store` so a
  report containing client text cannot be retained by a cache.

## Client reply drafting

`POST /api/reply` drafts one short message for one finding. The browser sends the
finding's whole context back to the server:

```jsonc
// request
{ "agreement": "...", "conversation": "...", "report": { /* ScopeReport */ }, "findingId": "f1" }

// 200
{ "findingId": "f1",
  "draft": { "intent": "discuss_additional_work", "body": "Hi Priya, ..." },
  "meta": { "model": "gemma3:4b", "durationMs": 41_200 },
  "groundedQuotes": ["Front-end development, CMS configuration, or hosting setup."],
  "droppedQuotes": 0,
  "trimmed": false }
```

The two pasted documents travel with the report on purpose. `evidenceStatus` is a flag
the browser sent, and a flag is not evidence: the route re-checks every quote the
finding cites with the same `findExactQuote` used by the report, and hands the model only
the quotes that matched. A doctored report, or a finding with nothing checkable left,
gets `422 missing_context` **before any model call**.

`draft.intent` is one of `clarify_scope`, `ask_question`, `discuss_additional_work`, so the
UI can say what the message is for instead of printing a contract value.

| Situation | Status | `code` |
| --- | --- | --- |
| Success | 200 | — |
| Body is not a JSON object | 400 | `invalid_request` |
| Body over 1 MiB | 413 | `invalid_request` |
| Input fails the reply contract | 400 | `invalid_input` |
| Nothing in the finding could be verified | 422 | `missing_context` |
| Draft asserted something unsupported | 502 | `draft_rejected` |
| `OLLAMA_*` unusable / Ollama not answering / model missing | 500 / 503 / 503 | `config_invalid` / `unavailable` / `model_missing` |
| Timeout, Ollama failure, output not matching the contract | 504 / 502 / 502 | `timeout` / `server_error` / `malformed_output` |

### The draft is discarded, not flagged

The model is asked not to invent a fee, a deadline, a clause, or a promise. Four
deterministic checks in `lib/reply.ts` then hold it to that, and **any failure throws the
whole draft away** — a warning attached to a draft is the thing most likely to be skimmed
past on the way to the outbox:

| Check | Rejects |
| --- | --- |
| `findUnsupportedFigures` | A price or date that is not in the two documents (the same patterns that downgrade a finding) |
| `findUnsupportedQuotations` | Any `"…"` span that is not in the two documents — the anti-fabricated-clause rule |
| `findForbiddenPhrasing` | Accusations and legal language, promises in the freelancer's own voice ("I will deliver…"), and `[Name]` / `{{…}}` placeholders |

The response then carries one static message and no part of the draft. The phrasing
lexicon is a heuristic, not a judgement — it catches the constructions that matter and
will miss a deliberate rephrasing, which is why the composer keeps saying to read the
draft before sending it.

One repair is deliberately *not* a discard: `trimDegenerateTail` cuts off whatever the model
spilled after the message and the response says `trimmed: true`. A reply is the only output in
this app that is long free prose, and `gemma3:4b` on llama.cpp reliably runs past the end of
it — once closing the JSON inside the body and then reciting the drafting rules back, once
emitting a word count and looping on it. Both shapes still validate, because the spill stays
inside the body string, so without the repair the tail reaches the user's textarea. Trimming
can only remove text, so it cannot introduce a claim the documents do not support, and the
guards run on the trimmed body.

Two consequences are documented in `lib/reply.ts` because they are not obvious:

- `REPLY_OPTIONS.num_predict` is **900**, not a tight budget. The failure mode was the
  opposite of running out of room: the model needed one more token to close the JSON object
  and did not get it, so the draft came back `malformed_output`.
- `repeat_penalty` is **not** raised. At 1.15 the drafts came back clean, but Ollama's own
  sampler then aborted most later runs with `prediction aborted, token repeat limit reached`,
  which reaches the user as `server_error`. A tail we can trim beats a hard failure.

### Nothing is ever sent

There is no `mailto:`, no SMTP, no outbound request other than `POST /api/reply`, and no
integration of any kind. The draft lands in an editable `<textarea>` with a copy button,
labelled "Draft — not sent", next to the verified quotes it was written from. Editing
your own wording does not disable regenerate, but the button relabels itself so a
regeneration cannot silently overwrite it.

### Known limitation on a CPU-only machine

Measured on this box with `gemma3:4b`: six live drafts, five came back clean in 11–25 s, and
one returned `malformed_output` and then succeeded on the second press. When the model runs
past the end of the message it can spend the whole token budget and never close the JSON,
which arrives as "the local model returned output ScopeSentry could not validate" next to a
**Try again** button. A larger model or a GPU is the real fix; a different `num_predict` is
not — see `REPLY_OPTIONS` for what was tried and what was measured.

## Analysis pipeline

`lib/analysis.ts` turns one agreement and one conversation into a validated `ScopeReport`.
Nothing is wired to the UI yet: this is the server-side pipeline a route will call.

```ts
import { analyzeScope } from "@/lib/analysis";

const report = await analyzeScope({ agreement, conversation });
// report satisfies z.infer<typeof scopeReportSchema>
```

Three calls to the local model, in this order:

1. **Agreement terms** — deliverables, exclusions, revision limits, deadlines, assumptions,
   ambiguities (`agreementExtractionSchema`).
2. **Conversation items** — client requests, freelancer commitments, decisions
   (`conversationExtractionSchema`).
3. **Comparison** — one finding per request plus the report summary, given the two validated
   extractions rather than the pasted text so the context stays inside a CPU-sized `num_ctx`.

The three calls run one after another. A local Ollama server generates a single request at a
time on CPU, so overlapping them only makes the second one queue behind the first and hit the
per-call timeout.

Every prompt lives in `lib/prompts.ts`. Documents are fenced and labelled as untrusted data, and
each stage is told to ignore instructions found inside them.

What the application checks after the model answers:

| Check | Result when it fails |
| --- | --- |
| Quote found in the pasted text (`lib/evidence.ts`) | `evidenceStatus` becomes `partial` or `unverified`, an issue is recorded, and an `unverified` finding is downgraded to `needs_review` |
| Price or date that appears in neither document | Finding downgraded to `needs_review` |
| Every quote verified | Classification is left exactly as the model returned it |
| Extracted request with no finding | Counted in a report limitation as uncovered |
| Agreement term whose quote cannot be found in the document it names | Counted in a report limitation as unverified |
| Comparison context shortened by the item bounds | Counted in a report limitation |
| Whole report | Re-validated with `scopeReportSchema`; a failure is `malformed_output` |

Deliberate limits: every quote is checked only against the source it declares, and matching is
case-, whitespace-, and punctuation-tolerant, but a matched quote is always sliced out of the
original text, so the report shows your own bytes; a quote with no letters or digits never counts
as evidence; an unverifiable quote is kept and labelled rather than silently deleted, so you can
judge the claim, and is never swapped for a similar sentence from your document; the pipeline only
ever downgrades a classification, never upgrades one; and input over 20,000 characters per field is
rejected instead of truncated.

Failures are typed: `AnalyzeInputError` for input that is too short, too long, or missing (it
never contains your text), and `OllamaError` for everything model-side.

## Tuning for a CPU-only laptop

Ollama only uses CUDA (NVIDIA) or ROCm/Vulkan (AMD) on Windows. On Intel integrated
graphics it falls back to CPU inference, which is fine but slow and RAM-bound.

- **Context:** default is 4096. Use `options.num_ctx: 8192` for the MVP; large contexts
  slow CPU generation sharply. Input fields are capped at 20,000 characters each.
- **Repetition:** long free-text generations can run past the end of the answer on llama.cpp.
  The reply stage handles that with a 900-token budget plus `trimDegenerateTail`, and does
  *not* raise `repeat_penalty` — at 1.15 Ollama's own sampler aborted most later runs with
  `token repeat limit reached`. The analysis stages never run long enough to need either.
- **Timeout:** a full analysis is three sequential calls, so the per-call budget is the
  whole-run budget in practice. Measured on a CPU-only Windows box, `gemma3:4b` generated
  at roughly 7 tokens/second and one complete run took about 8 minutes, which does **not**
  fit the default 120 s. Set `OLLAMA_TIMEOUT_MS=600000` (the maximum) or drop to
  `gemma3:1b` while iterating.
- **Scripting the endpoint from Node:** Node's built-in `fetch` has a 300 s default headers
  timeout, shorter than a slow full run. Browsers do not have that limit, so this only
  affects scripted calls — use `node:http` for them.
- **Keep the model warm:** `keep_alive: "10m"` (default is 5m) avoids reloading 3.4 GB on
  every request. `ollama ps` shows what is resident and where.
- **Stop it when done:** `ollama stop gemma3:4b`.
- Server-level equivalents (user environment variables, then restart Ollama):
  `OLLAMA_CONTEXT_LENGTH`, `OLLAMA_KEEP_ALIVE`, `OLLAMA_NUM_PARALLEL=1`,
  `OLLAMA_MAX_LOADED_MODELS=1`.
- Expect tens of seconds per model call on CPU, and roughly two to four minutes for a full
  three-stage analysis. Budget for that in the UI's loading state rather than pretending it is
  instant.

## Privacy

- Inference goes to `OLLAMA_BASE_URL` and nowhere else. Keep it on loopback; Ollama binds
  `127.0.0.1:11434` by default and must not be exposed to a network.
- Disable Ollama's optional cloud features so a local-only install cannot reach ollama.com
  at runtime:

  ```powershell
  [Environment]::SetEnvironmentVariable("OLLAMA_NO_CLOUD", "1", "User")
  ```

  Then quit and relaunch Ollama. `ollama ps`/the startup log should confirm it.
- Model downloads need internet access once. Offline use after that has to be verified by
  actually disconnecting; it has not been tested in this repository yet.
- Nothing is persisted: no database, no files written with your pasted text, and nothing
  written to `localStorage`, `sessionStorage`, or cookies. The report and your pasted text
  live only in the open tab, which is why a reload clears them.
- Drafting a reply re-sends the two documents to the same local endpoint for verification,
  so a report you are still looking at cannot be used to draft from invented evidence.
- ScopeSentry has no outbound path of any kind: it cannot email, message, or otherwise
  contact anyone, and no draft is sent anywhere.
- Local processing does not protect against malware, a compromised machine, or a leaked
  `.env`. Do not paste a client's confidential material without their permission.

## Project layout

```text
app/          route shell, layout, global tokens (Tailwind v4 + shadcn), api/analyze/, api/reply/
components/   ui/ shadcn primitives, scope-form.tsx client form, analysis-panel.tsx (the four
              analysis states), scope-report.tsx, finding-card.tsx, reply-composer.tsx,
              privacy-indicator.tsx
lib/          schemas.ts (Zod contracts), ollama.ts (server-only Ollama client), prompts.ts
              (all model prompts), analysis.ts (pipeline), evidence.ts (quote verification),
              analyze-handler.ts (POST /api/analyze), report-display.ts (status labels),
              reply.ts (reply drafting + draft guards), reply-handler.ts (POST /api/reply),
              samples.ts
prompts/      one task prompt per implementation step, per AGENTS.md
tests/        node:test unit tests (no test framework dependency)
```

## Scripts

```powershell
npm run dev     # dev server
npm run build   # production build
npm run start   # serve the production build
npm run lint    # eslint
npm run typecheck # tsc --noEmit
npm test        # node:test (schema contracts, Ollama client, evidence verification, pipeline, reply drafting)
```

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ollama` not recognised in the terminal | PATH not refreshed | Open a new terminal, or reinstall; binaries live in `%LOCALAPPDATA%\Programs\Ollama` |
| Connection refused on `127.0.0.1:11434` | Ollama not running | Start it from the Start menu, or `ollama serve` |
| `model not found` in the API response | Tag mismatch | `ollama list` and set the exact tag in `OLLAMA_MODEL` |
| `config_invalid` about a local server | `OLLAMA_BASE_URL` is not loopback | Use `127.0.0.1`/`localhost`, or set `OLLAMA_ALLOW_NON_LOOPBACK=1` deliberately |
| `timeout` after a long wait | CPU inference slower than `OLLAMA_TIMEOUT_MS` | Raise it (max 600000), or use a smaller tag such as `gemma3:1b` |
| Very slow responses | CPU inference, large `num_ctx` | Drop to `gemma3:1b` for iteration, lower `num_ctx`, trim pasted text |
| Out of disk space | Models in `C:\Users\<you>\.ollama` | Set `OLLAMA_MODELS` to a larger drive, then restart Ollama |

Logs: `explorer %LOCALAPPDATA%\Ollama` (`server.log`, `app.log`).

## Agent workflow

This repository follows `AGENTS.md`: one task at a time, an implementation prompt written
to `prompts/` and approved before code changes, and checks recorded per task.