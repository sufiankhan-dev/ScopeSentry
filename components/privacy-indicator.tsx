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
              Analysis runs on your own machine
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              When you run an analysis, the text you pasted is sent to this
              app&rsquo;s own server and from there to the Ollama instance
              configured for it &mdash; normally{" "}
              <code className="font-mono text-[0.8em]">127.0.0.1:11434</code> on
              this computer. That is the only destination it has: there is no
              cloud AI provider to fall back to. Nothing is stored, so nothing
              survives the analysis unless you copy it out yourself.
            </p>
          </div>

          <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 sm:gap-x-8">
            <li className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
              <span>No cloud AI provider, no database, no third-party analytics.</span>
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
              <span>
                Nothing is written to your browser storage either: the report and
                your pasted text live only in this open tab.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
              <span>Initial setup downloads software and models; that needs internet access.</span>
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
              <span>Findings are advisory review aids, never legal conclusions.</span>
            </li>
            <li className="flex items-start gap-2 sm:col-span-2">
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              <span>
                Local processing does not protect against malware, a compromised machine,
                or a leaked config file. It has also not been tested with the network
                disconnected, so treat offline use as unverified.
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