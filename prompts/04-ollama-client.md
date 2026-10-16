# Task 04 — Server-side Ollama client (config, timeouts, typed errors, tests)

## Goal and user outcome

ScopeSentry currently has no way to talk to Ollama. The input screen tells the user the
analysis engine is not connected yet. This task builds the **only** module that will ever
call Ollama: a small, server-side, dependency-free TypeScript client that reads its endpoint
and model from environment variables, refuses to reach a non-local host, aborts slow calls,
returns validated JSON, and converts every failure into a typed, user-safe error.

After this task there is still no analysis pipeline and no UI change on purpose. What exists
is a client that a route handler can call in one line and that cannot leak pasted client text,
cannot silently download a model, and cannot fall back to a cloud provider.

Explicitly **out of scope**: `lib/prompts.ts`, `lib/analysis.ts`, `lib/evidence.ts`, any
`app/api/**` route, the report/reply UI, evidence verification, and new npm dependencies.

## Skills and documentation consulted

- `AGENTS.md` — §2 approval workflow, §5 responsibilities (`lib/ollama.ts` server helper),
  §7 fixed decisions, §9 Ollama integration rules, §10 evidence-first, §11 privacy,
  §13 checks, §15 "inspect before changing".
- `node_modules/next/dist/docs/` (Next 16.4.1, read-only inspection):
  - `01-app/02-guides/environment-variables.md` — non-`NEXT_PUBLIC_` variables are server-only.
  - `01-app/02-guides/data-security.md` — "Next.js handles `server-only` imports internally",
    and the documented alternative of a data-access layer that is the only place reading
    `process.env`.
- Ollama official API docs (`https://docs.ollama.com/`, `llms.txt` index):
  - `api/chat` OpenAPI schema: request `model`, `messages[]`, `format` (`"json"` or a JSON
    Schema object), `options` (`temperature`, `num_ctx`, `num_predict`, `seed`, `stop`),
    `stream` (default `true`), `keep_alive`; response `model`, `message.role`,
    `message.content`, `done`, `done_reason`, `total_duration`, `eval_count`.
  - `api/errors.md` — status codes `200/400/404/429/500/502`; error body is
    `{"error": "..."}`.
  - `capabilities/structured-outputs` — pass the JSON Schema in `format`, set
    `temperature: 0`, and still validate the parsed result.
- Live local Ollama on this machine (probed, not guessed):
  - `GET /api/version` → `{"version":"0.40.4"}`.
  - `GET /api/tags` → exactly one model, `gemma3:4b` (3.9B, family `gemma3`) — the
    "already installed locally" model this task must target.
  - `POST /api/chat` with an unknown tag → `404` and
    `{"error":"model 'gemma3:404b' not found"}` (note single quotes in 0.40.x; older
    builds used double quotes, so no parsing may depend on the quote style).
- `zod@4.6.7` installed — `z.strictObject`, `z.enum`, `z.prettifyError` confirmed.
  `z.toJSONSchema()` on a `strictObject` + `superRefine` schema returns valid JSON Schema
  (refinements dropped) — relevant to the *next* task, not this one.
- No Ollama skill is installed in `.agents/skills` or the environment, so the official
  docs above are the source of truth. Repo skills (`frontend-design`, `shadcn`,
  `vercel-react-best-practices`, `webapp-testing`) are not relevant to a server module.

## Existing code inspected

- `package.json` — `next@16.4.1`, `react@19.3.0`, `zod@^4.6.7`; scripts `dev`, `build`,
  `start`, `lint`, `test` (`node --test … tests/**/*.test.ts`), `typecheck`. Node 24.21.0,
  npm 11.19.0. **No new dependency needed.**
- `lib/schemas.ts` — input + report Zod contracts. This task imports nothing from it and
  changes nothing in it; the generic client accepts any caller-supplied schema.
- `lib/samples.ts`, `app/page.tsx`, `components/scope-form.tsx`,
  `components/privacy-indicator.tsx` — current UI state ("engine not connected").
- `tests/schemas.test.ts` (387 lines) — established `node:test` + `node:assert/strict`
  style, explicit `.ts` import extensions, erasable-syntax-only TypeScript.
- `tsconfig.json` — `strict`, `noEmit`, `allowImportingTsExtensions`, `@/* → ./*`.
- `next.config.ts` — `cacheComponents`, `partialPrefetching`, `turbopack.root` pinned.
- `.env.example` — already has `OLLAMA_BASE_URL` / `OLLAMA_MODEL`; this task extends it.
- `README.md` — status table row "Ollama / Gemma analysis: Not wired up yet", setup,
  tuning, troubleshooting. This task updates those few lines only.
- Git: branch `master`, HEAD `eb61344`, clean except untracked `.aider-desk/` (preserve).

## Decisions and assumptions

1. **One module: `lib/ollama.ts`.** No `lib/ollama/` folder. It owns config resolution, the
   HTTP call, response validation, and the error taxonomy. `lib/prompts.ts` and
   `lib/analysis.ts` will import from it; they do not exist yet.
2. **Config is read per call from an injectable `env`, never at module scope.**
   `getOllamaConfig(env = process.env)` is a pure function so tests pass a literal object
   (no `process.env` mutation, no import-order coupling, no cached module state that a
   later test could poison). Env is read on the server only.
3. **Defaults live in exactly one exported place:** `DEFAULT_OLLAMA_BASE_URL =
   "http://127.0.0.1:11434"` and `DEFAULT_OLLAMA_MODEL = "gemma3:4b"`. `gemma3:4b` is
   chosen because it is the model already installed on this machine (`/api/tags`), matching
   the README's "default choice". `OLLAMA_MODEL` overrides it. No model name is hardcoded
   anywhere else in the repo.
4. **Loopback-only by default, with an explicit escape hatch.** `OLLAMA_BASE_URL` must use
   `http:`/`https:`, carry no credentials, no query, and no fragment, and its host must be
   loopback (`localhost`, `127.0.0.0/8`, `::1`). A non-loopback host is rejected with
   `config_invalid` unless `OLLAMA_ALLOW_NON_LOOPBACK=1` is set. Rationale: AGENTS §11
   ("inference must go only to the configured local Ollama service", "do not expose an
   Ollama service to a public network"). A misconfigured base URL is exactly how pasted
   client text would leave the machine, so the safe default must be the enforced one. The
   escape hatch keeps a deliberate LAN/Docker setup possible instead of an unfixable app.
5. **Timeouts are enforced, not advisory.** Default `120_000` ms
   (`OLLAMA_TIMEOUT_MS`, integer 1_000–600_000) because CPU inference of `gemma3:4b` is
   expected to take tens of seconds (README "Tuning"). A per-call `timeoutMs` may lower or
   raise it. Implementation is `AbortController` + `setTimeout`, cleared in `finally`, and
   the timeout is identified by our own `timedOut` flag rather than by sniffing the thrown
   error type (deterministic across Node versions and stubbed fetches).
6. **Non-streaming, schema-constrained, deterministic.** Every request sends
   `stream: false`, `options.temperature: 0` (caller may override other `options`),
   `keep_alive: "10m"` to keep a 3.4 GB model warm, and `format` when the caller supplies a
   JSON Schema. `Authorization` is never sent — the local server needs none, and sending
   one would be the first step toward a cloud fallback.
7. **The client never downloads anything.** Only `GET /api/tags` and `POST /api/chat` are
   implemented. There is no `pull` code path, no retry-on-404, no auto-unload
   (`keep_alive: 0`) trick. A missing model is an error the user resolves with
   `ollama pull`.
8. **Error taxonomy is a closed set, mapped to one curated message per code.**
   `OllamaErrorCode` = `config_invalid | unavailable | model_missing | timeout |
   bad_request | server_error | malformed_output`. Each `OllamaError` carries `code`,
   `retryable`, `httpStatus`, and a static user-safe `message`. The server's raw
   `{"error": …}` body and the `fetch` exception are attached only as `cause` for the
   Next.js server console; they are never placed in the message, so a route can serialize
   the error without a redaction step. `message` never embeds the prompt, the response
   body, or the URL.
9. **Response validation is total and happens twice.** (a) The chat envelope is parsed by a
   Zod `strictObject` (`model`, `message.content`, `done`, `done_reason`, `eval_count`,
   `total_duration`); anything else → `malformed_output`. (b) `message.content` is
   `JSON.parse`d and then validated by the caller's Zod schema; a non-JSON or non-conforming
   payload → `malformed_output`. This is AGENTS §9 ("validate even when constrained output
   is used"). `format` (JSON Schema) and the validating schema are both caller-supplied, so
   this module stays free of analysis-specific knowledge.
10. **`fetch` is injected, defaulting to `globalThis.fetch`.** Every exported async function
    takes an optional deps argument `{ fetch?, env? }`. This is what makes success /
    timeout / connection-failure / malformed-output tests deterministic and offline.
11. **No logging at all, and no global handlers.** The module contains zero `console.*`.
    It writes nothing to disk, keeps no module-level mutable state, and has no fallback
    path to any remote host — a single `fetch` to the configured local origin.
12. **`getOllamaStatus()`** (config + `/api/tags` reachability + is the configured model
    present) is included because AGENTS §3 requires an "Ollama unavailable or model missing"
    UI state, and the next task needs a cheap, download-free precheck. It is the same code
    path tests already cover.
13. **No `import "server-only"`.** Next 16 resolves that specifier internally, but the
    package is not in `node_modules`, so `node --test tests/ollama.test.ts` would fail with
    `ERR_MODULE_NOT_FOUND`. Server-only-ness is enforced instead by construction: nothing
    under `components/` imports this module, no value crosses a route response except the
    caller-selected data, and a source-level tripwire test asserts the module contains no
    `NEXT_PUBLIC_` reference, no `console.`, and no external hostname literal.
14. **User-facing messages are honest.** `unavailable` says Ollama is not reachable at the
    configured loopback endpoint and to start it; `model_missing` names the configured tag
    and the exact `ollama pull <tag>` command; `timeout` says the local model took too long
    and suggests a smaller model tag. None of them claim the work was done or stored.
15. **Test runner unchanged.** `tests/ollama.test.ts` matches the existing
    `tests/**/*.test.ts` glob, uses `node:test` + `node:assert/strict`, erasable syntax
    only, relative `.ts` imports.

## Expected files to change

- `lib/ollama.ts` (new) — the whole client: constants, `getOllamaConfig`, `OllamaError`,
  `getOllamaStatus`, `chatJson`, private fetch/envelope helpers.
- `tests/ollama.test.ts` (new) — unit tests listed below.
- `.env.example` (edit) — add `OLLAMA_TIMEOUT_MS`, document
  `OLLAMA_ALLOW_NON_LOOPBACK`, keep the file secret-free, state that values are read
  server-side only.
- `README.md` (edit) — status table row, one short "Ollama client" subsection (error codes,
  `npm test` now covers the client), troubleshooting rows for timeout / non-loopback URL.
  No rewrite of setup steps.

Nothing else. No route, no component, no prompt-for-inference module, no `package.json`
change, no lockfile change.

## Functional requirements

- `OLLAMA_BASE_URL` and `OLLAMA_MODEL` read from the environment; documented defaults;
  config errors are typed, not thrown as generic exceptions.
- `chatJson({ messages, format?, options?, timeoutMs?, schema })` returns
  `{ data, meta: { model, doneReason, evalCount, totalDurationMs } }` with `data` fully
  validated by the caller's schema.
- Every request: `stream: false`, `keep_alive: "10m"`, `temperature: 0` by default, no
  `Authorization` header, `Content-Type: application/json`.
- Timeout aborts the in-flight request and yields `code: "timeout"`, `retryable: true`.
- Connection failure (refused/DNS/socket) yields `code: "unavailable"`, `retryable: true`.
- `404` on chat yields `code: "model_missing"`, `retryable: false`, message naming the tag
  and `ollama pull <tag>`.
- `400` → `bad_request`, `429/5xx` → `server_error`, both `retryable` per status
  (`429` and `502` yes, `500` yes, `400` no).
- Non-JSON envelope, missing/blank `message.content`, or payload failing the caller's
  schema → `code: "malformed_output"`, `retryable: false`.
- `getOllamaStatus()` reports `{ baseUrlOrigin, model, reachable, modelInstalled }` and
  never throws.

## Security and privacy requirements

- No `console.*`, no `process.stdout/stderr` writes, no file writes, no metrics.
- No agreement text, conversation text, prompt, or generated reply appears in any log,
  error `message`, or error `code` string. Test fixtures use the committed Riverside sample
  or invented strings only.
- Requests only ever go to the configured origin; loopback is enforced by default (§4).
- No `Authorization` header, no API key, no cloud URL, no `/api/pull`, no retry that could
  reroute to a remote model.
- Nothing is persisted or cached across requests.
- Errors carry no stack traces into user-facing text; `cause` is the only debug channel.

## Acceptance criteria

1. `lib/ollama.ts` exports: the three defaults, `getOllamaConfig`, `OllamaError`,
   `OllamaErrorCode`/`OLLAMA_ERROR_CODES`, `getOllamaStatus`, `chatJson`, and their
   TypeScript types. No other module in the repo may read `OLLAMA_*`.
2. Only `/api/chat` and `/api/tags` are ever requested (asserted by test).
3. No `console.*`, no `NEXT_PUBLIC_`, no `http(s)://` literal other than the documented
   loopback default, no `import "server-only"`, no `node:` imports in `lib/ollama.ts`.
4. Config: unset vars → defaults; valid override → used; `ftp://`, credentialed URL,
   query/hash URL, non-loopback host (without the escape hatch), empty/oversized model tag,
   non-numeric or out-of-range `OLLAMA_TIMEOUT_MS` all produce `config_invalid`.
5. Success path returns schema-validated data plus metadata, and the captured request body
   contains `stream: false`, the configured model, and `temperature: 0`.
6. Timeout, connection failure, `404`, `429`, `500`, non-JSON envelope, blank content,
   non-JSON content, and schema-mismatched content each map to the documented code with the
   documented `retryable` value; no raw server body leaks into `message`.
7. `.env.example` documents all four variables, contains no secrets, and is not renamed.
8. Tests: no network, no `process.env` mutation, deterministic, `npm test` green.
9. No new dependency; `package-lock.json` untouched; `.aider-desk/` untouched.

## Automated checks and exact manual test steps

Automated (run and record real output):

1. `npm test`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run build`
5. `git diff --stat` and `git status --short` — diff limited to the four files above.

Manual, against the **real local Ollama 0.40.4** with `gemma3:4b` installed:

1. Confirm the client reaches the live server end to end with a throwaway script (deleted
   afterwards) that imports `lib/ollama.ts` through `node --experimental-strip-types` /
   `tsx`-free invocation, sets `OLLAMA_MODEL=gemma3:4b`, calls `chatJson` with a tiny
   schema (`{ ok: boolean }`), and prints only `data` + `meta` — never the prompt.
2. `getOllamaStatus()` against the live server → `reachable: true`,
   `modelInstalled: true`.
3. Set `OLLAMA_MODEL=gemma3:404b` (not installed) → `model_missing`, message names
   `gemma3:404b` and `ollama pull gemma3:404b`. Confirm no model is downloaded and
   `GET /api/tags` still lists only `gemma3:4b`.
4. Stop Ollama (or point `OLLAMA_BASE_URL` at `http://127.0.0.1:1`) → `unavailable` with no
   stack trace; confirm no request is attempted anywhere else.
5. Point `OLLAMA_BASE_URL` at a non-loopback host → `config_invalid` mentioning the loopback
   rule; with `OLLAMA_ALLOW_NON_LOOPBACK=1` the same URL is accepted by config (the call is
   then expected to fail as `unavailable`).
6. Read `lib/ollama.ts` top to bottom and confirm every AGENTS §11 item: no logging, no
   persistence, loopback enforcement, no pull, no cloud host.
7. `npm run build` output inspected for any client-side exposure of `OLLAMA_*`.

## Close-out report format (per AGENTS.md §2)

- `What I did`
- `Test` (numbered commands/steps with actual results)
- `Needs your attention`