"use client";

import { useState } from "react";

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
  analyzeInputSchema,
  conversationTextSchema,
} from "@/lib/schemas";

const LIMIT = MAX_TEXT_LENGTH.toLocaleString("en-US");

type TextFieldName = "agreement" | "conversation";

type TouchedState = Record<TextFieldName, boolean>;

function count(value: string) {
  return value.length.toLocaleString("en-US");
}

export function ScopeForm() {
  const [agreement, setAgreement] = useState("");
  const [conversation, setConversation] = useState("");
  const [touched, setTouched] = useState<TouchedState>({
    agreement: false,
    conversation: false,
  });
  const [submitted, setSubmitted] = useState(false);

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
    setSubmitted(false);
  }

  function loadSampleBoth() {
    setAgreement(SAMPLE_AGREEMENT);
    setConversation(SAMPLE_CONVERSATION);
    setSubmitted(false);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = analyzeInputSchema.safeParse({ agreement, conversation });

    if (!result.success) {
      setTouched({ agreement: true, conversation: true });
      return;
    }

    setSubmitted(true);
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
          <Button type="submit" size="lg" disabled={!isValid}>
            Analyze scope
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

      {submitted ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-border bg-muted/60 px-4 py-4 sm:px-5"
        >
          <p className="text-sm font-medium">Analysis engine not connected yet</p>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Your text stayed in this browser tab and nothing was sent anywhere. The next
            build runs the same check against a model on your own machine through Ollama and
            returns a scope report with the source text behind every finding.
          </p>
        </div>
      ) : null}
    </form>
  );
}