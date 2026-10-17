import { handleReplyRequest } from "@/lib/reply-handler";

/**
 * `POST /api/reply` — drafts one client message for one finding.
 *
 * The logic lives in `lib/reply-handler.ts` so the status-code mapping and its
 * redaction rules can be unit-tested against a stubbed `fetch`. This file is
 * intentionally a single delegation: no parsing, no branching, and no logging
 * happens here.
 */
export async function POST(request: Request): Promise<Response> {
  return handleReplyRequest(request);
}