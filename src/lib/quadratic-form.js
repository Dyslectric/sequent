/**
 * Exact global sign certificates for multivariable quadratic polynomials.
 *
 * The univariate sign chart decides everything it can reach, but it reaches
 * one variable. In several variables the app was falling back to sampling for
 * the most ordinary inequalities there are — `a² + b² ≥ 2ab`,
 * `x² + y² + z² ≥ xy + yz + zx` — reporting them as "no counterexample in N
 * samples" rather than as the one-line proofs they actually have.
 *
 * A polynomial of total degree at most two is `p(x) = xᵀAx + bᵀx + c`, which
 * homogenises to `[x;1]ᵀ M [x;1]` for the symmetric
 *
 *     M = [ A     b/2 ]
 *         [ b/2ᵀ  c   ]
 *
 * and then the whole question is whether M is positive semidefinite. That is
 * decidable exactly: run Cholesky with rational arithmetic and watch the
 * pivots. No floating point is involved in granting a proof, and no search.
 *
 * The coefficients are *read off by evaluation* — p at the origin, at each
 * ±eᵢ, and at each eᵢ+eⱼ — and then the reconstruction is verified against the
 * original expression symbolically. Guessing a shape and checking it exactly is
 * the same bargain the affine-consequent prover makes, and for the same reason:
 * evaluation is cheap and cannot be trusted, verification is the proof.
 */

import { boxedRational, Rational as R } from './rational-polynomial.js';

/** Quadratic forms in more variables than this are not worth the evaluations. */
const MAX_VARIABLES = 6;

function rationalAt(ce, expr, symbols, values) {
  const assignment = {};
  symbols.forEach((symbol, index) => { assignment[symbol] = values[index]; });
  try {
    return boxedRational(expr.subs(assignment).evaluate());
  } catch {
    return null;
  }
}

const unit = (length, index, value = 1) => (
  Array.from({ length }, (_, i) => (i === index ? value : 0))
);

/**
 * `A`, `b` and `c` for a degree-≤2 polynomial, or null when the expression is
 * not one. Nothing here is trusted until `verifiesAgainst` agrees.
 */
function readQuadratic(ce, expr, symbols) {
  const n = symbols.length;
  const at = (values) => rationalAt(ce, expr, symbols, values);

  const c = at(new Array(n).fill(0));
  if (!c) return null;

  const b = [];
  const diagonal = [];
  for (let i = 0; i < n; i++) {
    const plus = at(unit(n, i, 1));
    const minus = at(unit(n, i, -1));
    if (!plus || !minus) return null;
    // p(e) + p(-e) = 2A_ii + 2c, and p(e) - p(-e) = 2b_i.
    diagonal.push(R.sub(R.div(R.add(plus, minus), R.rat(2n)), c));
    b.push(R.div(R.sub(plus, minus), R.rat(2n)));
  }

  const A = Array.from({ length: n }, () => new Array(n).fill(R.ZERO));
  for (let i = 0; i < n; i++) A[i][i] = diagonal[i];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const values = new Array(n).fill(0);
      values[i] = 1;
      values[j] = 1;
      const both = at(values);
      if (!both) return null;
      // p(e_i + e_j) = A_ii + A_jj + 2A_ij + b_i + b_j + c.
      const cross = R.sub(
        R.sub(R.sub(both, c), R.add(b[i], b[j])),
        R.add(diagonal[i], diagonal[j])
      );
      A[i][j] = R.div(cross, R.rat(2n));
      A[j][i] = A[i][j];
    }
  }
  return { A, b, c };
}

const ratToExpr = (ce, value) => (
  value.d === 1n ? ce.number(Number(value.n)) : ce.box(['Rational', Number(value.n), Number(value.d)])
);

/**
 * Confirm the read-off form really is the polynomial we were handed. Without
 * this the evaluations would be an interpolation of a function that may not be
 * quadratic at all — a cubic agrees with some quadratic at every point we
 * sampled.
 */
function verifiesAgainst(ce, expr, symbols, { A, b, c }) {
  const terms = [ratToExpr(ce, c)];
  symbols.forEach((symbol, i) => {
    if (b[i].n !== 0n) terms.push(ce.box(['Multiply', ratToExpr(ce, b[i]), symbol]));
    for (let j = i; j < symbols.length; j++) {
      const coefficient = i === j ? A[i][i] : R.mul(A[i][j], R.rat(2n));
      if (coefficient.n === 0n) continue;
      terms.push(ce.box(['Multiply', ratToExpr(ce, coefficient), symbol, symbols[j]]));
    }
  });
  try {
    const difference = ce.box(['Subtract', expr, ce.box(['Add', ...terms])]).simplify();
    return difference.is(0) === true || difference.evaluate().is(0) === true;
  } catch {
    return false;
  }
}

/**
 * Cholesky with exact rational pivots, tolerating the singular case.
 *
 * Returns the pivots in order, or null the moment the matrix proves not to be
 * positive semidefinite: a negative pivot, or a zero pivot whose row still
 * carries an off-diagonal entry — which is exactly the `[[0,1],[1,0]]` shape
 * that is indefinite rather than degenerate.
 */
function semidefinitePivots(M) {
  const m = M.length;
  const work = M.map((row) => [...row]);
  const pivots = [];
  for (let k = 0; k < m; k++) {
    const pivot = work[k][k];
    if (R.sign(pivot) < 0) return null;
    if (R.sign(pivot) === 0) {
      for (let j = k + 1; j < m; j++) if (R.sign(work[k][j]) !== 0) return null;
      pivots.push(R.ZERO);
      continue;
    }
    pivots.push(pivot);
    for (let i = k + 1; i < m; i++) {
      const factor = R.div(work[i][k], pivot);
      if (R.sign(factor) === 0) continue;
      for (let j = k + 1; j < m; j++) {
        work[i][j] = R.sub(work[i][j], R.mul(factor, work[k][j]));
      }
    }
  }
  return pivots;
}

/**
 * Prove `diff >= 0` or `diff > 0` for every real assignment, exactly.
 *
 * The homogenising coordinate is eliminated last on purpose. Positive
 * semidefiniteness alone gives `p >= 0`; `p > 0` additionally needs p to have
 * no real zero, and a zero of p is precisely a kernel vector of M whose last
 * coordinate is nonzero. Eliminating that coordinate last puts the question in
 * the final pivot: strictly positive there means no such vector exists.
 *
 * `x^2 + 1` in the variables `(x, y)` is the case that rules out the easier
 * test — M is singular, yet the polynomial is strictly positive everywhere.
 *
 * @returns {true|null} true when certified, null when this prover has nothing
 *   to say. It never reports false: failing to certify non-negativity is not
 *   evidence that the polynomial goes negative.
 */
export function proveQuadraticFormNonNegative(ce, diff, kind) {
  if (kind !== 'ge' && kind !== 'gt') return null;
  let symbols;
  try {
    symbols = diff.unknowns;
  } catch {
    return null;
  }
  if (!symbols || symbols.length < 2 || symbols.length > MAX_VARIABLES) return null;

  const form = readQuadratic(ce, diff, symbols);
  if (!form || !verifiesAgainst(ce, diff, symbols, form)) return null;

  const n = symbols.length;
  const half = R.rat(1n, 2n);
  const M = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => {
    if (i < n && j < n) return form.A[i][j];
    if (i === n && j === n) return form.c;
    return R.mul(i === n ? form.b[j] : form.b[i], half);
  }));

  const pivots = semidefinitePivots(M);
  if (!pivots) return null;
  if (kind === 'ge') return true;
  return R.sign(pivots[n]) > 0 ? true : null;
}
