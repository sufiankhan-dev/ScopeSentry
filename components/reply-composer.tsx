"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { DRAFT_NOTICE, replyErrorSchema, replyResponseSchema } from "@/lib/schemas";
import type {
  Finding,
  ReplyDraft,
  ReplyFailure,
  ReplyResponse,
  ReplyState,
  ScopeReport,
} from "@/lib/schemas";
import { Copy, Loader, MessageSquareQuote, RefreshCw, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";

/**
 * Drafts one client message from one finding, and hands it to the user as text they own.
 *
 * Three rules shape this component, and all three are about not overpromising what
 * the model produced:
 *
 *  1. **The draft is editable.** The generated text lands in a `<textarea>`, not a
 *     read-only block, because the user's next move is always to rewrite it. The
 *     regenerate button changes its label once the text has been edited, so a
 *     regeneration can never silently destroy their wording.
 *  2. **Nothing is sent.** There is no `mailto:`, no outbound request, and no integration
 *     anywhere in this file. The only fetch is `POST /api/reply`, and the only other
 *     side effect is a write to the clipboard the user asked for. `DRAFT_NOTICE` says
 *     so next to the text rather than in a footer nobody reads.
 *  3. **The basis is visible.** The verified quotes the draft was based on are shown,
 *     and when the finding had quotes that could not be checked, or quotes that were
 *     left out, the component says so instead of presenting the draft as equally solid.
 */

const REPLY_ENDPOINT = "/api/reply";

/** What each intent means, so the badge is more than a contract value. */
const INTENT_LABELS: Record<ReplyDraft["intent"], string> = {
  clarify_scope: "Clarifies what the agreement covers",
  ask_question: "Asks the client a question",
  discuss_additional_work: "Proposes discussing extra work",
};

/** Shown when the browser cannot reach ScopeSentry's own endpoint at all. */
const NETWORK_ERROR_MESSAGE =
  "ScopeSentry could not reach its reply endpoint. Check that the app is still running, then try again. Your report and your pasted text are untouched.";

/**
 * Shown when the endpoint answered with something that is neither a draft nor an
 * error envelope. Deliberately vague: quoting an unexpected body could leak whatever
 * a proxy injected.
 */
const INVALID_RESPONSE_MESSAGE =
  "ScopeSentry received a response it could not read, so no draft was shown. Nothing was sent anywhere else. Try again.";

/** The two source documents, re-sent so the server can re-verify the finding's quotes. */
export type ReplyDocuments = {
  agreement: string;
  conversation: string;
};

function invalidResponse(): ReplyFailure {
  return {
    code: "invalid_response",
    message: INVALID_RESPONSE_MESSAGE,
    retryable: true,
    issues: [],
  };
}

function networkFailure(): ReplyFailure {
  return {
    code: "network_error",
    message: NETWORK_ERROR_MESSAGE,
    retryable: true,
    issues: [],
  };
}

/**
 * Turns whatever came back from `POST /api/reply` into a validated outcome.
 *
 * Both shapes are parsed with the shared contracts before anything is read out of them,
 * so the UI never renders text the server did not guarantee. An error envelope is parsed
 * rather than replaced: its message is the only thing that distinguishes "there was
 * nothing to draft from" from "the model was not answering", and collapsing both into one
 * string would leave the user with nothing to act on. A body that is neither shape is an
 * invalid response, not a partial render.
 */
async function readReplyResponse(
  response: Response,
): Promise<{ ok: true; response: ReplyResponse } | { ok: false; error: ReplyFailure }> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: invalidResponse() };
  }

  if (!response.ok) {
    const parsed = replyErrorSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: invalidResponse() };

    return {
      ok: false,
      error: {
        code: parsed.data.error.code,
        message: parsed.data.error.message,
        retryable: parsed.data.error.retryable,
        issues: parsed.data.error.issues ?? [],
      },
    };
  }

  const parsed = replyResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: invalidResponse() };
  }

  return { ok: true, response: parsed.data };
}

export function ReplyComposer({
  finding,
  report,
  documents,
}: {
  finding: Finding;
  report: ScopeReport;
  documents: ReplyDocuments;
}) {
  const [state, setState] = useState<ReplyState>({ status: "idle" });
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const draftId = useId();
  const bodyId = `${draftId}-body`;

  /**
   * Runs one draft.
   *
   * Started from the button's click handler rather than an effect, so it runs exactly
   * once per press. Nothing here clears the report or the pasted text: a failure must
   * leave the user exactly where they were, with their documents still on the page.
   */
  async function generate() {
    setState({ status: "running" });
    setCopyState("idle");

    try {
      const response = await fetch(REPLY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agreement: documents.agreement,
          conversation: documents.conversation,
          report,
          findingId: finding.id,
        }),
      });

      const outcome = await readReplyResponse(response);

      if (outcome.ok) {
        setText(outcome.response.draft.body);
        setDirty(false);
        setState({ status: "succeeded", response: outcome.response });
      } else {
        setState({ status: "failed", error: outcome.error });
      }
    } catch {
      setState({ status: "failed", error: networkFailure() });
    }
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      // No clipboard permission, or no clipboard at all. The text is still on screen
      // and selectable, so the message points at the manual route instead of failing
      // silently.
      setCopyState("failed");
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-mono text-[0.7rem] tracking-widest text-muted-foreground uppercase">
          Client reply
        </h4>
        {state.status === "idle" || state.status === "failed" ? (
          <Button type="button" variant="outline" size="sm" onClick={generate}>
            <MessageSquareQuote aria-hidden="true" />
            {state.status === "failed" ? "Try again" : "Draft a reply"}
          </Button>
        ) : null}
      </div>

      {state.status === "running" ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col gap-2 rounded-lg border border-border bg-muted/50 px-4 py-3.5"
        >
          <p className="flex items-center gap-2.5 text-sm font-medium">
            <Loader
              aria-hidden="true"
              className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
            />
            Drafting on your local model
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            One short message, written from this finding&rsquo;s verified quotes. On a
            CPU-only machine this usually takes under a minute, longer the first time
            because the model has to load.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Nothing is sent. The draft appears here for you to edit.
          </p>
        </div>
      ) : null}

      {state.status === "failed" ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3.5"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">No draft was produced</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{state.error.message}</p>
            {state.error.issues.length > 0 ? (
              <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground">
                {state.error.issues.map((issue) => (
                  <li key={`${issue.path}-${issue.message}`}>{issue.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      {state.status === "succeeded" ? (
        <DraftEditor
          state={state.response}
          text={text}
          dirty={dirty}
          bodyId={bodyId}
          copyState={copyState}
          findingIsFullyVerified={finding.evidenceStatus === "verified"}
          onChange={(value) => {
            setText(value);
            setDirty(value !== state.response.draft.body);
          }}
          onCopy={copyDraft}
          onRegenerate={generate}
        />
      ) : null}

      {state.status === "idle" ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Optional. Writes one short message from this finding&rsquo;s verified quotes
          using the same local model. You can edit it before you send anything, and
          ScopeSentry never sends it for you.
        </p>
      ) : null}
    </div>
  );
}

type DraftEditorProps = {
  state: ReplyResponse;
  text: string;
  dirty: boolean;
  bodyId: string;
  copyState: "idle" | "copied" | "failed";
  findingIsFullyVerified: boolean;
  onChange: (value: string) => void;
  onCopy: () => void;
  onRegenerate: () => void;
};

function DraftEditor({
  state,
  text,
  dirty,
  bodyId,
  copyState,
  findingIsFullyVerified,
  onChange,
  onCopy,
  onRegenerate,
}: DraftEditorProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-800 dark:border-amber-400/40 dark:text-amber-200">
          Draft — not sent
        </span>
        <span className="text-xs text-muted-foreground">{INTENT_LABELS[state.draft.intent]}</span>
      </div>

      <Field className="gap-0">
        <FieldLabel htmlFor={bodyId} className="sr-only">
          Draft message, editable
        </FieldLabel>
        <Textarea
          id={bodyId}
          name={bodyId}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          rows={7}
          className="min-h-40 resize-y text-sm leading-relaxed"
        />
      </Field>

      <p className="font-mono text-xs text-muted-foreground">
        local model {state.meta.model} &middot;{" "}
        {state.droppedQuotes === 0 ? "all quotes checked" : `${state.droppedQuotes} quote(s) left out`}
        {state.trimmed ? " &middot; repeated ending removed" : ""}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" onClick={onCopy}>
          <Copy aria-hidden="true" />
          Copy draft
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRegenerate}
          title={dirty ? "Replaces the text you have edited" : "Write a different version"}
        >
          <RefreshCw aria-hidden="true" />
          {dirty ? "Regenerate (replaces your edits)" : "Regenerate"}
        </Button>
      </div>

      <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {copyState === "copied"
          ? "Copied. Paste it into your own email or chat — nothing was sent from here."
          : null}
        {copyState === "failed"
          ? "Copying failed. Select the text above and copy it manually."
          : null}
      </p>

      {state.trimmed ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          The model repeated itself at the end of this one, so the repeated part was
          removed. Read what is left before you send it.
        </p>
      ) : null}

      {!findingIsFullyVerified || state.droppedQuotes > 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {[
            !findingIsFullyVerified
              ? "Some of this finding’s quotes could not be matched to your pasted text"
              : null,
            state.droppedQuotes > 0
              ? `${state.droppedQuotes} of its quotes were left out of the draft`
              : null,
          ]
            .filter(Boolean)
            .join(", and ")}
          , so check the wording against your own words before you send it.
        </p>
      ) : null}

      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer">
          Based on {state.groundedQuotes.length} verified quote
          {state.groundedQuotes.length === 1 ? "" : "s"}
        </summary>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 leading-relaxed">
          {state.groundedQuotes.map((quote, index) => (
            <li key={`${index}-${quote.slice(0, 24)}`} className="break-words">
              {quote}
            </li>
          ))}
        </ul>
      </details>

      <FieldDescription>{DRAFT_NOTICE}</FieldDescription>
    </div>
  );
}