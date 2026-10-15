import { PrivacyIndicator } from "@/components/privacy-indicator";
import { ScopeForm } from "@/components/scope-form";
import { SAMPLE_LABEL } from "@/lib/samples";

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

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4 sm:px-8">
          <p className="font-mono text-sm font-medium tracking-tight">
            ScopeSentry
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            local analysis &middot; no cloud AI
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 sm:px-8 sm:py-16">
        <div className="flex flex-col gap-10">
          <div className="flex flex-col gap-5">
            <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
              Scope review for freelancers
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Read every new request against the agreement you actually signed.
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground text-pretty">
              Scope creep rarely arrives as a refusal. It arrives as a quick
              &ldquo;one more thing?&rdquo; on a Thursday. Paste the agreement and the
              client conversation, and ScopeSentry marks where a request is covered,
              possibly beyond scope, or too unclear to call &mdash; with the source text
              behind each one.
            </p>
          </div>

          <div className="flex flex-col gap-4 border-y border-border py-6">
            <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
              How it works
            </p>
            <ol className="grid gap-6 sm:grid-cols-3 sm:gap-8">
              {STEPS.map((step) => (
                <li key={step.marker} className="flex flex-col gap-1.5">
                  <span className="font-mono text-xs tracking-widest text-muted-foreground">
                    {step.marker}
                  </span>
                  <span className="text-sm font-medium">{step.title}</span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <PrivacyIndicator />

          <div className="flex flex-col gap-5">
            <h2 className="text-sm font-semibold tracking-tight">
              Your two source documents
            </h2>
            <ScopeForm />
          </div>
        </div>
      </main>

      <footer className="mt-12 border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-6 py-8 sm:px-8">
          <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
            Advisory only
          </p>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            ScopeSentry highlights what the documents say and where they disagree. It does
            not give legal advice, does not decide a dispute, and does not claim a client
            has breached anything. The {SAMPLE_LABEL.toLowerCase()} on this page is
            fictional and illustrative &mdash; it is example text to paste, never example
            analysis results.
          </p>
        </div>
      </footer>
    </div>
  );
}