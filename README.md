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
| Analysis pipeline (prompts, extraction, comparison, evidence verification) | Working (server-side only; no route or UI yet) |
| Scope report UI, reply drafting, API routes | Not built yet |

The input screen is honest about this: pressing **Analyze scope** says the analysis engine
is not connected yet instead of showing fake results. Each field shows a realistic sample
placeholder and a labeled one-click sample loader. Findings are advisory review aids,
never legal conclusions.

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
- Nothing is persisted: no database, no files written with your pasted text.
- Local processing does not protect against malware, a compromised machine, or a leaked
  `.env`. Do not paste a client's confidential material without their permission.

## Project layout

```text
app/          route shell, layout, global tokens (Tailwind v4 + shadcn)
components/   ui/ shadcn primitives, scope-form.tsx client form, privacy-indicator.tsx
lib/          schemas.ts (Zod contracts), ollama.ts (server-only Ollama client), prompts.ts
              (all model prompts), analysis.ts (pipeline), evidence.ts (quote verification), samples.ts
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
npm test        # node:test (schema contracts, Ollama client, evidence verification, pipeline)
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