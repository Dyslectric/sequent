/**
 * Exact sign charts for univariate polynomials with rational coefficients.
 *
 * The more general polynomial prover uses inexpensive shape certificates. This
 * module is the complete fallback for the tractable rational case: isolate all
 * distinct real roots with Sturm sequences, then test every open interval and
 * every root. All arithmetic used to grant a proof is BigInt rational
 * arithmetic; decimal input is interpreted as its exact decimal value.
 */

const ZERO = Object.freeze({ n: 0n, d: 1n });
const ONE = Object.freeze({ n: 1n, d: 1n });

function absInt(n) { return n < 0n ? -n : n; }

function gcdInt(a, b) {
  a = absInt(a); b = absInt(b);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function rat(n, d = 1n) {
  if (d === 0n) throw new Error('zero rational denominator');
  if (n === 0n) return ZERO;
  if (d < 0n) { n = -n; d = -d; }
  const g = gcdInt(n, d);
  return { n: n / g, d: d / g };
}

function add(a, b) { return rat(a.n * b.d + b.n * a.d, a.d * b.d); }
function sub(a, b) { return rat(a.n * b.d - b.n * a.d, a.d * b.d); }
function mul(a, b) { return rat(a.n * b.n, a.d * b.d); }
function div(a, b) { return rat(a.n * b.d, a.d * b.n); }
function neg(a) { return a.n === 0n ? ZERO : { n: -a.n, d: a.d }; }
function compare(a, b) { return (a.n * b.d > b.n * a.d) ? 1 : (a.n * b.d < b.n * a.d ? -1 : 0); }
function sign(a) { return a.n > 0n ? 1 : a.n < 0n ? -1 : 0; }

/**
 * The exact rational arithmetic this module runs on, for other provers that
 * also refuse to grant a proof on floating point. Shared rather than copied so
 * there is one definition of what "exact" means here.
 */
export const Rational = Object.freeze({
  ZERO, ONE, rat, add, sub, mul, div, neg, compare, sign,
});

function rationalFromString(value) {
  const match = String(value).trim().match(/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (!match) return null;
  const [, prefix, whole, fraction = '', exponentText = '0'] = match;
  let numerator = BigInt(whole + fraction);
  if (prefix === '-') numerator = -numerator;
  const exponent = Number(exponentText) - fraction.length;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 256) return null;
  return exponent >= 0
    ? rat(numerator * (10n ** BigInt(exponent)))
    : rat(numerator, 10n ** BigInt(-exponent));
}

/** Convert a boxed exact rational (including an exact decimal) to a Rat. */
export function boxedRational(expr) {
  const json = expr?.json ?? expr;
  if (typeof json === 'number') return Number.isFinite(json) ? rationalFromString(json) : null;
  if (json && typeof json === 'object' && !Array.isArray(json) && typeof json.num === 'string') {
    return rationalFromString(json.num);
  }
  if (!Array.isArray(json)) return null;
  const [head, ...args] = json;
  if (head === 'Rational' && args.length === 2) {
    const a = boxedRational(args[0]);
    const b = boxedRational(args[1]);
    return a && b && b.n !== 0n ? div(a, b) : null;
  }
  if (head === 'Negate' && args.length === 1) {
    const a = boxedRational(args[0]);
    return a ? neg(a) : null;
  }
  if ((head === 'Divide' || head === 'Multiply' || head === 'Add' || head === 'Subtract') && args.length > 0) {
    const values = args.map(boxedRational);
    if (values.some((x) => x === null)) return null;
    if (head === 'Divide' && values.length === 2 && values[1].n !== 0n) return div(values[0], values[1]);
    if (head === 'Multiply') return values.reduce(mul, ONE);
    if (head === 'Add') return values.reduce(add, ZERO);
    if (head === 'Subtract' && values.length === 2) return sub(values[0], values[1]);
  }
  return null;
}

/** Boxed coefficients arrive highest-power first; internal polynomials ascend. */
export function exactPolynomial(coefficients) {
  const result = coefficients.map(boxedRational);
  if (result.some((x) => x === null)) return null;
  // Keep interactive proof attempts bounded when a line contains enormous
  // exact literals. Falling back is always safe; it merely withholds a proof.
  if (result.some((x) => absInt(x.n).toString().length > 256 || x.d.toString().length > 256)) return null;
  return trim(result.reverse());
}

function trim(poly) {
  let end = poly.length;
  while (end > 1 && poly[end - 1].n === 0n) end--;
  return end === poly.length ? poly : poly.slice(0, end);
}

function isZeroPoly(poly) { return poly.length === 1 && poly[0].n === 0n; }

function derivative(poly) {
  if (poly.length <= 1) return [ZERO];
  return poly.slice(1).map((coefficient, power) => mul(coefficient, rat(BigInt(power + 1))));
}

function multiplyPolynomial(a, b) {
  const result = Array(a.length + b.length - 1).fill(ZERO);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) result[i + j] = add(result[i + j], mul(a[i], b[j]));
  }
  return trim(result);
}

function evaluate(poly, x) {
  let result = ZERO;
  for (let i = poly.length - 1; i >= 0; i--) result = add(mul(result, x), poly[i]);
  return result;
}

function dividePolynomial(dividend, divisor) {
  if (isZeroPoly(divisor)) throw new Error('polynomial division by zero');
  const remainder = dividend.slice();
  const quotient = Array(Math.max(1, dividend.length - divisor.length + 1)).fill(ZERO);
  while (!isZeroPoly(trim(remainder)) && remainder.length >= divisor.length) {
    const degree = remainder.length - divisor.length;
    const coefficient = div(remainder[remainder.length - 1], divisor[divisor.length - 1]);
    quotient[degree] = coefficient;
    for (let i = 0; i < divisor.length; i++) {
      remainder[degree + i] = sub(remainder[degree + i], mul(coefficient, divisor[i]));
    }
    while (remainder.length > 1 && remainder[remainder.length - 1].n === 0n) remainder.pop();
  }
  return { quotient: trim(quotient), remainder: trim(remainder) };
}

function monic(poly) {
  poly = trim(poly);
  if (isZeroPoly(poly)) return poly;
  const leading = poly[poly.length - 1];
  return poly.map((x) => div(x, leading));
}

function polynomialGcd(a, b) {
  a = trim(a); b = trim(b);
  while (!isZeroPoly(b)) {
    const remainder = dividePolynomial(a, b).remainder;
    a = b; b = remainder;
  }
  return monic(a);
}

function squareFree(poly) {
  poly = trim(poly);
  if (poly.length <= 1) return poly;
  return dividePolynomial(poly, polynomialGcd(poly, derivative(poly))).quotient;
}

function sturmSequence(poly) {
  const sequence = [monic(squareFree(poly))];
  if (sequence[0].length <= 1) return sequence;
  sequence.push(derivative(sequence[0]));
  while (!isZeroPoly(sequence[sequence.length - 1])) {
    const remainder = dividePolynomial(sequence[sequence.length - 2], sequence[sequence.length - 1]).remainder;
    if (isZeroPoly(remainder)) break;
    sequence.push(remainder.map(neg));
  }
  return sequence;
}

function variationsAt(sequence, x) {
  let changes = 0;
  let previous = 0;
  for (const poly of sequence) {
    const current = sign(evaluate(poly, x));
    if (current === 0) continue;
    if (previous !== 0 && current !== previous) changes++;
    previous = current;
  }
  return changes;
}

function variationsAtInfinity(sequence, direction) {
  let changes = 0;
  let previous = 0;
  for (const poly of sequence) {
    const degree = poly.length - 1;
    let current = sign(poly[degree]);
    if (direction < 0 && degree % 2 === 1) current = -current;
    if (previous !== 0 && current !== previous) changes++;
    previous = current;
  }
  return changes;
}

function ceilPositive(a) { return (a.n + a.d - 1n) / a.d; }

function rootBound(poly) {
  const leading = poly[poly.length - 1];
  let maximum = ZERO;
  for (let i = 0; i < poly.length - 1; i++) {
    const ratio = rat(absInt(poly[i].n) * leading.d, poly[i].d * absInt(leading.n));
    if (compare(ratio, maximum) > 0) maximum = ratio;
  }
  return rat(ceilPositive(maximum) + 1n);
}

function rootCount(sequence, lo, hi) {
  return variationsAt(sequence, lo) - variationsAt(sequence, hi);
}

/** Pick an interior rational which is not itself a root. */
function safeSplit(poly, lo, hi) {
  for (let denominator = 2n; denominator < 70n; denominator++) {
    const numerator = denominator / 2n;
    if (numerator === 0n || numerator === denominator) continue;
    const point = div(add(mul(lo, rat(denominator - numerator)), mul(hi, rat(numerator))), rat(denominator));
    if (evaluate(poly, point).n !== 0n) return point;
  }
  return null;
}

function isolateRoots(poly) {
  poly = squareFree(poly);
  if (poly.length <= 1) return [];
  const sequence = sturmSequence(poly);
  const bound = rootBound(poly);
  const lo = neg(bound);
  const total = variationsAtInfinity(sequence, -1) - variationsAtInfinity(sequence, 1);
  const roots = [];
  let nodes = 0;
  const visit = (left, right, count, depth) => {
    if (++nodes > 8192) return false;
    if (count === 0) return true;
    if (count === 1) { roots.push({ lo: left, hi: right, poly, sequence }); return true; }
    if (depth > 256) return false;
    const middle = safeSplit(poly, left, right);
    if (!middle) return false;
    const leftCount = rootCount(sequence, left, middle);
    return visit(left, middle, leftCount, depth + 1)
      && visit(middle, right, count - leftCount, depth + 1);
  };
  return visit(lo, bound, total, 0) ? roots : null;
}

function refineRoot(root) {
  const middle = safeSplit(root.poly, root.lo, root.hi);
  if (!middle) return false;
  if (rootCount(root.sequence, root.lo, middle) === 1) root.hi = middle;
  else root.lo = middle;
  return true;
}

function overlaps(a, b) { return compare(a.hi, b.lo) >= 0 && compare(b.hi, a.lo) >= 0; }

/** Make isolating intervals from coprime factors disjoint, which orders roots exactly. */
function separateRoots(roots) {
  for (let pass = 0; pass < 4096; pass++) {
    let overlap = null;
    for (let i = 0; i < roots.length && !overlap; i++) {
      for (let j = i + 1; j < roots.length; j++) {
        if (overlaps(roots[i], roots[j])) { overlap = [roots[i], roots[j]]; break; }
      }
    }
    if (!overlap) return roots.sort((a, b) => compare(a.lo, b.lo));
    if (!refineRoot(overlap[0]) || !refineRoot(overlap[1])) return null;
  }
  return null;
}

/**
 * The rational with the smallest denominator in `[lo, hi]`, by descending the
 * Stern-Brocot tree: take the integer part when the interval spans one, and
 * otherwise recurse into the reciprocals of the fractional parts.
 */
function simplestRationalIn(lo, hi, depth = 0) {
  if (compare(lo, hi) > 0 || depth > 96) return null;
  if (sign(lo) <= 0 && sign(hi) >= 0) return ZERO;
  if (sign(hi) < 0) {
    const mirrored = simplestRationalIn(neg(hi), neg(lo), depth + 1);
    return mirrored ? neg(mirrored) : null;
  }
  // Both endpoints are positive here, so truncating division is the floor.
  const whole = lo.n / lo.d;
  if (compare(rat(whole), lo) === 0) return rat(whole);
  if (compare(rat(whole + 1n), hi) <= 0) return rat(whole + 1n);
  const inner = simplestRationalIn(
    div(ONE, sub(hi, rat(whole))),
    div(ONE, sub(lo, rat(whole))),
    depth + 1,
  );
  return inner ? add(rat(whole), div(ONE, inner)) : null;
}

/**
 * The exact value of an isolated root, when it is rational; null otherwise.
 *
 * Narrowing the isolating interval and testing the simplest rational inside it
 * converges on a rational root in a number of steps proportional to the size of
 * its denominator. An irrational root is never hit, so the search gives up —
 * which is the honest answer, since no rational witness exists.
 */
function exactRationalRoot(root) {
  const search = { ...root };
  for (let step = 0; step < 64; step++) {
    const candidate = simplestRationalIn(search.lo, search.hi);
    if (candidate && evaluate(search.poly, candidate).n === 0n) return candidate;
    if (!refineRoot(search)) return null;
  }
  return null;
}

/** LaTeX for an exact rational, used to display a counterexample. */
export function rationalLatex(value) {
  if (value.d === 1n) return String(value.n);
  return `${value.n < 0n ? '-' : ''}\\frac{${absInt(value.n)}}{${value.d}}`;
}

function relationHolds(kind, valueSign) {
  switch (kind) {
    case 'eq': return valueSign === 0;
    case 'ne': return valueSign !== 0;
    case 'gt': return valueSign > 0;
    case 'ge': return valueSign >= 0;
    default: return false;
  }
}

function implicationHolds(leftKind, leftSign, rightKind, rightSign) {
  return !relationHolds(leftKind, leftSign) || relationHolds(rightKind, rightSign);
}

/**
 * Decide a universal implication between rational univariate polynomials.
 * Returns true/false for this complete subproblem, or null when coefficients
 * are not exact rationals or root isolation exceeds its conservative limit.
 */
export function decideRationalPolynomialImplication(leftCoefficients, leftKind, rightCoefficients, rightKind) {
  const left = exactPolynomial(leftCoefficients);
  const right = exactPolynomial(rightCoefficients);
  if (!left || !right) return null;

  let factors;
  if (isZeroPoly(left) && isZeroPoly(right)) factors = [];
  else if (isZeroPoly(left)) factors = [{ poly: squareFree(right), tag: 'right' }];
  else if (isZeroPoly(right)) factors = [{ poly: squareFree(left), tag: 'left' }];
  else {
    const squareLeft = squareFree(left);
    const squareRight = squareFree(right);
    const common = polynomialGcd(squareLeft, squareRight);
    factors = [
      { poly: common, tag: 'common' },
      { poly: dividePolynomial(squareLeft, common).quotient, tag: 'left' },
      { poly: dividePolynomial(squareRight, common).quotient, tag: 'right' },
    ];
  }

  const roots = [];
  for (const factor of factors) {
    if (factor.poly.length <= 1) continue;
    const isolated = isolateRoots(factor.poly);
    if (!isolated) return null;
    for (const root of isolated) roots.push({ ...root, tag: factor.tag });
  }
  const ordered = separateRoots(roots);
  if (!ordered) return null;

  // Each open cell has constant signs for both polynomials.
  const samples = [];
  if (ordered.length === 0) samples.push(ZERO);
  else {
    samples.push(sub(ordered[0].lo, ONE));
    for (let i = 1; i < ordered.length; i++) samples.push(div(add(ordered[i - 1].hi, ordered[i].lo), rat(2n)));
    samples.push(add(ordered[ordered.length - 1].hi, ONE));
  }
  for (const sample of samples) {
    if (!implicationHolds(leftKind, sign(evaluate(left, sample)), rightKind, sign(evaluate(right, sample)))) return false;
  }

  // At a root, equality/strictness may differ from either adjacent cell.
  for (const root of ordered) {
    const sample = div(add(root.lo, root.hi), rat(2n));
    const leftSign = root.tag === 'left' || root.tag === 'common' ? 0 : sign(evaluate(left, sample));
    const rightSign = root.tag === 'right' || root.tag === 'common' ? 0 : sign(evaluate(right, sample));
    if (!implicationHolds(leftKind, leftSign, rightKind, rightSign)) return false;
  }
  return true;
}

/** Decide whether one rational polynomial relation holds on all real numbers. */
export function decideRationalPolynomialRelation(coefficients, kind) {
  // The zero polynomial equals zero everywhere, so use it as an always-true
  // antecedent and let the same sign-chart implementation do the work.
  return decideRationalPolynomialImplication([0], 'eq', coefficients, kind);
}

function prepareFormula(formula, atoms) {
  if (formula.op === 'atom') {
    const poly = exactPolynomial(formula.coefficients);
    if (!poly) return null;
    const square = isZeroPoly(poly) ? [ZERO] : squareFree(poly);
    const atom = {
      op: 'atom',
      kind: formula.kind,
      poly,
      square,
      sequence: square.length > 1 ? sturmSequence(square) : null,
    };
    atoms.push(atom);
    return atom;
  }
  const operands = [];
  for (const operand of formula.operands ?? []) {
    const prepared = prepareFormula(operand, atoms);
    if (!prepared) return null;
    operands.push(prepared);
  }
  return { op: formula.op, operands };
}

function evaluateFormula(formula, atomSign) {
  if (formula.op === 'atom') return relationHolds(formula.kind, atomSign(formula));
  const values = formula.operands.map((operand) => evaluateFormula(operand, atomSign));
  switch (formula.op) {
    case 'and': return values.every(Boolean);
    case 'or': return values.some(Boolean);
    case 'not': return values.length === 1 ? !values[0] : false;
    case 'implies': return values.length === 2 ? (!values[0] || values[1]) : false;
    case 'equivalent': return values.length === 2 ? values[0] === values[1] : false;
    default: return false;
  }
}

function polynomialWithinBudget(poly) {
  return poly.length <= 65 && poly.every(
    (coefficient) => absInt(coefficient.n).toString().length <= 512 && coefficient.d.toString().length <= 512
  );
}

/**
 * Decide whether a Boolean formula over rational univariate polynomial
 * relations holds for every real value. Formula nodes are `and`, `or`, `not`,
 * `implies`, `equivalent`, and `{op:'atom', kind, coefficients}`.
 *
 * Returns `{value, witness}` — `witness` being the exact point where a false
 * formula fails, when that point is rational — or null when the coefficients
 * are not exact rationals or root isolation exceeds its conservative limit.
 */
export function decideRationalPolynomialFormula(formula) {
  const atoms = [];
  const prepared = prepareFormula(formula, atoms);
  if (!prepared || atoms.length === 0) return null;

  let rootPolynomial = [ONE];
  for (const atom of atoms) {
    if (atom.square.length <= 1) continue;
    rootPolynomial = multiplyPolynomial(rootPolynomial, atom.square);
    if (!polynomialWithinBudget(rootPolynomial)) return null;
  }
  rootPolynomial = squareFree(rootPolynomial);
  const roots = isolateRoots(rootPolynomial);
  if (!roots) return null;

  const samples = [];
  if (roots.length === 0) samples.push(ZERO);
  else {
    samples.push(sub(roots[0].lo, ONE));
    for (let i = 1; i < roots.length; i++) samples.push(div(add(roots[i - 1].hi, roots[i].lo), rat(2n)));
    samples.push(add(roots[roots.length - 1].hi, ONE));
  }
  // An open cell is a genuine witness in its own right: the formula has the
  // same truth value across the whole cell, so the sample point is one of them.
  for (const sample of samples) {
    if (!evaluateFormula(prepared, (atom) => sign(evaluate(atom.poly, sample)))) {
      return { value: false, witness: sample };
    }
  }

  for (const root of roots) {
    const sample = div(add(root.lo, root.hi), rat(2n));
    const signAtRoot = (atom) => {
      if (isZeroPoly(atom.poly)) return 0;
      return atom.sequence && rootCount(atom.sequence, root.lo, root.hi) > 0
        ? 0
        : sign(evaluate(atom.poly, sample));
    };
    // Here the formula fails at the root itself and nowhere else in the cell,
    // so the interior sample is not a witness — the root's exact value is.
    if (!evaluateFormula(prepared, signAtRoot)) {
      return { value: false, witness: exactRationalRoot(root) };
    }
  }
  return { value: true, witness: null };
}
