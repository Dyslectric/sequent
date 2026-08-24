/**
 * Exact rational polynomial arithmetic, for the kernel and nothing else.
 *
 * The kernel checks a rewrite by recomputing its normal form and comparing,
 * rather than by following a derivation of it. What that trusts is not the
 * prover but this file: a few hundred lines of BigInt rational arithmetic,
 * small enough to audit, tested on its own, and — deliberately — shared with
 * nothing. `rational-polynomial.js` does the same job for the prover and is
 * much larger; using it here would mean the checker and the thing it checks
 * agreeing because they are the same code, which is not agreement at all.
 *
 * That is the ordinary trusted-computing-base trade, and `docs/proof-kernel.md`
 * argues it at length: the alternative is emitting associativity and
 * distributivity steps per use, which turns a four-variable identity into
 * thousands of nodes and destroys the one thing the proof panel exists to
 * provide.
 *
 * Nothing here knows about LaTeX. A variable is an opaque string, so the
 * caller may use whole unparsed subterms — `\cos(t)`, `\overline{z}` — as
 * indeterminates. That is always sound: an identity between polynomials in
 * those indeterminates holds under every interpretation of them, and failing
 * to find one only costs the kernel a step it could have checked.
 */

/* ------------------------------- rationals ------------------------------- */

const gcd = (a, b) => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x;
};

/** A rational in lowest terms with a positive denominator. */
export function rational(numerator, denominator = 1n) {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  if (d === 0n) throw new Error('rational with zero denominator');
  const sign = d < 0n ? -1n : 1n;
  const divisor = gcd(n, d) || 1n;
  return { n: (sign * n) / divisor, d: (sign * d) / divisor };
}

export const ZERO = Object.freeze(rational(0n));
export const ONE = Object.freeze(rational(1n));

export const addRational = (a, b) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
export const mulRational = (a, b) => rational(a.n * b.n, a.d * b.d);
export const negRational = (a) => rational(-a.n, a.d);
export const divRational = (a, b) => (b.n === 0n ? null : rational(a.n * b.d, a.d * b.n));
export const isZeroRational = (a) => a.n === 0n;
export const signOfRational = (a) => (a.n > 0n ? 1 : a.n < 0n ? -1 : 0);
export const sameRational = (a, b) => a.n === b.n && a.d === b.d;
export const showRational = (a) => (a.d === 1n ? `${a.n}` : `${a.n}/${a.d}`);

/* ------------------------------- monomials ------------------------------- */

/**
 * A monomial is a map from variable to positive exponent; the empty map is 1.
 * Its key is the sorted product, which makes it usable as a Map key and gives
 * the ordering below something stable to sort on.
 */
const monomialKey = (monomial) => [...monomial.entries()]
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([variable, exponent]) => `${variable}^${exponent}`)
  .join('*') || '1';

const degreeOf = (monomial) => [...monomial.values()].reduce((sum, e) => sum + e, 0);

const multiplyMonomials = (a, b) => {
  const product = new Map(a);
  for (const [variable, exponent] of b) {
    product.set(variable, (product.get(variable) ?? 0) + exponent);
  }
  return product;
};

/** `a / b` when b divides a, else null. */
const divideMonomials = (a, b) => {
  const quotient = new Map(a);
  for (const [variable, exponent] of b) {
    const have = quotient.get(variable) ?? 0;
    if (have < exponent) return null;
    if (have === exponent) quotient.delete(variable);
    else quotient.set(variable, have - exponent);
  }
  return quotient;
};

/**
 * Degree first, then the key, both descending.
 *
 * Any total order on monomials makes the division algorithm terminate and the
 * canonical form unique; this one is graded lexicographic, which keeps the
 * leading term of a polynomial the one a reader would call leading.
 */
const compareMonomials = (a, b) => {
  const byDegree = degreeOf(b.monomial) - degreeOf(a.monomial);
  if (byDegree) return byDegree;
  return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
};

/* ------------------------------ polynomials ------------------------------ */

/**
 * A polynomial is a map from monomial key to `{monomial, coefficient}`, with
 * zero coefficients dropped so that equality is map equality.
 */
export const zeroPolynomial = () => new Map();

export function constantPolynomial(value) {
  if (isZeroRational(value)) return new Map();
  const monomial = new Map();
  return new Map([[monomialKey(monomial), { monomial, coefficient: value }]]);
}

export function variablePolynomial(name, exponent = 1) {
  if (exponent === 0) return constantPolynomial(ONE);
  const monomial = new Map([[name, exponent]]);
  return new Map([[monomialKey(monomial), { monomial, coefficient: ONE }]]);
}

const put = (into, monomial, coefficient) => {
  const key = monomialKey(monomial);
  const existing = into.get(key);
  const total = existing ? addRational(existing.coefficient, coefficient) : coefficient;
  if (isZeroRational(total)) into.delete(key);
  else into.set(key, { monomial, coefficient: total });
};

export function addPolynomials(a, b) {
  const sum = new Map(a);
  for (const term of b.values()) put(sum, term.monomial, term.coefficient);
  return sum;
}

export const scalePolynomial = (a, factor) => {
  if (isZeroRational(factor)) return zeroPolynomial();
  return new Map([...a].map(([key, term]) => [
    key, { monomial: term.monomial, coefficient: mulRational(term.coefficient, factor) },
  ]));
};

export const negatePolynomial = (a) => scalePolynomial(a, rational(-1n));
export const subtractPolynomials = (a, b) => addPolynomials(a, negatePolynomial(b));

/**
 * A ceiling on how big an intermediate may get.
 *
 * `(x + y + z + w)^{64}` has some eleven million terms, and a reader may type
 * it. Expanding it would hang the page for a check nobody is waiting on, so
 * the kernel gives up instead — which costs a step it might have verified and
 * nothing else. Callers turn the refusal into "cannot tell".
 */
const MAX_TERMS = 1024;

class TooLarge extends Error {}

export function multiplyPolynomials(a, b) {
  if (a.size * b.size > MAX_TERMS * 4) throw new TooLarge('polynomial too large');
  const product = new Map();
  for (const left of a.values()) {
    for (const right of b.values()) {
      put(
        product,
        multiplyMonomials(left.monomial, right.monomial),
        mulRational(left.coefficient, right.coefficient),
      );
    }
  }
  if (product.size > MAX_TERMS) throw new TooLarge('polynomial too large');
  return product;
}

export function powerPolynomial(a, exponent) {
  if (!Number.isInteger(exponent) || exponent < 0) return null;
  let result = constantPolynomial(ONE);
  try {
    for (let i = 0; i < exponent; i += 1) result = multiplyPolynomials(result, a);
  } catch (error) {
    if (error instanceof TooLarge) return null;
    throw error;
  }
  return result;
}

export const isZeroPolynomial = (a) => a.size === 0;

/** The rational value of a polynomial with no variables, or null. */
export function constantOf(a) {
  if (!a.size) return ZERO;
  if (a.size > 1) return null;
  const [term] = a.values();
  return term.monomial.size ? null : term.coefficient;
}

/** The constant term, and everything else, separately. */
export function splitConstant(a) {
  const constant = a.get(monomialKey(new Map()));
  const rest = new Map(a);
  rest.delete(monomialKey(new Map()));
  return { constant: constant ? constant.coefficient : ZERO, rest };
}

const terms = (a) => [...a.entries()]
  .map(([key, term]) => ({ key, ...term }))
  .sort(compareMonomials);

export function leadingTerm(a) {
  return a.size ? terms(a)[0] : null;
}

/** `f / g` when g divides f exactly, else null. */
export function dividePolynomials(f, g) {
  const divisor = leadingTerm(g);
  if (!divisor) return null;
  let remainder = new Map(f);
  let quotient = zeroPolynomial();

  // Standard division by a single divisor: cancel the leading term, repeat.
  // Each step strictly lowers the leading monomial, so this terminates, and a
  // zero remainder is a certificate that the quotient is exact.
  while (remainder.size) {
    const lead = leadingTerm(remainder);
    const monomial = divideMonomials(lead.monomial, divisor.monomial);
    if (!monomial) return null;
    const coefficient = divRational(lead.coefficient, divisor.coefficient);
    if (!coefficient) return null;
    const step = new Map([[monomialKey(monomial), { monomial, coefficient }]]);
    quotient = addPolynomials(quotient, step);
    remainder = subtractPolynomials(remainder, multiplyPolynomials(step, g));
  }
  return quotient;
}

/** The rational `c` with `b = c * a`, or null when no such constant exists. */
export function scalarRatio(a, b) {
  const lead = leadingTerm(a);
  if (!lead) return null;
  const matching = b.get(lead.key);
  if (!matching) return null;
  const ratio = divRational(matching.coefficient, lead.coefficient);
  if (!ratio || isZeroRational(ratio)) return null;
  return isZeroPolynomial(subtractPolynomials(b, scalePolynomial(a, ratio))) ? ratio : null;
}

/**
 * `b = c * a + k` with both `c` and `k` rational, or null.
 *
 * Only the non-constant parts can determine `c`; the constants then determine
 * `k`. A constant `a` is refused rather than treated as an affine map, because
 * every polynomial is an affine image of a constant and the answer would say
 * nothing.
 */
export function affineRatio(a, b) {
  const left = splitConstant(a);
  const right = splitConstant(b);
  if (isZeroPolynomial(left.rest)) return null;
  const c = scalarRatio(left.rest, right.rest);
  if (!c) return null;
  return { c, k: addRational(right.constant, negRational(mulRational(c, left.constant))) };
}

/**
 * A canonical string for a polynomial, unique up to the chosen scaling.
 *
 * `upToPositiveScale` divides through by the magnitude of the leading
 * coefficient, which identifies `2x - 2y` with `x - y` but keeps `y - x`
 * apart; `upToScale` divides by the leading coefficient itself, identifying
 * all three. Which one is right depends on the relation the polynomial sits
 * under, and that is the caller's business.
 */
export function polynomialKey(a, { upToScale = false, upToPositiveScale = false } = {}) {
  let normalized = a;
  const lead = leadingTerm(a);
  if (lead && (upToScale || upToPositiveScale)) {
    const magnitude = upToScale
      ? lead.coefficient
      : rational(lead.coefficient.n < 0n ? -lead.coefficient.n : lead.coefficient.n,
        lead.coefficient.d);
    const inverse = divRational(ONE, magnitude);
    if (inverse) normalized = scalePolynomial(a, inverse);
  }
  if (!normalized.size) return '0';
  return terms(normalized)
    .map((term) => `${showRational(term.coefficient)}·${term.key}`)
    .join(' + ');
}

export const samePolynomial = (a, b) => isZeroPolynomial(subtractPolynomials(a, b));
