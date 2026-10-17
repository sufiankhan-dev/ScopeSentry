/**
 * The one bold gesture on the page: the product's own idea, drawn in the visual
 * language of the Gemma pages.
 *
 * ScopeSentry's entire job is comparing two documents, and Gemma's visual
 * signature is glowing blue dots arranged into a meaningful object. So this
 * renders exactly that: two documents built out of dots — the agreement on the
 * left, the conversation on the right — with the three lines that actually
 * match drawn as glowing connectors through a scan line between them, and one
 * verdict below.
 *
 * Constraints that shape the implementation:
 *
 *  - **No client JavaScript.** It is a server component of pure geometry, so it
 *    adds no bundle, no hydration, and no state.
 *  - **Deterministic.** Dot jitter comes from a hash of each dot's own
 *    coordinates, never from `Math.random`, so a render is reproducible and the
 *    image can never differ between server and client.
 *  - **Decorative.** It is `aria-hidden` and contains no text. Every idea it
 *    suggests is also stated in words in the caption beside it, so nothing is
 *    lost to a screen reader or to an image that fails to load.
 */

import { cn } from "cn";

/** Dot spacing, in user units. */
const COLUMN = 11;
const ROW = 19;
const DOT_R = 1.7;

/** Widest document, in dots. Both documents are drawn on this grid. */
const DOC_DOTS = 15;

const ORIGIN_LEFT = 44;
const ORIGIN_RIGHT = 314;
const ORIGIN_Y = 84;
const ROWS = 12;

/** The scan line's x: exactly halfway between the two documents. */
const SCAN_X = 256;

/** Where the bright three-dot "heading" cap sits above each document. */
const CAP_Y = 52;

/** The single verdict, under the comparison. */
const VERDICT_Y = 332;

/**
 * How many dots each line of each document contains.
 *
 * These are not random. The ragged right edge is what makes a lattice read as
 * *writing* rather than as a grid, and the short lines are where that edge has
 * to come from, so the array is written by hand the way a paragraph wraps.
 * `SECOND` is the same kind of text with its own line breaks, which is what a
 * chat thread looks like set against a signed document.
 */
const FIRST = [14, 12, 13, 9, 12, 11, 14, 8, 12, 13, 10, 11];
const SECOND = [11, 13, 10, 12, 8, 13, 12, 14, 9, 11, 13, 10];

/**
 * Which rows on each side are the same request seen twice, and therefore what
 * the connectors join. Each pair is `[row in FIRST, row in SECOND]`.
 */
const MATCHES: readonly (readonly [number, number])[] = [
  [1, 2],
  [4, 6],
  [7, 9],
];

/**
 * A repeatable 0–1 value from an integer, so a given dot always gets the same
 * jitter. Cheaper and more predictable than any PRNG, and it cannot be seeded
 * differently on the server and the client.
 */
function hash(value: number): number {
  const raw = Math.sin(value * 12.9898) * 43_758.5453;
  return raw - Math.floor(raw);
}

type Dot = {
  x: number;
  y: number;
  r: number;
  opacity: number;
  lit: boolean;
  key: string;
};

/**
 * One document: a ragged lattice of dots, `lines` dots per row.
 *
 * Rows listed in `lit` are the matched ones. They are drawn in the bright accent
 * and slightly larger, because the product's whole answer is the difference
 * between those rows and the rest.
 */
function documentDots(
  originX: number,
  originY: number,
  lines: readonly number[],
  lit: ReadonlySet<number>,
  seed: number,
): Dot[] {
  const dots: Dot[] = [];

  lines.forEach((count, row) => {
    for (let col = 0; col < count; col += 1) {
      const jitter = hash(seed + row * 37 + col * 11);
      const isLit = lit.has(row);

      dots.push({
        x: originX + col * COLUMN,
        y: originY + row * ROW,
        r: isLit ? DOT_R * 1.5 : DOT_R * (0.82 + jitter * 0.34),
        opacity: isLit ? 0.95 : 0.34 + jitter * 0.24,
        lit: isLit,
        key: `${seed}-${row}-${col}`,
      });
    }
  });

  return dots;
}

/**
 * The three matched lines, as a dotted curve that bows toward the scan line and
 * away again, so the eye reads a comparison happening in the gap rather than two
 * unrelated blocks sitting next to each other.
 */
function matchPaths(): string[] {
  return MATCHES.map(([leftRow, rightRow]) => {
    const y1 = ORIGIN_Y + leftRow * ROW;
    const y2 = ORIGIN_Y + rightRow * ROW;
    const x1 = ORIGIN_LEFT + DOC_DOTS * COLUMN;
    const bow = y2 > y1 ? 28 : -28;

    return `M ${x1} ${y1} Q ${SCAN_X} ${(y1 + y2) / 2 + bow} ${ORIGIN_RIGHT} ${y2}`;
  });
}

export function ScopeHeroVisual({ className }: { className?: string }) {
  const leftLit = new Set(MATCHES.map(([leftRow]) => leftRow));
  const rightLit = new Set(MATCHES.map(([, rightRow]) => rightRow));

  const leftDots = documentDots(ORIGIN_LEFT, ORIGIN_Y, FIRST, leftLit, 0);
  const rightDots = documentDots(ORIGIN_RIGHT, ORIGIN_Y, SECOND, rightLit, 1_000);
  const paths = matchPaths();

  const docWidth = (DOC_DOTS - 1) * COLUMN;
  const docHeight = (ROWS - 1) * ROW;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 520 360"
      className={cn("h-auto w-full", className)}
    >
      <defs>
        {/* The scan line: brightest at the middle, gone at both ends. */}
        <linearGradient id="ss-scan-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--glow)" stopOpacity="0" />
          <stop offset="45%" stopColor="var(--glow)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--glow)" stopOpacity="0" />
        </linearGradient>

        {/* One dot, glowing. Used for the single verdict below the comparison. */}
        <radialGradient id="ss-verdict-glow">
          <stop offset="0%" stopColor="var(--glow)" stopOpacity="0.55" />
          <stop offset="55%" stopColor="var(--glow)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--glow)" stopOpacity="0" />
        </radialGradient>

        <pattern
          id="ss-connector-dots"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="4" cy="4" r="2.1" fill="var(--glow)" fillOpacity="0.9" />
        </pattern>
      </defs>

      {/* The scan line: the one piece of motion on the page. */}
      <rect
        x={SCAN_X - 1.5}
        y={CAP_Y - 14}
        width="3"
        height={VERDICT_Y - CAP_Y + 4}
        fill="url(#ss-scan-gradient)"
        className="ss-scan"
      />

      {/* The matched lines, drawn through the gap. */}
      <g>
        {paths.map((path, index) => (
          <path
            key={`path-${index}`}
            d={path}
            fill="none"
            stroke="url(#ss-connector-dots)"
            strokeWidth="8"
            className="ss-match"
            style={{ animationDelay: `${index * 0.7}s` }}
          />
        ))}
      </g>

      {/* The two documents. */}
      <g>
        {[ORIGIN_LEFT, ORIGIN_RIGHT].map((originX) => (
          <rect
            key={`frame-${originX}`}
            x={originX - 18}
            y={ORIGIN_Y - ROW * 0.5}
            width={docWidth + 36}
            height={docHeight + ROW}
            rx="14"
            fill="none"
            stroke="var(--glow)"
            strokeOpacity="0.16"
            strokeWidth="1"
            strokeDasharray="2 7"
          />
        ))}

        {[leftDots, rightDots].map((dots) =>
          dots.map((dot) => (
            <circle
              key={dot.key}
              cx={dot.x}
              cy={dot.y}
              r={dot.r}
              fill={dot.lit ? "var(--glow)" : "var(--dot)"}
              fillOpacity={dot.opacity}
            />
          )),
        )}
      </g>

      {/* A short bright rule above each document, so each block has a heading. */}
      <g>
        {[ORIGIN_LEFT, ORIGIN_RIGHT].map((originX) =>
          [0, 1, 2].map((index) => (
            <circle
              key={`cap-${originX}-${index}`}
              cx={originX + index * 12}
              cy={CAP_Y}
              r={index === 0 ? 2.8 : 2.4}
              fill="var(--glow)"
              fillOpacity={index === 0 ? 1 : 0.55}
            />
          )),
        )}
      </g>

      {/* One verdict, below both documents. */}
      <circle cx={SCAN_X} cy={VERDICT_Y} r="22" fill="url(#ss-verdict-glow)" />
      <circle cx={SCAN_X} cy={VERDICT_Y} r="4.5" fill="var(--glow)" />
    </svg>
  );
}