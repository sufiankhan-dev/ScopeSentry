# Task 03 — Report Zod contracts + types + unit tests (no Ollama)

## Goal and user outcome

ScopeSentry has typed input validation (`lib/schemas.ts`) but no contract for what comes
*out* of the model. Without one, the analyze route would eventually hand unvalidated JSON to
the UI, which is exactly how fabricated findings and unsupported classifications reach a user
as if they were verified facts.

This task defines the strict Zod schema and TypeScript types for the full analysis report, so
that any future model output is validated at runtime before it can be displayed. Malformed
data is rejected safely; unsupported classifications and structurally invalid evidence cannot
pass.

Explicitly **out of scope**: Ollama, `lib/ollama.ts`, prompts, API routes, the report UI,
evidence *verification* (quote-matching against source text — the next task), reply
generation, and any new npm dependency.

## Skills and documentation consulted

- `AGENTS.md` — §2 approval workflow, §5 architecture (`lib/schemas.ts`, `tests/`), §6 stack,
  §7 fixed decisions, §8 data contracts, §10 evidence-first, §11 privacy, §13 checks.
- `node_modules/zod` v4.6.7 installed — confirmed `z.strictObject`, `z.discriminatedUnion`,
  `z.prettifyError` exist; `z.string().trim().min().max()` chaining behaves as `lib/schemas.ts`
  already relies on.
- No test-framework skill is installed in this repo or the environment, and no test runner is
  in `package.json`. Verified feasibility of the zero-dependency option below with a throwaway
  spike (since deleted; working tree is clean).

## Existing code inspected

- `package.json` — `next@16.4.1`, `react@19.3.0`, `zod@^4.6.7`, Tailwind v4, ESLint 9.
  Scripts: `dev`, `build`, `start`, `lint`, `typecheck`. **No `test` script, no test runner.**
- `lib/schemas.ts` (30 lines) — `MIN_TEXT_LENGTH = 20`, `MAX_TEXT_LENGTH = 20_000`,
  `SCOPE_CLASSIFICATIONS` (readonly tuple), `ScopeClassification`, `agreementTextSchema`,
  `conversationTextSchema`, `analyzeInputSchema`, `AnalyzeInput`.
- `lib/samples.ts` — `SAMPLE_AGREEMENT` / `SAMPLE_CONVERSATION` (Riverside Coffee Roasters).
  Useful as realistic fixture material for the valid-report test.
- `tsconfig.json` — `strict: true`, `noEmit: true`, `isolatedModules: true`, `include` covers
  `**/*.ts` (so `tests/` is typechecked), alias `@/* → ./*`.
- `eslint.config.mjs` — `next/core-web-vitals` + `next/typescript`, ignores only
  `.next/**`, `out/**`, `build/**`, `next-env.d.ts`.
- Git: branch `master`, HEAD `51dee0d`, clean except untracked `.aider-desk/` (preserve it).
  `.aider-desk/` is the only untracked path.

## Decisions and assumptions

1. **Extend `lib/schemas.ts`; no new schema file.** It already owns `SCOPE_CLASSIFICATIONS`
   and `ScopeClassification`, which the report contracts must reuse. A second file would
   either duplicate the classification tuple or introduce a circular import.
2. **Every object schema is `z.strictObject`.** Unknown keys are rejected rather than
   silently stripped, so a model that invents `legal_status` or misspells `nextStep` fails
   loudly instead of producing a quietly wrong report. Trade-off accepted: one stray field
   fails the whole report object. Documented here because it is deliberate, not an oversight.
3. **Two finding shapes, on purpose.**
   - `modelFindingSchema` — what the model must return. No verification status; the model is
     not trusted to grade itself.
   - `reportFindingSchema` — `modelFindingSchema` plus application-determined `evidenceStatus`
     (`verified` | `partial` | `unverified`) and `evidenceIssues: string[]`, defaulted to
     `[]`. Only the deterministic verifier (next task) may set these. Downgrading a finding
     to `needs_review` is that task's job, not this task's.
4. **Evidence is a strict discriminated object, not a loose string.**
   `evidenceSchema = z.strictObject({ quote: trimmed non-empty string ≤ 2,000 chars, source:
   z.enum(EVIDENCE_SOURCES) })`, `EVIDENCE_SOURCES = ["agreement", "conversation"]`.
   Arrays are capped (evidence ≤ 5 per finding, terms ≤ 25 per category, findings ≤ 50) so a
   runaway or looping model cannot produce an unbounded report.
5. **Required vs optional is driven by "does this affect a user's decision".**
   - A finding requires `title`, `classification`, `explanation`, `nextStep`, and **at least
     one** conversation evidence item (AGENTS §8: "The model must return source quotes for
     conversation-based findings"). `agreementEvidence` is optional and may be empty, because
     AGENTS §8 says "related agreement evidence, **when available**".
   - `impact` and `confidence` are optional (`confidence` validated to 0–1 inclusive when
     present, per AGENTS §8 "only if the model returns a meaningful value validated to a
     defined range"). `confidenceIsEstimate` defaults to `true` so the UI can label it as an
     estimate rather than a calibrated probability.
   - `speaker` on requests/commitments/decisions is optional, and `order` is optional — AGENTS
     §8 forbids inventing speaker identities, dates, or message order. Absence is legal.
   - Agreement-term items carry optional evidence; unstated terms are simply absent, never
     inferred as exclusions.
6. **`findings` allows zero entries.** AGENTS §3 requires a "no findings" UI state, so an
   empty findings array is a valid report, not a validation failure. `.min(1)` would be wrong.
7. **`summary.limitations` is required (min 1).** The user-visible report must carry
   "important limitations" (AGENTS §8), so a model response without them is malformed and
   should hit the "malformed model output" state rather than ship a report that reads as
   authoritative. The future prompt must instruct the model to always emit at least one
   limitation. If demo reliability later proves this too brittle for a 4B model, the fix is a
   prompt change or a documented default — not a silent schema loosening.
8. **Empty-string discipline.** Every free-text field trims first, then enforces a minimum,
   so `"   "` cannot pass as an explanation or quote.
9. **Unique finding ids are enforced** with a single `.superRefine` on the report, since ids
   must be stable within a report (AGENTS §8) and downstream reply generation will key on
   them.
10. **Test runner: Node's built-in `node:test` + `node:assert/strict`. Zero new
    dependencies.** Verified with a deleted spike on Node v24.21.0: TS type stripping is
    on by default, `node --test tests/` discovers `*.test.ts`, and `node:test` runs clean
    under the existing ESLint config. Requirements this implies:
    - Test files import with an explicit `.ts` extension (`../lib/schemas.ts`), which Node ESM
      needs; add `"allowImportingTsExtensions": true` to `tsconfig.json` (legal because
      `noEmit: true` is already set). Verified: without it `tsc` fails with TS5097; with it,
      `npx tsc --noEmit` passes. The `@/*` alias is not resolved by plain `node --test`, so
      tests use relative paths.
    - `"test": "node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/"`. The
      warning flag suppresses the ESM reparse notice for this CommonJS-default package
      without changing the package `type`, which could affect Next/ESLint behavior. Verified
      clean output.
    - Test files use erasable-syntax-only TypeScript (no `enum`, no parameter properties).
11. **Exported types** mirror the schemas 1:1: `Evidence`, `EvidenceSource`, `Deliverable`,
    `Exclusion`, `RevisionLimit`, `Deadline`, `Assumption`, `Ambiguity`,
    `AgreementExtraction`, `ConversationRequest`, `Commitment`, `Decision`,
    `ConversationExtraction`, `ModelFinding`, `EvidenceStatus`, `Finding`, `ReportSummary`,
    `Limitation`, `ScopeReport`.
12. **No logging, no network, no env access.** This task adds zero runtime side effects. Test
    fixtures must be inline strings or reference `lib/samples.ts`; fixture data is synthetic
    sample material only, never a real client's documents.

## Expected files to change

- `lib/schemas.ts` — append the report contracts (constants, evidence, agreement
  extraction, conversation extraction, findings, report) and their exported types. Leave
  lines 1–30 byte-identical; reuse `SCOPE_CLASSIFICATIONS` and `ScopeClassification`.
- `tests/schemas.test.ts` (new) — unit tests listed below.
- `package.json` — add the `test` script only. No dependency or lockfile change.
- `tsconfig.json` — add `"allowImportingTsExtensions": true`.
- `README.md` — optional one-line status/layout note for `tests/` and `npm test`. Omit if the
  existing wording stays accurate.

Nothing else. No route, no component, no `lib/ollama.ts`, no prompt file for inference.

## Functional requirements

- Report schema covers: agreement `deliverables`, `exclusions`, `revisionLimits`,
  `deadlines`, `assumptions`, `ambiguities`; conversation `requests`, `commitments`,
  `decisions`; `findings`; `summary.overview` + `summary.limitations`.
- Each finding carries: stable `id`, `title`, `classification`, `explanation`,
  `conversationEvidence` (≥ 1), optional `agreementEvidence`, optional `confidence`
  (0–1) + `confidenceIsEstimate`, `nextStep`, optional `impact`, and application-set
  `evidenceStatus` / `evidenceIssues`.
- Classification accepts exactly `in_scope`, `potentially_out_of_scope`, `unclear`,
  `needs_review` and nothing else.
- Every evidence item is `{ quote, source }` with `source` limited to `agreement` /
  `conversation`.
- Runtime validation is total: `safeParse` rejects unknown keys, wrong primitive types,
  missing required fields, empty-after-trim strings, out-of-range numbers, oversized arrays,
  and duplicate finding ids.

## Security and privacy requirements

- No model output is trusted to describe its own reliability: `evidenceStatus` lives outside
  `modelFindingSchema` so only application code can assert verification.
- No user text, sample text, or fixture text is logged, persisted, or sent anywhere.
- No `fetch`, no `process.env`, no secrets in the module. Zod messages must not embed the
  rejected values (a rejected quote could be client text) — use static messages and
  `z.prettifyError`/`error.issues` paths only.
- Schema files stay import-safe for both server and client bundles (no `node:` imports, no
  server-only APIs).

## Acceptance criteria

1. All report schemas live in `lib/schemas.ts` and use `z.strictObject` / `z.enum` /
   bounded arrays; no `any`, no `@ts-ignore`, no loose `z.record` or index signatures.
2. `in_scope`, `potentially_out_of_scope`, `unclear`, `needs_review` parse; any other or
   differently-cased classification fails.
3. `confidence` present but outside 0–1, or non-numeric, fails; absence is fine.
4. `modelFindingSchema` has no `evidenceStatus`; `reportFindingSchema` requires it.
5. A finding with `conversationEvidence: []`, a quote that is a number/object, a missing
   `source`, or `source: "email"` all fail.
6. Missing `explanation`, `nextStep`, `title`, `id`, or `classification` fails.
7. Missing `summary.overview` or empty `summary.limitations` fails.
8. Duplicate finding ids fail.
9. `findings: []` parses (no-findings state is valid).
10. A report with an extra unknown key fails.
11. Tests cover: valid full report; all four classifications; invalid enum (wrong value and
    wrong case); each missing required field group; malformed evidence structures (5 cases);
    confidence range; unknown key; duplicate ids; empty findings; optional-field absence.
12. No new npm dependency; `package-lock.json` unchanged; `.aider-desk/` untouched.

## Automated checks and exact manual test steps

Automated (run and record real output):

1. `npm test`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run build`
5. `git diff --stat` and `git status --short` to confirm the diff is limited to the files
   listed above.

Manual (no dev server needed; these are the honest checks for a contract-only task):

1. Read `lib/schemas.ts` top to bottom and confirm lines 1–30 are unchanged and every new
   export is documented by its own section comment.
2. Confirm each schema in the file can be reached from `ScopeReport` (no orphan contract).
3. Confirm no `console.*`, no `fetch`, no `process.env`, and no `node:` import in
   `lib/schemas.ts`.
4. Confirm `tests/schemas.test.ts` contains no real client material — only the Riverside
   sample already committed in `lib/samples.ts` or invented strings.
5. `npx tsc --noEmit` and `npm run build` both pass, so the new schema module compiles into
   the app bundle path without warnings.

## Close-out report format (per AGENTS.md §2)

- `What I did`
- `Test` (numbered commands/steps with actual results)
- `Needs your attention`