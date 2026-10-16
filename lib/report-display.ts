import type {
  EvidenceSource,
  EvidenceStatus,
  Finding,
  ScopeClassification,
  ScopeReport,
} from "./schemas.ts";
import { EVIDENCE_STATUSES, SCOPE_CLASSIFICATIONS } from "./schemas.ts";

/**
 * Everything the report UI needs to know that is *not* in the report itself.
 *
 * A classification like `potentially_out_of_scope` is a contract value: it is
 * chosen by a prompt and enforced by a Zod enum, and it means nothing to someone
 * who has not read the prompt. This module turns each contract value into a label
 * a freelancer can act on, a one-line explanation of what the label actually
 * claims, and a visual tone.
 *
 * It is deliberately pure — no React, no fetch, no environment — so the mapping
 * that decides what a status label *says* is covered by `node:test` rather than
 * by someone squinting at the rendered page.
 */

export type ReportTone = "positive" | "caution" | "neutral" | "critical";

export type ClassificationDisplay = {
  /** Short enough for a badge, and it is the value the contract uses. */
  label: string;
  /** What this label claims, in one sentence, without overstating it. */
  summary: string;
  tone: ReportTone;
};

/**
 * A caution here means "the evidence points away from the agreed scope", not
 * "the client has done something wrong". The wording keeps the finding advisory
 * (AGENTS.md §10) while still being specific enough to act on.
 */
const CLASSIFICATION_DISPLAY: Record<ScopeClassification, ClassificationDisplay> = {
  in_scope: {
    label: "In scope",
    summary:
      "The agreement supports this request, or it is a reasonable clarification of work already agreed.",
    tone: "positive",
  },
  potentially_out_of_scope: {
    label: "Possibly out of scope",
    summary:
      "The documents suggest extra work, something the agreement lists as excluded, or a changed deliverable.",
    tone: "caution",
  },
  unclear: {
    label: "Unclear",
    summary:
      "The agreement and conversation do not contain enough information to decide. Silence is not an exclusion.",
    tone: "neutral",
  },
  needs_review: {
    label: "Needs review",
    summary:
      "The evidence is missing, unsupported, or the documents disagree. Check this one against your own text.",
    tone: "critical",
  },
};

export const classificationDisplay = (
  classification: ScopeClassification,
): ClassificationDisplay => CLASSIFICATION_DISPLAY[classification];

export type EvidenceStatusDisplay = {
  label: string;
  tone: ReportTone;
};

/**
 * A `verified` finding is only ever `verified` because application code matched
 * every quote against the pasted text, so the label says exactly that rather
 * than implying the model checked itself.
 */
const EVIDENCE_STATUS_DISPLAY: Record<EvidenceStatus, EvidenceStatusDisplay> = {
  verified: { label: "Every quote matched your text", tone: "positive" },
  partial: { label: "Some quotes did not match your text", tone: "caution" },
  unverified: { label: "No quote matched your text", tone: "critical" },
};

export const evidenceStatusDisplay = (status: EvidenceStatus): EvidenceStatusDisplay =>
  EVIDENCE_STATUS_DISPLAY[status];

/**
 * How a quote is attributed in the report.
 *
 * `agreement` is phrased as "your agreement" rather than the model's term
 * "source", because the point of the label is to let the reader know which of
 * the two documents they pasted the text came from.
 */
export const evidenceSourceLabel = (source: EvidenceSource): string =>
  source === "agreement" ? "your agreement" : "your conversation";

/** Counts per classification, including the ones with a count of zero. */
export type ClassificationCounts = Record<ScopeClassification, number>;

/**
 * Counts findings per classification.
 *
 * Every classification is present in the result, including zeroes, so the summary
 * row can render a fixed set of cells instead of a list whose length depends on
 * what the model happened to return. Findings are counted once each; a finding
 * with several quotes is still one finding.
 */
export const countByClassification = (
  findings: readonly Pick<Finding, "classification">[],
): ClassificationCounts => {
  const counts: ClassificationCounts = {
    in_scope: 0,
    potentially_out_of_scope: 0,
    unclear: 0,
    needs_review: 0,
  };

  for (const finding of findings) {
    counts[finding.classification] += 1;
  }

  return counts;
};

/** The order the summary row renders its counts in: fixed, not sorted by size. */
export const CLASSIFICATION_ORDER: readonly ScopeClassification[] = SCOPE_CLASSIFICATIONS;

export const EVIDENCE_STATUS_ORDER: readonly EvidenceStatus[] = EVIDENCE_STATUSES;

/** Count of findings whose quotes did not all match, i.e. the ones to read first. */
export const countUnverified = (findings: readonly Pick<Finding, "evidenceStatus">[]): number =>
  findings.filter((finding) => finding.evidenceStatus !== "verified").length;

/**
 * How long the server said the analysis took, in words a person would use.
 * Shown next to the model tag so the wait is explained rather than hidden.
 */
export const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.round(durationMs / 1_000);

  if (totalSeconds < 60) {
    return `${totalSeconds} second${totalSeconds === 1 ? "" : "s"}`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return seconds === 0
    ? `${minutes} minute${minutes === 1 ? "" : "s"}`
    : `${minutes}m ${seconds}s`;
};

/** Milliseconds as `m:ss` for the live counter in the loading panel. */
export const formatElapsed = (elapsedMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

/** Whether a report has anything to show beyond its summary. */
export const hasFindings = (report: ScopeReport): boolean => report.findings.length > 0;