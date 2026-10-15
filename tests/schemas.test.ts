import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agreementExtractionSchema,
  conversationExtractionSchema,
  modelFindingSchema,
  reportFindingSchema,
  scopeReportSchema,
} from "../lib/schemas.ts";
import { SCOPE_CLASSIFICATIONS } from "../lib/schemas.ts";
import type { ModelFinding, ScopeReport } from "../lib/schemas.ts";

const conversationQuote = "We need an online ordering page on the site. Can you build that?";

const validFinding = {
  id: "finding-1",
  title: "Online ordering page",
  classification: "potentially_out_of_scope",
  explanation:
    "Ordering requires front-end development and a CMS connection, both listed as not included.",
  conversationEvidence: [{ quote: conversationQuote, source: "conversation" }],
  agreementEvidence: [
    { quote: "Front-end development, CMS configuration, or hosting setup.", source: "agreement" },
  ],
  nextStep: "Quote the ordering page as separate work before starting it.",
  impact: "Adds payment and menu-management work outside the six templates.",
  confidence: 0.72,
  confidenceIsEstimate: true,
} satisfies ModelFinding;

const validReport = {
  agreement: {
    deliverables: [
      {
        id: "deliverable-1",
        description: "High-fidelity design for six page templates.",
        evidence: [
          { quote: "Wireframe and high-fidelity design for six (6) page templates.", source: "agreement" },
        ],
      },
    ],
    exclusions: [
      {
        id: "exclusion-1",
        description: "Front-end development, CMS configuration, or hosting setup.",
        evidence: [
          { quote: "Front-end development, CMS configuration, or hosting setup.", source: "agreement" },
        ],
      },
    ],
    revisionLimits: [
      {
        id: "revision-limit-1",
        description: "Two rounds of revisions per page template, as one consolidated list.",
        evidence: [{ quote: "Two (2) rounds of revisions per page template.", source: "agreement" }],
      },
    ],
    deadlines: [
      {
        id: "deadline-1",
        description: "Design concepts delivered within three weeks of kickoff.",
        evidence: [{ quote: "Design concepts delivered within three (3) weeks of kickoff.", source: "agreement" }],
      },
    ],
    assumptions: [
      {
        id: "assumption-1",
        description: "Client supplies final menu copy and photography within one week of kickoff.",
        evidence: [{ quote: "Client supplies final menu copy, photography.", source: "agreement" }],
      },
    ],
    ambiguities: [
      {
        id: "ambiguity-1",
        description: "Handover date is referenced but never dated.",
        evidence: [{ quote: "Ongoing design support after the handover date.", source: "agreement" }],
      },
    ],
  },
  conversation: {
    requests: [
      {
        id: "request-1",
        text: "Build an online ordering page.",
        speaker: "Priya",
        order: 1,
        evidence: [{ quote: conversationQuote, source: "conversation" }],
      },
    ],
    commitments: [
      {
        id: "commitment-1",
        text: "Will scope ordering separately.",
        evidence: [{ quote: "I'd want to scope that separately.", source: "conversation" }],
      },
    ],
    decisions: [
      {
        id: "decision-1",
        text: "Ordering parked for now.",
        evidence: [{ quote: "Fine, let's park ordering for now.", source: "conversation" }],
      },
    ],
  },
  findings: [{ ...validFinding, evidenceStatus: "verified", evidenceIssues: [] }],
  summary: {
    overview: "One request appears to go beyond the agreed deliverables.",
    limitations: [
      { text: "Advisory only. This is not a legal determination." },
      { text: "Quotes are checked against the pasted text only." },
    ],
  },
} satisfies ScopeReport;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const omit = <T extends object>(value: T, ...keys: (keyof T)[]): Omit<T, keyof T> => {
  const kept = Object.entries(value).filter(([key]) => !keys.includes(key as keyof T));
  return Object.fromEntries(kept) as Omit<T, keyof T>;
};

test("valid report parses and keeps its shape", () => {
  const result = scopeReportSchema.safeParse(clone(validReport));

  assert.equal(result.success, true);
  assert.equal(result.data?.findings.length, 1);
  assert.equal(result.data?.findings[0]?.classification, "potentially_out_of_scope");
  assert.equal(result.data?.findings[0]?.evidenceStatus, "verified");
});

test("every supported classification is accepted", () => {
  for (const classification of SCOPE_CLASSIFICATIONS) {
    const finding = { ...validFinding, classification };
    const result = reportFindingSchema.safeParse({ ...finding, evidenceStatus: "verified" });

    assert.equal(result.success, true, `expected ${classification} to be accepted`);
  }
});

test("unsupported and mis-cased classifications are rejected", () => {
  for (const classification of ["out_of_scope", "In Scope", "in-scope", "unknown", 3, null]) {
    const result = reportFindingSchema.safeParse({
      ...validFinding,
      classification,
      evidenceStatus: "verified",
    });

    assert.equal(result.success, false, `expected ${String(classification)} to be rejected`);
  }
});

test("a missing classification is rejected", () => {
  const rest = omit(validFinding, "classification");

  assert.equal(
    reportFindingSchema.safeParse({ ...rest, evidenceStatus: "verified" }).success,
    false,
  );
});

test("every required finding field is required", () => {
  for (const field of ["id", "title", "explanation", "nextStep"] as const) {
    const finding = clone(validFinding) as Record<string, unknown>;
    delete finding[field];

    assert.equal(
      reportFindingSchema.safeParse({ ...finding, evidenceStatus: "verified" }).success,
      false,
      `expected a finding without ${field} to be rejected`,
    );
  }
});

test("blank-after-trim text is rejected", () => {
  const result = reportFindingSchema.safeParse({
    ...validFinding,
    explanation: "   ",
    evidenceStatus: "verified",
  });

  assert.equal(result.success, false);
});

test("optional finding fields may be absent", () => {
  const rest = omit(validFinding, "impact", "confidence");

  const result = reportFindingSchema.safeParse({ ...rest, evidenceStatus: "verified" });

  assert.equal(result.success, true);
  assert.equal(result.data?.impact, undefined);
  assert.equal(result.data?.confidenceIsEstimate, true);
});

test("confidence must be a number between 0 and 1", () => {
  for (const confidence of [-0.1, 1.1, "0.8", null, Number.NaN]) {
    const result = reportFindingSchema.safeParse({
      ...validFinding,
      confidence,
      evidenceStatus: "verified",
    });

    assert.equal(result.success, false, `expected confidence ${String(confidence)} to be rejected`);
  }

  assert.equal(
    reportFindingSchema.safeParse({ ...validFinding, confidence: 0, evidenceStatus: "verified" })
      .success,
    true,
  );
  assert.equal(
    reportFindingSchema.safeParse({ ...validFinding, confidence: 1, evidenceStatus: "verified" })
      .success,
    true,
  );
});

test("a finding needs at least one conversation quote", () => {
  const result = reportFindingSchema.safeParse({
    ...validFinding,
    conversationEvidence: [],
    evidenceStatus: "verified",
  });

  assert.equal(result.success, false);
});

test("malformed evidence items are rejected", () => {
  const malformed = [
    [{ quote: 42, source: "conversation" }],
    [{ quote: conversationQuote }],
    [{ quote: conversationQuote, source: "email" }],
    [{ quote: conversationQuote, source: "Conversation" }],
    [{ quote: conversationQuote, source: "agreement", location: "line 12" }],
    [{ quote: "   ", source: "conversation" }],
    [{ quote: "x".repeat(2_001), source: "conversation" }],
    ["Ordering means payments and a CMS connection."],
    { quote: conversationQuote, source: "conversation" },
    [null],
  ];

  for (const conversationEvidence of malformed) {
    const result = reportFindingSchema.safeParse({
      ...validFinding,
      conversationEvidence,
      evidenceStatus: "verified",
    });

    assert.equal(
      result.success,
      false,
      `expected evidence ${JSON.stringify(conversationEvidence)?.slice(0, 60)} to be rejected`,
    );
  }
});

test("agreement evidence may be absent but must be valid when present", () => {
  const withoutAgreementEvidence = clone(validReport) as Record<string, unknown>;
  const findings = withoutAgreementEvidence.findings as Record<string, unknown>[];
  delete findings[0]?.agreementEvidence;

  assert.equal(scopeReportSchema.safeParse(withoutAgreementEvidence).success, true);

  findings[0]!.agreementEvidence = [{ quote: "anything", source: "chat" }];
  assert.equal(scopeReportSchema.safeParse(withoutAgreementEvidence).success, false);
});

test("a model finding cannot assert its own verification status", () => {
  const parsed = modelFindingSchema.safeParse(clone(validFinding));

  assert.equal(parsed.success, true);
  assert.equal(parsed.data && "evidenceStatus" in parsed.data, false);
  assert.equal(reportFindingSchema.safeParse(clone(validFinding)).success, false);
});

test("an unknown evidence status is rejected", () => {
  assert.equal(
    reportFindingSchema.safeParse({ ...validFinding, evidenceStatus: "trusted" }).success,
    false,
  );
});

test("unknown keys are rejected rather than dropped", () => {
  const report = clone(validReport) as Record<string, unknown>;
  report.legalConclusion = "This breaches the contract.";

  assert.equal(scopeReportSchema.safeParse(report).success, false);

  const findings = report.findings as Record<string, unknown>[];
  const clean = clone(validReport) as Record<string, unknown>;
  delete clean.legalConclusion;
  (clean.findings as Record<string, unknown>[])[0]!.enforceable = true;

  assert.equal(scopeReportSchema.safeParse(clean).success, false);
  assert.equal(findings.length, 1);
});

test("duplicate finding ids are rejected", () => {
  const report = clone(validReport);
  report.findings = [report.findings[0]!, { ...report.findings[0]! }];

  const result = scopeReportSchema.safeParse(report);

  assert.equal(result.success, false);
  assert.equal(
    result.error?.issues.some((issue) => issue.path.join(".") === "findings.1.id"),
    true,
  );
});

test("a report with no findings is valid", () => {
  const report = clone(validReport);
  report.findings = [];

  const result = scopeReportSchema.safeParse(report);

  assert.equal(result.success, true);
  assert.equal(result.data?.findings.length, 0);
});

test("a report without a stated limitation is rejected", () => {
  const withoutLimitations = clone(validReport);
  withoutLimitations.summary.limitations = [];

  const withEmptyText = clone(validReport);
  withEmptyText.summary.limitations = [{ text: "  " }];

  assert.equal(scopeReportSchema.safeParse(withoutLimitations).success, false);
  assert.equal(scopeReportSchema.safeParse(withEmptyText).success, false);
});

test("a report without a summary overview is rejected", () => {
  const report = clone(validReport) as Record<string, unknown>;
  const summary = report.summary as Record<string, unknown>;
  delete summary.overview;

  assert.equal(scopeReportSchema.safeParse(report).success, false);
});

test("agreement extraction rejects unknown categories and malformed terms", () => {
  assert.equal(agreementExtractionSchema.safeParse({}).success, true);

  const unknownCategory = { ...clone(validReport).agreement, fees: [] };
  assert.equal(agreementExtractionSchema.safeParse(unknownCategory).success, false);

  const missingDescription = clone(validReport).agreement.deliverables;
  delete (missingDescription[0] as Record<string, unknown>).description;

  assert.equal(
    agreementExtractionSchema.safeParse({ ...clone(validReport).agreement, deliverables: missingDescription })
      .success,
    false,
  );

  const badRevisionLimit = {
    ...clone(validReport).agreement,
    revisionLimits: [{ id: "revision-limit-1", description: "Two rounds.", evidence: "none" }],
  };
  assert.equal(agreementExtractionSchema.safeParse(badRevisionLimit).success, false);
});

test("conversation extraction requires evidence and rejects invented sources", () => {
  const conversation = clone(validReport).conversation;
  conversation.requests = [];

  const emptyRequests = conversationExtractionSchema.safeParse(conversation);
  assert.equal(emptyRequests.success, true);
  assert.equal(emptyRequests.data?.requests.length, 0);

  const withoutEvidence = clone(validReport).conversation;
  delete (withoutEvidence.requests[0] as Record<string, unknown>).evidence;

  assert.equal(conversationExtractionSchema.safeParse(withoutEvidence).success, false);

  const unknownCategory = { ...clone(validReport).conversation, tensions: [] };
  assert.equal(conversationExtractionSchema.safeParse(unknownCategory).success, false);

  const inventedSpeaker = clone(validReport).conversation;
  (inventedSpeaker.requests[0] as Record<string, unknown>).speaker = 42;
  assert.equal(conversationExtractionSchema.safeParse(inventedSpeaker).success, false);
});

test("a completely wrong payload never parses", () => {
  for (const payload of [null, undefined, "a report", 42, [], [{ agreement: "text" }]]) {
    assert.equal(scopeReportSchema.safeParse(payload).success, false);
  }
});