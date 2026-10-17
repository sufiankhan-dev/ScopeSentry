# Task 09 — Gemma-inspired dark UI redesign of the whole page

## Goal and user outcome

A freelancer who has never seen ScopeSentry should be able to open the page and, without
guessing, understand three things: what the product does, what it will decide for them, and
where their text goes. Today the page is a competent form with a paragraph of explanation
above it; the vocabulary the report will use (`in_scope`, `potentially_out_of_scope`,
`unclear`, `needs_review`) is never explained until it appears in a result.

After this task the page is a dark, blue-accented, Gemma-inspired product page: a hero, an
explained three-step sequence, **the four verdicts explained in plain language before they
are ever used**, the privacy story, and then the workspace. Nothing about the analysis
changes.

The visual reference is <https://deepmind.google/models/gemma>: deep navy-black surfaces,
one luminous blue accent, blue "starlight dot" motifs, pill-shaped buttons, generous
section spacing, large left-aligned display type, thin rules instead of box-everything.

## Skills and documentation consulted

- `AGENTS.md` — §2 approval workflow, §3 required UI states and "if the user supplies design
  references, treat them as the source of truth", §5 boundaries, §6 stack, §7 fixed decisions,
  §10 evidence-first trust rules, §11 privacy, §13 checks, §15 keep the scope small.
- `.agents/skills/frontend-design/SKILL.md` — two-pass plan-then-critique; structural
  devices must encode information rather than decorate; numbered markers are legitimate only
  for a real sequence; restraint (one memorable element, quiet everywhere else); honest
  empty/loading/error states; visible focus; reduced motion; no generic SaaS-card-kit.
- `https://deepmind.google/models/gemma` (fetched) — palette, dot motif, pill buttons, section
  rhythm, card treatment, `gemma` wordmark and "Our most capable open models" headline pattern.
- `.agents/skills/vercel-react-best-practices/SKILL.md` — no new effects introduced; the
  `fetch` stays in `onSubmit` / `onClick`; conditional rendering stays explicit.
- `components/ui/**` (`base-nova` shadcn via `@base-ui/react`) — `Button`, `Field`,
  `FieldLabel`, `FieldDescription`, `FieldError`, `Textarea`, `Separator`. No new primitive.
- Tailwind v4 (`@import "tailwindcss"`, `@theme inline`, `@custom-variant dark`).
- No new npm dependency. No font download: `Geist` / `Geist_Mono` from `next/font/google`
  are already installed and already the whole type system.

## Existing code inspected

- `app/page.tsx` (101 lines) — header, hero copy, 3-step "How it works", `PrivacyIndicator`,
  `ScopeForm`, footer. The whole marketing surface is one server component.
- `app/layout.tsx` — `Geist` + `Geist_Mono` via `--font-geist-sans` / `--font-geist-mono`,
  `h-full` html, flex body.
- `app/globals.css` (132 lines) — shadcn token block; `:root` is a warm off-white neutral
  palette, `@media (prefers-color-scheme: dark)` a grey one; `--radius: 0.625rem`.
- `components/scope-form.tsx` (346) — `"use client"`, owns `agreement`/`conversation`/
  `analysis`, `readAnalyzeResponse`, `MAX_TEXT_LENGTH` counter, per-field "Load sample",
  "Load both samples", submit. All behavior must survive verbatim.
- `components/analysis-panel.tsx` (194) — `switch` over the closed `AnalysisState` union:
  idle / running / failed / succeeded.
- `components/scope-report.tsx` (145) — summary, four counts, unverified banner, findings,
  limitations, `ADVISORY_NOTICE`.
- `components/finding-card.tsx` (227) — badges, evidence-issues warning, reasoning,
  attributed `<blockquote>`s, impact, next step, `ReplyComposer`.
- `components/reply-composer.tsx` (394) — idle/running/failed/draft, clipboard confirmation,
  editable textarea, grounded-quote disclosure.
- `components/privacy-indicator.tsx` (83) — the honest processing-path copy, including the
  "not protection against malware / not tested with the network disconnected" caveats.
- `lib/report-display.ts` (164) — `classificationDisplay`, `evidenceStatusDisplay`,
  `evidenceSourceLabel`, `countByClassification`, `formatDuration`, `formatElapsed`.
  **Pure, and string-asserted by `tests/report-display.test.ts`. Not edited.**
- `lib/schemas.ts` (495) — contracts, `ADVISORY_NOTICE`, `DRAFT_NOTICE`. Not edited.
- `tests/` — 202 tests, all green at `b51e076` with a clean tree. `npm run typecheck`,
  `npm run lint` both clean at HEAD.

## Decisions and assumptions

1. **Dark is the only theme.** The reference page is dark navy with one luminous blue; the
   existing light/dark `prefers-color-scheme` split is what makes the current page read as
   generic. `:root` becomes the dark palette and the media query is removed, so there is one
   palette and no dead code. All dark-mode-only utilities (`dark:`) in components are dropped
   at the same time. This is a deliberate aesthetic choice, reversible by restoring one block.
2. **Token palette (oklch, in `globals.css`):**
   - `--background: oklch(0.15 0.022 265)` — deep navy-black, not neutral black.
   - `--card: oklch(0.20 0.026 265)`, `--muted: oklch(0.24 0.026 265)`.
   - `--foreground: oklch(0.97 0.005 265)`, `--muted-foreground: oklch(0.74 0.022 265)`.
   - `--primary: oklch(0.74 0.145 256)` — the Gemma blue. `--primary-foreground: oklch(0.15 0.022 265)`.
   - `--border: oklch(1 0 0 / 11%)`, `--input: oklch(1 0 0 / 15%)`, `--ring: oklch(0.74 0.145 256)`.
   - `--destructive` stays a red; the amber used for caution stays amber, so "needs review"
     and "possibly out of scope" remain distinguishable from the blue brand accent.
   - New: `--glow: oklch(0.74 0.145 256)` and `--dot: oklch(0.74 0.145 256 / 0.5)` exposed
     through `@theme inline` as `--color-glow` / `--color-dot` for the hero motif.
3. **Signature element: one hero SVG, "the comparison in starlight."** Gemma's motif is
   glowing blue dots forming a meaningful object. ScopeSentry's subject is *two documents
   being compared*, so the hero visual is a dot-formed pair of document cards (agreement |
   conversation) with a vertical scan line, three matched lines glowing between them, and one
   blue verdict dot. It is generated deterministically from a small seeded lattice in a
   server component — no client JS, no animation loop, no new dependency. It is
   `aria-hidden="true"` and purely decorative; the meaning it carries is also stated in text
   next to it. This is the one bold gesture. Everything else stays quiet.
4. **The other dot motif is a background, not an element.** One `radial-gradient` blue glow
   plus a 1px dot lattice on the hero only (`background-image`, no markup). Nowhere else.
5. **Pills.** `--radius` stays `0.625rem` for cards and inputs; buttons, badges, and the nav
   CTA get `rounded-full` — the Gemma pill — via an added `pill` size/variant in
   `components/ui/button.tsx`, not by hand-rolled classes at 12 call sites.
6. **Type: two families, clear roles.** Geist Sans for everything a human reads; Geist Mono,
   uppercase, tracked, at 10–12px for **machine output only** — section eyebrows, evidence
   quote attributions, `local model …`, character counters. That is a real distinction the
   existing code already draws, and it is reinforced rather than removed. Display type goes
   to `text-5xl`/`sm:text-6xl`/`lg:text-7xl` with `tracking-[-0.03em]`. Line lengths capped
   at ~68ch via `max-w-[68ch]`.
7. **Sections are separated by thin rules, not nested cards.** The page must not become the
   SaaS-card kit. Cards appear only where the content is genuinely a set: the four verdicts,
   the two inputs, each finding, the reply composer.
8. **New clarity section: "Four verdicts, explained."** A four-card grid that reuses
   `classificationDisplay` verbatim for label + summary, so the copy stays under test and can
   never drift from what the report renders. This is the single biggest comprehension win and
   the reason the user asked for clarity.
9. **The 3-step strip stays numbered 01/02/03** because it *is* a sequence and the form below
   it is already numbered 01/02 for the same reason. The markers are earned here.
10. **Nav is a sticky bar with anchor links** — How it works / Verdicts / Privacy / Analyze —
    plus a primary pill CTA that focuses the first textarea. Anchors only: no routing, no new
    pages, no nav router dependency.
11. **Class icons.** Each verdict card and each finding badge gets a `lucide-react` icon
    keyed off the contract value (`in_scope` → `CircleCheck`, `potentially_out_of_scope` →
    `TriangleAlert`, `unclear` → `CircleHelp`, `needs_review` → `ShieldAlert`). The mapping
    lives in the new section component only; `finding-card.tsx` keeps its tested
    `classificationDisplay` labels and gains no second source of truth.
12. **Honest copy is preserved.** `ADVISORY_NOTICE`, `DRAFT_NOTICE`, the privacy panel's
    caveats, and the "the sample is example input, never example analysis results" line all
    survive. No new privacy or accuracy claim is introduced. Section copy is rewritten only
    to be plainer, never to promise more.
13. **No behavior change.** `scope-form.tsx`, `reply-composer.tsx`, and `analysis-panel.tsx`
    keep their fetch logic, state unions, `readAnalyzeResponse` / `readReplyResponse`
    validation, `useElapsedSinceMount`, and clipboard handling byte-for-byte in logic; only
    class names and the surrounding wrapper markup change.
14. **Accessibility floor, asserted not assumed:** body text ≥ 4.5:1 on its surface, focus
    rings unchanged, every interactive control keeps a real accessible name, decorative SVG
    and dot backgrounds are `aria-hidden`, and the only motion is the existing loading spinner
    and a single scan-line shimmer that is disabled under `motion-reduce:animate-none`.
15. **No new npm dependency, no new route, no API change, no test change.**

## Expected files to change

New:

- `components/scope-hero-visual.tsx` — server component, the seeded dot-lattice SVG. Pure,
  no hooks, no fetch.
- `components/verdict-cards.tsx` — the "Four verdicts, explained" grid, built from
  `classificationDisplay`.
- `prompts/09-gemma-inspired-ui-redesign.md` (new, this file).

Modified:

- `app/globals.css` — dark navy token set, `--glow`/`--dot`, hero background utilities,
  `@custom-variant dark` removal, base layer tidy-up.
- `app/layout.tsx` — `color-scheme: dark` on `<html>`, metadata unchanged.
- `app/page.tsx` — new section structure, sticky nav, hero, steps strip, verdicts, privacy,
  workspace, footer.
- `components/privacy-indicator.tsx` — presentation only.
- `components/scope-form.tsx` — presentation only.
- `components/analysis-panel.tsx` — presentation only.
- `components/scope-report.tsx` — presentation only.
- `components/finding-card.tsx` — presentation only.
- `components/reply-composer.tsx` — presentation only.
- `components/ui/button.tsx` — add a `pill` treatment; no behaviour change.

Untouched: `lib/**`, `app/api/**`, `tests/**`, `package.json`, `next.config.ts`,
`.env.example`, `README.md`, `components/ui/**` other than `button.tsx`, `components.json`.

## Functional requirements

- All six required UI states from AGENTS.md §3 remain reachable and recognisable: empty,
  validation/size errors, loading, results, Ollama-unavailable / model-missing, malformed
  model output, no findings, copy-to-clipboard confirmation.
- Every existing control keeps its accessible name and behaviour: both textareas, both
  "Load sample" buttons, "Load both samples", "Analyze scope", "Draft a reply", "Copy draft",
  "Regenerate", the grounded-quote disclosure, and the skip-to-workspace focus action.
- The four verdict labels and explanations shown before a report exists are the exact strings
  `classificationDisplay` returns, so the page cannot promise one thing and report another.
- Responsive: no horizontal overflow at 375px; the two inputs stack, the verdict grid goes
  1 → 2 → 4 columns, the hero visual hides or scales below `lg`.
- Keyboard: tab order follows visual order, focus is always visible, the sticky nav does not
  trap or obscure focus, and skip links reach the workspace.

## Security considerations and privacy requirements

- No new data flows. No new `fetch`, no new endpoint, no client-side network call, no storage
  (`localStorage` / `sessionStorage` / `indexedDB` / cookies) — the "nothing is stored"
  promise in the privacy panel stays literally true.
- No logging of agreement text, conversation text, prompts, or model output.
- The hero SVG contains only hard-coded geometry and constants. No user text is ever
  interpolated into markup, and the visual cannot become an injection vector.
- The privacy panel's copy must remain true of this diff: text goes to this app's own server
  and from there to the configured local Ollama instance, for analysis and for reply
  drafting; nothing is stored; setup downloads need internet; local processing is not
  protection against malware or a compromised machine; offline use is untested. The redesign
  must not turn any of these into a stronger claim.
- No new external asset, font, CDN link, or third-party script. The dot motif is inline SVG and
  CSS only, so the page still loads nothing from a third party.

## Acceptance criteria

1. `npm test` passes with all 202 existing tests green, unweakened and unskipped. No test file
   is modified.
2. `npm run typecheck`, `npm run lint`, and `npm run build` all pass.
3. `git diff --stat` touches only the files listed above plus this prompt.
4. The diff contains no `console.`, no storage API, no `mailto:`, no `fetch`, no external
   `http(s)` URL, and no new npm dependency.
5. Every string asserted by `tests/report-display.test.ts` is unchanged; the new verdict cards
   read those strings rather than restating them.
6. The hero SVG is `aria-hidden`, renders no text, and costs no client JavaScript.
7. All AGENTS.md §3 states are present in the rendered page, verified in the browser.
8. Contrast: body and secondary text meet 4.5:1 against their own surface; the amber and red
   status colours remain distinguishable from the blue accent.

## Automated checks and exact manual test steps

Automated (run, and record the real output):

1. `npm test`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run build`
5. `git status --short` and `git diff --stat`
6. `git diff -- app components | grep -nE 'console\.|localStorage|sessionStorage|indexedDB|mailto:|fetch\(|https?://'` and confirm only the pre-existing `/api/analyze` and `/api/reply` strings and the Google Fonts reference in `layout.tsx` appear.
7. `git diff -- lib tests` and confirm it is empty.
8. `node node_modules/next/dist/bin/next internal agent-feedback-instructions` once, before the
   final report, and act on its output.

Manual browser pass (done by me against `npm run dev`, screenshots at 1440px and 375px, both
colour schemes no longer applicable so only the single dark theme is checked):

9. Load `/`. Confirm the nav, hero, dot visual, steps strip, verdict grid, privacy panel,
   workspace, and footer render in that order, with no console errors and no layout shift.
10. Confirm the nav CTA moves focus to the agreement textarea.
11. Click "Load both samples", press "Analyze scope", and confirm the loading panel with the
    live elapsed counter still appears; confirm the report renders with counts, findings,
    evidence, limitations, and the advisory notice.
12. Draft a reply on a finding: loading → draft → edit → copy, and confirm the "Copied"
    confirmation still appears.
13. Stop Ollama, re-run the analysis, and confirm the connection error panel still renders
    with the pasted text intact. Restart Ollama afterwards.
14. Tab through the whole page and confirm every control shows a visible focus ring and the
    order matches the visual order.
15. Narrow to 375px and confirm no horizontal overflow anywhere, including long quoted text.

## Close-out report format (per AGENTS.md §2)

- `What I did`
- `Test` (numbered, with the real output of each command and the real result of each manual
  step; anything not run is stated as not run)
- `Needs your attention`