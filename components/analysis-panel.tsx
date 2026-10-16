"use client";

import { ScopeReportView } from "@/components/scope-report";
import { formatElapsed } from "@/lib/report-display";
import type { AnalysisState } from "@/lib/schemas";
import { Loader, TriangleAlert, Unplug } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * The four states the analysis can be in, and nothing else.
 *
 * `AnalysisState` is a closed union, so this is a `switch` with no default that
 * could hide a state nobody wrote a branch for: an unhandled case is a type
 * error, not a blank region. Each branch below corresponds to one requirement in
 * AGENTS.md §3.
 *
 * The panel is presentational. It owns only the loading elapsed counter, which is
 * genuinely local UI state; the request itself is started by the form's submit
 * handler, never from an effect here.
 */

/**
 * Elapsed time since this component mounted.
 *
 * A local model on a CPU-only machine routinely takes minutes, so the wait is
 * measured and shown rather than left as an unexplained spinner.
 *
 * Only `LoadingPanel` calls this, and `AnalysisPanel` renders it as a distinct
 * component type, so React unmounts it whenever a run starts, finishes, or fails.
 * That is what resets the clock and clears the interval — no flag and no
 * synchronous reset inside the effect, which would force an extra render pass.
 */
function useElapsedSinceMount(): number {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 1_000);

    return () => clearInterval(timer);
  }, []);

  return elapsedMs;
}

function IdlePanel() {
  return (
    <section
      aria-labelledby="report-pending-heading"
      className="flex flex-col gap-2 rounded-xl border border-border bg-muted/40 px-5 py-5 sm:px-6"
    >
      <h2 id="report-pending-heading" className="text-sm font-semibold tracking-tight">
        No report yet
      </h2>
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Paste both documents above and run the analysis. The report will list every
        client request separately, mark each one as in scope, possibly out of scope,
        unclear, or needing review, and show the exact text behind each judgment so
        you can check it yourself.
      </p>
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        This needs Ollama running on your own machine with the configured model
        already pulled. If it is not running, the analysis will say so instead of
        failing quietly.
      </p>
    </section>
  );
}

function LoadingPanel() {
  const elapsedMs = useElapsedSinceMount();

  return (
    <section
      role="status"
      aria-live="polite"
      aria-labelledby="report-running-heading"
      className="flex flex-col gap-3 rounded-xl border border-border bg-muted/60 px-5 py-5 sm:px-6"
    >
      <div className="flex items-center gap-3">
        <Loader
          aria-hidden="true"
          className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
        />
        <h2 id="report-running-heading" className="text-sm font-semibold tracking-tight">
          Running the analysis on your local model
        </h2>
      </div>

      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Three steps run in order: reading the agreement, reading the conversation,
        then comparing them. On a CPU-only machine this commonly takes two to four
        minutes, and it is longer the first time because the model has to load.
      </p>

      <p className="font-mono text-sm tabular-nums text-muted-foreground">
        {formatElapsed(elapsedMs)} elapsed
      </p>

      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Your text is going to the Ollama server on this machine that ScopeSentry is
        configured to use, and nowhere else. Leaving this page will not cancel the
        run.
      </p>
    </section>
  );
}

/**
 * Whether a failure is about reaching the local model rather than about the
 * documents, which is what decides whether the copy points at Ollama or at the
 * input.
 */
const CONNECTION_CODES = new Set(["unavailable", "model_missing", "network_error"]);

const FIELD_LABELS: Record<string, string> = {
  agreement: "Original agreement",
  conversation: "Client conversation",
};

function ErrorPanel({ state }: { state: Extract<AnalysisState, { status: "failed" }> }) {
  const { error } = state;
  const isConnection = CONNECTION_CODES.has(error.code);

  return (
    <section
      role="alert"
      aria-labelledby="report-error-heading"
      className="flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-5 py-5 sm:px-6"
    >
      <div className="flex items-center gap-3">
        {isConnection ? (
          <Unplug aria-hidden="true" className="size-4 shrink-0 text-destructive" />
        ) : (
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-destructive" />
        )}
        <h2 id="report-error-heading" className="text-sm font-semibold tracking-tight">
          {isConnection ? "Could not reach the local model" : "The analysis could not be completed"}
        </h2>
      </div>

      <p className="max-w-2xl text-sm leading-relaxed">{error.message}</p>

      {error.issues.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
          {error.issues.map((issue) => (
            <li key={`${issue.path}-${issue.message}`}>
              <span className="font-medium text-foreground">
                {FIELD_LABELS[issue.path] ?? issue.path}
              </span>
              {": "}
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Your agreement and conversation are still in the fields above. Correct
        anything that needs changing and run the analysis again.
      </p>
    </section>
  );
}

/**
 * Renders exactly one analysis state.
 *
 * `state.status === "succeeded"` is the only branch that renders findings, so a
 * report can never appear unless a real request returned a body that passed
 * `analyzeResponseSchema`.
 */
export function AnalysisPanel({ state }: { state: AnalysisState }) {
  switch (state.status) {
    case "idle":
      return <IdlePanel />;
    case "running":
      return <LoadingPanel />;
    case "failed":
      return <ErrorPanel state={state} />;
    case "succeeded":
      return <ScopeReportView report={state.report} meta={state.meta} />;
  }
}