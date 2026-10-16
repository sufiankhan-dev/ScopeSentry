import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLASSIFICATION_ORDER,
  classificationDisplay,
  countByClassification,
  countUnverified,
  evidenceSourceLabel,
  evidenceStatusDisplay,
  formatDuration,
  formatElapsed,
  hasFindings,
} from "../lib/report-display.ts";
import {
  EVIDENCE_STATUSES,
  SCOPE_CLASSIFICATIONS,
} from "../lib/schemas.ts";
import type {
  EvidenceStatus,
  ScopeClassification,
  ScopeReport,
} from "../lib/schemas.ts";

// ---------------------------------------------------------------------------
// The report's display vocabulary is tested here rather than by looking at the
// rendered page: these strings are what a freelancer acts on, so a label that
// overstates a classification is a correctness bug, not a copy tweak.
// ---------------------------------------------------------------------------

test("every classification has a label, a summary, and a tone", () => {
  assert.deepEqual([...CLASSIFICATION_ORDER], [...SCOPE_CLASSIFICATIONS]);

  for (const classification of SCOPE_CLASSIFICATIONS) {
    const display = classificationDisplay(classification);
    assert.ok(display.label.length > 0, `${classification} needs a label`);
    assert.ok(display.summary.length > 20, `${classification} needs a real explanation`);
    assert.ok(
      ["positive", "caution", "neutral", "critical"].includes(display.tone),
      `${classification} needs a known tone`,
    );
  }
});

test("each classification is visually distinct from the others", () => {
  const tones = SCOPE_CLASSIFICATIONS.map((value) => classificationDisplay(value).tone);
  assert.equal(new Set(tones).size, tones.length, "two classifications share a tone");
});

test("classification labels are distinct from one another", () => {
  const labels = SCOPE_CLASSIFICATIONS.map((value) => classificationDisplay(value).label);
  assert.equal(new Set(labels).size, labels.length);
});

test("classification summaries never assert a breach or a legal conclusion", () => {
  const forbidden = ["breach", "violation", "liable", "unlawful", "owed", "guarantee"];

  for (const classification of SCOPE_CLASSIFICATIONS) {
    const summary = classificationDisplay(classification).summary.toLowerCase();
    for (const word of forbidden) {
      assert.ok(
        !summary.includes(word),
        `${classification} summary must not contain "${word}"`,
      );
    }
  }
});

test("the out-of-scope summary does not claim the client did anything wrong", () => {
  const summary = classificationDisplay("potentially_out_of_scope").summary.toLowerCase();
  assert.ok(!summary.includes("client"));
  assert.ok(!summary.includes("must"));
});

test("the unclear summary says silence is not an exclusion", () => {
  const summary = classificationDisplay("unclear").summary.toLowerCase();
  assert.ok(summary.includes("not an exclusion"));
});

test("the needs-review summary points back at the user's own text", () => {
  const summary = classificationDisplay("needs_review").summary.toLowerCase();
  assert.ok(summary.includes("your own text"));
});

test("every evidence status has a distinct label that says what was checked", () => {
  const labels = EVIDENCE_STATUSES.map((status) => evidenceStatusDisplay(status).label);
  assert.equal(new Set(labels).size, labels.length);

  // Each label has to name the actual outcome, because a reader deciding whether
  // to trust a finding is reading this and nothing else.
  assert.equal(evidenceStatusDisplay("verified").label, "Every quote matched your text");
  assert.equal(
    evidenceStatusDisplay("partial").label,
    "Some quotes did not match your text",
  );
  assert.equal(evidenceStatusDisplay("unverified").label, "No quote matched your text");
});

test("only a fully verified status is described as every quote matching", () => {
  for (const status of EVIDENCE_STATUSES) {
    const label = evidenceStatusDisplay(status).label.toLowerCase();

    if (status === "verified") {
      assert.ok(label.startsWith("every"), "verified must claim a complete match");
      continue;
    }

    // `partial` and `unverified` must never read as a clean bill of health.
    assert.equal(label.startsWith("every"), false, `${status} must not claim a complete match`);
  }
});

test("evidence source labels name one of the two pasted documents", () => {
  assert.equal(evidenceSourceLabel("agreement"), "your agreement");
  assert.equal(evidenceSourceLabel("conversation"), "your conversation");
});

const finding = (classification: ScopeClassification, evidenceStatus: EvidenceStatus) => ({
  classification,
  evidenceStatus,
});

test("counts include classifications with no findings at all", () => {
  const counts = countByClassification([]);

  assert.deepEqual(counts, {
    in_scope: 0,
    potentially_out_of_scope: 0,
    unclear: 0,
    needs_review: 0,
  });
});

test("counts tally findings per classification", () => {
  const counts = countByClassification([
    finding("in_scope", "verified"),
    finding("in_scope", "verified"),
    finding("unclear", "partial"),
    finding("needs_review", "unverified"),
  ]);

  assert.deepEqual(counts, {
    in_scope: 2,
    potentially_out_of_scope: 0,
    unclear: 1,
    needs_review: 1,
  });
});

test("counting does not mutate the array it was given", () => {
  const findings = [finding("unclear", "partial"), finding("in_scope", "verified")];
  countByClassification(findings);
  assert.equal(findings.length, 2);
});

test("only findings whose quotes all matched count as needing review", () => {
  const unverified = countUnverified([
    finding("in_scope", "verified"),
    finding("unclear", "partial"),
    finding("needs_review", "unverified"),
  ]);

  assert.equal(unverified, 2);
});

test("a fully verified report has nothing to flag", () => {
  assert.equal(countUnverified([finding("in_scope", "verified")]), 0);
  assert.equal(
    countUnverified([
      finding("in_scope", "verified"),
      finding("potentially_out_of_scope", "verified"),
    ]),
    0,
  );
});

test("durations read as time a person would say out loud", () => {
  assert.equal(formatDuration(0), "0 seconds");
  assert.equal(formatDuration(1_000), "1 second");
  assert.equal(formatDuration(45_000), "45 seconds");
  assert.equal(formatDuration(60_000), "1 minute");
  assert.equal(formatDuration(120_000), "2 minutes");
  assert.equal(formatDuration(192_000), "3m 12s");
  assert.equal(formatDuration(605_000), "10m 5s");
});

test("the elapsed counter is zero-padded and never negative", () => {
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(5_000), "0:05");
  assert.equal(formatElapsed(65_000), "1:05");
  assert.equal(formatElapsed(600_000), "10:00");
  assert.equal(formatElapsed(-1_000), "0:00");
});

test("a report with no findings is recognised as empty", () => {
  const report = { findings: [] } as unknown as ScopeReport;
  assert.equal(hasFindings(report), false);

  const withFindings = {
    findings: [finding("in_scope", "verified")],
  } as unknown as ScopeReport;
  assert.equal(hasFindings(withFindings), true);
});