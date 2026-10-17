import { z } from "zod";

import { PIPELINE_STAGE_TIMEOUT_MS } from "./analysis.ts";
import { CONCRETE_TERM_PATTERNS, findExactQuote } from "./evidence.ts";
import type { EvidenceSources } from "./evidence.ts";
import { chatJson, getOllamaConfig } from "./ollama.ts";
import type { OllamaDependencies } from "./ollama.ts";
import { buildReplyMessages } from "./prompts.ts";
import type { ReplyContext } from "./prompts.ts";
import type { AnalyzeInputIssue, Evidence, ReplyDraft, ReplyErrorCode } from "./schemas.ts";
import { replyDraftSchema, replyInputSchema } from "./schemas.ts";

/**
 * One model call in, one verified draft out.
 *
 * The draft is the first thing ScopeSentry produces that a freelancer might put in
 * front of a client, so this module is built around one rule: **nothing reaches the
 * user that the pasted documents do not support.**
 *
 * Four things enforce it:
 *  1. the finding is located by id in a report that must satisfy `scopeReportSchema`;
 *  2. every quote it cites is re-verified here with `findExactQuote` against the
 *     documents the caller re-sent, so a doctored `evidenceStatus: "verified"` buys
 *     nothing and an unverifiable quote never reaches the prompt;
 *  3. only those re-verified quotes are handed to the model, never the pasted text;
 *  4. the returned draft is checked for invented figures, invented quotations,
 *     accusations or commitments, and leftover placeholders. Any failure discards the
 *     draft entirely — the user gets a static message, not a warning attached to text
 *     they might send.
 *
 * Nothing here logs, persists, retries elsewhere, or sends anything. `fetch` and
 * `env` are injectable only so the tests can run without a model.
 */

/**
 * Generation options for the draft stage.
 *
 * A reply is the only output in this app that is long free prose inside a JSON string, and
 * that is what makes these two values different from `lib/analysis.ts`.
 *
 * - `num_predict: 900` rather than a tighter budget. The measured problem was the opposite
 *   of a tight budget: when `gemma3:4b` ran on past the end of the message it kept going
 *   until the limit, and the token it needed to close the JSON object was the one it ran
 *   out of, so the whole draft came back `malformed_output`. At 900 tokens the measured
 *   runs finished on their own in 92–340 tokens; at 400–512 two runs hit the limit with
 *   the closing brace never written.
 * - `repeat_penalty` is deliberately **not** raised. It looked like the fix — at 1.15 two
 *   drafts came back clean in 22 s and 29 s — but Ollama's own llama.cpp sampler then
 *   aborted three of five later runs with `prediction aborted, token repeat limit reached`,
 *   which surfaces to the user as `server_error`. Trading a tail we can trim for an outright
 *   failure is the wrong trade, so the penalty stays at the default and `trimDegenerateTail`
 *   below handles the tail instead.
 */
export const REPLY_OPTIONS = { num_ctx: 4_096, num_predict: 900 } as const;

/**
 * A body shorter than this after cleaning is not a message.
 *
 * `trimDegenerateTail` can leave a stub when the model started repeating almost
 * immediately. There is nothing worth showing in that case, so the draft is discarded
 * like any other unusable output.
 */
export const MIN_REPLY_LENGTH = 40;

/**
 * Input the route refused to draft from, or a draft the guards refused to return.
 *
 * Carries a code, a retryable flag, an already user-safe static message, and
 * optionally the field paths that failed. It never holds a field's value, so it is
 * safe to map straight onto a response body.
 */
export class ReplyError extends Error {
  readonly code: ReplyErrorCode;
  readonly retryable: boolean;
  readonly issues: ReadonlyArray<AnalyzeInputIssue>;

  constructor(
    code: ReplyErrorCode,
    message: string,
    options: { retryable?: boolean; issues?: ReadonlyArray<AnalyzeInputIssue> } = {},
  ) {
    super(message);
    this.name = "ReplyError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.issues = options.issues ?? [];
  }
}

/** Narrows a thrown value for a route handler. */
export const isReplyError = (value: unknown): value is ReplyError => value instanceof ReplyError;

// --- Static messages --------------------------------------------------------
//
// None of these contain pasted text, a quote, a draft, a prompt, or an endpoint,
// and none of them say which guard fired: a reason would have to quote the model's
// own output back to the browser.

export const INVALID_INPUT_MESSAGE =
  "ScopeSentry could not read the finding to draft from. Run the analysis again and pick a finding from the report.";

export const MISSING_CONTEXT_MESSAGE =
  "Nothing in this finding could be checked against the text you pasted, so there is no verified evidence to write from and no draft was made. Re-run the analysis, or pick a finding whose quotes matched.";

export const DRAFT_REJECTED_MESSAGE =
  "ScopeSentry discarded the draft because it contained something your agreement and conversation do not support, such as a figure, an obligation, or a commitment. Nothing was shown and nothing was sent. Try again, or write the message yourself.";

// --- Deterministic guards ----------------------------------------------------

/**
 * Figures a draft must not be able to state on its own.
 *
 * These are the same patterns `lib/evidence.ts` uses to downgrade a finding, so a
 * draft and the finding it is based on are held to one standard: a price or a date
 * has to be in the user's documents to appear in the message.
 */
export const findUnsupportedFigures = (draft: string, sources: EvidenceSources): string[] => {
  const haystack = `${sources.agreement}\n${sources.conversation}`.toLowerCase();
  const found = new Set<string>();

  for (const pattern of CONCRETE_TERM_PATTERNS) {
    // matchAll works on a copy of the regex, so the exported patterns stay stateless.
    for (const token of draft.matchAll(pattern)) {
      const text = token[0];
      if (!haystack.includes(text.toLowerCase())) {
        found.add(text);
      }
    }
  }

  return [...found];
};

/**
 * Every quoted span in the draft.
 *
 * Only double quotes — straight or curly — delimit a span. Apostrophes do not: in
 * a client message an apostrophe is overwhelmingly part of a contraction ("don't",
 * "we'll"), and treating those as quotations would reject perfectly good drafts on
 * the fragment "ll". An unterminated quote yields nothing rather than the rest of
 * the message, because guessing there would reject drafts for the wrong reason.
 */
export const extractQuotedSpans = (text: string): string[] => {
  const spans: string[] = [];

  for (const match of text.matchAll(/([“"])([^"”]*?)[”"]/g)) {
    const inner = match[2];
    if (inner !== undefined && inner.trim() !== "") {
      spans.push(inner.trim());
    }
  }

  return spans;
};

/**
 * Quotation the documents do not contain.
 *
 * This is the anti-fabricated-clause rule. A draft may repeat the user's own words
 * — quoting the agreement back to the client is the point — but text that does not
 * occur in either document was invented, whatever the quotation marks were for.
 */
export const findUnsupportedQuotations = (draft: string, sources: EvidenceSources): string[] =>
  extractQuotedSpans(draft).filter(
    (span) =>
      !findExactQuote(sources.agreement, span).found &&
      !findExactQuote(sources.conversation, span).found,
  );

export type ForbiddenCategory = "accusation" | "commitment" | "placeholder";

/**
 * Phrasing that must never appear in a draft, grouped by what it would do to the
 * freelancer if they sent it.
 *
 * Both categories are deliberately narrow:
 * - `accusation` covers blame, breach talk, and legal or contract language. A scope
 *   question is not a dispute, and the evidence may not support an accusation at all.
 * - `commitment` covers promises made in the freelancer's own voice. ScopeSentry
 *   cannot know what the freelancer will agree to, and a promise is the one mistake
 *   they cannot un-send. The future tense itself is fine — asking "Would Tuesday
 *   work for you?" is exactly what this feature is for — so the patterns are built
 *   around the constructions that bind the freelancer to work, an outcome, a payment,
 *   or a date. "I can provide this as a small addition" is deliberately *not* one of
 *   them: the model produced it unprompted on a live run, it reads as a scope
 *   observation rather than a promise, and rejecting it would make the feature look
 *   broken on the most ordinary phrasing there is.
 *
 * This is a lexicon, not a judgement: it catches the constructions that matter and
 * will miss deliberate rephrasings. That is why the UI keeps telling the user to read
 * the draft, and why a miss is not presented as a guarantee.
 */
export const FORBIDDEN_PHRASING: ReadonlyArray<{
  category: ForbiddenCategory;
  pattern: RegExp;
}> = [
  {
    category: "accusation",
    pattern:
      /\b(?:breach(?:es|ed|ing)?|violat(?:e|es|ed|ion|ions)|unprofessional|bad faith|negligen(?:t|ce))\b/i,
  },
  {
    category: "accusation",
    pattern:
      /\byou (?:failed|neglected|did not|didn't|have not|haven't|never) (?:deliver|provide|send|do|meet|include|start|finish|pay|approve|confirm|respond|reply|acknowledge|supply|share|mention|promise|commit|agree|raise|tell|instruct)\b/i,
  },
  {
    category: "accusation",
    pattern:
      /\byou (?:owe|are owed|are in breach|are in violation|failed|are at fault|must)\b/i,
  },
  {
    category: "accusation",
    pattern:
      /\b(?:liable|liability|legal action|lawyer|attorney|lawsuit|court|damages|penalt(?:y|ies))\b/i,
  },
  {
    category: "commitment",
    pattern:
      /\b(?:i|we) (?:will|shall|'ll) (?:deliver|start|begin|finish|complete|include|provide|send|ship|build|redo|rework|cover|pay|refund|discount|guarantee)\b/i,
  },
  {
    category: "commitment",
    pattern: /\b(?:i|we) (?:promise|guarantee|commit to|assure you|can deliver)\b/i,
  },
  {
    category: "commitment",
    pattern:
      /\b(?:i|we) (?:can|could|will be able to) (?:deliver|complete|ship|redo|rework|commit) (?:it|this|that|these|those)\b/i,
  },
  // "I can do that by Friday" is a commitment with a date attached, whatever the verb.
  {
    category: "commitment",
    pattern:
      /\b(?:i|we) (?:can|could|will) (?:do|get|have|wrap|finish) (?:it|this|that|the \w+)(?: done| finished| wrapped)? (?:by|before|on|within|next|this|end)\b/i,
  },
  // Unfinished-template markers the user would have to fill in themselves.
  { category: "placeholder", pattern: /\[[^\]]*\]/ },
  { category: "placeholder", pattern: /\{\{[^}]*\}\}/ },
];

/** Which forbidden categories the draft trips, if any. Empty means it passed. */
export const findForbiddenPhrasing = (draft: string): ForbiddenCategory[] =>
  [
    ...new Set(
      FORBIDDEN_PHRASING.filter((entry) => entry.pattern.test(draft)).map(
        (entry) => entry.category,
      ),
    ),
  ];

/**
 * Repairs a generation that spilled past the end of the message.
 *
 * Observed with `gemma3:4b` on llama.cpp, repeatedly and in two shapes. The model writes a
 * perfectly good message and then keeps going: it emits a word count and loops on it —
 * `"…for this additional development?" 366 words 366 words 366 words…` — or it closes the JSON
 * object and then recites the drafting rules back — `"…within the document?"} 76 words.
 * 8 sentences. First person. Addressed to client. Plain text. …"`. Both shapes validate,
 * because everything after the message is still inside the body string, so without a repair
 * the unusable tail sits in the textarea for the user to discover.
 *
 * Trimming is the right repair rather than discarding, and the distinction matters: cutting
 * text off the end cannot introduce a claim the documents do not support, so this does not
 * weaken any of the guards above. It is still reported — the response carries `trimmed: true`
 * and the UI says the draft was shortened.
 *
 * Returns the cleaned body and whether anything was removed.
 */
export const trimDegenerateTail = (text: string): { body: string; trimmed: boolean } => {
  // First case: the model finished the message, closed the JSON object, and kept writing
  // anyway — everything after the close brace is still inside the body string, which is
  // why it validates. Both real repetitions had this shape, and the stray `"}` is an exact
  // marker for it, so it is checked before the general case below.
  const strayClose = /["”]\s*\}/.exec(text);
  if (strayClose) {
    return { body: tidyTail(text.slice(0, strayClose.index)), trimmed: true };
  }

  // Second case: a genuine block repetition, with no close brace to cut on — e.g. a word
  // count emitted after the last sentence. The block can be any length.
  const words = text.split(/\s+/).filter((word) => word !== "");
  const start = findRepeatedBlock(words);

  if (start === -1) {
    return { body: text.trim(), trimmed: false };
  }

  return { body: tidyTail(words.slice(0, start).join(" ")), trimmed: true };
};

/**
 * Index of the first word where a block repeats three times back to back, or -1.
 *
 * Compared word by word rather than by joining slices, so the scan allocates nothing: it
 * runs over the whole body on every draft.
 */
const findRepeatedBlock = (words: readonly string[]): number => {
  const equalsAt = (left: number, right: number, length: number): boolean => {
    for (let offset = 0; offset < length; offset += 1) {
      if (words[left + offset] !== words[right + offset]) return false;
    }
    return true;
  };

  for (let length = 1; length * 3 <= words.length; length += 1) {
    for (let start = 0; start + length * 3 <= words.length; start += 1) {
      if (
        equalsAt(start, start + length, length) &&
        equalsAt(start + length, start + length * 2, length)
      ) {
        return start;
      }
    }
  }

  return -1;
};

/** Drops a half-written sentence and an unbalanced quote left behind by the cut. */
const tidyTail = (text: string): string => {
  let trimmed = text.trimEnd();

  const lastStop = Math.max(
    trimmed.lastIndexOf("."),
    trimmed.lastIndexOf("!"),
    trimmed.lastIndexOf("?"),
    trimmed.lastIndexOf("”"),
  );
  // Only back off to the previous sentence when that still leaves something usable.
  if (lastStop >= Math.floor(trimmed.length * 0.5) && lastStop < trimmed.length - 1) {
    trimmed = trimmed.slice(0, lastStop + 1);
  }

  // A dangling quote is the model's, not the user's, so it goes rather than travelling
  // into the textarea.
  const quotes = (trimmed.match(/"/g) ?? []).length;
  if (quotes % 2 === 1 && trimmed.endsWith('"')) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }

  return trimmed;
};

// --- Pipeline ----------------------------------------------------------------

const parseInput = (input: unknown) => {
  const parsed = replyInputSchema.safeParse(input);
  if (parsed.success) return parsed.data;

  throw new ReplyError("invalid_input", INVALID_INPUT_MESSAGE, {
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
};

export type VerifiedReplyFinding = {
  findingId: string;
  context: ReplyContext;
  /** Quotes of the finding that could not be re-verified and so were left out. */
  droppedQuotes: number;
};

/**
 * Locates one finding and re-verifies every quote it cites.
 *
 * Surviving quotes are returned as the *user's own bytes*, sliced out of the pasted
 * document by `findExactQuote`, so the model is shown exactly what the user wrote
 * instead of the model's earlier attempt at copying it.
 *
 * Throws `missing_context` when the finding is not in the report, or when nothing in
 * it can be verified — the one case where there is no honest message to draft.
 */
export const verifyReplyFinding = (input: unknown): {
  finding: VerifiedReplyFinding;
  sources: EvidenceSources;
} => {
  const { agreement, conversation, report, findingId } = parseInput(input);
  const sources: EvidenceSources = { agreement, conversation };

  const finding = report.findings.find((entry) => entry.id === findingId);
  if (!finding) {
    throw new ReplyError("missing_context", MISSING_CONTEXT_MESSAGE);
  }

  const reVerify = (quotes: readonly Evidence[]) =>
    quotes
      .map((entry) => findExactQuote(sources[entry.source], entry.quote))
      .filter((match) => match.found)
      .map((match) => match.matchedText);

  const conversationQuotes = reVerify(finding.conversationEvidence);
  const agreementQuotes = reVerify(finding.agreementEvidence);

  if (conversationQuotes.length === 0 && agreementQuotes.length === 0) {
    // Nothing the user can produce, so there is nothing to base a message on. This is
    // decided before any model call, which is the point: an unverifiable finding must
    // not cost a minute of local inference to find out.
    throw new ReplyError("missing_context", MISSING_CONTEXT_MESSAGE);
  }

  return {
    sources,
    finding: {
      findingId,
      context: {
        title: finding.title,
        classification: finding.classification,
        explanation: finding.explanation,
        nextStep: finding.nextStep,
        conversationQuotes,
        agreementQuotes,
      },
      droppedQuotes:
        finding.conversationEvidence.length +
        finding.agreementEvidence.length -
        conversationQuotes.length -
        agreementQuotes.length,
    },
  };
};

/** Runs every guard. Any hit means the draft is not shown. */
export const findDraftProblems = (draft: ReplyDraft, sources: EvidenceSources): string[] => [
  ...findUnsupportedFigures(draft.body, sources),
  ...findUnsupportedQuotations(draft.body, sources),
  ...findForbiddenPhrasing(draft.body),
];

const jsonSchemaFor = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema) as Record<string, unknown>;

export type DraftReplyResult = {
  findingId: string;
  draft: ReplyDraft;
  meta: { model: string; durationMs: number };
  /** The verified quotes the draft was grounded in, so the UI can show them. */
  groundedQuotes: string[];
  droppedQuotes: number;
  /** True when a repeated tail was cut off the draft before it was shown. */
  trimmed: boolean;
};

/**
 * Drafts one client message for one finding.
 *
 * Returns the draft with the quotes it was based on, or throws:
 * - `ReplyError` with `invalid_input` or `missing_context`, both before any model call;
 * - `ReplyError` with `draft_rejected`, when the draft asserted something unsupported;
 * - `OllamaError` for configuration, connection, timeout, and malformed-output failures.
 */
export const draftReply = async (
  input: unknown,
  dependencies: OllamaDependencies = {},
): Promise<DraftReplyResult> => {
  const { finding, sources } = verifyReplyFinding(input);
  const startedAt = Date.now();

  // A single short generation, but the same generous per-stage budget the pipeline
  // uses, so a warm CPU-only machine is not cut off at the default 120 s.
  const timeoutMs = Math.max(
    getOllamaConfig(dependencies.env).timeoutMs,
    PIPELINE_STAGE_TIMEOUT_MS,
  );

  const { data } = await chatJson(
    {
      messages: buildReplyMessages(finding.context),
      schema: replyDraftSchema,
      format: jsonSchemaFor(replyDraftSchema),
      options: REPLY_OPTIONS,
      timeoutMs,
    },
    dependencies,
  );

  const draft: ReplyDraft = data;
  const { body, trimmed } = trimDegenerateTail(draft.body);

  if (body.length < MIN_REPLY_LENGTH || findDraftProblems({ ...draft, body }, sources).length > 0) {
    // The whole draft goes. Showing it with a warning would be the wrong call: the one
    // thing a user does with a draft is copy it, and a warning is the thing most
    // likely to be skimmed past on the way out.
    throw new ReplyError("draft_rejected", DRAFT_REJECTED_MESSAGE);
  }

  const { model } = getOllamaConfig(dependencies.env);

  return {
    findingId: finding.findingId,
    draft: { ...draft, body },
    meta: { model, durationMs: Date.now() - startedAt },
    groundedQuotes: [...finding.context.conversationQuotes, ...finding.context.agreementQuotes],
    droppedQuotes: finding.droppedQuotes,
    trimmed,
  };
};