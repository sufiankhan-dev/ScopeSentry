import {
  classificationDisplay,
  evidenceSourceLabel,
  evidenceStatusDisplay,
} from "@/lib/report-display";
import type { ReportTone } from "@/lib/report-display";
import type {
  Evidence,
  EvidenceStatus,
  Finding,
  ScopeClassification,
  ScopeReport,
} from "@/lib/schemas";
import {
  BadgeCheck,
  CircleDashed,
  CircleHelp,
  MessageSquareQuote,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { ReplyComposer } from "@/components/reply-composer";
import type { ReplyDocuments } from "@/components/reply-composer";

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
 *
 * The reply composer at the foot of the card follows the same split: the draft is
 * clearly labelled as the model's text, the verified quotes it was written from are
 * one disclosure away, and the text itself is editable rather than presented as a
 * finished message.
 */

/**
 * One icon per classification, and one per evidence status.
 *
 * The icons are keyed off the contract values rather than off the label text, so
 * they cannot fall out of step with `classificationDisplay`, and they repeat the
 * iconography the landing page introduces in "the four verdicts": a reader who
 * learns the shape there recognises it here without reading the words.
 */
const CLASSIFICATION_ICONS: Record<ScopeClassification, LucideIcon> = {
  in_scope: BadgeCheck,
  potentially_out_of_scope: TriangleAlert,
  unclear: CircleHelp,
  needs_review: CircleDashed,
};

const EVIDENCE_ICONS: Record<EvidenceStatus, LucideIcon> = {
  verified: BadgeCheck,
  partial: TriangleAlert,
  unverified: CircleDashed,
};

/**
 * Badge and card treatments, per tone.
 *
 * The colour lives in the border and the badge text; the fill behind body text is
 * a neutral well. Tinting the fill with the alert hue looks fine in a screenshot
 * but a 12% tint of a light colour lifts a dark surface enough to push 12px
 * label text under 4.5:1, and a badge is text. Measured rather than assumed:
 * WCAG sets 3:1 for icons and shapes, 4.5:1 for text, and a coloured badge fill
 * only ever clears the former.
 */
const TONE_CLASSES: Record<ReportTone, string> = {
  positive: "border-glow/35 bg-card/60",
  caution: "border-amber-400/40 bg-card/60",
  neutral: "border-border bg-card/60",
  critical: "border-destructive/45 bg-card/60",
};

const BADGE_TONE_CLASSES: Record<ReportTone, string> = {
  positive: "border-glow/45 bg-muted/50 text-glow",
  caution: "border-amber-400/50 bg-muted/50 text-amber-300",
  neutral: "border-border bg-muted/40 text-muted-foreground",
  critical: "border-destructive/50 bg-muted/50 text-destructive",
};

function StatusBadge({
  label,
  tone,
  icon: Icon,
}: {
  label: string;
  tone: ReportTone;
  icon: LucideIcon;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${BADGE_TONE_CLASSES[tone]}`}
    >
      <Icon aria-hidden="true" className="size-3.5" />
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
    <blockquote className="rounded-r-lg border-l-2 border-glow/40 bg-background/50 py-3 pr-4 pl-4">
      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">
        {entry.quote}
      </p>
      <cite className="mt-2 block font-mono text-[0.7rem] tracking-wide text-muted-foreground not-italic">
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

export function FindingCard({
  finding,
  report,
  documents,
}: {
  finding: Finding;
  /** Omitted when a card is rendered outside the full report; the composer needs it to re-verify quotes. */
  report?: ScopeReport;
  documents?: ReplyDocuments;
}) {
  const classification = classificationDisplay(finding.classification);
  const evidence = evidenceStatusDisplay(finding.evidenceStatus);
  const evidenceIsClean = finding.evidenceStatus === "verified";
  const confidencePercent =
    finding.confidence === undefined
      ? null
      : Math.round(finding.confidence * 100);

  return (
    <li
      className={`rounded-2xl border bg-card/60 p-5 sm:p-6 ${TONE_CLASSES[evidenceIsClean ? "neutral" : evidence.tone]}`}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            label={classification.label}
            tone={classification.tone}
            icon={CLASSIFICATION_ICONS[finding.classification]}
          />
          <StatusBadge
            label={evidence.label}
            tone={evidence.tone}
            icon={EVIDENCE_ICONS[finding.evidenceStatus]}
          />
          {confidencePercent !== null ? (
            <span className="font-mono text-xs text-muted-foreground">
              confidence {confidencePercent}% (estimate)
            </span>
          ) : null}
        </div>

        <h3 className="text-lg font-semibold tracking-tight text-balance">{finding.title}</h3>

        <p className="text-sm leading-relaxed text-muted-foreground">
          {classification.summary}
        </p>

        {finding.evidenceIssues.length > 0 ? (
          <div
            role="note"
            className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-background/50 px-4 py-3.5"
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

        <div className="flex flex-col gap-2 border-t border-border pt-5">
          <h4 className="font-mono text-[0.7rem] tracking-widest text-glow uppercase">
            Recommended next step
          </h4>
          <p className="text-sm leading-relaxed text-pretty">{finding.nextStep}</p>
        </div>

        {report && documents ? (
          <ReplyComposer finding={finding} report={report} documents={documents} />
        ) : (
          <div className="flex items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
            <MessageSquareQuote aria-hidden="true" className="size-4 shrink-0" />
            Reply drafting is available on a finding inside a full report.
          </div>
        )}
      </div>
    </li>
  );
}