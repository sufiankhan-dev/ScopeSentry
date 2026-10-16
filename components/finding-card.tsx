import {
  classificationDisplay,
  evidenceSourceLabel,
  evidenceStatusDisplay,
} from "@/lib/report-display";
import type { ReportTone } from "@/lib/report-display";
import type { Evidence, Finding } from "@/lib/schemas";
import { TriangleAlert } from "lucide-react";

/**
 * One client request, reported against the agreement.
 *
 * The layout is the trust mechanism, not decoration. AGENTS.md §10 requires that
 * source evidence be distinguishable from the model's interpretation, so this
 * card keeps them in separate regions with separate headings:
 *
 *   - `explanation`, `impact` and `nextStep` sit under "Reasoning" / "Next step"
 *     headings and are explicitly the model's reading.
 *   - every quote sits in a `<blockquote>` attributed with `<cite>`, and a quote
 *     that failed verification is still rendered, in a warning treatment, exactly
 *     as the model wrote it.
 *
 * Nothing here decides whether a finding is *true*. It shows what the documents
 * say and what the model concluded, and marks the difference.
 */

const TONE_CLASSES: Record<ReportTone, string> = {
  positive: "border-primary/30 bg-primary/5 text-foreground",
  caution: "border-amber-500/40 bg-amber-500/5 text-foreground dark:border-amber-400/30",
  neutral: "border-border bg-muted/60 text-foreground",
  critical: "border-destructive/40 bg-destructive/5 text-foreground",
};

const BADGE_TONE_CLASSES: Record<ReportTone, string> = {
  positive: "border-primary/40 bg-primary/10 text-primary",
  caution:
    "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:border-amber-400/40 dark:text-amber-200",
  neutral: "border-border bg-muted text-muted-foreground",
  critical: "border-destructive/50 bg-destructive/10 text-destructive",
};

function StatusBadge({
  label,
  tone,
  className,
}: {
  label: string;
  tone: ReportTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${BADGE_TONE_CLASSES[tone]} ${className ?? ""}`}
    >
      {label}
    </span>
  );
}

/**
 * A quote block.
 *
 * `whitespace-pre-wrap` plus `break-words` so a long single-line paste cannot
 * force a horizontal scrollbar on a phone. `break-words` is applied rather than
 * `break-all` so a quote stays readable when it does wrap.
 */
function Quote({ entry }: { entry: Evidence }) {
  return (
    <blockquote className="rounded-lg border-l-2 border-border bg-muted/40 py-2.5 pl-3.5 pr-3">
      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">
        {entry.quote}
      </p>
      <cite className="mt-1.5 block font-mono text-[0.7rem] tracking-wide text-muted-foreground not-italic">
        from {evidenceSourceLabel(entry.source)}
      </cite>
    </blockquote>
  );
}

function EvidenceGroup({
  heading,
  entries,
  emptyNote,
}: {
  heading: string;
  entries: readonly Evidence[];
  emptyNote?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h5 className="font-mono text-[0.7rem] tracking-widest text-muted-foreground uppercase">
        {heading}
      </h5>
      {entries.length > 0 ? (
        entries.map((entry, index) => (
          <Quote
            key={`${entry.source}-${index}`}
            entry={entry}
          />
        ))
      ) : emptyNote ? (
        <p className="text-sm leading-relaxed text-muted-foreground">{emptyNote}</p>
      ) : null}
    </div>
  );
}

export function FindingCard({ finding }: { finding: Finding }) {
  const classification = classificationDisplay(finding.classification);
  const evidence = evidenceStatusDisplay(finding.evidenceStatus);
  const evidenceIsClean = finding.evidenceStatus === "verified";
  const confidencePercent =
    finding.confidence === undefined
      ? null
      : Math.round(finding.confidence * 100);

  return (
    <li
      className={`rounded-xl border bg-card p-5 sm:p-6 ${TONE_CLASSES[evidenceIsClean ? "neutral" : evidence.tone]}`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={classification.label} tone={classification.tone} />
          <StatusBadge label={evidence.label} tone={evidence.tone} />
          {confidencePercent !== null ? (
            <span className="font-mono text-xs text-muted-foreground">
              confidence {confidencePercent}% (estimate)
            </span>
          ) : null}
        </div>

        <h3 className="text-base font-semibold text-balance">{finding.title}</h3>

        <p className="text-sm leading-relaxed text-muted-foreground">
          {classification.summary}
        </p>

        {finding.evidenceIssues.length > 0 ? (
          <div
            role="note"
            className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/5 px-3.5 py-3"
          >
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-destructive"
            />
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">
                Some of this finding could not be checked against your text.
              </p>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-sm leading-relaxed text-muted-foreground">
                {finding.evidenceIssues.map((issue, index) => (
                  <li key={index}>{issue}</li>
                ))}
              </ul>
              <p className="text-sm leading-relaxed text-muted-foreground">
                The quote below is shown exactly as the model wrote it. It was not
                replaced with a similar sentence from your document, so you can
                judge the claim yourself.
              </p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <h4 className="font-mono text-[0.7rem] tracking-widest text-muted-foreground uppercase">
            Reasoning
          </h4>
          <p className="text-sm leading-relaxed text-pretty">{finding.explanation}</p>
        </div>

        <EvidenceGroup
          heading="From your conversation"
          entries={finding.conversationEvidence}
        />

        <EvidenceGroup
          heading="From your agreement"
          entries={finding.agreementEvidence}
          emptyNote="No agreement text was cited for this request, so this finding rests on the conversation alone."
        />

        {finding.impact ? (
          <div className="flex flex-col gap-2">
            <h4 className="font-mono text-[0.7rem] tracking-widest text-muted-foreground uppercase">
              Possible impact
            </h4>
            <p className="text-sm leading-relaxed text-pretty">{finding.impact}</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <h4 className="font-mono text-[0.7rem] tracking-widest text-muted-foreground uppercase">
            Recommended next step
          </h4>
          <p className="text-sm leading-relaxed text-pretty">{finding.nextStep}</p>
        </div>
      </div>
    </li>
  );
}