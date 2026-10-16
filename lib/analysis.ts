import { z } from "zod";

import { countUnverifiedExtractionEvidence, verifyFinding } from "./evidence.ts";
import type { EvidenceSources } from "./evidence.ts";
import {
  MAX_LIMITATIONS,
  MAX_LIMITATION_LENGTH,
  analyzeInputSchema,
  agreementExtractionSchema,
  conversationExtractionSchema,
  scopeReportSchema,
} from "./schemas.ts";
import type {
  AgreementExtraction,
  AnalyzeInput,
  ConversationExtraction,
  Finding,
  Limitation,
  ScopeReport,
} from "./schemas.ts";
import { chatJson, getOllamaConfig } from "./ollama.ts";
import { OllamaError } from "./ollama.ts";
import type { OllamaDependencies } from "./ollama.ts";
import {
  buildAgreementExtractionMessages,
  buildComparisonMessages,
  buildConversationExtractionMessages,
  comparisonOutputSchema,
} from "./prompts.ts";

/**
 * The analysis pipeline: pasted documents in, validated `ScopeReport` out.
 *
 * Three model calls, in the order AGENTS.md §8 describes:
 *   1. extract the agreement's deliverables, exclusions, revision limits, deadlines,
 *      assumptions, and ambiguities;
 *   2. extract the conversation's requests, commitments, and decisions;
 *   3. compare each request against the agreement and produce findings plus a summary.
 *
 * Everything the model produces is treated as a claim. Before a report leaves this function:
 * every quote is checked against the text the user pasted, unsupported figures downgrade the
 * finding to `needs_review`, missing coverage becomes a stated limitation, and the whole report
 * is re-validated against `scopeReportSchema`.
 *
 * Nothing here logs, persists, or retries against a different destination. `fetch` and `env` are
 * injectable only so tests can run offline.
 */

/** CPU-only inference is slow, so each call gets a bounded number of generated tokens. */
const EXTRACTION_OPTIONS = { num_ctx: 8_192, num_predict: 1_200 } as const;
const COMPARISON_OPTIONS = { num_ctx: 12_288, num_predict: 3_000 } as const;

/**
 * Per-stage budget for the pipeline.
 *
 * The client's default (`OLLAMA_TIMEOUT_MS`, 120 s) is enough for a small smoke-test request but
 * not for a real analysis: a live run of the committed sample against `gemma3:4b` on a CPU-only
 * Windows box generated at roughly 7 tokens per second, so one extraction stage ran past 120 s
 * and failed with `timeout`. The pipeline therefore asks for at least this much per stage and
 * keeps whatever longer budget the user configured.
 */
export const PIPELINE_STAGE_TIMEOUT_MS = 300_000;

export type AnalyzeDependencies = OllamaDependencies;

/**
 * Input the pipeline refused to analyze.
 *
 * Carries only field paths and static messages: a rejected agreement or conversation must never
 * end up in an error string that a route might log or echo back.
 */
export class AnalyzeInputError extends Error {
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(issues: ReadonlyArray<{ path: string; message: string }>) {
    super("The agreement or conversation could not be accepted.");
    this.name = "AnalyzeInputError";
    this.issues = issues;
  }
}

const parseInput = (input: unknown): AnalyzeInput => {
  const parsed = analyzeInputSchema.safeParse(input);
  if (parsed.success) return parsed.data;

  throw new AnalyzeInputError(
    parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  );
};

const jsonSchemaFor = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema) as Record<string, unknown>;

const extractAgreementTerms = async (
  agreement: string,
  timeoutMs: number,
  dependencies: AnalyzeDependencies,
): Promise<AgreementExtraction> => {
  const { data } = await chatJson(
    {
      messages: buildAgreementExtractionMessages(agreement),
      schema: agreementExtractionSchema,
      format: jsonSchemaFor(agreementExtractionSchema),
      options: EXTRACTION_OPTIONS,
      timeoutMs,
    },
    dependencies,
  );
  return data;
};

const extractConversationItems = async (
  conversation: string,
  timeoutMs: number,
  dependencies: AnalyzeDependencies,
): Promise<ConversationExtraction> => {
  const { data } = await chatJson(
    {
      messages: buildConversationExtractionMessages(conversation),
      schema: conversationExtractionSchema,
      format: jsonSchemaFor(conversationExtractionSchema),
      options: EXTRACTION_OPTIONS,
      timeoutMs,
    },
    dependencies,
  );
  return data;
};

// --- Application-written limitations ---------------------------------------

/** Always shown, because how a quote is matched is something the user should know. */
const MATCHING_NOTE =
  "Quote matching is whitespace- and punctuation-tolerant, so each evidence quote is the user's own text, not the model's rewording of it.";

/**
 * Limitations this module writes itself. The model's own `summary.limitations` stays in the
 * report; these entries cover the things only the application can know: context that was
 * shortened, extraction quotes that could not be found, and requests that never produced a
 * finding.
 */
const buildApplicationLimitations = (
  agreementExtraction: AgreementExtraction,
  dropped: { agreementItems: number; conversationItems: number },
  sources: EvidenceSources,
): Limitation[] => {
  const notes: string[] = [];

  if (dropped.agreementItems > 0 || dropped.conversationItems > 0) {
    notes.push(
      `The comparison step read only part of the extracted material (${dropped.agreementItems} agreement item(s) and ${dropped.conversationItems} conversation item(s) were left out of its context). Review those terms and requests yourself.`,
    );
  }

  const { items: unverifiedTerms } = countUnverifiedExtractionEvidence(
    agreementExtraction,
    sources,
  );

  if (unverifiedTerms > 0) {
    notes.push(
      `${unverifiedTerms} extracted agreement term(s) carried a quote that could not be found in the document it was attributed to. Treat those descriptions as unverified.`,
    );
  }

  return notes.map((text) => ({ text: text.slice(0, MAX_LIMITATION_LENGTH) }));
};

const findUnmatchedQuotes = (findings: readonly Finding[]): Limitation[] => {
  const flagged = findings.filter((finding) => finding.evidenceStatus !== "verified");

  if (flagged.length === 0) {
    return [{ text: MATCHING_NOTE }];
  }

  const unverified = flagged.filter((finding) => finding.evidenceStatus === "unverified");
  const parts: string[] = [
    `${flagged.length} of ${findings.length} finding(s) contain at least one quote that could not be found in the pasted text, so they are marked as needing review.`,
  ];

  for (const finding of unverified.slice(0, 3)) {
    parts.push(
      `${finding.title}: ${finding.evidenceIssues[0] ?? "no source quote could be verified"}`,
    );
  }

  return [{ text: parts.join(" ").slice(0, MAX_LIMITATION_LENGTH) }];
};

const buildCoverageLimitations = (
  requests: number,
  findings: number,
): Limitation[] => {
  if (requests === 0) {
    return [
      {
        text: "No client request could be identified in the pasted conversation, so this report has no comparison to make. Check that the conversation text is complete.",
      },
    ];
  }

  if (findings < requests) {
    return [
      {
        text: `${requests - findings} extracted request(s) produced no finding, so they are not covered below. Review the conversation for anything the analysis missed.`,
      },
    ];
  }

  return [];
};

/** Application limitations are deduplicated and capped so the contract's max always holds. */
const finalizeLimitations = (model: Limitation[], application: Limitation[]): Limitation[] => {
  const seen = new Set<string>();
  const merged: Limitation[] = [];

  for (const limitation of [...application, ...model]) {
    const text = limitation.text.trim().slice(0, MAX_LIMITATION_LENGTH);
    if (text === "" || seen.has(text)) continue;
    seen.add(text);
    merged.push({ text });
    if (merged.length >= MAX_LIMITATIONS) break;
  }

  // The contract requires at least one limitation, so the last resort is a static one.
  if (merged.length === 0) {
    merged.push({
      text: "This report compares two pasted documents with a local model. It cannot see anything else, and it is not legal advice.",
    });
  }

  return merged;
};

// --- Pipeline ---------------------------------------------------------------

/**
 * Runs the full analysis for one agreement and one conversation.
 *
 * Returns a report that parses with `scopeReportSchema`, or throws:
 * - `AnalyzeInputError` when the input is too short, too long, or missing;
 * - `OllamaError` for configuration, connection, timeout, and model-output failures.
 */
export const analyzeScope = async (
  input: AnalyzeInput,
  dependencies: AnalyzeDependencies = {},
): Promise<ScopeReport> => {
  const { agreement, conversation } = parseInput(input);
  const sources: EvidenceSources = { agreement, conversation };

  // Resolved through the client's own configuration reader, so a misconfigured setup still
  // fails with `config_invalid` and a generous OLLAMA_TIMEOUT_MS is never shortened.
  const stageTimeoutMs = Math.max(
    getOllamaConfig(dependencies.env).timeoutMs,
    PIPELINE_STAGE_TIMEOUT_MS,
  );

  // Sequential on purpose. A local Ollama server generates one request at a time on CPU, so
  // running the two extractions together would not make them faster; it would just make the
  // second one queue behind the first and blow the per-call timeout on a long agreement.
  const agreementExtraction = await extractAgreementTerms(agreement, stageTimeoutMs, dependencies);
  const conversationExtraction = await extractConversationItems(
    conversation,
    stageTimeoutMs,
    dependencies,
  );

  const comparisonPrompt = buildComparisonMessages(agreementExtraction, conversationExtraction);
  const comparison = await chatJson(
    {
      messages: comparisonPrompt.messages,
      schema: comparisonOutputSchema,
      format: jsonSchemaFor(comparisonOutputSchema),
      options: COMPARISON_OPTIONS,
      timeoutMs: stageTimeoutMs,
    },
    dependencies,
  );

  const findings = comparison.data.findings.map((finding) => verifyFinding(finding, sources));

  const limitations = finalizeLimitations(comparison.data.summary.limitations, [
    ...buildApplicationLimitations(agreementExtraction, comparisonPrompt.dropped, sources),
    ...buildCoverageLimitations(conversationExtraction.requests.length, findings.length),
    ...findUnmatchedQuotes(findings),
  ]);

  const candidate = {
    agreement: agreementExtraction,
    conversation: conversationExtraction,
    findings,
    summary: {
      overview: comparison.data.summary.overview,
      limitations,
    },
  };

  const report = scopeReportSchema.safeParse(candidate);
  if (!report.success) {
    // The three stages already validated their own payloads, so this is a defensive backstop
    // rather than an expected path. It is reported with the same typed error as bad model
    // output so a route can answer 502 instead of rendering an unchecked report.
    throw new OllamaError(
      "malformed_output",
      "The analysis could not be assembled into a valid report.",
      { cause: report.error },
    );
  }

  return report.data;
};

/** Narrows a thrown value for a route handler. */
export const isAnalyzeInputError = (value: unknown): value is AnalyzeInputError =>
  value instanceof AnalyzeInputError;