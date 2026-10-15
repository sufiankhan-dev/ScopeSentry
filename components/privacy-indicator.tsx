import { HardDrive, TriangleAlert } from "lucide-react";

export function PrivacyIndicator() {
  return (
    <section
      aria-labelledby="privacy-heading"
      className="rounded-xl border border-border bg-muted/50 px-5 py-5 sm:px-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
        <span
          aria-hidden="true"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background"
        >
          <HardDrive className="size-4" />
        </span>

        <div className="flex flex-col gap-3">
          <div>
            <h2
              id="privacy-heading"
              className="text-sm font-semibold tracking-tight"
            >
              Analysis is designed to run on your own machine
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Right now nothing you paste is stored or sent anywhere &mdash; this page
              makes no network requests. Once the local engine is connected, the model
              will run on an Ollama instance on your own machine instead of a
              third-party AI service. That connection is not wired up yet.
            </p>
          </div>

          <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 sm:gap-x-8">
            <li className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
              <span>No cloud AI provider, no database, no third-party analytics.</span>
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
              <span>Initial setup downloads software and models; that needs internet access.</span>
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
              <span>Findings are advisory review aids, never legal conclusions.</span>
            </li>
            <li className="flex items-start gap-2">
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              <span>
                Local processing does not protect against malware, a compromised machine,
                or a leaked config file.
              </span>
            </li>
          </ul>

          <p className="text-sm leading-relaxed text-muted-foreground">
            Do not paste a client&apos;s confidential material without their permission.
          </p>
        </div>
      </div>
    </section>
  );
}