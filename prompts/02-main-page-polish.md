# Task 02 — Main page polish: hierarchy, privacy indicator, real sample placeholders

## Goal and user outcome

Upgrade the existing ScopeSentry main page from a functional input form into a finished,
credible product surface. A freelancer lands on `/` and, within a few seconds, understands
what the product does, knows exactly what to paste where, sees that their text is meant to
stay on their own machine, and can either type their own documents or load a labeled sample
in one click. Pressing **Analyze scope** still ends in an honest "engine not connected yet"
notice — no Ollama, no `/api/*` route, no invented findings.

Explicitly **out of scope**: Ollama, API routes, prompts, extraction, classification,
evidence verification, reply drafting, any mock or sample *findings*, and any new
dependency or npm package.

## Skills and documentation consulted

- `AGENTS.md` — approval workflow, §3 required UI states, §11 privacy honesty rules,
  §12 demo honesty, §13 checks, §5 file layout (which names `components/privacy-indicator.tsx`).
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` —
  keep the page a Server Component; only the form is `"use client"`.
- `.agents/skills/shadcn/SKILL.md` — reuse the installed primitives (`Button`, `Field`,
  `FieldLabel`, `FieldDescription`, `FieldError`, `Textarea`, `Separator`); semantic tokens
  only; `data-invalid` + `aria-invalid` pairing; icons from the configured `lucide` library.
- `.agents/skills/frontend-design/SKILL.md` — one deliberate visual idea, avoid generic
  SaaS-card grids and chatbot tropes (no centered gradient hero, no sparkle icons, no
  "Hi! I'm your scope assistant"), honest empty/error states.
- `.agents/skills/vercel-react-best-practices/SKILL.md` — state derived during render,
  functional `setState`, no inline component definitions.

## Existing code inspected

- `package.json` — `next@16.4.1`, `react@19.3.0`, Tailwind v4, `lucide-react`,
  `@base-ui/react`, `zod@^4`. Scripts: `dev`, `build`, `start`, `lint`, `typecheck`. **No test
  runner and no `test` script** — tests are deferred to the evidence-verification task.
- `components.json` — shadcn `base-nova` style, `baseColor: neutral`, `iconLibrary: lucide`,
  CSS in `app/globals.css`, alias `@/* → ./*`, `cn` imported from the `cn` package.
- Installed primitives only: `components/ui/{button,field,label,separator,textarea}.tsx`.
  No `alert`, `badge`, `card`, or `tooltip` — do **not** add any unless a real need appears.
- `app/page.tsx` (43 lines) — current shell: bordered header (mono kicker `local scope
  review`, H1, one paragraph), `<ScopeForm />` in `main`, bordered footer with the
  processing-path paragraph. Renders boilerplate-free but flat: no visual anchor, no
  step framing, no empty-state guidance, no dedicated privacy indicator.
- `components/scope-form.tsx` (160 lines) — `"use client"`. Two-state per field via
  `useState`, `touched` record, live `safeParse` on every render, Analyze disabled while
  invalid, "Load sample input" button, `role="status"` notice after submit. Uses
  `FieldGroup` with `md:grid-cols-2`, `Textarea` with `field-sizing-fixed min-h-52`.
  Placeholders are generic one-liners ("Paste the proposal, brief, or signed agreement you
  agreed to.") — the user explicitly asked for realistic sample placeholders.
- `lib/schemas.ts` — `MIN_TEXT_LENGTH = 20`, `MAX_TEXT_LENGTH = 20_000`,
  `agreementTextSchema`, `conversationTextSchema`, `analyzeInputSchema`,
  `SCOPE_CLASSIFICATIONS`. **Reuse as-is**; do not change limits or messages.
- `lib/samples.ts` — `SAMPLE_LABEL`, `SAMPLE_AGREEMENT`, `SAMPLE_CONVERSATION`
  (Riverside Coffee Roasters: brand refresh + six page templates, two revision rounds,
  exclusions for copywriting/photography/front-end; a thread containing an out-of-scope
  ordering page, an unquoted brand guideline, and an in-scope copy tweak).
  `SAMPLE_LABEL` is currently exported but never imported anywhere — reuse it in this task.
- `app/layout.tsx` — Geist Sans + Geist Mono via `next/font/google`, `LayoutProps<"/">`,
  body `min-h-full flex flex-col`. Metadata already correct. **Do not change.**
- `app/globals.css` — shadcn tokens + `@theme inline`; `--primary` is a blue
  (`oklch(0.48 0.19 264)`), `--background` warm paper, `dark` via
  `prefers-color-scheme`. `* { @apply border-border outline-ring/50 }` already provides
  focus-visible rings — never remove them.
- `README.md` — status table and project layout need one-line accuracy updates only.
- Git: branch `master`, HEAD `df6c065`. Clean except untracked `.aider-desk/`. Preserve it.

## Decisions and assumptions

1. **Polish only, no new capability.** The honest "not connected yet" submit notice is the
   designed end state for this task, not a placeholder to hide.
2. **Design idea: "the contract desk."** An editorial, document-review surface — a masthead,
   an editorial headline, and the two inputs presented as *two sheets of paper under review*
   with mono gutter markers `01` / `02`. This is the one memorable element; everything else is
   quiet. Deliberately not: centered gradient hero, chat bubbles, sparkles, illustration,
   three-up feature cards, or floating glassmorphism.
3. **Layout.** One left-aligned column, `max-w-6xl` outer frame, hero measure capped near
   `62–68ch`. Inputs are a 2-column grid at `lg` and above, stacking to 1 column below `lg`
   (the current code breaks at `md`, which is too early for two 20k-character textareas).
   Action bar sits below the grid, wrapping on narrow screens. Privacy indicator is a
   full-width band directly under the action bar.
4. **Realistic placeholders.** Each textarea shows a 3–4 line excerpt of the *same*
   Riverside Coffee Roasters material already in `lib/samples.ts`, so the page teaches the
   expected shape before any typing. HTML collapses whitespace in `placeholder`, so the
   excerpt needs `whitespace-pre-line` on the textarea and on its placeholder
   (`placeholder:whitespace-pre-line`) to render as intended — verify visually.
   Excerpt text is stored as `PLACEHOLDER_AGREEMENT` / `PLACEHOLDER_CONVERSATION` in
   `lib/samples.ts`; do not duplicate prose in the component.
5. **Privacy indicator honesty.** It must state (a) nothing pasted is stored or sent today,
   (b) analysis will run on an Ollama instance on the user's own machine once connected and
   is **not** connected yet, (c) local processing is not protection against malware, a
   compromised machine, or a leaked `.env`, and (d) do not paste confidential client
   material without permission. No claim of "fully offline", no "100% private" badge, no
   fabricated model name or endpoint.
6. **Empty state.** A compact numbered "how this works" block above the form explains the
   three steps (read the agreement → read the thread → compare and cite the source text) and
   doubles as the empty-state instruction. It describes intent, never output.
7. **Empty fields are not errors.** Errors appear on blur or submit (existing `touched`
   behavior), never while the field is pristine and empty. Keep the disabled-until-valid
   Analyze button and its short helper text.
8. **Sample loading** gets a per-panel control in addition to the existing single action, so
   a user can load one side at a time. Every sample affordance is labeled with
   `SAMPLE_LABEL` so sample input is never mistaken for analysis output (AGENTS.md §12).
9. **No new dependencies.** Compose with the installed shadcn primitives, `lucide-react`
   icons (decorative, `aria-hidden`), and existing semantic tokens. No edits to
   `app/globals.css` unless a token is genuinely missing; if one is added, justify it in the
   close-out report.
10. **Accessibility contract.** Real `<label htmlFor>`; hints and errors wired with
    `aria-describedby`; `aria-invalid` on the invalid control only; errors keep `role="alert"`
    via `FieldError`; the submit notice keeps `role="status"` + `aria-live="polite"`; step
    markers and icons are `aria-hidden` because the adjacent label already conveys the
    meaning; one `<h1>`; the privacy band is a `<section aria-labelledby>`; full keyboard
    operation with visible focus everywhere; comfortable target sizes at 360px width.

## Expected files to change

- `app/page.tsx` — rebuild the shell as masthead + hero + "how this works" + `<ScopeForm />`
  + `<PrivacyIndicator />` + advisory footer. Stays a Server Component.
- `components/scope-form.tsx` — paper-panel layout, mono step markers, realistic multi-line
  placeholders, per-panel sample controls, styled honest notice. Validation logic and
  `lib/schemas.ts` behavior unchanged.
- `components/privacy-indicator.tsx` (new) — the privacy band described in decision 5.
- `lib/samples.ts` — add `PLACEHOLDER_AGREEMENT` / `PLACEHOLDER_CONVERSATION` excerpts;
  keep `SAMPLE_LABEL` and the two full samples.
- `README.md` — status/description wording and the `components/` layout line, kept minimal.

Nothing else. No new route, no `lib/ollama.ts`, no test files, no dependency or lockfile edit.

## Functional requirements

- Headline + one short explanation paragraph naming the actual job (compare requests against
  the agreement, show the source text behind each finding, advisory not legal advice).
- Two large labeled textareas — original agreement, client conversation — with visible
  character counters against the shared 20,000 limit and per-field help text.
- Primary **Analyze scope** button, disabled until both fields validate, with a short honest
  reason shown while disabled; on submit, an honest notice that the local engine is not
  connected yet, with the entered text preserved and no network request.
- Privacy indicator explaining that analysis is intended to run locally on the user's own
  machine via Ollama, with the current-build caveat.
- Empty-state guidance (the three-step explainer) and validation errors that say what to do.
- Responsive and keyboard-operable from ~360px to wide desktop.

## Security and privacy requirements

- No `fetch`, no action, no route call, no `localStorage`, no analytics; submitting must
  produce zero network activity.
- No `console.log`/`console.error` of user text, and no `dangerouslySetInnerHTML` anywhere.
- No secrets, tokens, or service URLs in the client bundle; no `NEXT_PUBLIC_` usage.
- Pasted text rendered as text only.
- Privacy copy must match actual behavior for this build.

## Acceptance criteria

1. `app/page.tsx` contains no create-next-app boilerplate and no chatbot/AI-assistant tropes.
2. Page shows, in order: headline + explanation, privacy indicator, the two inputs with
   realistic sample placeholders, Analyze scope, and a footer carrying the advisory disclaimer.
3. Placeholders render as multiple lines with realistic content matching `lib/samples.ts`.
4. Both fields validate exactly as before (20-char minimum, 20,000 max, same messages),
   errors appear only after interaction, and Analyze is disabled until valid.
5. Loading either sample (per panel or both) populates fields and enables Analyze; the
   affordances are labeled as sample input.
6. Submit shows the honest not-connected notice, keeps the text, and makes zero requests.
7. Privacy indicator contains no unverified guarantee and no fabricated configuration.
8. Layout is responsive at 360px, 768px, and 1280px; every control is reachable and visible
   when tabbing; errors announce via `role="alert"`; notice announces via `role="status"`.
9. `npm run lint`, `npm run typecheck`, and `npm run build` all pass with no new warnings
   from the changed files.
10. No API route, Ollama call, prompt, classification, evidence, or reply logic anywhere in
    the diff; no dependency added.

## Automated checks and exact manual test steps

Automated (run and record real output):

1. `npm run lint`
2. `npm run typecheck`
3. `npm run build`

Manual (dev server):

1. `npm run dev`, open <http://localhost:3000>.
2. Confirm the page reads as a finished product: masthead, headline, privacy indicator,
   two paper panels, action bar, advisory footer.
3. Confirm each placeholder shows multi-line realistic sample text (not one collapsed line).
4. Type 5 characters in a field, blur → inline error appears; Analyze stays disabled.
5. Paste >20,000 characters → maximum-size error appears.
6. Load the per-panel sample, then the other → counters update and Analyze enables.
7. Clear one field → helper text explains why Analyze is disabled; error does not appear on a
   pristine empty field.
8. Submit → honest not-connected notice, text still present, focus order sensible.
9. DevTools: Network shows zero requests on submit; Console shows no logs.
10. Resize 360 / 768 / 1280 → no overflow, panels stack below `lg`, privacy band readable.
11. Tab through every control → visible focus ring on each; submit the form with Enter from a
    textarea-adjacent control; confirm no focus trap.
12. Toggle OS dark mode → both panels, error text, and privacy band remain legible.

## Close-out report format (per AGENTS.md §2)

- `What I did`
- `Test` (numbered commands/steps with actual results)
- `Needs your attention`