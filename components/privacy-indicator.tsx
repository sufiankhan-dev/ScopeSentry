import { HardDrive, TriangleAlert } from "lucide-react";

/**
 * Where the text goes, stated before the user has pasted anything.
 *
 * The copy is unchanged in substance from the version this app shipped with: it
 * names the real processing path, says nothing is stored, and keeps the two
 * caveats that keep the claim honest (local is not a security boundary, and
 * offline use is untested). Only the layout moved, so the caveats read as part
 * of the same panel instead of as fine print below it.
 */
export function PrivacyIndicator() {
  return (
    <section
      aria-labelledby="privacy-heading"
      className="relative overflow-hidden rounded-2xl border border-glow/25 bg-card/50 p-6 sm:p-8"
    >
      <div className="flex flex-col gap-7 lg:flex-row lg:gap-10">
        <div className="flex flex-col gap-4 lg:w-[22rem] lg:shrink-0">
          <span
            aria-hidden="true"
            className="inline-flex size-10 items-center justify-center rounded-full border border-glow/30 bg-glow/10 text-glow"
          >
            <HardDrive className="size-4.5" />
          </span>

          <h2
            id="privacy-heading"
            className="text-2xl font-semibold tracking-[-0.02em] text-balance"
          >
            Analysis runs on your own machine
          </h2>

          <p className="text-sm leading-relaxed text-muted-foreground">
            When you run an analysis or draft a reply, the text you pasted is sent
            to this app&rsquo;s own server and from there to the Ollama instance
            configured for it &mdash; normally{" "}
            <code className="font-mono text-[0.8em] text-glow">127.0.0.1:11434</code>{" "}
            on this computer. That is the only destination it has: there is no
            cloud AI provider to fall back to.
          </p>
        </div>

        <div className="flex flex-col gap-5 lg:flex-1 lg:border-l lg:border-border lg:pl-10">
          <ul className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2 sm:gap-x-8 sm:gap-y-4">
            <li className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="mt-2 size-1 shrink-0 rounded-full bg-glow"
              />
              <span>No cloud AI provider, no database, no third-party analytics.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="mt-2 size-1 shrink-0 rounded-full bg-glow"
              />
              <span>
                Nothing is written to your browser storage either: the report and
                your pasted text live only in this open tab.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="mt-2 size-1 shrink-0 rounded-full bg-glow"
              />
              <span>Initial setup downloads software and models; that needs internet access.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="mt-2 size-1 shrink-0 rounded-full bg-glow"
              />
              <span>
                Drafted replies are text for you to edit and send yourself.
                ScopeSentry has no way to send a message to anyone.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="mt-2 size-1 shrink-0 rounded-full bg-glow"
              />
              <span>Findings are advisory review aids, never legal conclusions.</span>
            </li>
          </ul>

          <div
            role="note"
            className="flex items-start gap-2.5 rounded-xl border border-border bg-background/50 px-4 py-3.5"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-300" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              Local processing does not protect against malware, a compromised
              machine, or a leaked config file. It has also not been tested with the
              network disconnected, so treat offline use as unverified. Do not paste
              a client&rsquo;s confidential material without their permission.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}