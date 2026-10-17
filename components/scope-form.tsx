"use client";

import { AnalysisPanel } from "@/components/analysis-panel";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { FileText, MessagesSquare } from "lucide-react";
import {
  PLACEHOLDER_AGREEMENT,
  PLACEHOLDER_CONVERSATION,
  SAMPLE_AGREEMENT,
  SAMPLE_CONVERSATION,
  SAMPLE_LABEL,
} from "@/lib/samples";
import {
  MAX_TEXT_LENGTH,
  agreementTextSchema,
  analyzeErrorSchema,
  analyzeInputSchema,
  analyzeResponseSchema,
  conversationTextSchema,
} from "@/lib/schemas";
import type { AnalysisState, AnalyzeFailure, AnalyzeResponse } from "@/lib/schemas";
import { useState } from "react";

const LIMIT = MAX_TEXT_LENGTH.toLocaleString("en-US");

const ANALYZE_ENDPOINT = "/api/analyze";

/** Shown when the browser cannot reach ScopeSentry's own endpoint at all. */
const NETWORK_ERROR_MESSAGE =
  "ScopeSentry could not reach its analysis endpoint. Check that the app is still running, then try again. Your text is still in the fields above.";

/**
 * Shown when the endpoint answered with something that is not a report and not an
 * error envelope. Deliberately vague: an unexpected body is a bug or a proxy, and
 * quoting it could leak whatever a misconfigured proxy injected.
 */
const INVALID_RESPONSE_MESSAGE =
  "ScopeSentry received a response it could not read, so no findings were shown. Nothing was sent anywhere else. Try again.";

type TextFieldName = "agreement" | "conversation";

type TouchedState = Record<TextFieldName, boolean>;

function count(value: string) {
  return value.length.toLocaleString("en-US");
}

type AnalyzeOutcome =
  | { ok: true; response: AnalyzeResponse }
  | { ok: false; failure: AnalyzeFailure };

function invalidResponse(): AnalyzeOutcome {
  return {
    ok: false,
    failure: {
      code: "invalid_response",
      message: INVALID_RESPONSE_MESSAGE,
      retryable: true,
      issues: [],
    },
  };
}

/**
 * Turns whatever came back from `POST /api/analyze` into a validated outcome.
 *
 * The body is parsed against the shared contracts *before* anything is read out
 * of it, so the UI never indexes into an unverified object. A 200 whose body
 * fails `analyzeResponseSchema` is treated as an invalid response rather than
 * partially rendered, because a report is only trustworthy once it has been
 * through the same schema the server used.
 */
async function readAnalyzeResponse(response: Response): Promise<AnalyzeOutcome> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return invalidResponse();
  }

  if (!response.ok) {
    const parsed = analyzeErrorSchema.safeParse(body);
    if (!parsed.success) return invalidResponse();

    return {
      ok: false,
      failure: {
        code: parsed.data.error.code,
        message: parsed.data.error.message,
        retryable: parsed.data.error.retryable,
        issues: parsed.data.error.issues ?? [],
      },
    };
  }

  const parsed = analyzeResponseSchema.safeParse(body);
  if (!parsed.success) return invalidResponse();

  return { ok: true, response: parsed.data };
}

export function ScopeForm() {
  const [agreement, setAgreement] = useState("");
  const [conversation, setConversation] = useState("");
  const [touched, setTouched] = useState<TouchedState>({
    agreement: false,
    conversation: false,
  });
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: "idle" });

  const agreementResult = agreementTextSchema.safeParse(agreement);
  const conversationResult = conversationTextSchema.safeParse(conversation);
  const isValid = agreementResult.success && conversationResult.success;

  const agreementError =
    touched.agreement && !agreementResult.success
      ? (agreementResult.error.issues[0]?.message ?? null)
      : null;
  const conversationError =
    touched.conversation && !conversationResult.success
      ? (conversationResult.error.issues[0]?.message ?? null)
      : null;

  function markTouched(field: TextFieldName) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  function loadSample(field: TextFieldName) {
    if (field === "agreement") {
      setAgreement(SAMPLE_AGREEMENT);
    } else {
      setConversation(SAMPLE_CONVERSATION);
    }
    setAnalysis({ status: "idle" });
  }

  function loadSampleBoth() {
    setAgreement(SAMPLE_AGREEMENT);
    setConversation(SAMPLE_CONVERSATION);
    setAnalysis({ status: "idle" });
  }

  /**
   * Runs one analysis.
   *
   * Started from the submit handler rather than an effect, so it runs exactly
   * once per submission. The text state is deliberately left untouched, which is
   * what keeps the user's documents available to correct and retry after a
   * failure — nothing here clears or refetches a field.
   */
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = analyzeInputSchema.safeParse({ agreement, conversation });

    if (!result.success) {
      setTouched({ agreement: true, conversation: true });
      return;
    }

    setAnalysis({ status: "running" });

    try {
      const response = await fetch(ANALYZE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
      });

      const outcome = await readAnalyzeResponse(response);
      setAnalysis(
        outcome.ok
          ? { status: "succeeded", report: outcome.response.report, meta: outcome.response.meta }
          : { status: "failed", error: outcome.failure },
      );
    } catch {
      setAnalysis({
        status: "failed",
        error: {
          code: "network_error",
          message: NETWORK_ERROR_MESSAGE,
          retryable: true,
          issues: [],
        },
      });
    }
  }

  return (
    <form className="flex flex-col gap-8" onSubmit={handleSubmit} noValidate>
      <FieldGroup className="lg:grid lg:grid-cols-2 lg:gap-6">
        <Field
          data-invalid={agreementError ? true : undefined}
          className="gap-0 rounded-xl border border-border bg-card p-5 sm:p-6"
        >
          <div className="mb-4 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="font-mono text-xs tracking-widest text-muted-foreground"
            >
              01
            </span>
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
            <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
          </div>

          <FieldLabel htmlFor="agreement" className="text-base font-semibold">
            Original agreement
          </FieldLabel>

          <Textarea
            id="agreement"
            name="agreement"
            value={agreement}
            onChange={(event) => setAgreement(event.target.value)}
            onBlur={() => markTouched("agreement")}
            aria-invalid={agreementError ? true : undefined}
            aria-describedby={agreementError ? "agreement-error" : "agreement-hint"}
            placeholder={PLACEHOLDER_AGREEMENT}
            className="field-sizing-fixed mt-3 min-h-64 resize-y whitespace-pre-line text-sm leading-relaxed placeholder:whitespace-pre-line placeholder:text-muted-foreground/70"
          />

          {agreementError ? (
            <FieldError id="agreement-error" className="mt-2">
              {agreementError}
            </FieldError>
          ) : (
            <FieldDescription id="agreement-hint" className="mt-2">
              The proposal, brief, or signed agreement. Deliverables, revision limits,
              exclusions, deadlines, and anything it leaves ambiguous.
            </FieldDescription>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="font-mono text-xs text-muted-foreground">
              {count(agreement)} / {LIMIT}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title={`Fill this field with ${SAMPLE_LABEL.toLowerCase()}`}
              onClick={() => loadSample("agreement")}
            >
              Load sample
            </Button>
          </div>
        </Field>

        <Field
          data-invalid={conversationError ? true : undefined}
          className="gap-0 rounded-xl border border-border bg-card p-5 sm:p-6"
        >
          <div className="mb-4 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="font-mono text-xs tracking-widest text-muted-foreground"
            >
              02
            </span>
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
            <MessagesSquare
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
          </div>

          <FieldLabel htmlFor="conversation" className="text-base font-semibold">
            Client conversation
          </FieldLabel>

          <Textarea
            id="conversation"
            name="conversation"
            value={conversation}
            onChange={(event) => setConversation(event.target.value)}
            onBlur={() => markTouched("conversation")}
            aria-invalid={conversationError ? true : undefined}
            aria-describedby={
              conversationError ? "conversation-error" : "conversation-hint"
            }
            placeholder={PLACEHOLDER_CONVERSATION}
            className="field-sizing-fixed mt-3 min-h-64 resize-y whitespace-pre-line text-sm leading-relaxed placeholder:whitespace-pre-line placeholder:text-muted-foreground/70"
          />

          {conversationError ? (
            <FieldError id="conversation-error" className="mt-2">
              {conversationError}
            </FieldError>
          ) : (
            <FieldDescription id="conversation-hint" className="mt-2">
              The email thread or chat where the requests are made. Keep speaker names and
              message order exactly as written.
            </FieldDescription>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="font-mono text-xs text-muted-foreground">
              {count(conversation)} / {LIMIT}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title={`Fill this field with ${SAMPLE_LABEL.toLowerCase()}`}
              onClick={() => loadSample("conversation")}
            >
              Load sample
            </Button>
          </div>
        </Field>
      </FieldGroup>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={!isValid || analysis.status === "running"}>
            {analysis.status === "running" ? "Analyzing…" : "Analyze scope"}
          </Button>
          <Button
            type="button"
            variant="outline"
            title={`Fill both fields with ${SAMPLE_LABEL.toLowerCase()}`}
            onClick={loadSampleBoth}
          >
            Load both samples
          </Button>
        </div>
        {!isValid ? (
          <p className="text-sm text-muted-foreground">
            Both fields need at least 20 characters before analysis can run.
          </p>
        ) : null}
      </div>

      <AnalysisPanel state={analysis} documents={{ agreement, conversation }} />
    </form>
  );
}