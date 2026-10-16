import { handleAnalyzeRequest } from "@/lib/analyze-handler";

/**
 * `POST /api/analyze` — the only browser-facing entry point in the app.
 *
 * The handler itself lives in `lib/analyze-handler.ts` so that the status-code
 * mapping and its redaction rules can be unit-tested against a stubbed `fetch`.
 * This file is intentionally a single delegation: no parsing, no branching, and
 * no logging happens here.
 */
export async function POST(request: Request): Promise<Response> {
  return handleAnalyzeRequest(request);
}