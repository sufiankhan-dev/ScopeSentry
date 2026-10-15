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
import { SAMPLE_AGREEMENT, SAMPLE_CONVERSATION } from "@/lib/samples";
import {
  MAX_TEXT_LENGTH,
  agreementTextSchema,
  analyzeInputSchema,
  conversationTextSchema,
} from "@/lib/schemas";

const LIMIT = MAX_TEXT_LENGTH.toLocaleString("en-US");

type TextFieldName = "agreement" | "conversation";

type TouchedState = Record<TextFieldName, boolean>;

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

  function loadSample() {
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
    <form className="flex flex-col gap-6" onSubmit={handleSubmit} noValidate>
      <FieldGroup className="md:grid md:grid-cols-2 md:gap-x-10">
        <Field data-invalid={agreementError ? true : undefined}>
          <FieldLabel htmlFor="agreement">
            Original agreement
            <span className="font-mono text-xs font-normal text-muted-foreground">
              {agreement.length.toLocaleString("en-US")} / {LIMIT}
            </span>
          </FieldLabel>
          <Textarea
            id="agreement"
            name="agreement"
            value={agreement}
            onChange={(event) => setAgreement(event.target.value)}
            onBlur={() => markTouched("agreement")}
            aria-invalid={agreementError ? true : undefined}
            aria-describedby={agreementError ? "agreement-error" : "agreement-hint"}
            placeholder="Paste the proposal, brief, or signed agreement you agreed to."
            className="field-sizing-fixed min-h-52 resize-y"
          />
          {agreementError ? (
            <FieldError id="agreement-error">{agreementError}</FieldError>
          ) : (
            <FieldDescription id="agreement-hint">
              Deliverables, revision limits, exclusions, deadlines, and anything the
              agreement leaves ambiguous.
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={conversationError ? true : undefined}>
          <FieldLabel htmlFor="conversation">
            Client conversation
            <span className="font-mono text-xs font-normal text-muted-foreground">
              {conversation.length.toLocaleString("en-US")} / {LIMIT}
            </span>
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
            placeholder="Paste the email thread or chat where the requests are made."
            className="field-sizing-fixed min-h-52 resize-y"
          />
          {conversationError ? (
            <FieldError id="conversation-error">{conversationError}</FieldError>
          ) : (
            <FieldDescription id="conversation-hint">
              Keep speaker names and message order exactly as written.
            </FieldDescription>
          )}
        </Field>
      </FieldGroup>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={!isValid}>
          Analyze scope
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={loadSample}>
          Load sample input
        </Button>
        {!isValid ? (
          <p className="text-sm text-muted-foreground">
            Both fields need at least 20 characters.
          </p>
        ) : null}
      </div>

      {submitted ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-secondary px-4 py-3 text-sm leading-relaxed text-secondary-foreground"
        >
          Analysis is not connected yet. Your text stayed in this browser tab and
          nothing was sent anywhere. The next build runs the same check against a
          local Ollama model and returns a scope report.
        </p>
      ) : null}
    </form>
  );
}