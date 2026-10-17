import { z } from "zod";

export const MIN_TEXT_LENGTH = 20;
export const MAX_TEXT_LENGTH = 20_000;

export const SCOPE_CLASSIFICATIONS = [
  "in_scope",
  "potentially_out_of_scope",
  "unclear",
  "needs_review",
] as const;

export type ScopeClassification = (typeof SCOPE_CLASSIFICATIONS)[number];

const requiredText = (label: string) =>
  z
    .string()
    .trim()
    .min(MIN_TEXT_LENGTH, `Paste at least ${MIN_TEXT_LENGTH} characters of ${label}.`)
    .max(MAX_TEXT_LENGTH, `Keep ${label} under ${MAX_TEXT_LENGTH.toLocaleString("en-US")} characters.`);

export const agreementTextSchema = requiredText("the agreement");
export const conversationTextSchema = requiredText("the conversation");

export const analyzeInputSchema = z.object({
  agreement: agreementTextSchema,
  conversation: conversationTextSchema,
});

export type AnalyzeInput = z.infer<typeof analyzeInputSchema>;

// ---------------------------------------------------------------------------
// Report contracts
//
// Every model-produced value is validated here before it can reach the UI.
// Objects are strict: unknown keys are rejected instead of silently dropped, so
// a hallucinated or misspelled field fails loudly. Nothing here logs, fetches,
// or reads the environment.
// ---------------------------------------------------------------------------

export const MAX_QUOTE_LENGTH = 2_000;
export const MAX_EXPLANATION_LENGTH = 4_000;
export const MAX_NEXT_STEP_LENGTH = 1_000;
export const MAX_TITLE_LENGTH = 200;
export const MAX_SUMMARY_LENGTH = 2_000;
export const MAX_LIMITATION_LENGTH = 500;
export const MAX_EVIDENCE_PER_FINDING = 5;
export const MAX_EVIDENCE_ISSUES = 10;
export const MAX_EVIDENCE_NOTE_LENGTH = 300;
export const MAX_LIMITATIONS = 10;
export const MAX_FINDINGS = 50;
export const MAX_TERMS_PER_CATEGORY = 25;
export const MAX_REVISION_LIMITS = 10;
export const MAX_SCHEDULE_ITEMS = 10;
export const MAX_CONVERSATION_ITEMS = 40;

export const EVIDENCE_SOURCES = ["agreement", "conversation"] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

const trimmedText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `Keep ${label.toLowerCase()} under ${max.toLocaleString("en-US")} characters.`);

const identifier = z
  .string()
  .trim()
  .min(1, "An id is required.")
  .max(100, "Keep ids under 100 characters.");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this text under ${max.toLocaleString("en-US")} characters.`)
    .optional();

// --- Evidence --------------------------------------------------------------

export const evidenceSchema = z.strictObject({
  quote: trimmedText("An evidence quote", MAX_QUOTE_LENGTH),
  source: z.enum(EVIDENCE_SOURCES),
});

export type Evidence = z.infer<typeof evidenceSchema>;

const evidenceList = (max: number) => z.array(evidenceSchema).max(max);

// --- Agreement extraction --------------------------------------------------

const evidenceBackedItem = (label: string) =>
  z.strictObject({
    id: identifier,
    description: trimmedText(`A ${label} description`, MAX_EXPLANATION_LENGTH),
    evidence: evidenceList(MAX_EVIDENCE_PER_FINDING).default([]),
  });

export const deliverableSchema = evidenceBackedItem("deliverable");

export type Deliverable = z.infer<typeof deliverableSchema>;

export const exclusionSchema = evidenceBackedItem("exclusion");

export type Exclusion = z.infer<typeof exclusionSchema>;

export const assumptionSchema = evidenceBackedItem("assumption");

export type Assumption = z.infer<typeof assumptionSchema>;

export const ambiguitySchema = evidenceBackedItem("ambiguity");

export type Ambiguity = z.infer<typeof ambiguitySchema>;

export const revisionLimitSchema = evidenceBackedItem("revision limit");

export type RevisionLimit = z.infer<typeof revisionLimitSchema>;

export const deadlineSchema = evidenceBackedItem("deadline");

export type Deadline = z.infer<typeof deadlineSchema>;

export const agreementExtractionSchema = z.strictObject({
  deliverables: z.array(deliverableSchema).max(MAX_TERMS_PER_CATEGORY).default([]),
  exclusions: z.array(exclusionSchema).max(MAX_TERMS_PER_CATEGORY).default([]),
  revisionLimits: z.array(revisionLimitSchema).max(MAX_REVISION_LIMITS).default([]),
  deadlines: z.array(deadlineSchema).max(MAX_SCHEDULE_ITEMS).default([]),
  assumptions: z.array(assumptionSchema).max(MAX_TERMS_PER_CATEGORY).default([]),
  ambiguities: z.array(ambiguitySchema).max(MAX_TERMS_PER_CATEGORY).default([]),
});

export type AgreementExtraction = z.infer<typeof agreementExtractionSchema>;

// --- Conversation extraction ----------------------------------------------

const conversationItemSchema = (label: string) =>
  z.strictObject({
    id: identifier,
    text: trimmedText(`A ${label}`, MAX_EXPLANATION_LENGTH),
    speaker: optionalText(200),
    order: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .optional(),
    evidence: z
      .array(evidenceSchema)
      .min(1, `A ${label} needs at least one conversation quote.`)
      .max(MAX_EVIDENCE_PER_FINDING),
  });

export const conversationRequestSchema = conversationItemSchema("request");

export type ConversationRequest = z.infer<typeof conversationRequestSchema>;

export const commitmentSchema = conversationItemSchema("commitment");

export type Commitment = z.infer<typeof commitmentSchema>;

export const decisionSchema = conversationItemSchema("decision");

export type Decision = z.infer<typeof decisionSchema>;

export const conversationExtractionSchema = z.strictObject({
  requests: z.array(conversationRequestSchema).max(MAX_CONVERSATION_ITEMS).default([]),
  commitments: z.array(commitmentSchema).max(MAX_CONVERSATION_ITEMS).default([]),
  decisions: z.array(decisionSchema).max(MAX_CONVERSATION_ITEMS).default([]),
});

export type ConversationExtraction = z.infer<typeof conversationExtractionSchema>;

// --- Findings -------------------------------------------------------------

export const classificationSchema = z.enum(SCOPE_CLASSIFICATIONS);

export const modelFindingSchema = z.strictObject({
  id: identifier,
  title: trimmedText("A finding title", MAX_TITLE_LENGTH),
  classification: classificationSchema,
  explanation: trimmedText("A finding explanation", MAX_EXPLANATION_LENGTH),
  conversationEvidence: z
    .array(evidenceSchema)
    .min(1, "A finding needs at least one conversation quote.")
    .max(MAX_EVIDENCE_PER_FINDING),
  agreementEvidence: evidenceList(MAX_EVIDENCE_PER_FINDING).default([]),
  nextStep: trimmedText("A recommended next step", MAX_NEXT_STEP_LENGTH),
  impact: optionalText(MAX_EXPLANATION_LENGTH),
  confidence: z.number().min(0).max(1).optional(),
  confidenceIsEstimate: z.boolean().default(true),
});

export type ModelFinding = z.infer<typeof modelFindingSchema>;

export const EVIDENCE_STATUSES = ["verified", "partial", "unverified"] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const reportFindingSchema = modelFindingSchema.extend({
  evidenceStatus: z.enum(EVIDENCE_STATUSES),
  evidenceIssues: z
    .array(trimmedText("An evidence note", MAX_EVIDENCE_NOTE_LENGTH))
    .max(MAX_EVIDENCE_ISSUES)
    .default([]),
});

export type Finding = z.infer<typeof reportFindingSchema>;

// --- Report ----------------------------------------------------------------

export const limitationSchema = z.strictObject({
  text: trimmedText("A limitation", MAX_LIMITATION_LENGTH),
});

export type Limitation = z.infer<typeof limitationSchema>;

export const reportSummarySchema = z.strictObject({
  overview: trimmedText("A report summary", MAX_SUMMARY_LENGTH),
  limitations: z
    .array(limitationSchema)
    .min(1, "A report needs at least one stated limitation.")
    .max(MAX_LIMITATIONS),
});

export type ReportSummary = z.infer<typeof reportSummarySchema>;

export const scopeReportSchema = z
  .strictObject({
    agreement: agreementExtractionSchema,
    conversation: conversationExtractionSchema,
    findings: z.array(reportFindingSchema).max(MAX_FINDINGS).default([]),
    summary: reportSummarySchema,
  })
  .superRefine((report, ctx) => {
    const seen = new Set<string>();

    report.findings.forEach((finding, index) => {
      if (seen.has(finding.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["findings", index, "id"],
          message: `Duplicate finding id "${finding.id}".`,
        });
      }
      seen.add(finding.id);
    });
  });

export type ScopeReport = z.infer<typeof scopeReportSchema>;

export const ADVISORY_NOTICE =
  "Advisory only. ScopeSentry compares a client conversation against your agreement using a local model. It is not legal advice, not a legal determination, and not a statement that a contract has been breached.";

// ---------------------------------------------------------------------------
// Analyze API contracts
//
// One contract, two readers: the route handler builds a body that must satisfy
// these, and the browser parses the same schemas before it renders anything.
// That is what keeps an unvalidated finding out of the UI even if the handler
// and the client ever drift apart.
//
// `ANALYZE_ERROR_CODES` mirrors `OLLAMA_ERROR_CODES` from `lib/ollama.ts` and
// adds the two failures decided before a model is involved. It is written out
// here rather than spread from that module on purpose: `lib/schemas.ts` is
// imported by client components, and `lib/ollama.ts` is server-only code that
// reads `process.env` and calls `fetch`. Importing it would drag the Ollama
// client into the browser bundle. `tests/schemas.test.ts` asserts the two lists
// stay in step, so the duplication cannot drift.
// ---------------------------------------------------------------------------

export const ANALYZE_ERROR_CODES = [
  "invalid_request",
  "invalid_input",
  "config_invalid",
  "unavailable",
  "model_missing",
  "timeout",
  "bad_request",
  "server_error",
  "malformed_output",
] as const;

export type AnalyzeErrorCode = (typeof ANALYZE_ERROR_CODES)[number];

/** A rejected field. Carries a path and a static message, never the field's value. */
export const analyzeInputIssueSchema = z.strictObject({
  path: z.string().max(200),
  message: z.string().max(500),
});

export type AnalyzeInputIssue = z.infer<typeof analyzeInputIssueSchema>;

/**
 * Builds the one error envelope both browser-facing routes use.
 *
 * Factored so the shape — including the guarantee that a `message` is a static, user-safe string
 * and that `issues` carries a path and a message but never a field's value — is declared once
 * and cannot drift between `/api/analyze` and `/api/reply`.
 */
const buildErrorEnvelope = <const TCodes extends readonly string[]>(codes: TCodes) =>
  z.strictObject({
    error: z.strictObject({
      code: z.enum(codes),
      /** Already user-safe and static: it never contains pasted text, a prompt, or an endpoint. */
      message: z.string().trim().min(1).max(1_000),
      retryable: z.boolean(),
      issues: z.array(analyzeInputIssueSchema).max(20).optional(),
    }),
  });

export const analyzeErrorSchema = buildErrorEnvelope(ANALYZE_ERROR_CODES);

export type AnalyzeError = z.infer<typeof analyzeErrorSchema>;

/**
 * What the report was produced with, minus the endpoint.
 *
 * `model` is the configured local tag and `durationMs` is server wall-clock time.
 * Neither is a secret and both make the "it ran locally, and it was slow" claim
 * checkable instead of asserted. The Ollama base URL is deliberately absent: it
 * must never reach the browser.
 */
export const analyzeMetaSchema = z.strictObject({
  model: z.string().trim().min(1).max(200),
  durationMs: z.number().int().nonnegative(),
});

export type AnalyzeMeta = z.infer<typeof analyzeMetaSchema>;

export const analyzeResponseSchema = z.strictObject({
  report: scopeReportSchema,
  meta: analyzeMetaSchema,
});

export type AnalyzeResponse = z.infer<typeof analyzeResponseSchema>;

/**
 * A failure the browser can render, either parsed from an error envelope or
 * produced locally when the request never produced a usable response.
 *
 * Generic over the error-code union so `/api/analyze` and `/api/reply` share one
 * shape while keeping their own closed code sets.
 */
export type ApiFailure<TCode extends string = AnalyzeErrorCode> = {
  code: TCode | "network_error" | "invalid_response";
  message: string;
  retryable: boolean;
  issues: AnalyzeInputIssue[];
};

export type AnalyzeFailure = ApiFailure<AnalyzeErrorCode>;

/**
 * The client's request state as one closed union, so "loading" and "has a
 * report" cannot both be true and no branch has to defend against a state it
 * was not written for.
 */
export type AnalysisState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "succeeded"; report: ScopeReport; meta: AnalyzeMeta }
  | { status: "failed"; error: AnalyzeFailure };

// ---------------------------------------------------------------------------
// Reply drafting
//
// The reply is derived from one finding in an already-validated report, but the
// route does not trust that report: it re-checks every quote against the pasted
// documents itself (see `lib/reply.ts`) and drops any draft that asserts a price,
// date, quotation, commitment, or accusation the documents do not support.
// ---------------------------------------------------------------------------

/**
 * What a drafted message is for. A label the UI shows, not a claim about scope:
 * the classification that matters is the finding's, and it is already on the card.
 */
export const REPLY_INTENTS = [
  "clarify_scope",
  "ask_question",
  "discuss_additional_work",
] as const;

export type ReplyIntent = (typeof REPLY_INTENTS)[number];

/**
 * A short client message is the whole product here, so the cap is generous but
 * not unbounded: anything longer is a letter, not a reply to one finding.
 */
export const MAX_REPLY_LENGTH = 1_500;
export const MAX_FINDING_ID_LENGTH = 100;

export const replyDraftSchema = z.strictObject({
  intent: z.enum(REPLY_INTENTS),
  body: trimmedText("The draft message", MAX_REPLY_LENGTH),
});

export type ReplyDraft = z.infer<typeof replyDraftSchema>;

const findingIdSchema = z
  .string()
  .trim()
  .min(1, "Choose a finding to draft a reply for.")
  .max(MAX_FINDING_ID_LENGTH, `Keep the finding id under ${MAX_FINDING_ID_LENGTH} characters.`);

/**
 * Everything the route needs to ground a draft.
 *
 * The two pasted documents travel with the report on purpose: `evidenceStatus`
 * is a flag the browser sent, and a flag is not evidence. Re-sending the source
 * text is what lets the route re-verify the finding's quotes with
 * `findExactQuote` instead of believing it. Both documents are already held in
 * `ScopeForm` state, so this costs the user nothing and adds no storage.
 */
export const replyInputSchema = z.strictObject({
  agreement: agreementTextSchema,
  conversation: conversationTextSchema,
  report: scopeReportSchema,
  findingId: findingIdSchema,
});

export type ReplyInput = z.infer<typeof replyInputSchema>;

/**
 * `ANALYZE_ERROR_CODES` plus `missing_context` (a finding with nothing verified to
 * base a draft on) and `draft_rejected` (the model asserted something the
 * documents do not support, so the draft was discarded). The Ollama codes are
 * written out rather than spread for the reason given above, and
 * `tests/reply-handler.test.ts` asserts the two lists stay in step.
 */
export const REPLY_ERROR_CODES = [
  "invalid_request",
  "invalid_input",
  "missing_context",
  "config_invalid",
  "unavailable",
  "model_missing",
  "timeout",
  "bad_request",
  "server_error",
  "malformed_output",
  "draft_rejected",
] as const;

export type ReplyErrorCode = (typeof REPLY_ERROR_CODES)[number];

export const replyErrorSchema = buildErrorEnvelope(REPLY_ERROR_CODES);

export type ReplyError = z.infer<typeof replyErrorSchema>;

/**
 * The draft, which finding it belongs to, and which local model wrote it.
 *
 * `groundedQuotes` is the evidence the route re-verified and the model was shown, so
 * the browser can display it and the user can see the draft's basis — and, when
 * `droppedQuotes` is above zero, that some of the finding's quotes were left out.
 */
export const replyResponseSchema = z.strictObject({
  findingId: findingIdSchema,
  draft: replyDraftSchema,
  /** Same two fields as an analysis: the model tag, and how long the server waited. */
  meta: analyzeMetaSchema,
  groundedQuotes: z
    .array(trimmedText("A grounded quote", MAX_QUOTE_LENGTH))
    .max(MAX_EVIDENCE_PER_FINDING * 2),
  droppedQuotes: z.number().int().nonnegative().max(100),
  /** True when a repeated tail was cut off the draft before it was shown. */
  trimmed: z.boolean(),
});

export type ReplyResponse = z.infer<typeof replyResponseSchema>;

export type ReplyFailure = ApiFailure<ReplyErrorCode>;

/**
 * The composer's state as one closed union, mirroring `AnalysisState`.
 *
 * The success branch carries the whole validated response rather than a field or two
 * of it, so what the UI renders is exactly what `replyResponseSchema` accepted —
 * including the verified quotes the draft was grounded in.
 */
export type ReplyState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "succeeded"; response: ReplyResponse }
  | { status: "failed"; error: ReplyFailure };

/**
 * Rendered with every draft. It states what the text is, that it came from the
 * local model, that the user owns it before it leaves their outbox, and that
 * ScopeSentry has no way to send it.
 */
export const DRAFT_NOTICE =
  "Draft only. The local model wrote this from the evidence shown above, and it is advisory text, not legal advice. Read it, change anything you disagree with, and send it yourself — ScopeSentry cannot send messages for you.";