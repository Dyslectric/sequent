/**
 * The kernel: a checker for proof traces.
 *
 * `proof-trace.js` validates a trace's *shape* — one root, no cycles, every
 * rule registered, within bounds. It cannot tell whether a step follows from
 * its premises, and so the application still trusts the prover that emitted
 * it. This module is where that trust starts being repaid: every rule that
 * gains a checking function moves from *believed* to *checked*, and the move
 * is visible on the row.
 *
 * Each step therefore carries a trust level:
 *
 *   verified   the kernel re-derived the step from its premises
 *   certified  the step carried a witness the kernel checked
 *   axiom      named, believed, and refusable
 *   oracle     Compute Engine said so, with no witness at all
 *   rejected   the kernel refuses the step outright
 *
 * A proof is only as strong as its weakest step, so a trace reports the
 * minimum across its nodes. "Proved, resting on two theorems" is a more honest
 * sentence than "proved", and it is the sentence this module is for.
 *
 * Three commitments shape everything below.
 *
 * **The kernel does not prove.** It re-checks. Search happens outside; nothing
 * here looks for a derivation, only at the one it was handed.
 *
 * **Failing to check is not refusing.** A checker returns `true` when it
 * re-derived the step, `false` when the step is structurally not an instance
 * of the rule it claims, and `null` — by far the most common answer in phase
 * one — when it cannot tell. `null` leaves the step at `axiom`, which
 * understates the proof and never overstates it. That asymmetry is the whole
 * safety argument: the kernel's own gaps cost honesty, never soundness.
 *
 * **Propositions are compared syntactically.** Two atoms are the same claim
 * when they normalize to the same token sequence, up to the handful of
 * spellings LaTeX offers for one thing (`\lt` and `<`, `\frac{a}{b}` and
 * `a/b`, `x < y` and `y > x`). Nothing here evaluates, simplifies, or asks
 * Compute Engine anything. A premise that says the same thing in different
 * algebra — `\Re(\exp(it))` against `\operatorname{Re}(e^{it})` — is not
 * recognised, and the step stays an axiom until phase two teaches the kernel
 * exact normalization.
 */

import { isSummarized } from './proof-trace.js';
import {
  ONE,
  ZERO,
  addPolynomials,
  affineRatio,
  constantOf,
  constantPolynomial,
  dividePolynomials,
  divRational,
  isZeroPolynomial,
  isZeroRational,
  multiplyPolynomials,
  negatePolynomial,
  polynomialKey,
  powerPolynomial,
  rational,
  samePolynomial,
  scalarRatio,
  scalePolynomial,
  signOfRational,
  subtractPolynomials,
  variablePolynomial,
} from './kernel-polynomial.js';

/* --------------------------------- trust --------------------------------- */

/** Weakest first: a trace reports the minimum level over its steps. */
export const TRUST_ORDER = Object.freeze([
  'rejected', 'oracle', 'axiom', 'certified', 'verified',
]);

const RANK = new Map(TRUST_ORDER.map((level, index) => [level, index]));

export function trustRank(level) {
  return RANK.get(level) ?? RANK.get('axiom');
}

export function weakestTrust(a, b) {
  return trustRank(a) <= trustRank(b) ? a : b;
}

/**
 * What a step is worth before any checker runs.
 *
 * Everything is an axiom — named, believed, refusable — except the one rule
 * that has no witness by construction. Compute Engine's exact evaluation is an
 * appeal to authority and is labelled as one.
 */
function baseTrust(ruleId) {
  return ruleId === 'engine.exact-evaluation' ? 'oracle' : 'axiom';
}

/* ------------------------------- tokenizing ------------------------------- */

/** Spacing that carries no meaning and would only defeat comparison. */
const IGNORED = new Set(['\\,', '\\;', '\\:', '\\!', '\\ ', '\\quad', '\\qquad',
  '\\thinspace', '\\left', '\\right', '\\middle', '\\displaystyle', '\\limits']);

/**
 * One spelling per idea. These are alternative names for the same symbol, not
 * claims about mathematics: `\vdash` is how the reader writes the implication
 * Compute Engine serializes as `\implies`, and both mean the same arrow.
 */
const ALIASES = new Map(Object.entries({
  '\\lt': '<',
  '\\gt': '>',
  '\\leq': '\\le',
  '\\geq': '\\ge',
  '\\neq': '\\ne',
  '\\land': '\\wedge',
  '\\lor': '\\vee',
  '\\lnot': '\\neg',
  '\\vdash': '\\implies',
  '\\Rightarrow': '\\implies',
  '\\Longrightarrow': '\\implies',
  '\\Leftrightarrow': '\\iff',
  '\\Longleftrightarrow': '\\iff',
  '\\varnothing': '\\emptyset',
}));

const OPEN = new Map(Object.entries({
  '(': ')', '[': ']', '{': '}', '\\{': '\\}', '\\lbrace': '\\rbrace',
  '\\langle': '\\rangle', '\\lfloor': '\\rfloor', '\\lceil': '\\rceil',
}));
const CLOSE = new Set(OPEN.values());

/** LaTeX split into commands, braces and single characters. */
function tokenize(latex) {
  const tokens = [];
  for (let i = 0; i < latex.length;) {
    const char = latex[i];
    if (/\s/.test(char)) { i += 1; continue; }
    if (char !== '\\') {
      tokens.push(char);
      i += 1;
      continue;
    }
    const letters = /^[a-zA-Z]+/.exec(latex.slice(i + 1));
    const token = letters ? `\\${letters[0]}` : `\\${latex[i + 1] ?? ''}`;
    i += token.length;
    if (!IGNORED.has(token)) tokens.push(ALIASES.get(token) ?? token);
  }
  return tokens;
}

/** Index of the closer matching an opener at `start`, or -1. */
function matchingBrace(tokens, start) {
  const stack = [OPEN.get(tokens[start])];
  for (let i = start + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (OPEN.has(token)) stack.push(OPEN.get(token));
    else if (CLOSE.has(token)) {
      if (stack.pop() !== token) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

/** The tokens of a `{...}` group starting at `start`, or null. */
function group(tokens, start) {
  if (tokens[start] !== '{') return null;
  const end = matchingBrace(tokens, start);
  if (end < 0) return null;
  return { body: tokens.slice(start + 1, end), next: end + 1 };
}

/**
 * Rewrite the spellings that differ only in typography.
 *
 * `\mathbb{R}` is what the reader types and `\R` is what Compute Engine
 * prints; `\frac{a}{b}` and `a/b` are the same quotient. Both are pure
 * notation, so normalizing them lets the kernel check steps it would
 * otherwise have to abstain on. Parentheses go back around a compound
 * numerator or denominator, which is what makes the rewrite safe.
 */
function normalize(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length;) {
    const token = tokens[i];
    if (token === '\\mathbb' || token === '\\mathbf') {
      const inner = group(tokens, i + 1);
      if (inner && inner.body.length === 1 && /^[A-Z]$/.test(inner.body[0])) {
        out.push(`\\${inner.body[0]}`);
        i = inner.next;
        continue;
      }
    }
    if (token === '\\frac' || token === '\\dfrac' || token === '\\tfrac') {
      const numerator = group(tokens, i + 1);
      const denominator = numerator && group(tokens, numerator.next);
      if (denominator) {
        out.push(...wrap(normalize(numerator.body)), '/', ...wrap(normalize(denominator.body)));
        i = denominator.next;
        continue;
      }
    }
    out.push(token);
    i += 1;
  }
  return out;
}

/** Parenthesize unless the group is already atomic. */
function wrap(tokens) {
  if (tokens.length <= 1) return tokens;
  if (OPEN.has(tokens[0]) && matchingBrace(tokens, 0) === tokens.length - 1) return tokens;
  return ['(', ...tokens, ')'];
}

/* ------------------------------ arithmetic ------------------------------- */

/**
 * Read a term as an exact rational polynomial, or return null.
 *
 * The trick that makes this cover far more than polynomials is that anything
 * it cannot read as arithmetic becomes an *indeterminate* named by its own
 * tokens: `\cos(t)` is a variable, and so is `\overline{\exp(it)}`. An
 * identity between polynomials in such indeterminates holds however they are
 * interpreted, so treating them as opaque is sound; it only means the kernel
 * misses identities that depend on what they mean. `\Re(z) = (z +
 * \overline{z})/2` is exactly such an identity, and it stays an admitted
 * theorem rather than becoming a checked step.
 *
 * A function application is always opaque, never implicit multiplication.
 * Reading `h(2y)` as `h · 2 · y` would be the one mistake here that could
 * accept a bad step, since it would let an application match a product that
 * means something else entirely.
 */
function polynomialOf(tokens) {
  const cursor = { at: 0, tokens };
  let value;
  try {
    value = readSum(cursor);
  } catch {
    // An expression too large to expand is one the kernel cannot read, which
    // is the same answer as any other it cannot read.
    return null;
  }
  return value && cursor.at === tokens.length ? value : null;
}

const DIGIT = /^[0-9]$/;
const LETTER = /^[a-zA-Z]$/;
const TIMES = new Set(['\\cdot', '\\times', '*']);

function readSum(cursor) {
  let sign = 1;
  if (cursor.tokens[cursor.at] === '-') { sign = -1; cursor.at += 1; }
  else if (cursor.tokens[cursor.at] === '+') cursor.at += 1;

  let total = readProduct(cursor);
  if (!total) return null;
  if (sign < 0) total = negatePolynomial(total);

  for (;;) {
    const token = cursor.tokens[cursor.at];
    if (token !== '+' && token !== '-') return total;
    cursor.at += 1;
    const next = readProduct(cursor);
    if (!next) return null;
    total = token === '+'
      ? addPolynomials(total, next)
      : subtractPolynomials(total, next);
  }
}

function readProduct(cursor) {
  let total = readPower(cursor);
  if (!total) return null;

  for (;;) {
    const token = cursor.tokens[cursor.at];
    if (TIMES.has(token)) {
      cursor.at += 1;
      const next = readPower(cursor);
      if (!next) return null;
      total = multiplyPolynomials(total, next);
      continue;
    }
    if (token === '/') {
      cursor.at += 1;
      const next = readPower(cursor);
      if (!next) return null;
      // Only division by a nonzero constant stays inside the ring. Anything
      // else is left for the caller to treat as an opaque term.
      const divisor = constantOf(next);
      if (!divisor || isZeroRational(divisor)) return null;
      total = scalePolynomial(total, divRational(ONE, divisor));
      continue;
    }
    // Juxtaposition is multiplication: `2ab`, `x^2y`, `(x+1)(x-1)`.
    if (!startsTerm(token)) return total;
    const next = readPower(cursor);
    if (!next) return null;
    total = multiplyPolynomials(total, next);
  }
}

const startsTerm = (token) => token !== undefined
  && (DIGIT.test(token) || LETTER.test(token) || token === '(' || token.startsWith('\\'))
  && !RELATIONS.has(token) && !CONNECTIVES.includes(token)
  && token !== '\\neg' && !QUANTIFIERS.has(token);

function readPower(cursor) {
  const base = readFactor(cursor);
  if (!base) return null;
  if (cursor.tokens[cursor.at] !== '^') return base;
  cursor.at += 1;
  const exponent = readExponent(cursor);
  if (exponent === null) return null;
  return powerPolynomial(base, exponent);
}

/** A literal integer exponent, braced or not. Negative powers are not read. */
function readExponent(cursor) {
  const { tokens } = cursor;
  let digits = '';
  if (tokens[cursor.at] === '{') {
    const end = matchingBrace(tokens, cursor.at);
    if (end < 0) return null;
    digits = tokens.slice(cursor.at + 1, end).join('');
    cursor.at = end + 1;
  } else {
    while (DIGIT.test(tokens[cursor.at] ?? '')) {
      digits += tokens[cursor.at];
      cursor.at += 1;
    }
  }
  const value = Number(digits);
  return digits && Number.isInteger(value) && value >= 0 && value <= 64 ? value : null;
}

function readFactor(cursor) {
  const { tokens } = cursor;
  const token = tokens[cursor.at];
  if (token === undefined) return null;

  if (token === '(') {
    const end = matchingBrace(tokens, cursor.at);
    if (end < 0) return null;
    const inner = polynomialOf(tokens.slice(cursor.at + 1, end));
    if (!inner) return null;
    cursor.at = end + 1;
    return inner;
  }

  if (DIGIT.test(token)) return readNumber(cursor);
  const bounded = readBoundedOperator(cursor);
  if (bounded) return bounded;
  const integerFunction = readIntegerFunction(cursor);
  if (integerFunction) return integerFunction;
  if (LETTER.test(token) || token.startsWith('\\')) return readSymbol(cursor);
  return null;
}

/* --------------------------- bounded enumeration -------------------------- */

/**
 * `\sum` and `\prod` over a literal range, expanded term by term.
 *
 * A bounded sum is not new mathematics — it is the arithmetic the kernel
 * already does, written once per index — and without it the most ordinary
 * rows in the application rest on the CAS's word for a computation a reader
 * could do on paper. `\sum_{n=1}^{10} n = 55` is now the kernel's own answer.
 *
 * The body is *re-read* at each index rather than substituted into a
 * polynomial, which is what lets `\sum_{n=1}^{3}\frac{1}{n} = \frac{11}{6}`
 * through: `1/n` is not a polynomial, but `1/2` is a rational constant. It
 * also makes nested sums fall out of the recursion, since an inner bound that
 * mentions the outer index is a literal by the time the inner reader sees it.
 *
 * Everything uncertain abstains. A symbolic bound, an index that is not a
 * single name, an empty range, or a range too long to enumerate all return
 * null, and the step keeps whatever trust it had.
 */
const BOUNDED_OPERATORS = new Set(['\\sum', '\\prod']);

/**
 * How many terms the kernel will expand.
 *
 * The bound exists because checking must stay cheap enough to run on every
 * keystroke, not because anything breaks above it. A sum longer than this
 * abstains rather than being refused.
 */
const ENUMERATION_LIMIT = 512n;

function readBoundedOperator(cursor) {
  const { tokens } = cursor;
  const operator = tokens[cursor.at];
  if (!BOUNDED_OPERATORS.has(operator)) return null;

  const limits = readLimits(tokens, cursor.at + 1);
  if (!limits) return null;
  if (limits.upper < limits.lower) return null;
  if (limits.upper - limits.lower + 1n > ENUMERATION_LIMIT) return null;

  const end = productExtent(tokens, limits.next);
  if (end < 0) return null;
  const body = tokens.slice(limits.next, end);

  const sum = operator === '\\sum';
  let total = constantPolynomial(sum ? ZERO : ONE);
  for (let index = limits.lower; index <= limits.upper; index += 1n) {
    const instance = substituteIndex(body, limits.index, index);
    if (!instance) return null;
    const term = polynomialOf(instance);
    if (!term) return null;
    total = sum ? addPolynomials(total, term) : multiplyPolynomials(total, term);
  }
  cursor.at = end;
  return total;
}

/**
 * `_{n=1}^{10}`, in either order, or null.
 *
 * Both bounds are read as arithmetic and both must come out integers: a bound
 * the kernel cannot evaluate is a sum it cannot expand, and `\sum_{k=1}^{n}`
 * says nothing at all until `n` is known.
 */
function readLimits(tokens, start) {
  let at = start;
  let subscript = null;
  let superscript = null;
  while (subscript === null || superscript === null) {
    const token = tokens[at];
    if (token === '_' && subscript === null) {
      const braced = group(tokens, at + 1);
      if (!braced) return null;
      subscript = braced.body;
      at = braced.next;
    } else if (token === '^' && superscript === null) {
      const braced = group(tokens, at + 1);
      if (braced) {
        superscript = braced.body;
        at = braced.next;
      } else if (tokens[at + 1] !== undefined) {
        superscript = [tokens[at + 1]];
        at += 2;
      } else return null;
    } else return null;
  }

  // `n = 1`, and nothing more elaborate: the index is one name.
  if (subscript[1] !== '=') return null;
  const index = subscript[0];
  if (!LETTER.test(index) && !/^\\[a-zA-Z]+$/.test(index ?? '')) return null;

  const lower = integerOf(subscript.slice(2));
  const upper = integerOf(superscript);
  if (lower === null || upper === null) return null;
  return { index, lower, upper, next: at };
}

/** Tokens read as arithmetic and coming out a literal integer, or null. */
function integerOf(tokens) {
  const polynomial = tokens.length ? polynomialOf(tokens) : null;
  const constant = polynomial && constantOf(polynomial);
  return constant && constant.d === 1n ? constant.n : null;
}

/**
 * Where the run of factors after `\sum_{..}^{..}` ends.
 *
 * Compute Engine binds a summation to the product that follows it and no
 * further — `\sum_{n=1}^{3} n + 5` is 11, not 21 — so the extent stops at a
 * top-level `+`, `-`, relation, connective or comma. Reading it any wider
 * would not merely miss a check: a ground relation the kernel reads wrongly is
 * *refused*, so the boundary has to be the one the CAS used.
 */
function productExtent(tokens, start) {
  let at = start;
  while (at < tokens.length) {
    const token = tokens[at];
    if (OPEN.has(token)) {
      const end = matchingBrace(tokens, at);
      if (end < 0) return -1;
      at = end + 1;
      continue;
    }
    if (CLOSE.has(token) || token === '+' || token === '-' || token === ','
      || RELATIONS.has(token) || CONNECTIVES.includes(token)
      || QUANTIFIERS.has(token)) break;
    at += 1;
  }
  return at > start ? at : -1;
}

/** Commands whose braced argument is a name rather than mathematics. */
const VERBATIM = new Set(['\\text', '\\textrm', '\\textit', '\\mathrm', '\\mathsf',
  '\\mathbf', '\\mathbb', '\\mathit', '\\mathcal', '\\mathfrak', '\\operatorname']);

/**
 * The body of a sum with the index replaced by one literal value.
 *
 * Substitution is on tokens because the body need not be a polynomial in the
 * index — `1/n` is the case that matters — so the value has to go in before
 * the arithmetic reader sees it. Two things could make that wrong, and both
 * are handled rather than risked: a letter inside `\text{...}` or
 * `\operatorname{...}` is part of a name and is skipped, and a nested `\sum`
 * binding the same index would shadow ours, so the whole reading is abandoned.
 *
 * The value is parenthesized unless it can stand alone, which keeps `2n` from
 * becoming `23` and lets `f(n)` become the same `f(1)` the reader would write.
 */
function substituteIndex(tokens, index, value) {
  const digits = `${value < 0n ? -value : value}`.split('');
  const literal = value < 0n ? ['-', ...digits] : digits;
  const out = [];
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (VERBATIM.has(token)) {
      const braced = group(tokens, at + 1);
      if (!braced) return null;
      out.push(token, '{', ...braced.body, '}');
      at = braced.next - 1;
      continue;
    }
    if (BOUNDED_OPERATORS.has(token)) {
      const inner = readLimits(tokens, at + 1);
      if (inner && inner.index === index) return null;
    }
    if (token !== index) {
      out.push(token);
      continue;
    }
    const after = out[out.length - 1];
    if (after === '_' || after === '^') {
      if (literal.length === 1) out.push(...literal);
      else out.push('{', ...literal, '}');
      continue;
    }
    // A bare digit run would weld itself to an adjacent one.
    if (literal.length === 1 && !DIGIT.test(after ?? '') && !DIGIT.test(tokens[at + 1] ?? '')) {
      out.push(...literal);
      continue;
    }
    out.push('(', ...literal, ')');
  }
  return out;
}

/**
 * The integer functions the kernel evaluates for itself.
 *
 * Everything else applied to arguments stays an opaque indeterminate, and that
 * is the safe default; these three are here because they are one line of
 * BigInt each and because without them the most elementary rows in the
 * application — `\gcd(12,18) = 6` — rest on the CAS's word for a computation
 * a reader could check on paper.
 *
 * `mod` is restricted to a non-negative dividend and a positive divisor, where
 * the truncating and flooring conventions agree. Outside that range they do
 * not, and the kernel has no business guessing which one the statement meant.
 */
const INTEGER_FUNCTIONS = new Map(Object.entries({
  gcd: (values) => (values.length === 2 ? bigGcd(abs(values[0]), abs(values[1])) : null),
  lcm: (values) => {
    if (values.length !== 2) return null;
    const [a, b] = [abs(values[0]), abs(values[1])];
    if (a === 0n || b === 0n) return 0n;
    return (a / bigGcd(a, b)) * b;
  },
  mod: (values) => {
    if (values.length !== 2) return null;
    const [a, b] = values;
    return a >= 0n && b > 0n ? a % b : null;
  },
}));

const abs = (value) => (value < 0n ? -value : value);

function bigGcd(a, b) {
  let [x, y] = [a, b];
  while (y) [x, y] = [y, x % y];
  return x;
}

/** `\gcd(12,18)` and `\operatorname{lcm}(4,6)`, or null for anything else. */
function readIntegerFunction(cursor) {
  const { tokens } = cursor;
  let at = cursor.at;
  let name = null;
  if (tokens[at]?.startsWith('\\') && INTEGER_FUNCTIONS.has(tokens[at].slice(1))) {
    name = tokens[at].slice(1);
    at += 1;
  } else if (tokens[at] === '\\operatorname') {
    const inner = group(tokens, at + 1);
    if (!inner) return null;
    name = inner.body.join('');
    at = inner.next;
  }
  if (!name || !INTEGER_FUNCTIONS.has(name)) return null;
  if (tokens[at] !== '(') return null;
  const end = matchingBrace(tokens, at);
  if (end < 0) return null;

  const argumentTokens = tokens.slice(at + 1, end);
  const commas = topLevel(argumentTokens, new Set([',']));
  if (!commas) return null;
  const values = [];
  for (const part of splitAt(argumentTokens, commas)) {
    const polynomial = polynomialOf(part);
    const constant = polynomial && constantOf(polynomial);
    // Only literal integers: these functions are not defined on anything else,
    // and an unread argument must leave the whole application opaque.
    if (!constant || constant.d !== 1n) return null;
    values.push(constant.n);
  }
  const value = INTEGER_FUNCTIONS.get(name)(values);
  if (value === null) return null;
  cursor.at = end + 1;
  return constantPolynomial(rational(value, 1n));
}

function readNumber(cursor) {
  const { tokens } = cursor;
  let whole = '';
  while (DIGIT.test(tokens[cursor.at] ?? '')) {
    whole += tokens[cursor.at];
    cursor.at += 1;
  }
  let fraction = '';
  if (tokens[cursor.at] === '.' && DIGIT.test(tokens[cursor.at + 1] ?? '')) {
    cursor.at += 1;
    while (DIGIT.test(tokens[cursor.at] ?? '')) {
      fraction += tokens[cursor.at];
      cursor.at += 1;
    }
  }
  const scale = 10n ** BigInt(fraction.length);
  return constantPolynomial(rational(BigInt(whole + fraction), scale));
}

/**
 * A name, and whatever is welded to it: a subscript, the braces of a `\text`
 * or `\mathsf`, the arguments of an application. All of it is one
 * indeterminate, keyed by the tokens it was written with.
 */
function readSymbol(cursor) {
  const { tokens } = cursor;
  const start = cursor.at;
  cursor.at += 1;

  for (;;) {
    const token = tokens[cursor.at];
    if (token === '_') {
      cursor.at += 1;
      if (tokens[cursor.at] === '{') {
        const end = matchingBrace(tokens, cursor.at);
        if (end < 0) return null;
        cursor.at = end + 1;
      } else if (tokens[cursor.at] !== undefined) cursor.at += 1;
      continue;
    }
    if (token === '{' || token === '(') {
      const end = matchingBrace(tokens, cursor.at);
      if (end < 0) return null;
      cursor.at = end + 1;
      continue;
    }
    break;
  }
  return variablePolynomial(join(tokens.slice(start, cursor.at)));
}

/* -------------------------------- parsing -------------------------------- */

/**
 * Relations that may head an atom.
 *
 * A chain of them (`a = b \ge 0`) is read as the conjunction of its adjacent
 * links, which is the standard reading and the one the prover relies on.
 * `\ne` is deliberately absent from the chainable set: `a \ne b \ne c` means
 * pairwise distinct, which is *stronger* than the adjacent links, and reading
 * it as the weaker thing would let a proof of less pass for a proof of more.
 */
const RELATIONS = new Set(['=', '<', '>', '\\le', '\\ge', '\\ne', '\\in',
  '\\notin', '\\subseteq', '\\subset', '\\supseteq', '\\equiv']);
const CHAINABLE = new Set(['=', '<', '>', '\\le', '\\ge']);
const FLIP = new Map(Object.entries({ '<': '>', '\\le': '\\ge' }));
const SYMMETRIC = new Set(['=', '\\ne', '\\equiv']);

/**
 * The relations whose two sides are numbers, and so may be compared by
 * subtracting one from the other. Membership and inclusion are not among
 * them; `\equiv` is left out because it is ambiguous enough already.
 */
const ARITHMETIC = new Set(['=', '\\ne', '>', '\\ge']);

const CONNECTIVES = ['\\iff', '\\implies', '\\vee', '\\wedge'];
const QUANTIFIERS = new Set(['\\forall', '\\exists']);

/** Positions of `token` at nesting depth zero, or null if the delimiters are unbalanced. */
function topLevel(tokens, wanted) {
  const at = [];
  const stack = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (OPEN.has(token)) stack.push(OPEN.get(token));
    else if (CLOSE.has(token)) {
      if (stack.pop() !== token) return null;
    } else if (!stack.length && wanted.has(token)) at.push(i);
  }
  return stack.length ? null : at;
}

const splitAt = (tokens, positions) => {
  const parts = [];
  let from = 0;
  for (const at of positions) {
    parts.push(tokens.slice(from, at));
    from = at + 1;
  }
  parts.push(tokens.slice(from));
  return parts;
};

/**
 * A proposition, as far as its propositional skeleton goes.
 *
 * Atoms are kept as token sequences rather than understood: the kernel needs
 * to know that two atoms are the same claim, never what either one asserts.
 * Returns null for anything it cannot read, which the callers treat as "cannot
 * tell" rather than as "false".
 */
function parse(tokens) {
  if (!tokens.length) return null;

  if (QUANTIFIERS.has(tokens[0])) return parseQuantifier(tokens);

  // `\equiv` is two things: an equality relation between terms, and — as
  // Compute Engine's `IdenticallyEqual` — a connective between propositions,
  // which would bind more loosely than everything below. Where both readings
  // are in play the kernel cannot tell which was meant, and guessing wrong
  // would give it a proposition nobody asserted, so it declines to read the
  // line at all.
  const equivalence = topLevel(tokens, new Set(['\\equiv']));
  if (equivalence === null) return null;
  if (equivalence.length) {
    const connective = topLevel(tokens, new Set([...CONNECTIVES, '\\neg']));
    if (connective === null || connective.length) return null;
  }

  for (const connective of CONNECTIVES) {
    const at = topLevel(tokens, new Set([connective]));
    if (at === null) return null;
    if (!at.length) continue;
    // Implication is right-associative, so only the first arrow splits it;
    // the others are n-ary and split at every occurrence.
    const parts = splitAt(tokens, connective === '\\implies' ? [at[0]] : at);
    const ops = parts.map(parse);
    if (ops.some((op) => op === null)) return null;
    if (connective === '\\implies') return { type: 'implies', left: ops[0], right: ops[1] };
    if (connective === '\\iff') return { type: 'iff', ops };
    return { type: connective === '\\vee' ? 'or' : 'and', ops: flatten(ops, connective === '\\vee' ? 'or' : 'and') };
  }

  if (tokens[0] === '\\neg') {
    const inner = parse(tokens.slice(1));
    return inner && { type: 'not', op: inner };
  }

  if (OPEN.has(tokens[0]) && matchingBrace(tokens, 0) === tokens.length - 1) {
    return parse(tokens.slice(1, -1));
  }

  if (tokens.length === 1 && (tokens[0] === '\\top' || tokens[0] === '\\bot')) {
    return { type: tokens[0] === '\\top' ? 'true' : 'false' };
  }

  return parseAtom(tokens);
}

/** `\forall x \in D, P` and its existential twin. */
function parseQuantifier(tokens) {
  const comma = topLevel(tokens, new Set([',']));
  if (!comma?.length) return null;
  const binding = tokens.slice(1, comma[0]);
  const body = parse(tokens.slice(comma[0] + 1));
  if (!body) return null;
  // Only a single typed variable is understood; anything else abstains rather
  // than guessing which name the quantifier binds.
  const at = topLevel(binding, new Set(['\\in']));
  if (binding.length === 1) return { type: tokens[0], variable: binding[0], domain: null, body };
  if (at?.length !== 1 || at[0] !== 1) return null;
  return {
    type: tokens[0],
    variable: binding[0],
    domain: binding.slice(2),
    body,
  };
}

const flatten = (ops, type) => ops.flatMap((op) => (op.type === type ? op.ops : [op]));

/**
 * A relation, a chain of them, or an opaque claim.
 *
 * Orientation is normalized so that `x < y` and `y > x` are one proposition,
 * and the two sides of a symmetric relation are sorted so that `a = b` and
 * `b = a` are too.
 */
function parseAtom(tokens) {
  const at = topLevel(tokens, RELATIONS);
  if (at === null) return null;
  if (!at.length) return { type: 'atom', tokens };

  const terms = splitAt(tokens, at);
  if (terms.some((term) => !term.length)) return null;
  const operators = at.map((index) => tokens[index]);
  if (operators.length === 1) return relation(operators[0], terms[0], terms[1]);
  if (!operators.every((operator) => CHAINABLE.has(operator))) return null;

  const links = operators.map((operator, index) => relation(operator, terms[index], terms[index + 1]));
  return { type: 'and', ops: links };
}

/**
 * One relation, with its difference computed where arithmetic allows.
 *
 * `x < y`, `y > x` and `2y < 2x` are one proposition, and what makes them one
 * is not their spelling but the polynomial `x - y` with a positive sign: the
 * difference, normalized up to the scaling the relation tolerates. Where
 * either side is not a polynomial — a set, an absolute value, a name with no
 * arithmetic in it — the tokens themselves are the only handle there is, and
 * the relation falls back to comparing them.
 */
function relation(operator, left, right) {
  if (FLIP.has(operator)) return relation(FLIP.get(operator), right, left);
  const node = { type: 'rel', operator, left, right };
  if (ARITHMETIC.has(operator)) {
    const a = polynomialOf(left);
    const b = polynomialOf(right);
    if (a && b) return { ...node, difference: subtractPolynomials(a, b) };
  }
  if (SYMMETRIC.has(operator) && join(right) < join(left)) {
    return { ...node, left: right, right: left };
  }
  return node;
}

/**
 * How much rescaling leaves a relation saying the same thing.
 *
 * An equation survives multiplication by any nonzero constant; an inequality
 * survives only a positive one, since a negative constant turns it around.
 */
const scalingOf = (operator) => (SYMMETRIC.has(operator)
  ? { upToScale: true }
  : { upToPositiveScale: true });

const join = (tokens) => tokens.join(' ');

/**
 * A canonical string for a proposition, so that comparison is one `===`.
 *
 * Conjunction, disjunction and equivalence are commutative, so their operands
 * are sorted; implication is not, so it is not.
 */
function key(formula) {
  switch (formula.type) {
    case 'atom': return `a:${join(formula.tokens)}`;
    case 'rel':
      return formula.difference
        ? `r:${formula.operator}:${polynomialKey(formula.difference, scalingOf(formula.operator))}`
        : `r:${formula.operator}:${join(formula.left)}:${join(formula.right)}`;
    case 'not': return `!${key(formula.op)}`;
    case 'implies': return `(${key(formula.left)}=>${key(formula.right)})`;
    case 'and':
    case 'or':
    case 'iff': {
      const parts = formula.ops.map(key).sort();
      return `${formula.type}(${parts.join(',')})`;
    }
    case '\\forall':
    case '\\exists':
      return `${formula.type} ${formula.variable}:${join(formula.domain ?? [])}.${key(formula.body)}`;
    default: return formula.type;
  }
}

/** Parse a LaTeX proposition, or null when it cannot be read. Exported for tests. */
export function parseProposition(latex) {
  if (typeof latex !== 'string' || !latex.trim()) return null;
  try {
    return parse(normalize(tokenize(latex)));
  } catch {
    return null;
  }
}

/** Whether two LaTeX propositions are syntactically the same claim. */
export function sameProposition(a, b) {
  const left = parseProposition(a);
  const right = parseProposition(b);
  return Boolean(left && right && key(left) === key(right));
}

/* -------------------------------- checkers -------------------------------- */

/**
 * The three answers a checker may give.
 *
 * `REFUSED` is reserved for a step that is not an instance of the rule it
 * names whatever its atoms mean — conjunction introduction concluding a
 * disjunction, generalization concluding something unquantified. A conclusion
 * whose *shape* is right but whose parts the kernel could not match to the
 * premises is `UNKNOWN`, because the two may well say the same thing in
 * algebra this module cannot see through.
 */
const CHECKED = true;
const REFUSED = false;
const UNKNOWN = null;

const BOOLEAN_TYPES = new Set(['and', 'or', 'not', 'implies', 'iff']);
const MAX_BOOLEAN_ATOMS = 12;

/**
 * Re-run a propositional truth table with every mathematical statement kept
 * opaque. The kernel needs no idea what `x > y` or `A \in B` means here; it
 * only needs the same atom to receive the same truth value everywhere it
 * occurs. At twelve atoms the complete table has 4,096 rows, the same bound
 * used by the prover.
 */
function checkTautology(conclusion) {
  if (!BOOLEAN_TYPES.has(conclusion.type)) return UNKNOWN;
  const atoms = new Map();

  const collect = (formula) => {
    if (formula.type === 'true' || formula.type === 'false') return;
    if (BOOLEAN_TYPES.has(formula.type)) {
      if (formula.type === 'not') collect(formula.op);
      else if (formula.type === 'implies') {
        collect(formula.left);
        collect(formula.right);
      } else formula.ops.forEach(collect);
      return;
    }
    const atom = key(formula);
    if (!atoms.has(atom)) atoms.set(atom, atoms.size);
  };
  collect(conclusion);
  if (atoms.size > MAX_BOOLEAN_ATOMS) return UNKNOWN;

  const evaluate = (formula, assignment) => {
    switch (formula.type) {
      case 'true': return true;
      case 'false': return false;
      case 'not': return !evaluate(formula.op, assignment);
      case 'and': return formula.ops.every((op) => evaluate(op, assignment));
      case 'or': return formula.ops.some((op) => evaluate(op, assignment));
      case 'implies': return !evaluate(formula.left, assignment)
        || evaluate(formula.right, assignment);
      case 'iff': {
        const values = formula.ops.map((op) => evaluate(op, assignment));
        return values.every((value) => value === values[0]);
      }
      default: return assignment[atoms.get(key(formula))];
    }
  };

  const assignment = new Array(atoms.size).fill(false);
  for (let mask = 0; mask < 2 ** atoms.size; mask++) {
    for (let bit = 0; bit < atoms.size; bit++) {
      assignment[bit] = Boolean(mask & (1 << bit));
    }
    if (!evaluate(conclusion, assignment)) return UNKNOWN;
  }
  return CHECKED;
}

const conjuncts = (formula) => (formula.type === 'and' ? formula.ops : [formula]);
const disjuncts = (formula) => (formula.type === 'or' ? formula.ops : [formula]);

/**
 * A rule applied to a bare proposition and the same rule applied under a
 * shared antecedent are one rule, and the prover emits both.
 *
 * `x^2 \ge 0 \wedge y^2 \ge 0` from its two conjuncts is conjunction
 * introduction; so is `A \implies B \wedge C` from `A \implies B` and
 * `A \implies C`. This peels the antecedent, so that a checker can be written
 * once against the consequent.
 */
function underAntecedent(conclusion) {
  return conclusion.type === 'implies'
    ? { antecedent: conclusion.left, consequent: conclusion.right }
    : { antecedent: null, consequent: conclusion };
}

/**
 * Whether some premise establishes `goal`, either outright or under the shared
 * antecedent.
 *
 * Premises the rule does not consume are ignored rather than refused. A step
 * may cite the definitions its statement rests on alongside its logical
 * inputs, and an unused premise can only ever make a step easier to justify,
 * never harder.
 */
function supported(goal, premises, antecedent) {
  const wanted = key(goal);
  const wantedUnder = antecedent && key({ type: 'implies', left: antecedent, right: goal });
  return premises.some((premise) => {
    const found = key(premise);
    return found === wanted || found === wantedUnder;
  });
}

/**
 * Conjunction introduction, and the chain that is a conjunction in disguise.
 *
 * A relation chain `a = b \ge 0` holds exactly when its adjacent links do, and
 * the parser has already expanded it, so both rules check the same way.
 */
function checkConjunction(conclusion, premises) {
  const { antecedent, consequent } = underAntecedent(conclusion);
  const parts = conjuncts(consequent);
  if (parts.length < 2) return REFUSED;
  return parts.every((part) => supported(part, premises, antecedent)) ? CHECKED : UNKNOWN;
}

/** Disjunction introduction: one disjunct is enough. */
function checkDisjunction(conclusion, premises) {
  const { antecedent, consequent } = underAntecedent(conclusion);
  const parts = disjuncts(consequent);
  if (parts.length < 2) return REFUSED;
  return parts.some((part) => supported(part, premises, antecedent)) ? CHECKED : UNKNOWN;
}

/**
 * Conjunction elimination.
 *
 * Bare, it takes one conjunct of an established conjunction. Under an arrow it
 * is the weakening the prover actually emits: having proved `A \implies C`, a
 * stronger antecedent that contains `A` still gives `C`.
 */
function checkAndElim(conclusion, premises) {
  if (conclusion.type === 'implies') {
    const parts = conjuncts(conclusion.left);
    if (parts.some((part) => supported(conclusion.right, premises, part))) return CHECKED;
  }
  const wanted = key(conclusion);
  const found = premises.some((premise) => premise.type === 'and'
    && premise.ops.some((part) => key(part) === wanted));
  // Both shapes are plausible for any conclusion, so failing to find either is
  // a gap in the evidence rather than proof of a misapplied rule.
  return found ? CHECKED : UNKNOWN;
}

/** Proof by cases: every disjunct of the antecedent reaches the conclusion. */
function checkCases(conclusion, premises) {
  if (conclusion.type !== 'implies') return REFUSED;
  const parts = disjuncts(conclusion.left);
  if (parts.length < 2) return REFUSED;
  return parts.every((part) => supported(conclusion.right, premises, part)) ? CHECKED : UNKNOWN;
}

/**
 * Implication introduction, in the two shapes the prover reaches it by: the
 * consequent holds outright and so the implication does, or the consequent is
 * `\top` and there is nothing to prove.
 */
function checkImpliesIntro(conclusion, premises) {
  if (conclusion.type !== 'implies') return REFUSED;
  if (conclusion.right.type === 'true') return CHECKED;
  return supported(conclusion.right, premises, null) ? CHECKED : UNKNOWN;
}

/** Modus ponens: the implication and its antecedent both stand. */
function checkImpliesElim(conclusion, premises) {
  const wanted = key(conclusion);
  const found = premises.some((premise) => premise.type === 'implies'
    && key(premise.right) === wanted
    && supported(premise.left, premises, null));
  return found ? CHECKED : UNKNOWN;
}

/** Equivalence introduction: both directions were established. */
function checkIffIntro(conclusion, premises) {
  if (conclusion.type !== 'iff' || conclusion.ops.length !== 2) return REFUSED;
  const [a, b] = conclusion.ops;
  const forward = supported(b, premises, a);
  const backward = supported(a, premises, b);
  return forward && backward ? CHECKED : UNKNOWN;
}

/**
 * Vacuous truth.
 *
 * Only the explicitly false antecedent is checkable here. The prover also
 * reaches this rule by showing a relation unsatisfiable, and that argument
 * does not appear in the trace at all, so the kernel abstains rather than
 * pretending to have seen it.
 */
function checkVacuous(conclusion) {
  if (conclusion.type !== 'implies') return REFUSED;
  return conclusion.left.type === 'false' ? CHECKED : UNKNOWN;
}

/**
 * Universal generalization.
 *
 * The body was proved with the variable free, which is exactly the rule — but
 * only if the variable was genuinely arbitrary. Any assumption still open
 * could have constrained it, so a derivation containing one goes unchecked
 * rather than being taken as generalization.
 */
function checkUniversal(conclusion, premises, step, context) {
  let body = conclusion;
  const bound = [];
  while (body.type === '\\forall') {
    bound.push(`${body.variable}\\in${join(body.domain ?? [])}`);
    body = body.body;
  }
  if (!bound.length) return REFUSED;

  // The bindings the prover declared and the ones the conclusion displays come
  // from the same place, so agreeing does not make the domain true — it makes
  // the trace internally consistent, which is what a checker can offer here.
  const declared = step.data?.bindingsLatex;
  if (Array.isArray(declared)) {
    if (declared.length !== bound.length) return UNKNOWN;
    const stated = declared.map((binding) => {
      const tokens = normalize(tokenize(binding));
      return `${tokens[0]}\\in${join(tokens.slice(2))}`;
    });
    if (stated.some((binding, index) => binding !== bound[index])) return UNKNOWN;
  }
  if (context.dependsOnRule(step.id, 'logic.assumption')) return UNKNOWN;
  return supported(body, premises, null) ? CHECKED : UNKNOWN;
}

/* --------------------------------- rewrites --------------------------------- */

/**
 * Whether a value of the given sign satisfies a relation against zero.
 *
 * The whole of the rewrite arithmetic reduces to this and the table below, so
 * it is worth being able to read both at a glance.
 */
function satisfiedBy(operator, sign) {
  switch (operator) {
    case '=': return sign === 0;
    case '\\ne': return sign !== 0;
    case '>': return sign > 0;
    case '\\ge': return sign >= 0;
    default: return false;
  }
}

/**
 * Does `t ⋈from 0` entail `c·t + k ⋈to 0`?
 *
 * Every rewrite in this file is an instance of this question, and the answer
 * is pointwise arithmetic rather than a table to be looked up. Taking the
 * cases in turn, with `t` an arbitrary value satisfying the antecedent:
 *
 *   c = 0, or from is `=`   the value is exactly `k`, whatever `t` is;
 *   from `>`, c > 0, k ≥ 0  `ct > 0`, so `ct + k > 0`;
 *   from `>`, c < 0, k ≤ 0  `ct < 0`, so `ct + k < 0`, which settles `≠`;
 *   from `≥`, c > 0         `ct ≥ 0`, so `ct + k ≥ k`;
 *   from `≥`, c < 0, k < 0  `ct ≤ 0`, so `ct + k < 0`;
 *   from `≠`, c ≠ 0, k = 0  `ct ≠ 0`.
 *
 * Nothing here appeals to the range `t` actually takes, only to its sign, so
 * the conclusion holds for every polynomial with that sign — which is what
 * makes it safe to apply to a polynomial the kernel knows nothing else about.
 */
function affineEntails(from, to, c, k) {
  const cSign = signOfRational(c);
  const kSign = signOfRational(k);
  if (cSign === 0 || from === '=') return satisfiedBy(to, kSign);

  switch (from) {
    case '\\ne':
      return to === '\\ne' && kSign === 0;
    case '>':
      if (cSign > 0) return ['>', '\\ge', '\\ne'].includes(to) && kSign >= 0;
      return to === '\\ne' && kSign <= 0;
    case '\\ge':
      if (cSign > 0) {
        if (to === '\\ge') return kSign >= 0;
        return (to === '>' || to === '\\ne') && kSign > 0;
      }
      return to === '\\ne' && kSign < 0;
    default: return false;
  }
}

/**
 * The two relations a rewrite claims to connect, when a conclusion is shaped
 * like one. An equivalence has to survive being read in both directions, so it
 * comes back as a pair of implications.
 */
function rewriteSteps(conclusion) {
  const pairs = conclusion.type === 'implies'
    ? [[conclusion.left, conclusion.right]]
    : conclusion.type === 'iff' && conclusion.ops.length === 2
      ? [[conclusion.ops[0], conclusion.ops[1]], [conclusion.ops[1], conclusion.ops[0]]]
      : null;
  if (!pairs) return null;
  if (!pairs.every(([from, to]) => from.difference && to.difference)) return null;
  return pairs;
}

/**
 * A rewrite that rescales, offsets, or merely restates a relation.
 *
 * The kernel does not take the prover's word for the factor: it recovers `c`
 * and `k` from the two polynomials itself and then asks whether that map
 * justifies the step. `allow` is the extra condition the *rule* claims beyond
 * validity — that the factor is positive, or nonzero — which is what keeps
 * three separate rules from collapsing into one.
 */
const scalingRewrite = (allow) => (conclusion) => {
  const pairs = rewriteSteps(conclusion);
  if (!pairs) return UNKNOWN;
  for (const [from, to] of pairs) {
    const affine = affineRatio(from.difference, to.difference)
      ?? scaled(from.difference, to.difference);
    if (!affine || !allow(affine.c)) return UNKNOWN;
    if (!affineEntails(from.operator, to.operator, affine.c, affine.k)) return UNKNOWN;
  }
  return CHECKED;
};

/** `b = c·a` read as an affine map with no offset. */
function scaled(a, b) {
  const c = scalarRatio(a, b);
  return c ? { c, k: rational(0n) } : null;
}

const isPositive = (c) => signOfRational(c) > 0;
const isNonzero = (c) => signOfRational(c) !== 0;

/**
 * Exact normalization: the two relations are the same claim.
 *
 * On a bare relation the claim is that its two sides reduce to one normal
 * form, which is checkable outright — and refutable, since a difference of
 * exactly zero makes `\ne` and `>` false whatever the terms in it mean.
 */
function checkNormalize(conclusion) {
  if (conclusion.type === 'rel') {
    if (!conclusion.difference) return UNKNOWN;
    if (!isZeroPolynomial(conclusion.difference)) return UNKNOWN;
    return satisfiedBy(conclusion.operator, 0) ? CHECKED : REFUSED;
  }
  const pairs = rewriteSteps(conclusion);
  if (!pairs) return UNKNOWN;
  return pairs.every(([from, to]) => key(from) === key(to)) ? CHECKED : UNKNOWN;
}

/**
 * One side is a fixed power of the other.
 *
 * Which side is which is not recorded, so both readings are tried. The
 * reasoning is the same pointwise arithmetic as the affine table: `t^n` is
 * non-negative for even `n` and takes the sign of `t` for odd `n`, and `s`
 * carries that through.
 */
function checkPower(conclusion, premises, step) {
  const exponent = step.data?.exponent;
  if (!Number.isInteger(exponent) || exponent < 2 || exponent > 64) return UNKNOWN;
  const pairs = rewriteSteps(conclusion);
  if (!pairs) return UNKNOWN;

  for (const [from, to] of pairs) {
    const forward = powerScale(from.difference, to.difference, exponent);
    if (forward && powerEntails(from.operator, to.operator, exponent, forward)) continue;
    const reverse = powerScale(to.difference, from.difference, exponent);
    if (reverse && reversedPowerEntails(from.operator, to.operator, exponent, reverse)) continue;
    return UNKNOWN;
  }
  return CHECKED;
}

/** The sign of `s` in `powered = s·base^n`, or null. */
function powerScale(base, powered, exponent) {
  const raised = powerPolynomial(base, exponent);
  if (!raised || isZeroPolynomial(raised)) return null;
  const scale = scalarRatio(raised, powered);
  return scale ? signOfRational(scale) : null;
}

/** Given `t ⋈from 0`, does `s·t^n ⋈to 0` follow? */
function powerEntails(from, to, exponent, sign) {
  const even = exponent % 2 === 0;
  switch (from) {
    // t = 0 makes the power zero whatever the scale.
    case '=': return to === '=' || to === '\\ge';
    // t > 0 makes t^n > 0, so the product takes the sign of s.
    case '>': return sign > 0 ? ['>', '\\ge', '\\ne'].includes(to) : to === '\\ne';
    // t >= 0 leaves t^n at zero when t is, so only `>=` survives.
    case '\\ge': return sign > 0 && to === '\\ge';
    // t != 0 makes t^n nonzero, and positive as well when n is even.
    case '\\ne':
      if (to === '\\ne') return true;
      return even && sign > 0 && (to === '>' || to === '\\ge');
    default: return false;
  }
}

/** Given `s·p^n ⋈from 0`, does `p ⋈to 0` follow? */
function reversedPowerEntails(from, to, exponent, sign) {
  const even = exponent % 2 === 0;
  switch (from) {
    case '=': return to === '=' || to === '\\ge';
    case '\\ne': return to === '\\ne';
    case '>':
      // An even power against a negative scale can never be positive, so the
      // antecedent is unsatisfiable and anything follows from it.
      if (even && sign < 0) return true;
      if (to === '\\ne') return true;
      return !even && sign > 0 && (to === '>' || to === '\\ge');
    case '\\ge':
      if (even && sign < 0) return to === '=' || to === '\\ge';
      return !even && sign > 0 && to === '\\ge';
    default: return false;
  }
}

/**
 * The consequent's polynomial is an exact multiple of the antecedent's.
 *
 * Division by a single divisor terminates and is complete for exact
 * divisibility, so a quotient found here is a certificate and its absence is
 * a genuine answer — though only for the equations this rule is used on.
 */
function checkMultiple(conclusion) {
  const pairs = rewriteSteps(conclusion);
  if (!pairs) return UNKNOWN;
  for (const [from, to] of pairs) {
    if (from.operator !== '=' || to.operator !== '=') return UNKNOWN;
    if (!dividePolynomials(to.difference, from.difference)) return UNKNOWN;
  }
  return CHECKED;
}

/**
 * Ground arithmetic: a closed relation the kernel works out for itself.
 *
 * `engine.exact-evaluation` is one label over statements with nothing in
 * common — `2 + 2 = 4` and `\sum 1/n^2 = \pi^2/6` arrive under it alike — and
 * the label is why the easiest rows in the application rested on the CAS's
 * word. Nothing new is needed to check the easy end of it: where both sides
 * read as rational arithmetic with no indeterminate left over, the difference
 * is a single exact rational and its sign settles the relation.
 *
 * Everything the reader cannot check on paper still abstains. `\pi > 3` leaves
 * `\pi` as an indeterminate, so the difference is not constant and the step
 * keeps the oracle it had.
 *
 * A false answer here is a real disagreement, not a gap: the CAS cannot have
 * exactly evaluated `2 + 2 = 5` to true, so the step is refused rather than
 * left alone.
 */
function checkGroundArithmetic(conclusion) {
  if (conclusion.type !== 'rel' || !conclusion.difference) return UNKNOWN;
  const value = constantOf(conclusion.difference);
  if (!value) return UNKNOWN;
  return satisfiedBy(conclusion.operator, signOfRational(value)) ? CHECKED : REFUSED;
}

/**
 * The domains in which a radical's membership is one integer question.
 *
 * `\mathbb{Q}` normalizes to `\Q`, which is why the set is spelled this way.
 */
const RATIONALITY_DOMAINS = new Set(['\\Q', '\\Z']);

/** A run of digits as a BigInt, or null if the tokens are anything else. */
function digitsOf(tokens) {
  if (!tokens.length || tokens.some((token) => !DIGIT.test(token))) return null;
  return BigInt(tokens.join(''));
}

/** `\sqrt{2}` and `\sqrt[3]{5}` as a radicand and an index, or null. */
function radicalTokens(tokens) {
  const body = peelParentheses(tokens);
  if (body[0] !== '\\sqrt') return null;
  let at = 1;
  let index = 2n;
  if (body[at] === '[') {
    const end = matchingBrace(body, at);
    if (end < 0) return null;
    index = digitsOf(body.slice(at + 1, end));
    if (index === null || index < 1n || index > 64n) return null;
    at = end + 1;
  }
  const radicand = group(body, at);
  if (!radicand || radicand.next !== body.length) return null;
  const value = digitsOf(radicand.body);
  return value === null ? null : { radicand: value, index };
}

/**
 * The exact n-th root of a non-negative integer, or null when there is none.
 *
 * Binary search on the integers, deliberately written out here rather than
 * shared with the prover that found the same answer: the kernel's arithmetic
 * has to be its own or it is checking nothing.
 */
function exactIntegerRoot(radicand, index) {
  if (radicand < 2n) return radicand;
  let low = 1n;
  let high = radicand;
  while (low <= high) {
    const middle = (low + high) / 2n;
    const power = middle ** index;
    if (power === radicand) return middle;
    if (power < radicand) low = middle + 1n;
    else high = middle - 1n;
  }
  return null;
}

/**
 * Irrationality, which turns out to be a search over the integers.
 *
 * `\sqrt{2} \notin \mathbb{Q}` says that 2 is not a perfect square, and every
 * classical proof of it is a proof of that; the kernel can settle the question
 * by looking. The conclusion carries everything needed, so this checker reads
 * nothing from the step's data — the prover's `rootLatex` is a courtesy to the
 * reader and is not believed here.
 *
 * The claim is refused when the search disagrees with it, in either direction:
 * a perfect square asserted to be irrational is not this rule misapplied, it
 * is this rule contradicted.
 */
function checkIntegerRoot(conclusion) {
  if (conclusion.type !== 'rel') return UNKNOWN;
  const claimsMember = conclusion.operator === '\\in';
  if (!claimsMember && conclusion.operator !== '\\notin') return UNKNOWN;
  if (!RATIONALITY_DOMAINS.has(join(conclusion.right))) return UNKNOWN;
  const radical = radicalTokens(conclusion.left);
  if (!radical) return UNKNOWN;
  const isRational = exactIntegerRoot(radical.radicand, radical.index) !== null;
  return isRational === claimsMember ? CHECKED : REFUSED;
}

/* -------------------------------- primality ------------------------------- */

/**
 * Primality, which is the one Tier 1 statement the kernel cannot simply
 * recompute.
 *
 * Everything else the ground checker does is a calculation: the kernel redoes
 * the sum and compares. Factoring is not, and a checker that trial-divides is
 * a checker that has quietly become a prover — slowly, on every keystroke.
 * So this one takes a witness in each direction and does the small arithmetic
 * that confirms it:
 *
 *   - **prime** carries a Pratt certificate. For each prime in the tree, a
 *     primitive root `a` and the complete factorisation of `p-1`: if
 *     `a^{p-1} = 1` and `a^{(p-1)/q} \ne 1` for every prime `q` dividing
 *     `p-1`, then `a` has order exactly `p-1`, so the multiplicative group has
 *     `p-1` elements and `p` is prime. Each `q` is established the same way,
 *     lower in the tree, and the list is checked in ascending order so nothing
 *     is believed before it is shown.
 *   - **composite** carries a proper divisor, which is one remainder.
 *
 * The asymmetry of refusal is deliberate and is the same one as everywhere
 * else here. A witness that contradicts the claim is a refusal — a valid Pratt
 * certificate for a number claimed composite is not a gap, it is a
 * disagreement. A witness that is merely missing or malformed is a gap, and
 * the step keeps the trust it had.
 */
const PRIME_DOMAINS = new Set(['\\P']);

/** Certificates larger than this are declined rather than walked. */
const MAX_PRATT_ENTRIES = 64;

function modPow(base, exponent, modulus) {
  let result = 1n;
  let value = base % modulus;
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) result = (result * value) % modulus;
    value = (value * value) % modulus;
    remaining >>= 1n;
  }
  return result;
}

/** A decimal string as a positive BigInt, or null. */
function positiveInteger(text) {
  return typeof text === 'string' && /^[1-9]\d{0,18}$/.test(text) ? BigInt(text) : null;
}

/**
 * Walk a Pratt certificate, and report the numbers it establishes as prime.
 *
 * Returns null the moment anything fails to check: a partly valid certificate
 * establishes nothing, and returning what it managed would be an invitation to
 * read a subtree as the claim.
 */
function prattPrimes(entries) {
  if (!Array.isArray(entries) || !entries.length) return null;
  if (entries.length > MAX_PRATT_ENTRIES) return null;
  const established = new Set();
  for (const entry of entries) {
    const number = positiveInteger(entry?.numberLatex);
    if (number === null || number < 2n || established.has(number)) return null;

    if (number === 2n) {
      established.add(number);
      continue;
    }
    if (!Array.isArray(entry.factorsLatex) || !entry.factorsLatex.length) return null;
    let product = 1n;
    const distinct = new Set();
    for (const text of entry.factorsLatex) {
      const factor = positiveInteger(text);
      // A factor not already established is not believed; the certificate is
      // required to name its subtree first, and this is what enforces it.
      if (factor === null || !established.has(factor)) return null;
      product *= factor;
      if (product > number) return null;
      distinct.add(factor);
    }
    if (product !== number - 1n) return null;

    const root = positiveInteger(entry.rootLatex);
    if (root === null || root < 2n || root >= number) return null;
    if (modPow(root, number - 1n, number) !== 1n) return null;
    for (const factor of distinct) {
      if (modPow(root, (number - 1n) / factor, number) === 1n) return null;
    }
    established.add(number);
  }
  return established;
}

function checkPrimality(conclusion, premises, step) {
  if (conclusion.type !== 'rel') return UNKNOWN;
  const claimsMember = conclusion.operator === '\\in';
  if (!claimsMember && conclusion.operator !== '\\notin') return UNKNOWN;
  if (!PRIME_DOMAINS.has(join(conclusion.right))) return UNKNOWN;

  const digits = digitsOf(peelParentheses(conclusion.left));
  if (digits === null) return UNKNOWN;
  // Nothing below 2 is prime, and no witness is needed to say so.
  if (digits < 2n) return claimsMember ? REFUSED : CHECKED;

  const data = step?.data ?? {};
  const factor = positiveInteger(data.factorLatex);
  if (factor !== null && factor > 1n && factor < digits && digits % factor === 0n) {
    return claimsMember ? REFUSED : CHECKED;
  }
  const established = prattPrimes(data.prattLatex);
  if (established?.has(digits)) return claimsMember ? CHECKED : REFUSED;
  return UNKNOWN;
}

/** A polynomial whose displayed monomials are visibly non-negative. */
function evenMonomialSign(polynomial) {
  let positiveConstant = false;
  for (const { monomial, coefficient } of polynomial.values()) {
    if (signOfRational(coefficient) < 0) return null;
    if ([...monomial.values()].some((exponent) => exponent % 2 !== 0)) return null;
    if (monomial.size === 0 && signOfRational(coefficient) > 0) positiveConstant = true;
  }
  return positiveConstant ? 'positive' : 'nonnegative';
}

/** Remove parentheses that enclose an entire token sequence. */
function peelParentheses(tokens) {
  let peeled = tokens;
  while (peeled[0] === '(' && matchingBrace(peeled, 0) === peeled.length - 1) {
    peeled = peeled.slice(1, -1);
  }
  return peeled;
}

/**
 * Whether the witness is one explicit even power, such as `(xy+z)^2`.
 *
 * Expanding this expression may introduce mixed monomials, so the coefficient
 * test above cannot see its sign. The kernel still expands its base itself;
 * the trace supplies only the cheap-to-check shape, never a claimed result.
 */
function isExplicitEvenPower(tokens) {
  const expression = peelParentheses(tokens);
  const powers = topLevel(expression, new Set(['^']));
  if (!powers || powers.length !== 1 || powers[0] === 0) return false;
  const cursor = { at: powers[0] + 1, tokens: expression };
  const exponent = readExponent(cursor);
  if (!Number.isInteger(exponent) || exponent <= 0 || exponent % 2 !== 0
    || cursor.at !== expression.length) return false;
  return polynomialOf(expression.slice(0, powers[0])) !== null;
}

/**
 * Check an even-power certificate without sharing the prover's arithmetic.
 *
 * The witness has two obligations: it must be visibly non-negative (a sum of
 * non-negative even monomials, or one explicit even power), and its exact
 * rational expansion must equal the relation's oriented difference. A strict
 * inequality additionally needs a positive constant, because a bare square
 * can vanish.
 */
function checkEvenPower(conclusion, premises, step) {
  if (conclusion.type !== 'rel' || !['>', '\\ge'].includes(conclusion.operator)) {
    return UNKNOWN;
  }
  if (!conclusion.difference) return UNKNOWN;
  const witnessLatex = step.data?.witnessLatex;
  if (typeof witnessLatex !== 'string' || !witnessLatex.trim()) return UNKNOWN;

  const tokens = normalize(tokenize(witnessLatex));
  const witness = polynomialOf(tokens);
  if (!witness || !samePolynomial(witness, conclusion.difference)) return UNKNOWN;

  const sign = evenMonomialSign(witness)
    ?? (isExplicitEvenPower(tokens) ? 'nonnegative' : null);
  if (!sign) return UNKNOWN;
  if (conclusion.operator === '>' && sign !== 'positive') return UNKNOWN;
  return CHECKED;
}

/**
 * Check a positive-semidefinite quadratic certificate as a sum of squares.
 *
 * The prover supplies positive rational coefficients `d_i` and affine bases
 * `b_i`; the kernel trusts neither. It parses them with its own arithmetic,
 * establishes every `d_i > 0`, expands `sum d_i b_i^2`, and requires exact
 * equality with the relation's oriented difference. For a strict inequality,
 * one square must have a nonzero constant base, giving a positive lower bound.
 */
function checkQuadraticPsd(conclusion, premises, step) {
  if (conclusion.type !== 'rel' || !['>', '\\ge'].includes(conclusion.operator)) {
    return UNKNOWN;
  }
  if (!conclusion.difference) return UNKNOWN;

  const coefficients = step.data?.sosCoefficientsLatex;
  const bases = step.data?.sosBasesLatex;
  if (!Array.isArray(coefficients) || !Array.isArray(bases)
    || coefficients.length === 0 || coefficients.length !== bases.length
    || coefficients.length > 8) return UNKNOWN;

  let sum = constantPolynomial(rational(0n));
  let hasPositiveConstant = false;
  for (let i = 0; i < coefficients.length; i++) {
    if (typeof coefficients[i] !== 'string' || typeof bases[i] !== 'string') return UNKNOWN;
    const coefficientPolynomial = polynomialOf(normalize(tokenize(coefficients[i])));
    const base = polynomialOf(normalize(tokenize(bases[i])));
    if (!coefficientPolynomial || !base) return UNKNOWN;

    const coefficient = constantOf(coefficientPolynomial);
    if (!coefficient || signOfRational(coefficient) <= 0) return UNKNOWN;
    const square = powerPolynomial(base, 2);
    if (!square) return UNKNOWN;
    sum = addPolynomials(sum, scalePolynomial(square, coefficient));

    const constant = constantOf(base);
    if (constant && !isZeroRational(constant)) hasPositiveConstant = true;
  }

  if (!samePolynomial(sum, conclusion.difference)) return UNKNOWN;
  if (conclusion.operator === '>' && !hasPositiveConstant) return UNKNOWN;
  return CHECKED;
}

/* --------------------------- free-group words --------------------------- */

const GROUP_MAX_EXPONENT = 64;
const GROUP_GREEK = new Set([
  '\\alpha', '\\beta', '\\gamma', '\\delta', '\\epsilon', '\\zeta', '\\eta',
  '\\theta', '\\iota', '\\kappa', '\\lambda', '\\mu', '\\nu', '\\xi',
  '\\omicron', '\\pi', '\\rho', '\\sigma', '\\tau', '\\upsilon', '\\phi',
  '\\chi', '\\psi', '\\omega', '\\varepsilon', '\\vartheta', '\\varpi',
  '\\varrho', '\\varsigma', '\\varphi',
]);

const inverseWord = (word) => word.map(
  ({ name, inverse }) => ({ name, inverse: !inverse })
).reverse();

function repeatWord(word, exponent) {
  if (!Number.isInteger(exponent) || Math.abs(exponent) > GROUP_MAX_EXPONENT) return null;
  const unit = exponent < 0 ? inverseWord(word) : word;
  const repeated = [];
  for (let index = 0; index < Math.abs(exponent); index++) repeated.push(...unit);
  return repeated;
}

function groupExponent(cursor) {
  const { tokens } = cursor;
  let sign = 1;
  let digits = '';
  if (tokens[cursor.at] === '{') {
    const end = matchingBrace(tokens, cursor.at);
    if (end < 0) return null;
    let at = cursor.at + 1;
    if (tokens[at] === '-') { sign = -1; at += 1; }
    while (at < end && DIGIT.test(tokens[at])) { digits += tokens[at]; at += 1; }
    if (at !== end) return null;
    cursor.at = end + 1;
  } else {
    // As in TeX itself, an unbraced exponent is exactly one token.
    if (!DIGIT.test(tokens[cursor.at] ?? '')) return null;
    digits = tokens[cursor.at];
    cursor.at += 1;
  }
  return digits ? sign * Number(digits) : null;
}

/** One generator name, deliberately excluding commands such as `\\sin`. */
function groupGenerator(cursor) {
  const { tokens } = cursor;
  const start = cursor.at;
  const token = tokens[cursor.at];
  if (!(LETTER.test(token ?? '') || GROUP_GREEK.has(token)
    || token === '\\text' || token === '\\mathrm' || token === '\\mathbf')) return null;
  cursor.at += 1;

  if (token === '\\text' || token === '\\mathrm' || token === '\\mathbf') {
    if (tokens[cursor.at] !== '{') return null;
    const end = matchingBrace(tokens, cursor.at);
    if (end < 0 || end === cursor.at + 1) return null;
    cursor.at = end + 1;
  }
  if (tokens[cursor.at] === '_') {
    cursor.at += 1;
    if (tokens[cursor.at] === '{') {
      const end = matchingBrace(tokens, cursor.at);
      if (end < 0) return null;
      cursor.at = end + 1;
    } else if (tokens[cursor.at] !== undefined) cursor.at += 1;
    else return null;
  }
  return join(tokens.slice(start, cursor.at));
}

function groupFactor(cursor, depth) {
  if (depth > 32) return null;
  const { tokens } = cursor;
  let word;
  if (tokens[cursor.at] === '(') {
    cursor.at += 1;
    word = groupTerm(cursor, depth + 1, ')');
    if (!word || tokens[cursor.at] !== ')') return null;
    cursor.at += 1;
  } else if (tokens[cursor.at] === '1') {
    cursor.at += 1;
    word = [];
  } else {
    const name = groupGenerator(cursor);
    if (!name) return null;
    word = [{ name, inverse: false }];
  }

  if (tokens[cursor.at] !== '^') return word;
  cursor.at += 1;
  const exponent = groupExponent(cursor);
  return exponent === null ? null : repeatWord(word, exponent);
}

function groupTerm(cursor, depth = 0, closer = null) {
  const word = [];
  while (cursor.at < cursor.tokens.length && cursor.tokens[cursor.at] !== closer) {
    if (TIMES.has(cursor.tokens[cursor.at])) { cursor.at += 1; continue; }
    const before = cursor.at;
    const factor = groupFactor(cursor, depth);
    if (!factor || cursor.at === before) return null;
    word.push(...factor);
  }
  return word;
}

function groupWord(tokens, allowDisplayedIdentity = false) {
  if (allowDisplayedIdentity && tokens.length === 1 && tokens[0] === 'e') return [];
  const cursor = { at: 0, tokens };
  const word = groupTerm(cursor);
  return word && cursor.at === tokens.length ? word : null;
}

function reduceGroupWord(word) {
  const reduced = [];
  for (const letter of word) {
    const previous = reduced[reduced.length - 1];
    if (previous && previous.name === letter.name && previous.inverse !== letter.inverse) {
      reduced.pop();
    } else reduced.push(letter);
  }
  return reduced;
}

function abelianGroupWord(word) {
  const exponents = new Map();
  for (const { name, inverse } of word) {
    exponents.set(name, (exponents.get(name) ?? 0) + (inverse ? -1 : 1));
  }
  return [...exponents]
    .filter(([, exponent]) => exponent !== 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

const sameGroupWord = (left, right) => left.length === right.length
  && left.every((letter, index) => (
    letter.name === right[index].name && letter.inverse === right[index].inverse
  ));

/** Re-run free or free-abelian reduction and verify the displayed normal form. */
function checkGroupReduction(conclusion, premises, step) {
  if (conclusion.type !== 'implies' || conclusion.left.type !== 'atom'
    || conclusion.right.type !== 'rel' || conclusion.right.operator !== '=') return UNKNOWN;
  const assumption = join(conclusion.left.tokens);
  const abelian = assumption === '\\mathsf { A b l }';
  if (!abelian && assumption !== '\\mathsf { G r p }') return UNKNOWN;
  if (step.data?.abelian !== abelian || typeof step.data?.normalFormLatex !== 'string') {
    return UNKNOWN;
  }

  const left = groupWord(conclusion.right.left);
  const right = groupWord(conclusion.right.right);
  const displayed = groupWord(normalize(tokenize(step.data.normalFormLatex)), true);
  if (!left || !right || !displayed) return UNKNOWN;

  if (abelian) {
    const normal = abelianGroupWord(left);
    return JSON.stringify(normal) === JSON.stringify(abelianGroupWord(right))
      && JSON.stringify(normal) === JSON.stringify(abelianGroupWord(displayed))
      ? CHECKED : UNKNOWN;
  }
  const normal = reduceGroupWord(left);
  return sameGroupWord(normal, reduceGroupWord(right))
    && sameGroupWord(normal, reduceGroupWord(displayed)) ? CHECKED : UNKNOWN;
}

/**
 * Existential introduction: name a witness, prove the body of the claim at it,
 * and show it lies in the domain.
 *
 * This is the rule that turns a reader's own `w := 2` into a proof, and it is
 * the only rule here with no prover behind it yet — the checker comes first so
 * that the prover has a contract to emit against. `data.witnessLatex` is that
 * contract.
 */
function checkExists(conclusion, premises, step) {
  if (conclusion.type !== '\\exists') return REFUSED;
  const witness = step.data?.witnessLatex;
  if (typeof witness !== 'string' || !witness) return UNKNOWN;
  const terms = normalize(tokenize(witness));
  if (!terms.length) return UNKNOWN;

  const candidates = [terms, wrap(terms)].map(
    (term) => key(substitute(conclusion.body, conclusion.variable, term))
  );
  const proved = premises.some((premise) => candidates.includes(key(premise)));
  if (!proved) return UNKNOWN;
  if (!conclusion.domain) return CHECKED;
  const member = relation('\\in', terms, conclusion.domain);
  return premises.some((premise) => key(premise) === key(member)) ? CHECKED : UNKNOWN;
}

/** Replace a free variable by a term throughout a proposition's atoms. */
function substitute(formula, variable, term) {
  const inTokens = (tokens) => tokens.flatMap((token) => (token === variable ? term : [token]));
  switch (formula.type) {
    case 'atom': return { type: 'atom', tokens: inTokens(formula.tokens) };
    case 'rel': return relation(formula.operator, inTokens(formula.left), inTokens(formula.right));
    case 'not': return { type: 'not', op: substitute(formula.op, variable, term) };
    case 'implies': return {
      type: 'implies',
      left: substitute(formula.left, variable, term),
      right: substitute(formula.right, variable, term),
    };
    case 'and':
    case 'or':
    case 'iff':
      return { ...formula, ops: formula.ops.map((op) => substitute(op, variable, term)) };
    case '\\forall':
    case '\\exists':
      // The inner binder shadows the name, so nothing below it is free.
      return formula.variable === variable
        ? formula
        : { ...formula, body: substitute(formula.body, variable, term) };
    default: return formula;
  }
}

/**
 * Every rule the kernel can check, and how.
 *
 * A checker returns true when it re-derived the step, false when the step is
 * not an instance of the rule it names, and null when it cannot tell. The
 * rules absent from this table are the work list: the seven rewrites are
 * phase two and the certificates phase three.
 *
 * `engine.exact-evaluation` was long described here as having no witness by
 * construction, and so as an oracle forever. That is true of the statement it
 * takes to reach the CAS at its hardest and false of most of what actually
 * arrives under the label, which is arithmetic. It is checked at that end and
 * abstains at the other.
 *
 * `logic.assumption` is absent for a different reason. An assumption is not
 * checked where it is made but where it is discharged, and nothing emits one
 * today; a checker returning true would be asserting that supposing something
 * proves it.
 */
const CHECKERS = new Map(Object.entries({
  'logic.and-intro': checkConjunction,
  'logic.chain': checkConjunction,
  'logic.or-intro': checkDisjunction,
  'logic.and-elim': checkAndElim,
  'logic.cases': checkCases,
  'logic.implies-intro': checkImpliesIntro,
  'logic.implies-elim': checkImpliesElim,
  'logic.iff-intro': checkIffIntro,
  'logic.vacuous': checkVacuous,
  'logic.universal-generalization': checkUniversal,
  'logic.exists-intro': checkExists,
  'logic.tautology': checkTautology,
  'relation.normalize': checkNormalize,
  // A certificate, and so phase three's business — but the only one of them
  // whose witness is nothing at all: expanding the difference to zero *is* the
  // check, and phase two built the expander.
  'polynomial.identity': checkNormalize,
  'polynomial.even-power': checkEvenPower,
  'quadratic.psd': checkQuadraticPsd,
  'group.free-reduction': checkGroupReduction,
  'order.positive-scale': scalingRewrite(isPositive),
  'relation.nonzero-scale': scalingRewrite(isNonzero),
  'order.affine-monotonicity': scalingRewrite(isNonzero),
  'order.power-monotonicity': checkPower,
  'polynomial.multiple': checkMultiple,
  'arithmetic.integer-root': checkIntegerRoot,
  'arithmetic.primality': checkPrimality,
  // The oracle, checked at the end where it is ordinary arithmetic. The rule
  // still names Compute Engine as what proved the row, because it is; the
  // trust says whether the kernel was able to do the sum again itself.
  'engine.exact-evaluation': checkGroundArithmetic,
}));

/** Checked witnesses are one level below fully re-derived inference steps. */
const CERTIFICATE_CHECKERS = new Set([
  'logic.tautology',
  'group.free-reduction',
  'polynomial.even-power',
  'quadratic.psd',
  // Unlike `arithmetic.integer-root`, which redoes the whole search, this one
  // checks a witness it did not find. That is the distinction the two levels
  // exist to record, so it belongs on this side of it.
  'arithmetic.primality',
]);

/** Every rule the kernel checks today, for tests and for the theorem list. */
export const CHECKED_RULES = Object.freeze([...CHECKERS.keys()]);

/* ------------------------------ checking a trace ------------------------------ */

/**
 * Check one step against its premises.
 *
 * A summarized step is not checkable at all: `summarize` keeps the rule and
 * drops the derivation, so its premises are gone and no checker could see
 * them. Saying so is more useful than a checker failing for the wrong reason.
 */
function checkStep(step, byId, context) {
  const checker = CHECKERS.get(step.rule);
  if (!checker) return { trust: baseTrust(step.rule), note: null };
  if (isSummarized(step)) return { trust: baseTrust(step.rule), note: 'derivation not shown' };

  const conclusion = parseProposition(step.conclusionLatex);
  if (!conclusion) return { trust: baseTrust(step.rule), note: 'conclusion not read' };

  const premises = [];
  for (const id of step.premises ?? []) {
    const parsed = parseProposition(byId.get(id)?.conclusionLatex ?? '');
    if (parsed) premises.push(parsed);
  }

  let verdict;
  try {
    verdict = checker(conclusion, premises, step, context);
  } catch {
    verdict = UNKNOWN;
  }
  if (verdict === CHECKED) {
    return {
      trust: CERTIFICATE_CHECKERS.has(step.rule) ? 'certified' : 'verified',
      note: null,
    };
  }
  // A step whose statement still wears a defined name may not look like the
  // rule that proved it: `\text{both}(x)` is a conjunction only once unfolded,
  // and unfolding is a phase-two checker. Where the trace unfolded something,
  // a shape the kernel does not recognise is its own ignorance, not a fault in
  // the proof, and it abstains instead of refusing.
  if (verdict === REFUSED && !context.dependsOnRule(step.id, 'definition.unfold')) {
    return { trust: 'rejected', note: `not an instance of ${step.rule}` };
  }
  return { trust: baseTrust(step.rule), note: 'premises not matched' };
}

/**
 * The trust level of every step, and of the trace as a whole.
 *
 * @returns {{trust: string, steps: Map<string, {trust: string, note: string|null}>,
 *   admitted: string[], rejected: string[]}}
 */
export function checkTrace(trace) {
  const steps = new Map();
  if (!trace || !Array.isArray(trace.steps) || !trace.steps.length) {
    return { trust: 'rejected', steps, admitted: [], rejected: [] };
  }
  const byId = new Map(trace.steps.map((step) => [step.id, step]));

  const context = {
    /** Whether `id` rests, anywhere below it, on a step citing `ruleId`. */
    dependsOnRule(id, ruleId) {
      const seen = new Set();
      const walk = (current) => {
        if (seen.has(current)) return false;
        seen.add(current);
        const step = byId.get(current);
        if (!step) return false;
        if (step.rule === ruleId) return true;
        return (step.premises ?? []).some(walk);
      };
      return (byId.get(id)?.premises ?? []).some(walk);
    },
  };

  let trust = 'verified';
  const admitted = [];
  const rejected = [];
  for (const step of trace.steps) {
    const result = checkStep(step, byId, context);
    steps.set(step.id, result);
    trust = weakestTrust(trust, result.trust);
    if (result.trust === 'rejected') rejected.push(step.id);
    else if (result.trust === 'axiom' || result.trust === 'oracle') admitted.push(step.rule);
  }
  return { trust, steps, admitted: [...new Set(admitted)], rejected };
}

/**
 * The trace with a trust level on every step and on the whole.
 *
 * Applied at the engine boundary, where the trace is finished and its
 * identifiers are already the reader's. Returns the trace unchanged in shape,
 * so nothing downstream needs to know the kernel ran.
 */
export function certify(trace) {
  if (!trace) return trace;
  const checked = checkTrace(trace);
  return {
    ...trace,
    trust: checked.trust,
    admitted: checked.admitted,
    steps: trace.steps.map((step) => {
      const result = checked.steps.get(step.id);
      return result?.note
        ? { ...step, trust: result.trust, trustNote: result.note }
        : { ...step, trust: result?.trust ?? baseTrust(step.rule) };
    }),
  };
}

/**
 * What the row says about a finished proof.
 *
 * The weakest step is the whole story, so it is what gets said. A count of
 * admitted theorems is more informative than their names at this width, and
 * the panel below names every one of them.
 */
export function trustSummary(trace) {
  const trust = trace?.trust ?? 'axiom';
  if (trust === 'rejected') return 'a step the kernel refused';
  if (trust === 'verified') return 'verified';
  if (trust === 'certified') return 'witnessed';

  const admitted = trace?.admitted ?? [];
  // Defensive fallback for a hand-built or older trace with no inventory.
  if (!admitted.length) return 'checked';
  const oracles = admitted.filter((id) => baseTrust(id) === 'oracle').length;
  const theorems = admitted.length - oracles;
  const counted = theorems === 1 ? '1 theorem' : `${theorems} theorems`;
  if (!theorems) return "the CAS's word";
  if (!oracles) return `resting on ${counted}`;
  return `resting on ${counted} and the CAS`;
}

/** How a step's own trust reads in the proof panel. */
export function stepTrustLabel(step) {
  switch (step?.trust) {
    case 'verified': return 'checked';
    case 'certified': return 'witnessed';
    case 'oracle': return 'unchecked';
    case 'rejected': return 'refused';
    // Everything else is an axiom: named, believed, and there to be refused.
    default: return 'admitted';
  }
}
