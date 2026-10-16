import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  CONCRETE_TERM_PATTERNS,
  countUnverifiedExtractionEvidence,
  findExactQuote,
  normalizeForMatching,
  verifyFinding,
} from "../lib/evidence.ts";
import type { FindingClaim } from "../lib/evidence.ts";
import type { AgreementExtraction, Evidence } from "../lib/schemas.ts";

// ---------------------------------------------------------------------------
// Fixtures use the committed Riverside sample wording or invented strings.
// No real client material, no network, no process.env.
// ---------------------------------------------------------------------------

const AGREEMENT = `Scope of work

1. Website design: wireframe and high-fidelity design for six (6) page templates.
2. Two (2) rounds of revisions per page template.

Not included

- Copywriting, translation, or menu data entry.
- Front-end development, CMS configuration, or hosting setup.`;

const CONVERSATION = `Priya (client) — Mon 09:14
We need an online ordering page on the site. Can you build that?

Me — Mon 09:40
Ordering means payments and a CMS connection, which is not included.`;

const sources = { agreement: AGREEMENT, conversation: CONVERSATION };

const evidence = (quote: string, source: Evidence["source"]): Evidence => ({ quote, source });

const finding = (overrides: Partial<FindingClaim> = {}): FindingClaim => ({
  id: "f1",
  title: "Online ordering page",
  classification: "potentially_out_of_scope",
  explanation:
    "The request asks for an ordering page. Front-end development and CMS configuration are excluded by the agreement.",
  conversationEvidence: [
    evidence("We need an online ordering page on the site.", "conversation"),
  ],
  agreementEvidence: [
    evidence("Front-end development, CMS configuration, or hosting setup.", "agreement"),
  ],
  nextStep: "Quote the ordering page as separate work before starting it.",
  ...overrides,
});

// --- Normalization ----------------------------------------------------------

test("normalization folds case-sensitive punctuation and whitespace runs", () => {
  const source = "Deliverables:  logo — refinement\r\nand   palette…\n";
  const normalized = normalizeForMatching(source);

  assert.equal(normalized.text, "deliverables: logo - refinement and palette...");
  assert.equal(normalized.map.length, normalized.text.length);
});

test("normalization maps every folded character back to its original offset", () => {
  const source = "Two (2) rounds — per template";
  const normalized = normalizeForMatching(source);

  // The em dash folds to "-" and is still reported as the original character.
  const dashIndex = normalized.text.indexOf("-");
  assert.equal(source[normalized.map[dashIndex]], "—");

  const firstRoundsIndex = normalized.text.indexOf("rounds");
  assert.equal(source[normalized.map[firstRoundsIndex]], "r");
});

test("normalization drops zero-width characters without shifting later offsets", () => {
  const source = "Copy\u200bwriting is excluded.";
  const normalized = normalizeForMatching(source);

  assert.equal(normalized.text, "copywriting is excluded.");
  assert.equal(source[normalized.map[0]], "C");
  assert.equal(normalized.map.length, normalized.text.length);
});

// --- Quote matching ---------------------------------------------------------

test("an exact quote is found and reported as the user's own text", () => {
  const match = findExactQuote(AGREEMENT, "Front-end development, CMS configuration");

  assert.equal(match.found, true);
  assert.equal(
    match.matchedText,
    "Front-end development, CMS configuration",
  );
});

test("matching tolerates case, whitespace runs, and typographic punctuation", () => {
  const cases: Array<[string, string]> = [
    ["front-end   development,  cms configuration", "Front-end development, CMS configuration"],
    ["FRONT-END DEVELOPMENT", "Front-end development"],
    ["copywriting", "Copywriting"],
  ];

  for (const [quote, expected] of cases) {
    const match = findExactQuote(AGREEMENT, quote);
    assert.equal(match.found, true, `expected to find ${JSON.stringify(quote)}`);
    assert.equal(match.matchedText, expected);
  }
});

test("a hyphenated quote of an em dash sentence returns the user's own punctuation", () => {
  const source = "Deliverables: design — refinement\nand palette…";
  const match = findExactQuote(source, "design - refinement and palette...");

  assert.equal(match.found, true);
  assert.equal(match.matchedText, "design — refinement\nand palette…");
});

test("a smart quote in the source is returned smart in the verified quote", () => {
  const source = `The client said “we need an ordering page”.`;
  const match = findExactQuote(source, `"we need an ordering page"`);

  assert.equal(match.found, true);
  assert.equal(match.matchedText, `“we need an ordering page”`);
});

test("a quote that is not in the source is not found", () => {
  assert.deepEqual(findExactQuote(AGREEMENT, "The client agreed to pay $2,000"), {
    found: false,
    matchedText: null,
  });
  assert.deepEqual(findExactQuote(CONVERSATION, "six page templates"), {
    found: false,
    matchedText: null,
  });
});

test("blank or meaningless quotes are never found", () => {
  for (const quote of ["", "   ", "\n\t", "...", "-", "—", "'"]) {
    assert.deepEqual(
      findExactQuote(AGREEMENT, quote),
      { found: false, matchedText: null },
      `expected ${JSON.stringify(quote)} to fail verification`,
    );
  }
});

test("a quote cannot be verified against the document it did not come from", () => {
  assert.equal(findExactQuote(CONVERSATION, "Front-end development, CMS configuration").found, false);
  assert.equal(findExactQuote(AGREEMENT, "We need an online ordering page on the site.").found, false);
});

// --- Finding verification ---------------------------------------------------

test("a fully sourced finding is verified and keeps the model's classification", () => {
  const verified = verifyFinding(finding(), sources);

  assert.equal(verified.evidenceStatus, "verified");
  assert.deepEqual(verified.evidenceIssues, []);
  assert.equal(verified.classification, "potentially_out_of_scope");
  assert.equal(verified.confidenceIsEstimate, true);
  assert.equal(
    verified.conversationEvidence[0].quote,
    "We need an online ordering page on the site.",
  );
});

test("optional finding fields survive verification when present and stay absent otherwise", () => {
  const withExtras = verifyFinding(finding({ confidence: 0.4, impact: "Adds a payment integration." }), sources);
  assert.equal(withExtras.confidence, 0.4);
  assert.equal(withExtras.impact, "Adds a payment integration.");

  const withoutExtras = verifyFinding(finding(), sources);
  assert.equal(withoutExtras.confidence, undefined);
  assert.equal(withoutExtras.impact, undefined);
});

test("a fabricated quote makes the finding unverified and needs review", () => {
  const fabricated = verifyFinding(
    finding({
      conversationEvidence: [
        evidence("The client approved a $2,000 budget for ordering.", "conversation"),
      ],
    }),
    sources,
  );

  assert.equal(fabricated.evidenceStatus, "unverified");
  assert.equal(fabricated.classification, "needs_review");
  assert.equal(fabricated.evidenceIssues.length, 1);
  assert.match(fabricated.evidenceIssues[0], /conversation text/);
  // The claim is kept so the user can judge it, never marked verified.
  assert.equal(
    fabricated.conversationEvidence[0].quote,
    "The client approved a $2,000 budget for ordering.",
  );
});

test("a quote found in the wrong document is treated as unverified", () => {
  const mislabelled = verifyFinding(
    finding({
      conversationEvidence: [
        evidence("Front-end development, CMS configuration, or hosting setup.", "conversation"),
      ],
    }),
    sources,
  );

  assert.equal(mislabelled.evidenceStatus, "unverified");
  assert.equal(mislabelled.classification, "needs_review");
});

test("one good quote and one bad quote give partial status and keep the classification", () => {
  const partial = verifyFinding(
    finding({
      conversationEvidence: [
        evidence("We need an online ordering page on the site.", "conversation"),
        evidence("The client also approved a rush delivery fee.", "conversation"),
      ],
    }),
    sources,
  );

  assert.equal(partial.evidenceStatus, "partial");
  assert.equal(partial.classification, "potentially_out_of_scope");
  assert.equal(partial.evidenceIssues.length, 1);
  // Matched quotes are replaced by the source text and come first.
  assert.equal(partial.conversationEvidence[0].quote, "We need an online ordering page on the site.");
});

test("verification never upgrades a cautious classification", () => {
  for (const classification of ["unclear", "needs_review"] as const) {
    const cautious = verifyFinding(finding({ classification }), sources);
    assert.equal(cautious.classification, classification);
    assert.equal(cautious.evidenceStatus, "verified");
  }
});

test("in scope stays in scope when its quotes are real", () => {
  const inScope = verifyFinding(
    finding({
      classification: "in_scope",
      title: "Ordering page feasibility question",
      explanation: "The client asked what ordering would involve; that is a question about agreed work.",
      agreementEvidence: [evidence("six (6) page templates", "agreement")],
    }),
    sources,
  );

  assert.equal(inScope.classification, "in_scope");
  assert.equal(inScope.evidenceStatus, "verified");
  assert.equal(inScope.agreementEvidence[0].quote, "six (6) page templates");
});

// --- Invented prices and dates ---------------------------------------------

test("a price the sources never contained downgrades an otherwise verified finding", () => {
  const invented = verifyFinding(
    finding({
      explanation:
        "The request adds front-end development, which the agreement excludes, and would cost about $2,000.",
    }),
    sources,
  );

  assert.equal(invented.evidenceStatus, "verified");
  assert.equal(invented.classification, "needs_review");
  assert.equal(invented.evidenceIssues.length, 1);
  assert.match(invented.evidenceIssues[0], /\$2,000/);
});

test("dates, deadlines, and prices present in a source are not flagged", () => {
  const agreementWithFigures = `Delivery: final files on 2026-03-01 for $4,500 total.`;
  const guarded = verifyFinding(
    finding({
      explanation: "The agreement sets delivery on 2026-03-01 for $4,500.",
      agreementEvidence: [],
    }),
    { ...sources, agreement: `${AGREEMENT}\n\n${agreementWithFigures}` },
  );

  assert.deepEqual(guarded.evidenceIssues, []);
  assert.equal(guarded.classification, "potentially_out_of_scope");
});

test("an invented calendar date downgrades the finding", () => {
  const invented = verifyFinding(
    finding({ nextStep: "Confirm the scope in writing before January 15." }),
    sources,
  );

  assert.equal(invented.classification, "needs_review");
  assert.match(invented.evidenceIssues[0], /January 15/);
});

test("weekday and round-count wording is not mistaken for an invented date", () => {
  const conversationWithWeekday = `${CONVERSATION}\n\nMe — Tue 08:30
Can you change the About page text to something warmer before Friday?`;

  const guarded = verifyFinding(
    finding({
      explanation:
        "The client asks for a wording change before Friday. Two (2) rounds of revisions are agreed.",
      nextStep: "Ask for the final wording before Friday.",
    }),
    { agreement: AGREEMENT, conversation: conversationWithWeekday },
  );

  assert.deepEqual(guarded.evidenceIssues, []);
});

test("the concrete-term patterns stay narrow", () => {
  assert.ok(
    CONCRETE_TERM_PATTERNS.every((pattern) => pattern.global),
    "every pattern must be global so matchAll can use it",
  );

  const ordinary = "Two (2) rounds of revisions across 6 templates, round 2, week 4.";
  const tokens = CONCRETE_TERM_PATTERNS.flatMap((pattern) =>
    [...ordinary.matchAll(pattern)].map((match) => match[0]),
  );

  assert.deepEqual(tokens, [], "counts and round numbers are not prices or dates");
});

// --- Extraction evidence ----------------------------------------------------

const extraction = (quotes: string[]): AgreementExtraction => ({
  deliverables: [
    { id: "d1", description: "Six page templates", evidence: quotes.map((quote) => evidence(quote, "agreement")) },
  ],
  exclusions: [{ id: "e1", description: "Copywriting", evidence: [] }],
  revisionLimits: [],
  deadlines: [],
  assumptions: [],
  ambiguities: [],
});

test("extraction evidence is counted only when a quote is missing from the source", () => {
  assert.deepEqual(
    countUnverifiedExtractionEvidence(extraction(["six (6) page templates"]), "agreement", AGREEMENT),
    { items: 0, quotes: 0 },
  );

  assert.deepEqual(
    countUnverifiedExtractionEvidence(
      extraction(["six (6) page templates", "a clause that was never written"]),
      "agreement",
      AGREEMENT,
    ),
    { items: 1, quotes: 1 },
  );
});

test("extraction items without evidence are not counted as unverified", () => {
  assert.deepEqual(countUnverifiedExtractionEvidence(extraction([]), "agreement", AGREEMENT), {
    items: 0,
    quotes: 0,
  });
});

// --- Source-level tripwire --------------------------------------------------

test("the analysis modules stay silent, server-side, and local", async () => {
  for (const file of ["prompts.ts", "evidence.ts", "analysis.ts"]) {
    const source = await readFile(new URL(`../lib/${file}`, import.meta.url), "utf8");

    assert.doesNotMatch(source, /console\./, `${file} must not log`);
    assert.doesNotMatch(source, /NEXT_PUBLIC_/, `${file} must not read a public env var`);
    assert.doesNotMatch(source, /ollama\.com|api\.openai\.com|anthropic\.com/, `${file} must not name a cloud host`);
    assert.doesNotMatch(source, /api\/pull/, `${file} must not pull models`);
    assert.doesNotMatch(source, /writeFile|appendFile|createWriteStream/, `${file} must not persist text`);
    assert.doesNotMatch(source, /\bfetch\(/, `${file} must go through lib/ollama.ts`);
  }
});