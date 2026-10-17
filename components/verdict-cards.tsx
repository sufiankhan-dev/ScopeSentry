import { classificationDisplay } from "@/lib/report-display";
import { CLASSIFICATION_ORDER } from "@/lib/report-display";
import type { ScopeClassification } from "@/lib/schemas";
import {
  BadgeCheck,
  CircleDashed,
  CircleHelp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

/**
 * The report's vocabulary, explained before it is used.
 *
 * A freelancer opening this page has never seen `in_scope` or
 * `potentially_out_of_scope`. Until now the only place those words appeared was
 * inside a result the model produced, which is the worst possible time to meet a
 * new vocabulary. This section puts all four verdicts on the page in advance,
 * with the same words the report will use.
 *
 * The labels and explanations are **not written here**. They come from
 * `classificationDisplay`, the same function `FindingCard` renders, so the page
 * cannot describe a verdict one way and the report another. The tests in
 * `tests/report-display.test.ts` already assert that those strings never assert a
 * breach or a legal conclusion, and that assertion now covers the landing page
 * as well as the report.
 */

const ICONS: Record<ScopeClassification, LucideIcon> = {
  in_scope: BadgeCheck,
  potentially_out_of_scope: TriangleAlert,
  unclear: CircleHelp,
  needs_review: CircleDashed,
};

/**
 * How each verdict is coloured.
 *
 * Only "in scope" wears the brand blue, deliberately: the accent is the
 * product's own voice, and the one place it can mean "this is settled" is the
 * verdict that says the agreement covers the request. The other three stay amber
 * or red so a reader can scan for trouble without reading a word.
 */
const TONES: Record<ScopeClassification, string> = {
  in_scope: "border-glow/35 bg-glow/10 text-glow",
  potentially_out_of_scope: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  unclear: "border-border bg-muted/50 text-muted-foreground",
  needs_review: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function VerdictCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {CLASSIFICATION_ORDER.map((classification) => {
        const display = classificationDisplay(classification);
        const Icon = ICONS[classification];

        return (
          <div
            key={classification}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card/60 p-5"
          >
            <span
              aria-hidden="true"
              className={`inline-flex size-9 items-center justify-center rounded-full border ${TONES[classification]}`}
            >
              <Icon className="size-4" />
            </span>

            <h3 className="text-base font-semibold tracking-tight">{display.label}</h3>

            <p className="text-sm leading-relaxed text-muted-foreground">
              {display.summary}
            </p>
          </div>
        );
      })}
    </div>
  );
}