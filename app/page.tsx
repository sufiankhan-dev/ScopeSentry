import { ScopeForm } from "@/components/scope-form";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-8 sm:px-8">
          <p className="font-mono text-xs text-muted-foreground">
            local scope review
          </p>
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Know when a client request leaves the agreement you signed.
          </h1>
          <p className="max-w-2xl leading-relaxed text-muted-foreground">
            Paste the agreement on the left and the conversation on the right.
            ScopeSentry compares the requests against what was actually agreed and
            shows the source text behind every finding. It is a review aid, not
            legal advice.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 sm:px-8">
        <ScopeForm />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-6 sm:px-8">
          <p className="font-mono text-xs text-muted-foreground">
            processing path
          </p>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Nothing you paste on this page is stored or sent anywhere. Local
            analysis is not wired up yet; when it is, it will run on an Ollama
            instance on your own machine rather than a third-party AI service.
            Do not paste a client&apos;s confidential material without their
            permission.
          </p>
        </div>
      </footer>
    </div>
  );
}