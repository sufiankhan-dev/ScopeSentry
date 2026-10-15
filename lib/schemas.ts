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