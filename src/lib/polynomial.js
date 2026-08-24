/**
 * Sign reasoning for polynomial relations.
 *
 * Everything here answers one question: on some domain, is this polynomial
 * positive / non-negative / zero / negative / non-positive? With that, an
 * implication `A => B` reduces to
 *
 *     domain(A)  ->  required sign of B's polynomial on that domain
 *
 * The certificates are exact, never numeric guesses:
 *
 * - **Half-lines** use a Taylor shift. To show `q > 0` on `(a, inf)`, expand
 *   `q(a + t)`; if every coefficient is non-negative and one is positive, then
 *   `q(a + t) > 0` for all `t > 0`, because every `t^i` is. `x > 2 => x^2 > 3`
 *   is proved this way: `(2 + t)^2 - 3 = t^2 + 4t + 1`.
 * - **Points** (an equation antecedent) are just substitution, which is
 *   complete: `x = 2 => x^2 = 4` because `2^2 - 4 = 0`.
 * - **All of R** uses the even-power test or, for quadratics, the discriminant.
 *
 * Each test only ever certifies; when it cannot, it returns null and the caller
 * falls back to sampling. Nothing here can report a false statement as true.
 */

import {
  decideRationalPolynomialImplication,
  decideRationalPolynomialRelation,
} from './rational-polynomial.js';
import { proveQuadraticFormNonNegative } from './quadratic-form.js';

const MAX_DEGREE = 16;

/** A fresh variable for Taylor shifts. Distinct from the `Id<n>` user names. */
const SHIFT_VAR = 'ShiftT';

/**
 * -1, 0 or 1 for an expression with no unknowns; null when the sign cannot be
 * established. A value too close to zero to distinguish from it returns null
 * rather than a guess.
 */
export function constantSign(ce, expr) {
  try {
    const boxed = ce.box(expr);
    if (boxed.unknowns.length > 0) return null;
    const simplified = boxed.simplify();
    if (simplified.is(0) === true) return 0;
    const numeric = simplified.N();
    if (!numeric.isNumberLiteral) return null;
    if (numeric.im && Math.abs(numeric.im) > 1e-12) return null;
    const re = numeric.re;
    if (!Number.isFinite(re) || Math.abs(re) < 1e-12) return null;
    return re > 0 ? 1 : -1;
  } catch {
    return null;
  }
}

/**
 * Coefficients of `expr` as a polynomial in `variable`, highest power first,
 * or null if it is not a polynomial (`1/x`, `sqrt(x)`, `sin(x)` ...) or if any
 * coefficient still involves an unknown.
 */
export function polynomialCoefficients(ce, expr, variable) {
  // `CoefficientList` needs the polynomial in expanded form, and expansion alone
  // does not always get there — a downward Taylor shift leaves `(-t)^2` intact,
  // for instance — so try progressively harder normalisations.
  const forms = [
    () => expr,
    () => ce.box(['Expand', expr]).evaluate(),
    () => ce.box(['Expand', expr.simplify()]).evaluate(),
  ];

  for (const form of forms) {
    let list;
    try {
      list = ce.box(['CoefficientList', form(), variable]).evaluate();
    } catch {
      continue;
    }
    // A non-polynomial comes back as the unevaluated CoefficientList itself.
    if (!list || list.operator !== 'List') continue;
    const coefficients = list.ops ?? [];
    if (coefficients.length === 0 || coefficients.length > MAX_DEGREE + 1) continue;
    if (coefficients.some((c) => c.unknowns.length > 0)) continue;
    return coefficients;
  }
  return null;
}

/** Does a value known to be in `signClass` satisfy `kind` against zero? */
export function satisfiesSign(kind, signClass) {
  if (signClass === null) return false;
  switch (kind) {
    case 'eq': return signClass === 'zero';
    case 'ne': return signClass === 'positive' || signClass === 'negative';
    case 'gt': return signClass === 'positive';
    case 'ge': return signClass === 'positive' || signClass === 'nonneg' || signClass === 'zero';
    default: return false;
  }
}

/**
 * Sign of `sum(d_i * t^i)` over `t > 0` (or `t >= 0` when `closed`), given all
 * the `d_i`. Uniform coefficient signs are what make this decidable.
 */
function signClassOfShift(ce, coefficients, closed) {
  const signs = coefficients.map((c) => constantSign(ce, c));
  if (signs.some((s) => s === null)) return null;

  const constantTerm = signs[signs.length - 1];
  const anyPositive = signs.some((s) => s > 0);
  const anyNegative = signs.some((s) => s < 0);

  if (!anyPositive && !anyNegative) return 'zero';

  if (!anyNegative) {
    // Every term is >= 0, so the sum is too; it is strictly positive as soon as
    // one term is, which for t > 0 means any coefficient, and at t = 0 means
    // the constant term specifically.
    if (!closed) return 'positive';
    return constantTerm > 0 ? 'positive' : 'nonneg';
  }
  if (!anyPositive) {
    if (!closed) return 'negative';
    return constantTerm < 0 ? 'negative' : 'nonpos';
  }
  return null;
}

/**
 * Sign of `poly` on a half-line at `at`: `(at, inf)` for direction 'up',
 * `(-inf, at)` for 'down', closed at the endpoint when `closed`.
 */
function signClassOnHalfLine(ce, poly, variable, at, direction, closed) {
  try {
    const t = ce.box(SHIFT_VAR);
    const argument = direction === 'up'
      ? ce.box(['Add', at, t])
      : ce.box(['Subtract', at, t]);
    const shifted = ce.box(['Expand', poly.subs({ [variable]: argument })]).evaluate();
    const coefficients = polynomialCoefficients(ce, shifted, SHIFT_VAR);
    if (!coefficients) return null;
    return signClassOfShift(ce, coefficients, closed);
  } catch {
    return null;
  }
}

/** Sign of a polynomial over the whole real line. */
function signClassOnReals(ce, coefficients) {
  const degree = coefficients.length - 1;
  if (degree === 0) {
    const s = constantSign(ce, coefficients[0]);
    if (s === null) return null;
    return { sign: s > 0 ? 'positive' : s < 0 ? 'negative' : 'zero', via: 'constant' };
  }

  // Only even powers present: every term keeps its sign for every x.
  const powerOf = (index) => degree - index;
  const oddAllZero = coefficients.every((c, i) => powerOf(i) % 2 === 0 || constantSign(ce, c) === 0);
  if (oddAllZero) {
    const evenSigns = coefficients
      .map((c, i) => (powerOf(i) % 2 === 0 ? constantSign(ce, c) : 0));
    if (!evenSigns.some((s) => s === null)) {
      const anyPositive = evenSigns.some((s) => s > 0);
      const anyNegative = evenSigns.some((s) => s < 0);
      const constantTerm = evenSigns[evenSigns.length - 1];
      const even = (sign) => ({ sign, via: 'even-powers' });
      if (!anyPositive && !anyNegative) return even('zero');
      if (!anyNegative) return even(constantTerm > 0 ? 'positive' : 'nonneg');
      if (!anyPositive) return even(constantTerm < 0 ? 'negative' : 'nonpos');
    }
  }

  // A quadratic never crosses zero when its discriminant is negative.
  if (degree === 2) {
    const [a, b, c] = coefficients;
    const leading = constantSign(ce, a);
    const discriminant = constantSign(
      ce,
      ce.box(['Subtract', ce.box(['Square', b]), ce.box(['Multiply', 4, a, c])])
    );
    if (leading !== null && discriminant !== null && leading !== 0 && discriminant <= 0) {
      const byDiscriminant = (sign) => ({ sign, via: 'discriminant' });
      if (leading > 0) return byDiscriminant(discriminant < 0 ? 'positive' : 'nonneg');
      return byDiscriminant(discriminant < 0 ? 'negative' : 'nonpos');
    }
  }

  return null;
}

/**
 * Non-negativity read straight off the shape of an expression, so it also works
 * with several variables: `x^2 + y^2 + 1 > 0`.
 */
export function structuralSign(expr) {
  try {
    if (expr.isNumberLiteral) {
      if (expr.im && Math.abs(expr.im) > 1e-12) return null;
      if (expr.is(0) === true) return 'nonneg';
      return expr.re > 0 ? 'positive' : null;
    }
    switch (expr.operator) {
      case 'Power': {
        const exponent = expr.ops?.[1];
        const n = exponent?.re;
        return Number.isInteger(n) && n > 0 && n % 2 === 0 ? 'nonneg' : null;
      }
      case 'Square':
      case 'Abs':
        return 'nonneg';
      case 'Add': {
        let result = 'nonneg';
        for (const operand of expr.ops ?? []) {
          const s = structuralSign(operand);
          if (s === null) return null;
          if (s === 'positive') result = 'positive';
        }
        return result;
      }
      case 'Multiply': {
        let result = 'positive';
        for (const operand of expr.ops ?? []) {
          const s = structuralSign(operand);
          if (s === null) return null;
          if (s === 'nonneg') result = 'nonneg';
        }
        return result;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * The set of x where `coefficients(x) <kind> 0` holds — or a superset of it.
 *
 * A superset is safe: proving the consequent on more points than necessary
 * still proves it on the ones that matter. Returns null when even a superset
 * cannot be described.
 */
function antecedentDomain(ce, kind, coefficients) {
  const degree = coefficients.length - 1;

  if (degree === 0) {
    const s = constantSign(ce, coefficients[0]);
    if (s === null) return null;
    const signClass = s > 0 ? 'positive' : s < 0 ? 'negative' : 'zero';
    return satisfiesSign(kind, signClass) ? { kind: 'all' } : { kind: 'empty' };
  }

  if (degree === 1) {
    const [a, b] = coefficients;
    const leading = constantSign(ce, a);
    if (leading === null || leading === 0) return null;
    const root = ce.box(['Divide', ce.box(['Negate', b]), a]).evaluate();

    switch (kind) {
      case 'eq': return { kind: 'point', at: root };
      case 'ne': return { kind: 'except', at: root };
      case 'gt':
      case 'ge':
        return {
          kind: 'half',
          at: root,
          direction: leading > 0 ? 'up' : 'down',
          closed: kind === 'ge',
        };
      default: return null;
    }
  }

  return null;
}

/** Can we certify `poly <kind> 0` everywhere on `domain`? */
function holdsOnDomain(ce, poly, variable, domain, kind) {
  switch (domain.kind) {
    case 'empty':
      return true;
    case 'point': {
      const value = poly.subs({ [variable]: domain.at }).evaluate();
      const s = constantSign(ce, value);
      if (s === null) return false;
      return satisfiesSign(kind, s > 0 ? 'positive' : s < 0 ? 'negative' : 'zero');
    }
    case 'half':
      return satisfiesSign(
        kind,
        signClassOnHalfLine(ce, poly, variable, domain.at, domain.direction, domain.closed)
      );
    case 'except':
      // R \ {a} is the two open half-lines either side of it.
      return (
        satisfiesSign(kind, signClassOnHalfLine(ce, poly, variable, domain.at, 'up', false)) &&
        satisfiesSign(kind, signClassOnHalfLine(ce, poly, variable, domain.at, 'down', false))
      );
    case 'all': {
      const coefficients = polynomialCoefficients(ce, poly, variable);
      if (coefficients && satisfiesSign(kind, signClassOnReals(ce, coefficients)?.sign)) return true;
      return satisfiesSign(kind, structuralSign(poly));
    }
    default:
      return false;
  }
}

/**
 * Prove `left` implies `right`, where both are normalised relations
 * `{kind, diff}`. Single-variable polynomials only; returns null otherwise.
 */
export function proveImplicationBySign(ce, left, right) {
  const variables = [...new Set([...left.diff.unknowns, ...right.diff.unknowns])];
  if (variables.length !== 1) return null;
  const variable = variables[0];

  const antecedent = polynomialCoefficients(ce, left.diff, variable);
  if (!antecedent) return null;

  const consequent = polynomialCoefficients(ce, right.diff, variable);
  if (consequent) {
    const exact = decideRationalPolynomialImplication(antecedent, left.kind, consequent, right.kind);
    if (exact === true) {
      return { rule: 'polynomial.sturm-sign-chart', data: { variableLatex: variable } };
    }
    // A false answer is discarded here because this public function is a
    // prover. Nothing is lost: `decideExactly` in decide.js runs the same
    // complete procedure over the whole statement first, and reports the false
    // verdict — with its exact witness — before this partial prover is reached.
  }

  const domain = antecedentDomain(ce, left.kind, antecedent);
  if (!domain) return null;

  // The consequent need not be a polynomial for a point domain, where we just
  // substitute; for the others it must be.
  if (domain.kind !== 'point' && !consequent) return null;

  return holdsOnDomain(ce, right.diff, variable, domain, right.kind)
    ? { rule: 'polynomial.domain-sign', data: { variableLatex: variable, domain: domain.kind } }
    : null;
}

/**
 * Prove a standalone relation `diff <kind> 0` holds for every value of its free
 * variables — `x^2 >= 0`, `x^2 + y^2 + 1 > 0`, `(x+1)^2 = x^2 + 2x + 1`.
 */
export function proveRelationBySign(ce, relation) {
  const { kind, diff } = relation;
  const variables = diff.unknowns;
  if (variables.length === 0) return null;

  if (variables.length === 1) {
    const coefficients = polynomialCoefficients(ce, diff, variables[0]);
    if (coefficients) {
      if (decideRationalPolynomialRelation(coefficients, kind) === true) {
        return { rule: 'polynomial.sturm-sign-chart', data: { variableLatex: variables[0] } };
      }
      const onReals = signClassOnReals(ce, coefficients);
      if (satisfiesSign(kind, onReals?.sign)) {
        return onReals.via === 'discriminant'
          ? { rule: 'polynomial.discriminant', data: { variableLatex: variables[0] } }
          : {
            rule: 'polynomial.even-power',
            data: { variableLatex: variables[0], witnessLatex: diff.latex },
          };
      }
    }
  }

  // Preserve useful syntax such as `(xy + z)^2`: expansion turns an obvious
  // square into mixed-sign terms and throws away its structural certificate.
  if (satisfiesSign(kind, structuralSign(diff))) {
    return { rule: 'polynomial.even-power', data: { witnessLatex: diff.latex } };
  }

  let expanded = diff;
  try {
    expanded = ce.box(['Expand', diff]).evaluate();
  } catch { /* use the original */ }
  if (satisfiesSign(kind, structuralSign(expanded))) {
    return {
      rule: 'polynomial.even-power',
      data: { expandedLatex: expanded.latex, witnessLatex: expanded.latex },
    };
  }

  // A polynomial identity in several variables is settled by expanding both
  // sides — `(a²+b²)(c²+d²) - (ac+bd)² - (ad-bc)²` is the zero polynomial, and
  // saying so is a proof rather than the sampled agreement it was reported as.
  if (kind === 'eq' && variables.length > 1) {
    try {
      if (expanded.is(0) === true || expanded.simplify().is(0) === true) {
        return { rule: 'polynomial.identity', data: null };
      }
    } catch { /* not identically zero */ }
  }

  // Many multivariable inequalities are a single square wearing an expanded
  // form: `x⁴ + y⁴ - 2x²y²` is `(x² - y²)²`, and Cauchy–Schwarz in two
  // dimensions is Lagrange's `(ad - bc)²`. Factoring puts the square back
  // where `structuralSign` can see it.
  if (variables.length > 1) {
    let factored = null;
    try {
      factored = ce.box(['Factor', expanded]).evaluate();
    } catch { /* no factorisation available */ }
    if (factored && satisfiesSign(kind, structuralSign(factored))) {
      return {
        rule: 'polynomial.even-power',
        data: { factoredLatex: factored.latex, witnessLatex: factored.latex },
      };
    }
  }

  // Several variables, degree two: an exact positive-semidefiniteness test on
  // the homogenised coefficient matrix. This is what turns the ordinary
  // multivariable inequalities — `a² + b² ≥ 2ab` and its relatives — from
  // "no counterexample in N samples" into proofs.
  const quadraticWitness = proveQuadraticFormNonNegative(ce, diff, kind);
  if (quadraticWitness) return { rule: 'quadratic.psd', data: quadraticWitness };

  if (expanded !== diff) {
    const expandedWitness = proveQuadraticFormNonNegative(ce, expanded, kind);
    if (expandedWitness) {
      return {
        rule: 'quadratic.psd',
        data: { expandedLatex: expanded.latex, ...expandedWitness },
      };
    }
  }

  return null;
}
