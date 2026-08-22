/**
 * Deciding the truth of a statement that still contains free variables.
 *
 * Three passes, in order:
 *   1. Symbolic. Ask the CAS to prove it outright, then try relation-level
 *      normalisation (two relations are equivalent when their normal forms are
 *      a positive constant multiple of each other).
 *   2. Exact. For the univariate rational-polynomial case the sign chart is a
 *      complete decision procedure, so it settles TRUE and FALSE alike. Running
 *      it before the sampling pass is what stops a statement that fails at a
 *      single point from being reported as true.
 *   3. Numeric. Substitute concrete values for the free variables and evaluate.
 *      A single FALSE sample disproves the statement and is reported as a
 *      counterexample; surviving every sample is reported as true-but-unproven,
 *      never as a proof.
 */

import { polynomialCoefficients, proveImplicationBySign, proveRelationBySign } from './polynomial.js';
import { decideRationalPolynomialFormula, rationalLatex } from './rational-polynomial.js';

const RELATIONS = new Set([
  'Equal', 'NotEqual', 'Less', 'LessEqual', 'Greater', 'GreaterEqual', 'IdenticallyEqual',
]);

/** Deterministic PRNG so the same sheet always yields the same verdict. */
function makeRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Pull the numeric literals out of an expression so we can sample near them. */
function collectLiterals(json, out = new Set()) {
  if (typeof json === 'number') out.add(json);
  else if (typeof json === 'object' && json !== null) {
    if (Array.isArray(json)) json.forEach((j) => collectLiterals(j, out));
    else if (typeof json.num === 'string') {
      const n = Number.parseFloat(json.num);
      if (Number.isFinite(n)) out.add(n);
    }
  }
  return out;
}

/**
 * Candidate values for a free variable. Mixes exact rationals (so `=` holds
 * exactly rather than to within a float epsilon), irrationals, and points
 * adjacent to the literals appearing in the statement — which is where
 * inequality boundaries live.
 */
function buildSamplePool(ce, expr, complex) {
  const values = [];
  const seen = new Set();
  const push = (latex) => {
    if (seen.has(latex)) return;
    seen.add(latex);
    values.push({ latex, expr: ce.parse(latex) });
  };

  for (let n = -6; n <= 6; n++) push(String(n));
  for (const q of ['\\frac{1}{2}', '-\\frac{1}{2}', '\\frac{1}{3}', '-\\frac{2}{3}',
    '\\frac{3}{2}', '-\\frac{5}{2}', '\\frac{22}{7}', '\\frac{1}{10}', '-\\frac{1}{100}']) push(q);
  for (const r of ['\\sqrt{2}', '-\\sqrt{2}', '\\pi', '-\\pi', 'e', '\\frac{\\pi}{4}']) push(r);
  for (const b of ['100', '-100', '1000', '\\frac{1}{1000}']) push(b);

  // Boundary probing: inequalities flip exactly at the constants in the statement.
  for (const lit of collectLiterals(expr.json)) {
    if (!Number.isFinite(lit) || Math.abs(lit) > 1e6) continue;
    for (const delta of [0, 1, -1]) {
      const v = lit + delta;
      if (Number.isInteger(v)) push(String(v));
    }
    push(`\\frac{${Math.round(lit * 2 + 1)}}{2}`);
    push(`\\frac{${Math.round(lit * 100 - 1)}}{100}`);
    push(`\\frac{${Math.round(lit * 100 + 1)}}{100}`);
  }

  if (complex) {
    for (const c of ['i', '-i', '1+i', '2-3i', '\\frac{1}{2}+\\frac{1}{2}i']) push(c);
  }

  return values;
}

function truthOf(expr) {
  const sym = expr.symbol;
  if (sym === 'True') return true;
  if (sym === 'False') return false;
  return null;
}

/**
 * Rewrite a relation into `diff <rel> 0` form so two relations written
 * differently can be compared. Returns null for relations we do not normalise.
 */
function normalizeRelation(ce, rel) {
  const op = rel.operator;
  if (!RELATIONS.has(op) || rel.nops !== 2) return null;
  const [a, b] = rel.ops;
  switch (op) {
    // `a = b` and `a != b` become `a - b`, asserted equal / not equal to zero.
    case 'Equal':
    case 'IdenticallyEqual':
      return { kind: 'eq', diff: ce.box(['Subtract', a, b]) };
    case 'NotEqual':
      return { kind: 'ne', diff: ce.box(['Subtract', a, b]) };
    // All inequalities are oriented to `diff > 0` or `diff >= 0`.
    case 'Less':
      return { kind: 'gt', diff: ce.box(['Subtract', b, a]) };
    case 'LessEqual':
      return { kind: 'ge', diff: ce.box(['Subtract', b, a]) };
    case 'Greater':
      return { kind: 'gt', diff: ce.box(['Subtract', a, b]) };
    case 'GreaterEqual':
      return { kind: 'ge', diff: ce.box(['Subtract', a, b]) };
    default:
      return null;
  }
}

/** The relation that holds exactly when `relation` does not. */
function negateRelation(ce, relation) {
  const flipped = ce.box(['Negate', relation.diff]);
  switch (relation.kind) {
    case 'eq': return { kind: 'ne', diff: relation.diff };
    case 'ne': return { kind: 'eq', diff: relation.diff };
    // not (p > 0)  <=>  p <= 0  <=>  -p >= 0
    case 'gt': return { kind: 'ge', diff: flipped };
    case 'ge': return { kind: 'gt', diff: flipped };
    default: return null;
  }
}

function isZero(expr) {
  try {
    return expr.simplify().is(0) === true;
  } catch {
    return false;
  }
}

/** -1, 0, or 1 for a real constant; null if it is not a real constant. */
function signOf(value) {
  if (!value?.isNumberLiteral) return null;
  if (value.im && Math.abs(value.im) > 1e-12) return null;
  if (value.is(0) === true) return 0;
  const re = value.re;
  if (!Number.isFinite(re)) return null;
  if (Math.abs(re) < 1e-12) return 0;
  return re > 0 ? 1 : -1;
}

/** Sample points used to *guess* an affine relationship, never to confirm one. */
const PROBE_VALUES = [0, 1, 2, -1, 3, -2, 5];

/**
 * Find constants `c` and `k` with `q = c*p + k` identically, or null.
 *
 * The pair is guessed by evaluating both sides at two points and solving, then
 * **verified symbolically**. The verification is what makes this sound: two
 * points also "fit" a line through a parabola, and the check throws that out.
 */
function affineRelationship(ce, p, q) {
  const unknowns = [...new Set([...p.unknowns, ...q.unknowns])];
  if (unknowns.length === 0) return null;

  const at = (expr, index) => {
    const assignment = {};
    // Offset per variable, so symmetric expressions like `x - y` are not
    // evaluated only along the diagonal where they are constant.
    unknowns.forEach((id, i) => {
      assignment[id] = ce.box(PROBE_VALUES[(index + i) % PROBE_VALUES.length]);
    });
    try {
      const value = expr.subs(assignment).evaluate();
      return value.isNumberLiteral && Number.isFinite(value.re) ? value : null;
    } catch {
      return null;
    }
  };

  for (let i = 0; i < PROBE_VALUES.length; i++) {
    for (let j = i + 1; j < PROBE_VALUES.length; j++) {
      const p1 = at(p, i);
      const p2 = at(p, j);
      const q1 = at(q, i);
      const q2 = at(q, j);
      if (!p1 || !p2 || !q1 || !q2) continue;
      if (ce.box(['Subtract', p1, p2]).evaluate().is(0) === true) continue;

      const c = ce.box(['Divide', ce.box(['Subtract', q1, q2]), ce.box(['Subtract', p1, p2])]).evaluate();
      const k = ce.box(['Subtract', q1, ce.box(['Multiply', c, p1])]).evaluate();
      if (signOf(c) === null || signOf(k) === null) continue;

      const residual = ce.box(['Subtract', ce.box(['Subtract', q, ce.box(['Multiply', c, p])]), k]);
      if (isZero(residual)) return { c, k };
    }
  }
  return null;
}

/** True for a value with sign `s` satisfying the relation `kind` against 0. */
function satisfiedBySign(kind, s) {
  switch (kind) {
    case 'eq': return s === 0;
    case 'ne': return s !== 0;
    case 'gt': return s > 0;
    case 'ge': return s >= 0;
    default: return false;
  }
}

/**
 * Given `A` asserting `P(p)` and `B` asserting `Q(q)` where `q = c*p + k`,
 * does A imply B for every real p?
 *
 * Decided from the range q covers while A holds:
 *   p  = 0  ->  q = k
 *   p != 0  ->  every real except k   (c != 0)
 *   p  > 0  ->  (k, inf)  for c > 0,  (-inf, k)  for c < 0
 *   p >= 0  ->  [k, inf)  for c > 0,  (-inf, k]  for c < 0
 *
 * Sound but incomplete: p is treated as ranging over all of that interval, which
 * may be wider than the values p can actually take (`x^2` is never negative).
 * A wider range only ever withholds a proof, never grants a false one.
 */
function impliesUnderAffine(antecedent, consequent, cSign, kSign) {
  if (cSign === 0 || antecedent === 'eq') return satisfiedBySign(consequent, kSign);

  switch (antecedent) {
    case 'ne':
      return consequent === 'ne' && kSign === 0;
    case 'gt':
      if (cSign > 0) return ['gt', 'ge', 'ne'].includes(consequent) && kSign >= 0;
      return consequent === 'ne' && kSign <= 0;
    case 'ge':
      if (cSign > 0) {
        if (consequent === 'ge') return kSign >= 0;
        return (consequent === 'gt' || consequent === 'ne') && kSign > 0;
      }
      return consequent === 'ne' && kSign < 0;
    default:
      return false;
  }
}

/** Does the expression divide by an unknown anywhere? */
function hasUnknownDenominator(expr) {
  const unknowns = new Set(expr.unknowns);
  const walk = (json) => {
    if (!Array.isArray(json)) return false;
    const [head, ...rest] = json;
    if (head === 'Divide' || head === 'Rational') {
      const denominator = JSON.stringify(rest[1] ?? '');
      if ([...unknowns].some((u) => denominator.includes(`"${u}"`))) return true;
    }
    if (head === 'Power' && typeof rest[1] === 'number' && rest[1] < 0) return true;
    return json.some(walk);
  };
  return walk(expr.json);
}

/**
 * `p = 0` implies `q = 0` when p divides q exactly — `x = 2` implies `x^2 = 4`
 * because `x^2 - 4 = (x - 2)(x + 2)`.
 *
 * The quotient must come back free of division by an unknown; otherwise the
 * "identity" `q - p*(q/p) = 0` is vacuously true and proves nothing.
 */
function dividesExactly(ce, p, q) {
  let quotient;
  try {
    quotient = ce.box(['Divide', q, p]).simplify();
  } catch {
    return false;
  }
  if (!quotient || hasUnknownDenominator(quotient)) return false;
  return isZero(ce.box(['Subtract', q, ce.box(['Multiply', p, quotient])]));
}

/** A nonzero constant, and its sign, or null if it is not constant. */
function constantRatio(ce, num, den) {
  try {
    const ratio = ce.box(['Divide', num, den]).simplify();
    if (ratio.unknowns.length > 0) return null;
    const n = ratio.N();
    if (!n.isNumberLiteral) return null;
    const re = n.re;
    if (!Number.isFinite(re) || Math.abs(re) < 1e-12) return null;
    if (n.im && Math.abs(n.im) > 1e-12) return null;
    return re;
  } catch {
    return null;
  }
}

/**
 * Symbolic attempt at `A -> B`, both sides relations. Proves, in order:
 *   - the same relation on both sides;
 *   - an affine consequent, decided by sign (`x > 2` implies `x > 1`, since
 *     `(x - 1) = (x - 2) + 1` and the offset is non-negative);
 *   - an equation whose polynomial is a multiple of the antecedent's
 *     (`x = 2` implies `x^2 = 4`).
 */
function proveImplies(ce, left, right) {
  const a = normalizeRelation(ce, left);
  const b = normalizeRelation(ce, right);
  if (!a || !b) return null;

  if (a.kind === b.kind && isZero(ce.box(['Subtract', a.diff, b.diff]))) return true;

  // Trivially true when the consequent holds for every value anyway...
  if (proveRelationBySign(ce, b) === true) return true;
  // ...and vacuously true when the antecedent can never hold at all.
  const impossible = negateRelation(ce, a);
  if (impossible && proveRelationBySign(ce, impossible) === true) return true;

  const affine = affineRelationship(ce, a.diff, b.diff);
  if (affine && impliesUnderAffine(a.kind, b.kind, signOf(affine.c), signOf(affine.k))) {
    return true;
  }

  if (a.kind === 'eq' && b.kind === 'eq' && dividesExactly(ce, a.diff, b.diff)) return true;

  // Nonlinear, one variable: turn the antecedent into a domain and certify the
  // consequent's sign on it. This is what reaches `x > 2 => x^2 > 3`.
  if (proveImplicationBySign(ce, a, b) === true) return true;

  return null;
}

/**
 * Symbolic attempt at `A <-> B`. Equivalence is implication both ways, which
 * covers scaling (`x > 2 <-> 2x > 4`) and rearrangement (`x + 1 = 2 <-> x = 1`)
 * without special-casing either.
 */
function proveEquivalent(ce, left, right) {
  const a = normalizeRelation(ce, left);
  const b = normalizeRelation(ce, right);
  if (!a || !b) return null;

  if (proveImplies(ce, left, right) === true && proveImplies(ce, right, left) === true) {
    return true;
  }

  // Fallback for relations the affine test cannot pin down: identical normal
  // forms, or a constant multiple of one another.
  const bothEquality = (a.kind === 'eq' && b.kind === 'eq') || (a.kind === 'ne' && b.kind === 'ne');
  const bothInequality = a.kind === b.kind && (a.kind === 'gt' || a.kind === 'ge');
  if (!bothEquality && !bothInequality) return null;

  if (isZero(ce.box(['Subtract', a.diff, b.diff]))) return true;

  const ratio = constantRatio(ce, a.diff, b.diff);
  if (ratio === null) return null;
  // Scaling an equation by any nonzero constant preserves it; scaling an
  // inequality preserves it only when the constant is positive.
  if (bothEquality) return true;
  return ratio > 0 ? true : null;
}

/** Convert a supported proposition to the generic exact sign-chart form. */
function polynomialFormula(ce, expr, variable) {
  const op = expr.operator;
  const logical = {
    And: 'and', Or: 'or', Not: 'not', Implies: 'implies', Equivalent: 'equivalent',
  };
  if (logical[op]) {
    const operands = expr.ops.map((operand) => polynomialFormula(ce, operand, variable));
    return operands.every(Boolean) ? { op: logical[op], operands } : null;
  }

  // `\equiv` may arrive as IdenticallyEqual. It is a logical connective when
  // both operands are themselves propositions, and an equality relation
  // otherwise.
  if (op === 'IdenticallyEqual' && expr.nops === 2 && expr.ops.every(
    (operand) => RELATIONS.has(operand.operator) || ['And', 'Or', 'Not', 'Implies', 'Equivalent'].includes(operand.operator)
  )) {
    const operands = expr.ops.map((operand) => polynomialFormula(ce, operand, variable));
    return operands.every(Boolean) ? { op: 'equivalent', operands } : null;
  }

  if (!RELATIONS.has(op)) return null;
  const relation = normalizeRelation(ce, expr);
  if (!relation) return null;
  const coefficients = polynomialCoefficients(ce, relation.diff, variable);
  return coefficients ? { op: 'atom', kind: relation.kind, coefficients } : null;
}

/**
 * The complete exact decision for a Boolean combination of univariate
 * rational-polynomial relations.
 *
 * Unlike `proveSymbolically`, this also reports FALSE — and it is the only pass
 * that can, without a sample. That matters because the point where such a
 * statement fails is often one sampling will never visit: a lone root, at an
 * awkward denominator or an irrational value. Without this, `4x^2 + 2x - 2 > 0
 * => -3x + 2 != 0` survives every sample and is reported true, when it fails
 * exactly at x = 2/3.
 *
 * The witness comes back only when it is rational; an irrational one has no
 * exact display form, and the verdict is then reported without it.
 */
function decideExactly(ce, expr) {
  const variables = expr.unknowns;
  if (variables.length !== 1) return null;

  const formula = polynomialFormula(ce, expr, variables[0]);
  if (!formula) return null;
  const verdict = decideRationalPolynomialFormula(formula);
  if (!verdict) return null;

  return {
    value: verdict.value,
    counterexample: verdict.witness
      ? [{ id: variables[0], valueLatex: rationalLatex(verdict.witness) }]
      : null,
  };
}

/**
 * Symbolic proof over a whole statement. Chains arrive as `And` of their links,
 * so proving every link proves the chain.
 */
function proveSymbolically(ce, expr) {
  const op = expr.operator;

  // Compute Engine represents homogeneous relation chains as one n-ary
  // relation (`Equal(a, b, c)`, `Less(a, b, c)`, ...), rather than the `And`
  // of binary links used for mixed inequality chains. A chain holds exactly
  // when every adjacent link holds, so prove those links individually. Do not
  // apply this to NotEqual: its n-ary meaning is pairwise distinct, which is
  // stronger than adjacent inequality alone.
  if (expr.nops > 2 && [
    'Equal', 'IdenticallyEqual', 'Less', 'LessEqual', 'Greater', 'GreaterEqual',
  ].includes(op)) {
    return expr.ops.slice(1).every((right, index) => (
      proveSymbolically(ce, ce.box([op, expr.ops[index], right])) === true
    )) ? true : null;
  }

  // Complete for Boolean combinations of univariate rational-polynomial
  // relations. One shared sign chart is essential for conjunction-defined
  // intervals and complementary disjunctions.
  const variables = expr.unknowns;
  if (variables.length === 1) {
    const formula = polynomialFormula(ce, expr, variables[0]);
    if (formula && decideRationalPolynomialFormula(formula)?.value === true) return true;
  }

  if (op === 'And' && expr.nops > 0) {
    return expr.ops.every((operand) => proveSymbolically(ce, operand) === true) ? true : null;
  }
  if (op === 'Or' && expr.nops > 0) {
    return expr.ops.some((operand) => proveSymbolically(ce, operand) === true) ? true : null;
  }
  if ((op === 'Equivalent' || op === 'IdenticallyEqual') && expr.nops === 2) {
    return proveEquivalent(ce, expr.ops[0], expr.ops[1]);
  }
  if (op === 'Implies' && expr.nops === 2) {
    const [left, right] = expr.ops;
    if (left.operator === 'Or') {
      return left.ops.every((operand) => proveSymbolically(ce, ce.box(['Implies', operand, right])) === true)
        ? true : null;
    }
    if (right.operator === 'And') {
      return right.ops.every((operand) => proveSymbolically(ce, ce.box(['Implies', left, operand])) === true)
        ? true : null;
    }
    if (left.operator === 'And' && left.ops.some(
      (operand) => proveSymbolically(ce, ce.box(['Implies', operand, right])) === true
    )) return true;
    if (right.operator === 'Or' && right.ops.some(
      (operand) => proveSymbolically(ce, ce.box(['Implies', left, operand])) === true
    )) return true;
    return proveImplies(ce, expr.ops[0], expr.ops[1]);
  }
  // A bare relation carrying free variables: is it an identity?
  if (RELATIONS.has(op)) {
    const relation = normalizeRelation(ce, expr);
    return relation ? proveRelationBySign(ce, relation) : null;
  }
  return null;
}

const MAX_SAMPLES = 320;
const MIN_DECISIVE = 8;
const TIME_BUDGET_MS = 250;

/**
 * @returns {{value: boolean|null, method: string, samples: number, counterexample: Array|null}}
 */
export function decideStatement(ce, expr, options = {}) {
  const complex = options.complex ?? false;

  // 1a. Outright proof by the CAS.
  let evaluated;
  try {
    evaluated = expr.evaluate();
  } catch {
    evaluated = null;
  }
  const direct = evaluated ? truthOf(evaluated) : null;
  if (direct !== null) {
    return { value: direct, method: 'proved', samples: 0, counterexample: null };
  }

  // 1b. The complete exact decision, where it applies. Run before the partial
  // provers because it settles both directions, and a false verdict here must
  // not be left to the sampling pass to rediscover — it generally cannot.
  const exact = decideExactly(ce, expr);
  if (exact?.value === true) {
    return { value: true, method: 'proved', samples: 0, counterexample: null };
  }
  if (exact?.value === false) {
    return {
      value: false,
      method: exact.counterexample ? 'counterexample' : 'disproved',
      samples: 0,
      counterexample: exact.counterexample,
    };
  }

  // 1c. Relation-level reasoning over the connectives.
  if (proveSymbolically(ce, expr) === true) {
    return { value: true, method: 'proved', samples: 0, counterexample: null };
  }

  // 2. Numeric search for a counterexample.
  const unknowns = expr.unknowns;
  if (unknowns.length === 0) {
    try {
      const n = truthOf(expr.N());
      if (n !== null) return { value: n, method: 'proved', samples: 0, counterexample: null };
    } catch { /* fall through to undecided */ }
    return { value: null, method: 'undecided', samples: 0, counterexample: null };
  }

  const pool = buildSamplePool(ce, expr, complex);
  const random = makeRandom(hashString(expr.toString() + unknowns.join(',')));
  const started = Date.now();
  let decisive = 0;

  const trial = (assignment) => {
    let result;
    try {
      result = expr.subs(assignment).evaluate();
    } catch {
      return null;
    }
    return truthOf(result);
  };

  const describe = (indices) => unknowns.map((id, k) => ({
    id,
    valueLatex: pool[indices[k]].latex,
  }));

  if (unknowns.length === 1) {
    const id = unknowns[0];
    const limit = Math.min(pool.length, MAX_SAMPLES);
    for (let k = 0; k < limit; k++) {
      if (k % 16 === 0 && Date.now() - started > TIME_BUDGET_MS) break;
      const verdict = trial({ [id]: pool[k].expr });
      if (verdict === false) {
        return { value: false, method: 'counterexample', samples: decisive, counterexample: describe([k]) };
      }
      if (verdict === true) decisive++;
    }
  } else {
    const indices = new Array(unknowns.length).fill(0);
    for (let k = 0; k < MAX_SAMPLES; k++) {
      if (k % 16 === 0 && Date.now() - started > TIME_BUDGET_MS) break;
      // First pass the "all variables equal" diagonal, then random tuples.
      for (let v = 0; v < unknowns.length; v++) {
        indices[v] = k < pool.length ? (k + v * 3) % pool.length : Math.floor(random() * pool.length);
      }
      const assignment = {};
      unknowns.forEach((id, v) => { assignment[id] = pool[indices[v]].expr; });
      const verdict = trial(assignment);
      if (verdict === false) {
        return { value: false, method: 'counterexample', samples: decisive, counterexample: describe(indices) };
      }
      if (verdict === true) decisive++;
    }
  }

  if (decisive >= MIN_DECISIVE) {
    return { value: true, method: 'sampled', samples: decisive, counterexample: null };
  }
  return { value: null, method: 'undecided', samples: decisive, counterexample: null };
}
