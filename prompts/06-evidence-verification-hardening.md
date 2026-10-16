# Task 06 — Evidence verification hardening (declared-source checks, whitespace, missing/unaltered-quote tests)

## Goal and user outcome

Task 05 already shipped deterministic evidence verification in `lib/evidence.ts`, and
`analyzeScope()` runs every finding through it before a report can be built. This task does not
rebuild that; it closes the three gaps that probing the current verifier actually found, and it
locks the behaviour down with the test cases the requirement names explicitly.

After this task: a quote verifies only against the source it declares, leading or trailing
whitespace around a quote is tolerated instead of failing, and there is a test proving each of
exact match, altered quote, wrong source, missing evidence, and whitespace handling.

Explicitly **out of scope**: `app/api/**` routes (decided this session: library + tests only),
the report UI, reply generation, chunking, persistence, and any new npm dependency.

## Skills and documentation consulted

- `AGENTS.md` — §2 approval workflow, §10 evidence verification and trust ("the model must
  return source quotes… application code must verify the quote exists… if verification fails do
  not show the finding as verified; mark it `needs_review`"), §8 comparison steps 6–7, §13 checks.
- `node_modules/next/dist/docs/` — not re-read: this task adds no route, no server action, and
  no client component, so no Next.js API surface changes.
- No Ollama/scope-analysis skill is installed in this repo or environment, so nothing was loaded
  for it. This task makes **no model call and changes no prompt**, so no Ollama documentation was
  needed either.

## Existing code inspected

- `lib/evidence.ts` (336 lines, Task 05) — `normalizeForMatching` (case-folded, typographic
  punctuation folded, whitespace runs collapsed, plus an index map back to original offsets),
  `findExactQuote`, `verifyEvidenceList` (private), `verifyFinding`,
  `countUnverifiedExtractionEvidence`, `CONCRETE_TERM_PATTERNS`.
- `lib/schemas.ts` — `evidenceSchema` (`quote` is `.trim()`ed, `source` is
  `"agreement" | "conversation"`), `modelFindingSchema` (`conversationEvidence` `.min(1)`,
  `agreementEvidence` defaults to `[]`), `reportFindingSchema` adds `evidenceStatus` +
  `evidenceIssues`.
- `lib/analysis.ts` — `analyzeScope()` maps every model finding through `verifyFinding`;
  `buildApplicationLimitations()` is the single caller of
  `countUnverifiedExtractionEvidence(agreementExtraction, "agreement", sources.agreement)`.
- `tests/evidence.test.ts` (377 lines) — 24 tests: normalization/index-map, exact match,
  case+whitespace+typographic tolerance, smart quotes, not-found, blank quotes, wrong-document
  quotes, fabricated quote → `unverified`/`needs_review`, partial, downgrade-only, invented
  price/date guard, extraction counting, and a source-level tripwire test.
- `package.json` — `test` (`node --test … "tests/**/*.test.ts"`), `typecheck`, `lint`, `build`.
  No new dependency.
- Git: branch `master`, HEAD `892dd1d`, working tree clean except untracked `.aider-desk/`
  (preserve).

## Gaps found by probing the current code (all reproduced before writing this file)

1. **A quote with leading whitespace fails to verify.** `findExactQuote("We need an online
   ordering page", "  We need an online ordering page")` returns `{ found: false }` when the
   quote sits at the very start of a document, because the folded needle keeps its leading space
   while the folded haystack does not. Trailing whitespace already works. `evidenceSchema` trims
   quotes so this cannot reach the pipeline through a validated report, but `findExactQuote` is
   exported and is called directly by `countUnverifiedExtractionEvidence`, so it is a real
   inconsistency in a whitespace-tolerant matcher.
2. **Extraction evidence is verified against the stage's document, not its declared source.**
   `countUnverifiedExtractionEvidence` takes a single `document` string and ignores
   `entry.source`. Probed: a conversation quote that genuinely appears in the pasted
   conversation, returned inside an agreement-extraction item, is counted as **1 unverified
   quote** because it was looked for in the agreement. That is a false "could not be verified"
   signal, and it contradicts the requirement that a quote is checked against the source it
   declares. `verifyFinding` already gets this right (`verifyEvidenceList` uses
   `sources[entry.source]`); the extraction path is the outlier.
3. **No test for an altered (near-miss) quote.** Probed behaviour is already correct —
   `"Two (3) rounds of revisions per page template."`, `"Copywriting and translation, or menu
   data entry."` and a reworded exclusion all return `{ found: false }` — but nothing pins it,
   and nothing asserts the *negative* requirement that a failed quote is never swapped for the
   nearby real sentence.

Not a gap: an unverifiable quote is already kept exactly as the model wrote it, never replaced
and never dropped, with the finding downgraded to `needs_review` (`lib/evidence.ts:170-196`,
`:259-296`). This task adds a test for it rather than changing it.

Cosmetic: two comments in `lib/evidence.ts` (around lines 251 and 253) contain mojibake —
`â†'` where `→` was intended (bytes `C3 A2 E2 80 A0 E2 80 99`, i.e. UTF-8 read as Latin-1). Fix
while the file is open; no behaviour change.

## Decisions and assumptions

1. **No route.** Decided with the user before this file was written: this task is library + tests
   only. `analyzeScope()` remains the only caller of the verifier, so verification is enforced for
   every report the pipeline can produce, and the HTTP entry point arrives in its own task.
2. **`findExactQuote` trims the quote before matching.** `normalizeForMatching(quote.trim())`.
   The index map still points into the untouched original source, so a matched quote is still the
   user's own bytes; a quote that is only whitespace still normalizes to nothing and still fails
   `HAS_MEANINGFUL_CHARACTER`. This changes matching for *leading* whitespace only.
3. **`countUnverifiedExtractionEvidence` verifies each quote against its declared source.** New
   signature: `(extraction, defaultSource: Evidence["source"], sources: EvidenceSources)`. The
   second argument still names the document the extraction stage read, and is used to label the
   issue text; lookup uses `sources[entry.source]`, exactly as `verifyEvidenceList` does. The
   extraction schemas are **not** changed.
4. **Verification stays downgrade-only.** No classification is upgraded, no quote is invented, no
   fuzzy/partial-credit matching is introduced, and a quote with no letters or digits still
   fails. "Do not silently replace a quote with a similar sentence" is treated as a hard rule: on
   failure the model's exact text stays in the report, `evidenceStatus` degrades, and the issue
   text says the quote could not be found in the named source.
5. **Test-only additions otherwise.** The five required cases (exact match, altered quote,
   incorrect source attribution, missing evidence, whitespace handling) are added to
   `tests/evidence.test.ts`, reusing the existing `AGREEMENT` / `CONVERSATION` fixtures so no
   real client material appears. Style follows the file: `node:test`, `node:assert/strict`,
   `../lib/x.ts` imports with explicit `.ts`, no network, no `process.env`.
6. **`modelFindingSchema` may be imported in the test file** for the "missing evidence" cases, to
   assert that a finding with no conversation quotes never reaches the verifier at all.
7. **README gets two line edits only** — the extraction-check row and the whitespace-tolerance
   sentence — so the documented behaviour matches the code.

## Expected files to change

- `lib/evidence.ts` — trim the quote in `findExactQuote`; resolve extraction quotes against
  `sources[entry.source]`; fix the two mojibake comments.
- `lib/analysis.ts` — update the one `countUnverifiedExtractionEvidence` call site
  (`lib/analysis.ts:158`) to pass `sources`. No other change.
- `tests/evidence.test.ts` — new tests (see acceptance criteria).
- `README.md` — two line edits (rows/note above).
- `prompts/06-evidence-verification-hardening.md` (new, this file).

Nothing else. No change to `lib/schemas.ts`, `lib/prompts.ts`, `lib/ollama.ts`,
`lib/samples.ts`, `app/**`, `components/**`, `tests/analysis.test.ts`, `tests/ollama.test.ts`,
`tests/schemas.test.ts`, `package.json`, or `.aider-desk/`.

## Functional requirements

- A quote verifies only when its normalized form occurs in the normalized text of the document it
  **declares** (`entry.source`), and the report then stores the slice of that original document.
- Leading and trailing whitespace on a quote is tolerated; internal whitespace runs, newlines,
  and tabs still collapse to a single space; a whitespace-only or punctuation-only quote is never
  evidence.
- A quote absent from its declared source — because it was invented, or because its wording was
  altered even slightly — produces `evidenceStatus: "unverified"` (or `"partial"` when other
  quotes in the finding do match), an `evidenceIssues` entry naming the document that was
  searched, and `classification: "needs_review"`.
- The model's exact quote text is preserved on failure. It is never dropped, never shortened,
  and never swapped for a nearby sentence from the source.
- Extraction items are verified the same way as findings; the count of unverifiable items feeds
  the existing application-written report limitation unchanged in wording.

## Security and privacy requirements

- No logging, no persistence, no network, no new dependency, no environment read.
- Issue strings name only the **source kind** (`agreement` / `conversation`), never document
  content, and never a quote the model wrote — the user already sees that quote in the report.
- No test fixture contains real client material; the committed Riverside sample wording is the
  only realistic text used.
- Verification stays server-side. `lib/evidence.ts` keeps its `fetch`/`console`/persistence
  tripwire coverage.

## Acceptance criteria

1. `findExactQuote` finds a quote that has leading **and** trailing whitespace, at the start and
   in the middle of a document, and returns the source's own characters.
2. A quote altered from the real wording — changed number (`(2)` → `(3)`), changed conjunction,
   dropped clause, reworded exclusion — is **not** found; the same alteration through
   `verifyFinding` yields `unverified` + `needs_review` + an issue naming the source.
3. A failed quote is preserved byte-for-byte as the model wrote it, and the finding contains no
   substitute quote taken from the source.
4. A quote that exists only in the other document is not verified against the wrong one, for both
   findings and extraction items; a quote inside an agreement-extraction item that declares
   `conversation` is verified against the conversation and counted as verifiable when present.
5. Missing evidence is covered: `modelFindingSchema` rejects a finding with an empty
   `conversationEvidence`; an empty `agreementEvidence` is allowed and leaves the finding
   `verified` when the conversation quote matches; a finding whose only quotes are absent is
   `unverified` + `needs_review` with one issue per failed quote.
6. Whitespace handling is covered: newline/tab/collapsed-space equivalence, zero-width folding,
   and whitespace-only quotes failing.
7. Existing behaviour is unchanged: `npm test` stays green including all 87 current tests, and no
   existing test is weakened, deleted, or skipped.
8. No new npm dependency; `package-lock.json` unchanged; `.aider-desk/` untouched.

## Automated checks and exact manual test steps

Automated (run and record real output):

1. `npm test`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run build`
5. `git status --short` and `git diff --stat` — diff limited to the five files listed above.
6. Re-run the probe from this session's investigation (leading-whitespace match, altered quotes,
   extraction declared-source count) and record the before/after values.

Manual: none required. This task makes no model call and has no UI surface, so there is nothing
to click. If Ollama happens to be running, a full end-to-end run belongs to the pipeline task
(05) and is not repeated here. State that in the close-out report rather than implying an
end-to-end test was run.

## Close-out report format (per AGENTS.md §2)

- `What I did`
- `Test` (numbered commands with actual results)
- `Needs your attention`