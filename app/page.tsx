import { JumpToWorkspace } from "@/components/jump-to-workspace";
import { PrivacyIndicator } from "@/components/privacy-indicator";
import { ScopeForm } from "@/components/scope-form";
import { ScopeHeroVisual } from "@/components/scope-hero-visual";
import { VerdictCards } from "@/components/verdict-cards";
import { SAMPLE_LABEL } from "@/lib/samples";
import { CloudOff, HardDrive, ShieldCheck } from "lucide-react";

/**
 * The page, in the order a freelancer needs it.
 *
 * 1. What this is. 2. Where the text goes. 3. What it will decide, in plain
 * words. 4. Then the two documents and the run button.
 *
 * That order is the whole point of the redesign. The previous version put the
 * form at the top and explained the product underneath, so a first-time visitor
 * met `in_scope` for the first time inside a result they had to trust. The
 * verdicts are now on the page before anything runs, using the same strings the
 * report will print.
 */

const STEPS = [
  {
    marker: "01",
    title: "Read the agreement",
    body: "Pull out the deliverables, revision limits, exclusions, deadlines, and the terms it leaves open.",
  },
  {
    marker: "02",
    title: "Read the thread",
    body: "Pull out what the client actually asked for, what you already agreed to, and in what order.",
  },
  {
    marker: "03",
    title: "Compare and cite",
    body: "Classify each request and show the exact source text behind it, so you judge the evidence yourself.",
  },
];

/**
 * The three claims the page can already stand behind, in the code that performs
 * them. "Every quote checked" is not a promise about the model — it is
 * `lib/evidence.ts` comparing each quote to the pasted text before anything is
 * rendered.
 */
const TRUST = [
  {
    icon: HardDrive,
    title: "Runs on this machine",
    body: "A local Gemma model through Ollama. There is no cloud provider to fall back to.",
  },
  {
    icon: CloudOff,
    title: "Nothing is stored",
    body: "No database, no browser storage, no analytics. The report lives in this open tab.",
  },
  {
    icon: ShieldCheck,
    title: "Every quote is checked",
    body: "Each quote is matched against the text you pasted, or the finding is flagged for review.",
  },
];

const NAV_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#verdicts", label: "The four verdicts" },
  { href: "#privacy", label: "Privacy" },
];

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <a
        href="#analyze"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to the analysis
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3 sm:px-8">
          <a href="#top" className="flex items-center gap-2.5">
            <span className="text-[0.95rem] font-semibold tracking-tight">
              ScopeSentry
            </span>
          </a>

          <nav
            aria-label="Sections"
            className="hidden items-center gap-6 md:flex"
          >
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-muted-foreground">
              local analysis · no cloud AI
            </span>
            {/* <JumpToWorkspace className="px-4 text-sm" /> */}
          </div>
        </div>
      </header>

      <main id="top" className="flex-1">
        {/* ---------------------------------------------------------------- */}
        {/* Hero                                                              */}
        {/* ---------------------------------------------------------------- */}
        <section className="ss-hero-field relative overflow-hidden border-b border-border">
          <div className="mx-auto w-full max-w-6xl gap-12 px-6 pt-16 pb-20 sm:px-8 sm:pt-24 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16 lg:pt-28 lg:pb-28">
            <div className="flex flex-col gap-7">
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-glow/30 bg-glow/10 px-3 py-1.5 text-xs font-medium text-glow">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-glow"
                />
                Scope review for freelancers
              </span>

              <h1 className="text-4xl leading-[1.05] font-semibold tracking-[-0.03em] text-balance sm:text-6xl lg:text-7xl">
                Read every new request against the agreement you actually
                signed.
              </h1>

              <p className="max-w-[62ch] text-base leading-relaxed text-muted-foreground text-pretty sm:text-lg">
                Scope creep rarely arrives as a refusal. It arrives as a quick
                &ldquo;one more thing?&rdquo; on a Thursday. Paste the agreement
                and the client conversation, and ScopeSentry marks where a
                request is covered, possibly beyond scope, or too unclear to
                call &mdash; with the source text behind each one.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <JumpToWorkspace className="px-6 text-[0.95rem]" />
                <a
                  href="#verdicts"
                  className="inline-flex h-9 items-center rounded-full border border-border bg-background/70 px-5 text-sm font-medium transition-colors hover:border-glow/45 hover:bg-muted"
                >
                  See the four verdicts first
                </a>
              </div>

              <p className="font-mono text-xs text-muted-foreground">
                Takes a few minutes on a CPU-only machine. Nothing leaves your
                computer.
              </p>
            </div>

            {/* <figure className="flex flex-col gap-4">
              <ScopeHeroVisual />
              <figcaption className="max-w-[46ch] text-sm leading-relaxed text-muted-foreground">
                Your agreement and the client&rsquo;s messages, matched line by line.
                Each request gets one of four verdicts &mdash; never a guess dressed
                up as a fact.
              </figcaption>
            </figure> */}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Trust claims                                                      */}
        {/* ---------------------------------------------------------------- */}
        <section
          aria-label="What ScopeSentry does"
          className="border-b border-border"
        >
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-10 sm:px-8 md:grid-cols-3">
            {TRUST.map((item) => (
              <div key={item.title} className="flex gap-3.5">
                <span
                  aria-hidden="true"
                  className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-glow/25 bg-glow/10 text-glow"
                >
                  <item.icon className="size-4" />
                </span>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">{item.title}</span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    {item.body}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* How it works                                                      */}
        {/* ---------------------------------------------------------------- */}
        <section
          id="how"
          aria-labelledby="how-heading"
          className="border-b border-border"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-16 sm:px-8 sm:py-20">
            <div className="flex flex-col gap-3">
              <h2
                id="how-heading"
                className="text-3xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl"
              >
                Three passes over your two documents
              </h2>
              <p className="max-w-[62ch] leading-relaxed text-muted-foreground">
                The model reads one document at a time, then compares them.
                Nothing is guessed between the steps.
              </p>
            </div>

            <ol className="grid gap-8 sm:grid-cols-3 sm:gap-10">
              {STEPS.map((step) => (
                <li key={step.marker} className="flex flex-col gap-2.5">
                  <span className="font-mono text-xs tracking-widest text-glow">
                    {step.marker}
                  </span>
                  <span className="text-base font-semibold tracking-tight">
                    {step.title}
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* The four verdicts                                                 */}
        {/* ---------------------------------------------------------------- */}
        <section
          id="verdicts"
          aria-labelledby="verdicts-heading"
          className="border-b border-border"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-16 sm:px-8 sm:py-20">
            <div className="flex flex-col gap-3">
              <h2
                id="verdicts-heading"
                className="text-3xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl"
              >
                Every request gets one of four verdicts
              </h2>
              <p className="max-w-[62ch] leading-relaxed text-muted-foreground">
                These are the exact labels the report uses, and what each one
                claims. None of them says a client has done anything wrong.
              </p>
            </div>

            <VerdictCards />
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Privacy                                                           */}
        {/* ---------------------------------------------------------------- */}
        <section
          id="privacy"
          aria-labelledby="privacy-heading"
          className="border-b border-border"
        >
          <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-8 sm:py-20">
            <PrivacyIndicator />
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Workspace                                                         */}
        {/* ---------------------------------------------------------------- */}
        <section
          id="analyze"
          aria-labelledby="workspace-heading"
          className="border-b border-border"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-16 sm:px-8 sm:py-20">
            <div className="flex flex-col gap-3">
              <h2
                id="workspace-heading"
                className="text-3xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl"
              >
                Paste your two documents
              </h2>
              <p className="max-w-[62ch] leading-relaxed text-muted-foreground">
                The agreement you signed, and the conversation where the client
                made the request. Both stay in this tab until you clear them.
              </p>
            </div>

            <ScopeForm />
          </div>
        </section>
      </main>

      <footer className="mt-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-12 sm:px-8">
          <div className="ss-rule" aria-hidden="true" />

          <p className="max-w-[76ch] text-sm leading-relaxed text-muted-foreground">
            ScopeSentry highlights what the documents say and where they
            disagree. It does not give legal advice, does not decide a dispute,
            and does not claim a client has breached anything. The{" "}
            {SAMPLE_LABEL.toLowerCase()} on this page is fictional and
            illustrative &mdash; it is example text to paste, never example
            analysis results.
          </p>

          <p className="font-mono text-xs text-muted-foreground">
            Analysis runs on a local model you install yourself. ScopeSentry
            sends nothing to any third party.
          </p>
        </div>
      </footer>
    </div>
  );
}
