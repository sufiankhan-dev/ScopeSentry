import { FindingCard } from "@/components/finding-card";
import type { ReplyDocuments } from "@/components/reply-composer";
import {
  CLASSIFICATION_ORDER,
  classificationDisplay,
  countByClassification,
  countUnverified,
  formatDuration,
} from "@/lib/report-display";
import { ADVISORY_NOTICE } from "@/lib/schemas";
import type { AnalyzeMeta, ScopeReport } from "@/lib/schemas";
import { ShieldCheck } from "lucide-react";

/**
 * The report: what the analysis found, and how much of it can be trusted.
 *
 * Reading order is deliberate and matches the way a freelancer actually uses this:
 * what the comparison concluded overall, how many requests landed in each
 * category, then each request in full, then what the analysis could not settle,
 * then the advisory limit. Limitations are not buried in a footer because a
 * report that omits its own gaps invites more confidence than it has earned.
 *
 * `meta.model` is shown because a claim that analysis ran locally is only
 * meaningful if the reader can see which local model produced it.
 */
export function ScopeReportView({
  report,
  meta,
  documents,
}: {
  report: ScopeReport;
  meta: AnalyzeMeta;
  /** The pasted documents, so each finding's reply composer can re-send them for verification. */
  documents: ReplyDocuments;
}) {
  const counts = countByClassification(report.findings);
  const unverified = countUnverified(report.findings);

  return (
    <section
      aria-labelledby="report-heading"
      className="flex flex-col gap-8 border-t border-border pt-10"
    >
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-glow uppercase">
          Scope report
        </p>
        <h2
          id="report-heading"
          className="text-3xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl"
        >
          {report.findings.length === 0
            ? "The comparison produced no findings"
            : `${report.findings.length} request${report.findings.length === 1 ? "" : "s"} reviewed against your agreement`}
        </h2>
        <p className="font-mono text-xs text-muted-foreground">
          local model {meta.model} &middot; {formatDuration(meta.durationMs)}
        </p>
      </div>

      <div className="rounded-2xl border border-glow/30 bg-card/50 px-6 py-6 sm:px-7">
        <h3 className="font-mono text-[0.7rem] tracking-widest text-glow uppercase">
          Summary
        </h3>
        <p className="mt-3 max-w-[72ch] text-base leading-relaxed text-pretty">
          {report.summary.overview}
        </p>
        <p className="mt-4 max-w-[72ch] text-sm leading-relaxed text-muted-foreground">
          The paragraph above is the local model&rsquo;s reading of the two
          documents. The quotes further down are the parts that were checked
          against the text you pasted.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {CLASSIFICATION_ORDER.map((classification) => {
          const display = classificationDisplay(classification);
          const count = counts[classification];

          return (
            <div
              key={classification}
              className="flex flex-col gap-1.5 rounded-xl border border-border bg-card/60 px-4 py-4"
            >
              <dt className="text-xs leading-snug text-muted-foreground">
                {display.label}
              </dt>
              <dd className="font-mono text-2xl font-semibold tabular-nums">
                {count}
              </dd>
            </div>
          );
        })}
      </dl>

      {unverified > 0 ? (
        <p className="flex items-start gap-2.5 rounded-xl border border-destructive/45 bg-card/50 px-4 py-3.5 text-sm leading-relaxed">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>
            {unverified} of {report.findings.length} finding
            {unverified === 1 ? "" : "s"} could not be fully checked against your
            pasted text. Read {unverified === 1 ? "it" : "those"} before acting on
            {unverified === 1 ? " it" : " them"}.
          </span>
        </p>
      ) : null}

      {report.findings.length > 0 ? (
        <div className="flex flex-col gap-5">
          <h3 className="text-base font-semibold tracking-tight">Findings</h3>
          <ol className="flex flex-col gap-5">
            {report.findings.map((finding) => (
              <FindingCard key={finding.id} finding={finding} report={report} documents={documents} />
            ))}
          </ol>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card/30 px-6 py-6 text-sm leading-relaxed text-muted-foreground sm:px-7">
          <p>
            The model returned no findings for this conversation. The limitations
            below explain why that can happen — most often because no client
            request could be identified in the text you pasted, or because the
            requests it found did not survive verification.
          </p>
          <p className="mt-3">
            Nothing has been invented to fill the gap. Re-check that the
            conversation text is complete, then run the analysis again.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-8">
        <h3 className="font-mono text-[0.7rem] tracking-widest text-muted-foreground uppercase">
          What this analysis could not settle
        </h3>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          {report.summary.limitations.map((limitation, index) => (
            <li key={index}>{limitation.text}</li>
          ))}
        </ul>
      </div>

      <p className="rounded-xl border border-border bg-card/40 px-5 py-4 text-sm leading-relaxed text-muted-foreground">
        {ADVISORY_NOTICE}
      </p>
    </section>
  );
}