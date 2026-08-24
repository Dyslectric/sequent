/**
 * The gate that decides whether a definite integral may be trusted.
 *
 * Compute Engine will answer an integral whether or not the answer exists, and
 * it is not merely silent about the hard cases — it is wrong about some of
 * them. Probed directly:
 *
 *     \int_{-1}^{1} 1/x   dx = 0     ->  True.  The integral does not exist;
 *                                        zero is only its principal value.
 *     \int_{-1}^{1} 1/x^2 dx = -2    ->  True.  The integrand is positive
 *                                        everywhere, so no value can be
 *                                        negative. It diverges to +infinity.
 *
 * It gets the easy divergences right — `\int_0^1 dx/x = 1` comes back False —
 * which makes the failures worse rather than better: they are scattered, not a
 * uniform "improper integrals unsupported". So the engine's value may only be
 * used once *this* module has independently established that the integral is a
 * proper one: finite bounds, and an integrand with no singularity anywhere on
 * the closed interval between them.
 *
 * Everything here answers "may I trust the answer?", never "what is it?". When
 * it cannot tell, it says so, and the line is refused rather than decided.
 */

import { polynomialCoefficients } from './polynomial.js';
import { vanishesOnClosedInterval } from './rational-polynomial.js';

/** Heads that are finite and continuous wherever their arguments are. */
const CONTINUOUS = new Set([
  'Add', 'Subtract', 'Negate', 'Multiply',
  'Sin', 'Cos', 'Exp', 'Sinh', 'Cosh', 'Tanh', 'Abs',
]);

/** Constants that stand for a finite real number. */
const FINITE_CONSTANTS = new Set(['Pi', 'ExponentialE', 'GoldenRatio', 'CatalanConstant']);

const INFINITIES = new Set([
  'PositiveInfinity', 'NegativeInfinity', 'ComplexInfinity', 'Infinity', 'Nothing',
]);

/** A bound has to be an actual point on the line. */
function boundProblem(bound) {
  if (!bound) return 'the limits of integration are missing';
  const symbol = bound.symbol;
  if (symbol && INFINITIES.has(symbol)) {
    return 'an infinite limit needs a limit argument this sheet cannot check';
  }
  if (bound.isNumberLiteral) return bound.isFinite === false ? 'a limit is not finite' : null;
  if (symbol && FINITE_CONSTANTS.has(symbol)) return null;

  // `2\pi` is neither a literal nor a bare constant, so ask what it comes to.
  // A bound that reduces to a finite real number is a point on the line like
  // any other; one that does not — a free variable, an unevaluated call —
  // leaves the interval undetermined, and an interval nobody knows cannot be
  // checked for poles.
  try {
    const value = bound.N();
    if (value?.isNumberLiteral && value.isFinite !== false
      && Number.isFinite(value.re) && !value.im) return null;
  } catch { /* fall through to the refusal */ }

  return 'the limits of integration must be definite numbers';
}

/**
 * Where does the integrand stop being continuous on `[lower, upper]`?
 *
 * Division is the only construction here that can introduce a singularity, so
 * it is the only one that consults the root test. Everything else either
 * cannot blow up or is not recognised at all — and not recognised means
 * refused, because a function this code cannot classify may do anything.
 */
function discontinuity(ce, expr, variable, lower, upper) {
  if (!expr) return 'this integrand cannot be read';
  if (expr.isNumberLiteral) return expr.isFinite === false ? 'the integrand is infinite' : null;
  if (expr.symbol) {
    return (expr.symbol === variable || FINITE_CONSTANTS.has(expr.symbol))
      ? null
      : 'the integrand depends on something with no value';
  }

  const operator = expr.operator;
  const operands = expr.ops ?? [];

  if (CONTINUOUS.has(operator)) {
    for (const operand of operands) {
      const problem = discontinuity(ce, operand, variable, lower, upper);
      if (problem) return problem;
    }
    return null;
  }

  // `x^n` is safe for a non-negative integer power; a negative one is a
  // division in disguise and gets the same treatment. `e^x` and `2^x` are
  // safe for any exponent, because a positive constant base never reaches
  // zero and never turns complex.
  if (operator === 'Power' && operands.length === 2) {
    const [base, exponent] = operands;
    const baseProblem = discontinuity(ce, base, variable, lower, upper);
    if (baseProblem) return baseProblem;

    const power = exponent?.isNumberLiteral ? exponent.re : null;
    if (Number.isInteger(power)) {
      return power >= 0 ? null : poleProblem(ce, base, variable, lower, upper);
    }

    const positiveConstant = base?.symbol === 'ExponentialE'
      || (base?.isNumberLiteral && base.re > 0);
    if (positiveConstant) return discontinuity(ce, exponent, variable, lower, upper);

    return 'only whole-number powers of the variable can be checked';
  }

  if ((operator === 'Divide' || operator === 'Rational') && operands.length === 2) {
    const top = discontinuity(ce, operands[0], variable, lower, upper);
    if (top) return top;
    const bottom = discontinuity(ce, operands[1], variable, lower, upper);
    if (bottom) return bottom;
    return poleProblem(ce, operands[1], variable, lower, upper);
  }

  return 'this integrand is not one the sheet knows how to check for poles';
}

/** Does `denominator` vanish somewhere on the closed interval? */
function poleProblem(ce, denominator, variable, lower, upper) {
  const coefficients = polynomialCoefficients(ce, denominator, variable);
  if (!coefficients) {
    return 'the denominator is not a polynomial this sheet can check for zeros';
  }
  const vanishes = vanishesOnClosedInterval(coefficients, lower, upper);
  if (vanishes === null) {
    return 'the denominator cannot be checked for zeros exactly here';
  }
  return vanishes ? 'the integrand blows up inside the interval' : null;
}

/**
 * The reason this integral may not be trusted, or null when it may be.
 *
 * @param {object} integrate a boxed `Integrate` expression
 */
export function integralObstruction(ce, integrate) {
  const [integrand, limits] = integrate?.ops ?? [];
  if (!integrand || limits?.operator !== 'Limits') {
    return 'only a single definite integral is supported';
  }

  const [bound, lower, upper] = limits.ops ?? [];
  const variable = bound?.symbol;
  if (!variable) return 'the variable of integration is unclear';

  if (lower?.symbol === 'Nothing' || upper?.symbol === 'Nothing') {
    // An antiderivative is only defined up to a constant, so an equation
    // claiming one particular antiderivative is not something to certify.
    return 'an indefinite integral is only defined up to a constant';
  }
  const bounds = boundProblem(lower) ?? boundProblem(upper);
  if (bounds) return bounds;

  // `Function` wraps the integrand; its body may be wrapped again in `Block`.
  let body = integrand;
  while (body && ['Function', 'Block', 'Delimiter'].includes(body.operator)) {
    [body] = body.ops ?? [];
  }
  return discontinuity(ce, body, variable, lower, upper);
}

/** Every `Integrate` node anywhere in the expression. */
export function collectIntegrals(expr, found = []) {
  if (!expr?.ops) return found;
  if (expr.operator === 'Integrate') found.push(expr);
  for (const operand of expr.ops) collectIntegrals(operand, found);
  return found;
}
