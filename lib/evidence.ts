import { z } from "zod";

import type {
  AgreementExtraction,
  ConversationExtraction,
  Evidence,
  EvidenceStatus,
  Finding,
} from "./schemas.ts";
import { MAX_EVIDENCE_ISSUES, modelFindingSchema } from "./schemas.ts";

/**
 * A finding exactly as the model sends it: no verification status, no evidence issues, and the
 * defaulted `confidenceIsEstimate` flag not yet present. `z.input` is used deliberately so the
 * verifier accepts the comparison call's leaner schema as well as the full contract.
 */
export type FindingClaim = z.input<typeof modelFindingSchema>;

/**
 * Deterministic evidence verification.
 *
 * The model is not trusted to grade itself. Every quote it returns is checked here against the
 * text the user actually pasted, and a finding whose quotes cannot be found is never shown as a
 * supported finding.
 *
 * Matching is done on a normalized view (case, typographic punctuation, and whitespace runs
 * folded) because models copy quotes with small differences. That creates a risk the user must
 * not inherit: a "quote" that is not in their document. So the normalized view carries an index
 * map back to the original string, and a verified quote is always the user's own bytes, sliced
 * from the original text at the matched offsets.
 *
 * This module never logs, never calls a model, and never embeds document text in an error
 * message it creates.
 */

// --- Normalization with an index map ---------------------------------------

/** Character-by-character folding, so matching holds no mutable regex state. */
const CHARACTER_FOLDING = new Map<string, string>([
  ["\u2018", "'"],
  ["\u2019", "'"],
  ["\u201a", "'"],
  ["\u201b", "'"],
  ["\u2032", "'"],
  ["\u201c", '"'],
  ["\u201d", '"'],
  ["\u201e", '"'],
  ["\u201f", '"'],
  ["\u2033", '"'],
  ["\u2010", "-"],
  ["\u2011", "-"],
  ["\u2012", "-"],
  ["\u2013", "-"],
  ["\u2014", "-"],
  ["\u2015", "-"],
  ["\u2212", "-"],
  ["\u2026", "..."],
  // Zero-width and soft-hyphen characters a copy-paste can add invisibly.
  ["\u200b", ""],
  ["\u200d", ""],
  ["\ufeff", ""],
  ["\u00ad", ""],
]);

export type NormalizedSource = {
  /** Folded text used for substring matching. */
  text: string;
  /** `map[i]` is the offset in the original string of `text[i]`. */
  map: number[];
};

/**
 * Folds a document for matching while recording, for every folded character, the offset of the
 * original character it came from. The map is what lets a match be reported as the exact
 * original text instead of the folded approximation.
 *
 * Three differences are tolerated, because they are the ones models introduce when they copy a
 * quote and are meaningless as evidence of anything: letter case, typographic punctuation
 * (`“ ” ’ — …`), and whitespace runs. Trailing whitespace is dropped from the folded view.
 */
export const normalizeForMatching = (source: string): NormalizedSource => {
  let text = "";
  const map: number[] = [];

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (/\s/.test(char)) {
      // A run of whitespace becomes one space, mapped to the first character of the run.
      const previous = text.at(-1);
      if (previous !== " ") {
        text += " ";
        map.push(index);
      }
      continue;
    }

    const folded = foldPunctuation(char).toLowerCase();
    if (folded === "") continue;

    text += folded;
    for (let offset = 0; offset < folded.length; offset += 1) {
      map.push(index);
    }
  }

  while (text.endsWith(" ")) {
    text = text.slice(0, -1);
    map.pop();
  }

  return { text, map };
};

/** Folds one character's punctuation form; unknown characters pass through unchanged. */
const foldPunctuation = (char: string): string => CHARACTER_FOLDING.get(char) ?? char;

// --- Quote matching ---------------------------------------------------------

export type QuoteMatch =
  | { found: true; matchedText: string }
  | { found: false; matchedText: null };

/** A quote has to carry actual words or numbers to be evidence of anything. */
const HAS_MEANINGFUL_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Looks for `quote` inside `source` and returns the exact original text of the match.
 *
 * Returns `found: false` for anything that is not a real occurrence: a blank quote, a quote with
 * no letters or digits in it (an ellipsis or a dash is not evidence), or text that simply is not
 * in the source.
 */
export const findExactQuote = (source: string, quote: string): QuoteMatch => {
  const needle = normalizeForMatching(quote);
  if (!HAS_MEANINGFUL_CHARACTER.test(needle.text)) {
    return { found: false, matchedText: null };
  }

  const haystack = normalizeForMatching(source);
  const start = haystack.text.indexOf(needle.text);
  if (start === -1) {
    return { found: false, matchedText: null };
  }

  const firstOriginal = haystack.map[start];
  const lastOriginal = haystack.map[start + needle.text.length - 1];
  if (firstOriginal === undefined || lastOriginal === undefined) {
    return { found: false, matchedText: null };
  }

  return { found: true, matchedText: source.slice(firstOriginal, lastOriginal + 1) };
};

export type EvidenceSources = {
  agreement: string;
  conversation: string;
};

/**
 * Verifies one evidence list, replacing each matched quote with the exact text found in the
 * source.
 *
 * Status: `verified` when every quote matches, `partial` when some match, `unverified` when none
 * do. A quote that could not be found is **kept as the model wrote it** rather than dropped, so
 * the user can see the claim that was made and judge it; it is never presented as verified, and
 * every failed quote produces an issue. Dropping it instead would also leave a finding with no
 * evidence at all, which the report contract does not allow.
 */
const verifyEvidenceList = (
  evidence: readonly Evidence[],
  sources: EvidenceSources,
  label: string,
): { evidence: Evidence[]; status: EvidenceStatus; issues: string[] } => {
  const verified: Evidence[] = [];
  const issues: string[] = [];
  let matched = 0;

  for (const entry of evidence) {
    const source = sources[entry.source];
    const match = findExactQuote(source, entry.quote);

    if (match.found) {
      matched += 1;
      verified.push({ quote: match.matchedText, source: entry.source });
    } else {
      issues.push(`${label} could not be found in the pasted ${entry.source} text.`);
      verified.push({ quote: entry.quote, source: entry.source });
    }
  }

  const status: EvidenceStatus =
    matched === evidence.length ? "verified" : matched === 0 ? "unverified" : "partial";

  return { evidence: verified, status, issues };
};

/**
 * Concrete figures a finding must not be able to assert without the document saying so.
 *
 * Deliberately narrow: bare numbers, weekday names, and month names on their own are not
 * checked, because a conversation legitimately says "before Friday" without that being a
 * contractual deadline.
 */
export const CONCRETE_TERM_PATTERNS: RegExp[] = [
  // Dollar, euro, pound, yen amounts. Decimals allowed; a trailing full stop is not.
  // Written with escapes so the pattern cannot be damaged by an editor's encoding.
  /[$€£¥]\s?\d[\d,]*(?:\.\d{1,2})?/g,
  // 250 USD, 250 euros, 1,200 dollars
  /\b\d[\d.,]*\s?(?:usd|eur|gbp|dollars?|euros?|pounds?)\b/gi,
  // 2026-03-01
  /\b\d{4}-\d{2}-\d{2}\b/g,
  // 14/05/2026
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
  // January 15, Jan 3
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/gi,
];

/** The model-written parts of a finding, i.e. everything that is not quoted evidence. */
const MODEL_PROSE_FIELDS = ["title", "explanation", "nextStep", "impact"] as const;

const collectUnsupportedTerms = (
  finding: FindingClaim,
  sources: EvidenceSources,
): string[] => {
  const haystack = `${sources.agreement}\n${sources.conversation}`.toLowerCase();
  const found = new Set<string>();

  for (const field of MODEL_PROSE_FIELDS) {
    const value = finding[field];
    if (!value) continue;

    for (const pattern of CONCRETE_TERM_PATTERNS) {
      // matchAll works on a copy of the regex, so the exported patterns stay stateless.
      for (const token of value.matchAll(pattern)) {
        const text = token[0];
        if (!haystack.includes(text.toLowerCase())) {
          found.add(text);
        }
      }
    }
  }

  return [...found];
};

/**
 * Verifies a model finding against the pasted sources.
 *
 * Downgrade-only, and deliberately so:
 * - no quote matches â†’ `needs_review`, because the finding has no support at all;
 * - a price or date the documents never contained â†’ `needs_review`, even if every quote
 *   verified, because the model asserted something unsourced;
 * - `unclear` and `needs_review` are never rewritten to a more confident classification.
 *
 * What survives is only ever made *less* assertive here, so a pipeline change can never make a
 * report look stronger than the evidence allows.
 */
export const verifyFinding = (finding: FindingClaim, sources: EvidenceSources): Finding => {
  const conversation = verifyEvidenceList(
    finding.conversationEvidence ?? [],
    sources,
    "A conversation quote",
  );
  const agreement = verifyEvidenceList(
    finding.agreementEvidence ?? [],
    sources,
    "An agreement quote",
  );

  const issues = [...conversation.issues, ...agreement.issues];
  const unsupportedTerms = collectUnsupportedTerms(finding, sources);
  for (const term of unsupportedTerms) {
    issues.push(
      `The finding mentions "${term}", which does not appear in the pasted agreement or conversation.`,
    );
  }

  const status: EvidenceStatus = weakerStatus(conversation.status, agreement.status);
  const unsupported = status === "unverified" || unsupportedTerms.length > 0;

  return {
    id: finding.id,
    title: finding.title,
    classification: unsupported ? "needs_review" : finding.classification,
    explanation: finding.explanation,
    conversationEvidence: conversation.evidence,
    agreementEvidence: agreement.evidence,
    nextStep: finding.nextStep,
    ...(finding.impact === undefined ? {} : { impact: finding.impact }),
    ...(finding.confidence === undefined ? {} : { confidence: finding.confidence }),
    confidenceIsEstimate: true,
    evidenceStatus: status,
    evidenceIssues: issues.slice(0, MAX_EVIDENCE_ISSUES),
  };
};

/** Returns the less confident of two statuses; `verified` is the weakest possible signal. */
const weakerStatus = (left: EvidenceStatus, right: EvidenceStatus): EvidenceStatus => {
  if (left === "verified") return right;
  if (right === "verified") return left;
  return left === "unverified" || right === "unverified" ? "unverified" : "partial";
};

/**
 * Verifies the evidence attached to extracted agreement or conversation items.
 *
 * The extraction schemas have no verification status field, so this returns the count of items
 * whose quotes could not be found. `lib/analysis.ts` turns that into a report limitation instead
 * of hiding it.
 */
export const countUnverifiedExtractionEvidence = (
  extraction: AgreementExtraction | ConversationExtraction,
  source: Evidence["source"],
  document: string,
): { items: number; quotes: number } => {
  const groups = Object.values(extraction) as Array<Array<{ evidence?: Evidence[] }>>;
  let items = 0;
  let quotes = 0;

  for (const group of groups) {
    for (const item of group) {
      const evidence = item.evidence ?? [];
      if (evidence.length === 0) continue;
      const failed = evidence.filter(
        (entry) => !findExactQuote(document, entry.quote).found,
      );
      if (failed.length > 0) {
        items += 1;
        quotes += failed.length;
      }
    }
  }

  return { items, quotes };
};