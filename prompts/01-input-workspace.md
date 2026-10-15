# Task 01 — App shell, typed input schema, and core input workspace

## Goal and user outcome

Give ScopeSentry a real, honest first screen. A freelancer opens the app, reads what it does, pastes an original agreement and a client conversation (or loads a clearly labeled sample), sees inline validation and size limits, and reaches an enabled "Analyze scope" action. On submit the app validates and **does not fake any results** — it states plainly that the local analysis engine is not connected yet. This shell is what the Ollama/Gemma pipeline and the report UI plug into in later tasks.

Explicitly **out of scope**: any Ollama call, any `/api/*` route, model prompting, evidence verification, classification logic, reply generation, or any mock/sample *findings*.

## Skills and documentation consulted

- `AGENTS.md` (repo root) — workflow, UI states, privacy rules, checks, two-day plan.
- `node_modules/next/AGENTS.md` — installed Next.js has breaking changes; read `dist/docs/`, do not assume.
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` — `"use client"` boundary, "server-only" for server code, minimize data passed to client components.
- `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md` — `.env*` loading order, only `NEXT_PUBLIC_` reaches the browser, `.env*` is gitignored by default.
- `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` (headings + breaking-change sections) — async request APIs, `middleware`→`proxy`, `next lint` removed, image defaults.
- `.agents/skills/shadcn/SKILL.md` — `FieldGroup`/`Field` form composition, `data-invalid` + `aria-invalid` validation, semantic tokens only, review every added component, icons via the project's `iconLibrary`.
- `.agents/skills/frontend-design/SKILL.md` — deliberate palette/typography, honest empty and error states, avoid the SaaS-card template tells, restraint.
- `.agents/skills/vercel-react-best-practices/SKILL.md` — derive state during render, functional `setState`, no inline components, keep client boundary tight.
- `.agents/skills/webapp-testing/SKILL.md` — Playwright-based verification (not used this task; browsers are not installed — see Decisions).

## Existing code inspected

- **Package manager:** npm (`package-lock.json`), npm 11.19.0, Node v24.21.0.
- `package.json` — `next@16.4.1`, `react@19.3.0`, `react-dom@19.3.0`; dev: `tailwindcss@^4` (+ `@tailwindcss/turbopack`), `eslint@^9`, `eslint-config-next@16.4.1`, `typescript@^5`. Scripts: `dev`, `build`, `start`, `lint` only. No `typecheck` script, no test runner.
- `node_modules` — `tailwindcss` 4.3.3. **`zod` 4.6.7 exists only as a dev transitive dependency** (via `zod-validation-error`); it is not a declared dependency and must be added explicitly as a runtime dep.
- `next.config.ts` — `cacheComponents: true`, `partialPrefetching: true`, Turbopack CSS loader for `*.css`, `experimental.agentFeedback: true`.
- `tsconfig.json` — `strict: true`, `@/*` → `./*`, bundler resolution, includes `.next/types`.
- `app/layout.tsx` — Geist + Geist Mono via `next/font/google`, uses the Next 16 global `LayoutProps<"/">` type, body is `min-h-full flex flex-col`; metadata still "Create Next App".
- `app/page.tsx` — untouched create-next-app boilerplate.
- `app/globals.css` — Tailwind v4 `@import "tailwindcss"`, `@theme inline` tokens for background/foreground/fonts, `prefers-color-scheme` dark block, hardcoded `body { font-family: Arial... }`.
- `eslint.config.mjs` — flat config, `core-web-vitals` + `typescript`; `next lint` is removed in Next 16, the repo already calls `eslint` directly.
- `.gitignore` — line 34 is `.env*`, so **`.env.example` would be ignored** unless a `!.env.example` negation is added.
- Confirmed absent: `components/`, `components.json`, `lib/`, `tests/`, `.env.example`.
- `.next/` build cache exists (gitignored).
- Git: branch `master`, one commit (`debd275 Initial commit from Create Next App`). Uncommitted: `AGENTS.md` modified; `.agents/`, `.aider-desk/`, `prompts/`, `skills-lock.json` untracked. Preserve all of it.
- **Ollama:** `ollama` is not on PATH and nothing answers on `127.0.0.1:11434` — Ollama is not installed on this machine. This task does not depend on it; it blocks the later Ollama tasks.
- npm registry reachable (`https://registry.npmjs.org/-/ping` → 200), so the shadcn CLI can run.
- Python 3.14.3 with the `playwright` package is installed, but Chromium binaries are **not** downloaded (verified: launch fails with "Executable doesn't exist").

## Decisions and assumptions

1. **Scope is input UI + validation only.** No AI/API this task; Analyze ends in a truthful "not connected yet" notice.
2. **UI foundation: shadcn/ui via the CLI** (user decision). Run `npx shadcn@latest init --defaults` in the project, then add **only** the components this task actually uses (`button`, `label`, `textarea`, `field`; add `alert`/`badge` only if genuinely needed). After init, run `npx shadcn@latest info --json` to confirm `aliases`, `tailwindVersion`, `tailwindCssFile`, `base`, and `iconLibrary`, and fix icon imports per that output. If `init` fails against Next 16 / Tailwind v4, stop, report the failure, and fall back to plain Tailwind v4 with hand-rolled controls.
3. **Tailwind v4 tokens only.** shadcn writes its token block into `app/globals.css`; keep the existing `@theme inline` structure and the dark-mode block, keep Geist fonts in `app/layout.tsx`, and remove the `Arial` body override so the app actually uses Geist. Review the init diff instead of accepting it wholesale.
4. **Zod for input validation** (AGENTS.md §6/§8): add `zod` as a direct dependency. Zod v4 API (`z.object`, `safeParse`, `error.issues`).
5. **No test runner this task** (user decision: defer to the evidence-verification task). `tests/` and a `test` script are not created here; schema coverage comes with the runner later.
6. **`.env.example` is added now** to document the eventual `OLLAMA_BASE_URL` / `OLLAMA_MODEL` setup, even though nothing reads it yet, plus the `!.env.example` negation in `.gitignore` so it is actually tracked. No real values, no `.env` committed.
7. **Samples are input examples only**, clearly labeled as sample input — never presented as analysis results (AGENTS.md §12).
8. **Single-page workspace** at `/`: `app/page.tsx` stays a Server Component shell; only the form is a Client Component (`components/scope-form.tsx`, `"use client"`). Static copy (title, empty state, privacy note) stays on the server.
9. **Design direction** (frontend-design skill, subject = a freelancer reading a contract next to an email thread; audience = a solo freelancer who wants a trustworthy, calm review tool):
   - Color: paper `#FBFAF8` background, ink `#1A1A1A` text, muted slate `#5B6169` secondary text, a single signal blue `#1D4ED8` for the primary action, amber `#B45309` reserved for validation messaging. Classification colors come later with the report.
   - Type: keep the installed Geist Sans for UI and Geist Mono for character counters and the privacy/configuration details — no new font downloads.
   - Layout: one left-aligned column, measure capped near 72ch, label-above-field stack, hairline `divide` between the agreement and conversation blocks instead of nested rounded cards; a thin status strip under the header for the local-processing note. No hero image, no gradient, no decorative motion.
   - Principles: structure carries meaning (counters, limits, and status are real information); empty and error states explain what to do next; one memorable element only — the agreement/conversation pair presented as a two-column "document margin" on desktop that collapses to one column on mobile.
10. **No persistence, analytics, or external calls** in this task. Nothing is written to `localStorage`; nothing leaves the browser.

## Expected files to change

- `package.json`, `package-lock.json` — add `zod` as a dependency; add only shadcn's own required deps.
- `components.json`, `lib/utils.ts` (with `cn`) — created by the shadcn CLI.
- `components/ui/*.tsx` — only the added components; review each file after the CLI writes it.
- `.gitignore` — add `!.env.example` under the env block.
- `.env.example` (new) — documented `OLLAMA_BASE_URL`, `OLLAMA_MODEL` (unused this task, no secrets).
- `app/globals.css` — shadcn/theme tokens merged into the existing Tailwind v4 `@theme inline` block; keep dark mode; drop the `Arial` override.
- `app/layout.tsx` — ScopeSentry title/description; keep Geist fonts and the existing layout props type.
- `app/page.tsx` — replace boilerplate with the server-rendered workspace shell (header, short what-it-does copy, empty-state instructions, truthful privacy note) rendering `<ScopeForm />`.
- `components/scope-form.tsx` (new, `"use client"`) — both textareas, character counters, inline validation, "Load sample" action, disabled/enabled Analyze button, submit result notice.
- `lib/schemas.ts` (new) — Zod input schema, classification enum values (`in_scope`, `potentially_out_of_scope`, `unclear`, `needs_review`) as a typed constant for later tasks, and the size constants shared by the form and any future route handler.
- `lib/samples.ts` (new) — clearly labeled sample agreement and sample conversation text.

## Functional and privacy requirements

- Two labeled inputs: **Original agreement** and **Client conversation**, each with a visible character counter and a stated maximum.
- Validation via the shared Zod schema (`safeParse`): both fields required, trimmed, min length (~20 chars) and max length (20,000 chars) each. Errors render inline, tied to the control with `aria-invalid` + `aria-describedby` (and `data-invalid` on the shadcn `Field`); Analyze stays disabled while invalid.
- Required states present in this task: empty state with instructions, input-size errors, and a submit result that honestly says analysis is not connected yet **while preserving the user's input**.
- Accessible: real labels, keyboard operable, visible focus (do not remove shadcn/Tailwind focus rings), semantic landmarks, responsive from ~360px to desktop.
- Truthful privacy note for the current build: nothing pasted here is saved or sent anywhere; analysis will run on a local Ollama instance once connected. Do **not** claim a verified local-inference guarantee that has not been implemented (AGENTS.md §3/§11).
- No `console.log` of user text. No request bodies carrying user text are created this task.

## Security considerations

- No secrets, tokens, or internal service URLs in client code. `OLLAMA_*` values are server-side only and must never use the `NEXT_PUBLIC_` prefix.
- No client→model path exists yet; all future inference stays server-side (use `import "server-only"` in the future `lib/ollama.ts`).
- Render pasted text as text only — never as HTML.
- `.env` stays ignored; only `.env.example` (placeholder values) is added.

## Acceptance criteria

1. `app/page.tsx` no longer contains create-next-app boilerplate, and the repo builds.
2. `components.json` exists and `npx shadcn@latest info --json` reports this project correctly; only components actually used were added.
3. A user can type or paste into both fields, load the labeled samples, and see live counters.
4. Too-short or oversized input shows clear, accessible inline errors and keeps Analyze disabled.
5. A valid submit shows an honest "analysis not connected yet" notice and preserves the entered text.
6. The empty state explains the agreement + conversation workflow and the current local-processing status.
7. Layout is responsive and fully keyboard operable with visible focus.
8. The privacy note accurately describes this build (no over-claiming).
9. `.env.example` is created **and tracked** (`git check-ignore .env.example` reports no match).
10. No API route, Ollama call, prompt, classification logic, evidence logic, or sample finding exists anywhere in the diff.

## Automated checks and exact manual test steps

Automated (run and record real output):

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm run build`
4. `npx shadcn@latest info --json` — confirm aliases/base/tailwindVersion match the files on disk.

Manual (dev server, user-run per decision):

1. `npm run dev`, open `http://localhost:3000`.
2. Confirm the empty state explains the agreement + conversation workflow and the honest privacy/status note.
3. Type 5 characters in each field → confirm the minimum-length error appears and Analyze stays disabled.
4. Paste more than 20,000 characters into a field → confirm a clear maximum-size error.
5. Click "Load sample" → confirm both fields populate and Analyze becomes enabled.
6. Submit → confirm the "not connected yet" notice appears and the entered text is still there.
7. Resize to a mobile width → confirm the layout collapses to one column; tab through the controls and confirm visible focus and full keyboard operation.
8. DevTools Network on submit → confirm zero requests; console → confirm nothing is logged.

## Close-out report format (per AGENTS.md §2)

- `What I did`
- `Test` (numbered commands/steps with actual results)
- `Needs your attention`