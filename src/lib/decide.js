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
 *
 * Every return also carries a proof status. The exact passes are `opaque` —
 * their verdict is exact, but they do not yet build the trace that explains it
 * — and the numeric pass is `unavailable`, permanently: a statement that
 * merely survived sampling has no derivation to show. See `proof-trace.js`.
 */

import { polynomialCoefficients, proveImplicationBySign, proveRelationBySign } from './polynomial.js';
import { decideRationalPolynomialFormula, rationalLatex } from './rational-polynomial.js';
import { proveComplexStatement } from './complex-proof.js';
import {
  NO_PROOF, OPAQUE_PROOF, createTraceBuilder, provedBy,
} from './proof-trace.js';

const RELATIONS = new Set([
  'Equal', 'NotEqual', 'Less', 'LessEqual', 'Greater', 'GreaterEqual', 'IdenticallyEqual',
]);
const CHAIN_RELATIONS = new Set([
  'Equal', 'IdenticallyEqual', 'Less', 'LessEqual', 'Greater', 'GreaterEqual',
]);

/**
 * Domains strictly inside ℝ. A real-valued decision procedure may still prove
 * a statement about these — ℕ ⊂ ℝ — but may not disprove one, because the
 * point where it fails can lie outside the domain the reader declared.
 */
const NARROWED_DOMAINS = new Set(['natural', 'positive-integer', 'integer', 'rational']);

const BOOLEAN_CONNECTIVES = new Set(['And', 'Or', 'Not', 'Implies', 'Equivalent']);
const MAX_BOOLEAN_ATOMS = 12;

/**
 * Prove a proposition from its Boolean skeleton alone. Atomic statements stay
 * opaque, so a positive result is sound for arithmetic, set membership, or any
 * future proposition type. This is the complete decision procedure for the
 * pointwise set-algebra identities produced by the set lowering pass.
 */
function booleanSkeletonTautology(expr) {
  if (!BOOLEAN_CONNECTIVES.has(expr.operator)) return null;
  const atoms = new Map();

  const collect = (node) => {
    if (node?.symbol === 'True' || node?.symbol === 'False') return;
    if (BOOLEAN_CONNECTIVES.has(node?.operator)) {
      node.ops.forEach(collect);
      return;
    }
    const key = JSON.stringify(node?.json);
    if (!atoms.has(key)) atoms.set(key, atoms.size);
  };
  collect(expr);
  if (atoms.size > MAX_BOOLEAN_ATOMS) return null;

  const evaluate = (node, assignment) => {
    if (node?.symbol === 'True') return true;
    if (node?.symbol === 'False') return false;
    const op = node?.operator;
    if (!BOOLEAN_CONNECTIVES.has(op)) return assignment[atoms.get(JSON.stringify(node?.json))];
    if (op === 'Not') return !evaluate(node.ops[0], assignment);
    if (op === 'And') return node.ops.every((operand) => evaluate(operand, assignment));
    if (op === 'Or') return node.ops.some((operand) => evaluate(operand, assignment));
    if (op === 'Implies') return !evaluate(node.ops[0], assignment)
      || evaluate(node.ops[1], assignment);
    if (op === 'Equivalent') return evaluate(node.ops[0], assignment)
      === evaluate(node.ops[1], assignment);
    return false;
  };

  const assignment = new Array(atoms.size).fill(false);
  for (let mask = 0; mask < 2 ** atoms.size; mask++) {
    for (let bit = 0; bit < atoms.size; bit++) assignment[bit] = Boolean(mask & (1 << bit));
    if (!evaluate(expr, assignment)) return null;
  }
  return true;
}

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
function buildSamplePool(ce, expr, complex, domain = null) {
  const values = [];
  const seen = new Set();
  const push = (latex) => {
    if (seen.has(latex)) return;
    seen.add(latex);
    values.push({ latex, expr: ce.parse(latex) });
  };

  // A variable declared over ℕ or ℤ must never be handed a fraction or a
  // surd. Every inductive step is false at n = ½ and true over the naturals,
  // so sampling the reals here does not merely fail to prove such a statement
  // — it disproves it, with a witness outside the domain the reader declared.
  const lowestInteger = { natural: 0, 'positive-integer': 1, integer: -6 }[domain];
  if (lowestInteger !== undefined) {
    for (let n = lowestInteger; n <= 12; n++) push(String(n));
    for (const b of ['100', '1000']) push(b);
    if (domain === 'integer') for (const b of ['-100', '-1000']) push(b);
    for (const lit of collectLiterals(expr.json)) {
      if (!Number.isFinite(lit) || Math.abs(lit) > 1e6) continue;
      for (const delta of [0, 1, -1]) {
        const v = lit + delta;
        if (Number.isInteger(v) && v >= lowestInteger) push(String(v));
      }
    }
    return values;
  }

  for (let n = -6; n <= 6; n++) push(String(n));
  for (const q of ['\\frac{1}{2}', '-\\frac{1}{2}', '\\frac{1}{3}', '-\\frac{2}{3}',
    '\\frac{3}{2}', '-\\frac{5}{2}', '\\frac{22}{7}', '\\frac{1}{10}', '-\\frac{1}{100}']) push(q);
  if (domain !== 'rational') {
    for (const r of ['\\sqrt{2}', '-\\sqrt{2}', '\\pi', '-\\pi', 'e', '\\frac{\\pi}{4}']) push(r);
  }
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

/** Exact truth evaluation after all free variables have been substituted. */
function truthOfConstantStatement(ce, expr) {
  const direct = truthOf(expr);
  if (direct !== null) return direct;

  const op = expr.operator;
  if (RELATIONS.has(op)) {
    if (expr.nops > 2 && op !== 'NotEqual') {
      for (let i = 0; i + 1 < expr.nops; i++) {
        const link = truthOfConstantStatement(ce, ce.box([op, expr.ops[i], expr.ops[i + 1]]));
        if (link !== true) return link;
      }
      return true;
    }
    const relation = normalizeRelation(ce, expr);
    if (!relation || relation.diff.unknowns.length > 0) return null;
    try {
      const value = relation.diff.evaluate();
      const zero = value.is(0);
      if (relation.kind === 'eq') return zero === true ? true : zero === false ? false : null;
      if (relation.kind === 'ne') return zero === true ? false : zero === false ? true : null;
      if (value.isPositive === true) return true;
      if (value.isNegative === true) return false;
      if (zero === true) return relation.kind === 'ge';
      return null;
    } catch {
      return null;
    }
  }

  const values = () => expr.ops.map((operand) => truthOfConstantStatement(ce, operand));
  if (op === 'Not' && expr.nops === 1) {
    const value = truthOfConstantStatement(ce, expr.ops[0]);
    return value === null ? null : !value;
  }
  if (op === 'And') {
    const results = values();
    return results.includes(false) ? false : results.every((value) => value === true) ? true : null;
  }
  if (op === 'Or') {
    const results = values();
    return results.includes(true) ? true : results.every((value) => value === false) ? false : null;
  }
  if (op === 'Implies' && expr.nops === 2) {
    const [left, right] = values();
    return left === false || right === true ? true
      : left === true && right === false ? false : null;
  }
  if (op === 'Equivalent' && expr.nops === 2) {
    const [left, right] = values();
    return left === null || right === null ? null : left === right;
  }
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

/** Find `powered = c * base^n` for a small positive integer n, exactly. */
function powerRelationship(ce, base, powered) {
  if (hasUnknownDenominator(base) || hasUnknownDenominator(powered)) return null;

  // Fast path for the overwhelmingly common explicit shape `c * q^n`. Match
  // q to ±base symbolically and read the remaining constant factors directly;
  // no probing is needed when the syntax itself is already a certificate.
  let outerSign = 1;
  let body = powered;
  if (body.operator === 'Negate') {
    outerSign = -1;
    body = body.ops[0];
  }
  const factors = body.operator === 'Multiply' ? body.ops : [body];
  const powerFactors = factors.filter((factor) => (
    factor.operator === 'Square'
    || (factor.operator === 'Power' && factor.nops === 2)
  ));
  if (powerFactors.length === 1) {
    const powerFactor = powerFactors[0];
    const exponent = powerFactor.operator === 'Square' ? 2 : powerFactor.ops[1]?.re;
    const inner = powerFactor.ops[0];
    const constants = factors.filter((factor) => factor !== powerFactor);
    if (Number.isInteger(exponent) && exponent >= 2 && exponent <= 8
      && constants.every((factor) => factor.unknowns.length === 0)) {
      let baseSign = 0;
      if (isZero(ce.box(['Subtract', inner, base]))) baseSign = 1;
      else if (isZero(ce.box(['Add', inner, base]))) baseSign = -1;

      if (baseSign !== 0) {
        try {
          const scale = constants.length === 0
            ? ce.box(outerSign)
            : ce.box(['Multiply', outerSign, ...constants]).evaluate();
          let scaleSign = scale.isPositive === true ? 1 : scale.isNegative === true ? -1 : null;
          if (scaleSign !== null) {
            if (baseSign < 0 && exponent % 2 !== 0) scaleSign *= -1;
            return { exponent, scaleSign };
          }
        } catch { /* use the verified fallback below */ }
      }
    }
  }

  const candidateExponents = new Set();
  const inspectFactor = (factor) => {
    if (factor.operator === 'Square') candidateExponents.add(2);
    if (factor.operator !== 'Power' || factor.nops !== 2) return;
    const exponent = factor.ops[1]?.re;
    if (Number.isInteger(exponent) && exponent >= 2 && exponent <= 8) {
      candidateExponents.add(exponent);
    }
  };
  if (powered.operator === 'Multiply') powered.ops.forEach(inspectFactor);
  else if (powered.operator === 'Negate') inspectFactor(powered.ops[0]);
  else inspectFactor(powered);

  for (const exponent of candidateExponents) {
    try {
      const power = ce.box(['Power', base, exponent]);
      // Compute Engine deliberately avoids cancelling symbolic powers in a
      // quotient because of domains. Guess the scale from values instead, then
      // accept it only after an exact residual check (the same sound pattern as
      // affineRelationship).
      const affine = affineRelationship(ce, power, powered);
      if (affine && signOf(affine.k) === 0) {
        const scaleSign = signOf(affine.c);
        if (scaleSign !== null && scaleSign !== 0) return { exponent, scaleSign };
      }

      const scale = ce.box(['Divide', powered, power]).simplify();
      if (scale.unknowns.length > 0) continue;
      const scaleSign = signOf(scale);
      if (scaleSign === null || scaleSign === 0) continue;
      const residual = ce.box(['Subtract', powered, ce.box(['Multiply', scale, power])]);
      if (isZero(residual)) return { exponent, scaleSign };
    } catch { /* try the next exponent */ }
  }
  return null;
}

/** Pointwise sign implications for `q = c*p^n`. */
function impliesThroughPower(antecedent, consequent, exponent, scaleSign, reverse = false) {
  const even = exponent % 2 === 0;

  if (!reverse) {
    switch (antecedent) {
      case 'eq': return consequent === 'eq' || consequent === 'ge';
      case 'ne':
        if (consequent === 'ne') return true;
        return even && scaleSign > 0 && (consequent === 'gt' || consequent === 'ge');
      case 'gt':
        if (consequent === 'ne') return true;
        return scaleSign > 0 && (consequent === 'gt' || consequent === 'ge');
      case 'ge': return scaleSign > 0 && consequent === 'ge';
      default: return false;
    }
  }

  // Here the antecedent is `c*p^n` and the consequent is `p`.
  switch (antecedent) {
    case 'eq': return consequent === 'eq' || consequent === 'ge';
    case 'ne': return consequent === 'ne';
    case 'gt':
      if (even && scaleSign < 0) return true; // impossible antecedent
      if (consequent === 'ne') return true;
      return !even && scaleSign > 0 && (consequent === 'gt' || consequent === 'ge');
    case 'ge':
      if (even && scaleSign < 0) return consequent === 'eq' || consequent === 'ge';
      return !even && scaleSign > 0 && consequent === 'ge';
    default: return false;
  }
}

/** If `product = factor * cofactor` syntactically, return the exact cofactor. */
function productCofactor(ce, factor, product) {
  let outerSign = 1;
  let body = product;
  if (body.operator === 'Negate') {
    outerSign = -1;
    body = body.ops[0];
  }
  const factors = body.operator === 'Multiply' ? body.ops : [body];
  for (let i = 0; i < factors.length; i++) {
    let matchedSign = 0;
    if (isZero(ce.box(['Subtract', factors[i], factor]))) matchedSign = 1;
    else if (isZero(ce.box(['Add', factors[i], factor]))) matchedSign = -1;
    if (matchedSign === 0) continue;
    const rest = factors.filter((_, index) => index !== i);
    const scale = outerSign * matchedSign;
    if (rest.length === 0) return ce.box(scale);
    return scale === 1 ? ce.box(['Multiply', ...rest]) : ce.box(['Multiply', scale, ...rest]);
  }
  return null;
}

/** Sign of a cofactor known to be everywhere nonzero, or null. */
function universalNonzeroSign(ce, cofactor) {
  if (cofactor.unknowns.length === 0) {
    try {
      const value = cofactor.evaluate();
      if (value.isPositive === true) return 1;
      if (value.isNegative === true) return -1;
    } catch { /* try structural proof below */ }
  }
  if (proveRelationBySign(ce, { kind: 'gt', diff: cofactor })) return 1;
  const negated = ce.box(['Negate', cofactor]);
  if (proveRelationBySign(ce, { kind: 'gt', diff: negated })) return -1;
  return null;
}

/**
 * Multiplication by a nonzero (or positive) factor preserves a relation.
 * Returns the factor and its sign, so the trace can name what it scaled by.
 */
function impliesThroughProduct(ce, antecedent, consequent) {
  if (antecedent.kind !== consequent.kind) return null;
  const cofactor = productCofactor(ce, antecedent.diff, consequent.diff);
  if (!cofactor) return null;
  const sign = universalNonzeroSign(ce, cofactor);
  if (sign === null) return null;
  if (antecedent.kind === 'eq' || antecedent.kind === 'ne') return { cofactor, sign };
  return sign > 0 ? { cofactor, sign } : null;
}

/**
 * Symbolic attempt at `A -> B`, both sides relations. Proves, in order:
 *   - the same relation on both sides;
 *   - an affine consequent, decided by sign (`x > 2` implies `x > 1`, since
 *     `(x - 1) = (x - 2) + 1` and the offset is non-negative);
 *   - an equation whose polynomial is a multiple of the antecedent's
 *     (`x = 2` implies `x^2 = 4`).
 */
function proveImplies(ce, left, right, scope, top = null) {
  const a = normalizeRelation(ce, left);
  const b = normalizeRelation(ce, right);
  if (!a || !b) return null;

  const conclude = concluding(scope, () => ce.box(['Implies', left, right]), top);

  if (a.kind === b.kind && isZero(ce.box(['Subtract', a.diff, b.diff]))) {
    return conclude('relation.normalize');
  }

  // Trivially true when the consequent holds for every value anyway...
  const always = proveRelationBySign(ce, b);
  if (always) {
    const consequent = concluding(scope, right, null)(always.rule, [], always.data);
    return conclude('logic.implies-intro', [consequent]);
  }
  // ...and vacuously true when the antecedent can never hold at all.
  const impossible = negateRelation(ce, a);
  if (impossible && proveRelationBySign(ce, impossible)) {
    return conclude('logic.vacuous');
  }

  const forwardPower = powerRelationship(ce, a.diff, b.diff);
  if (forwardPower && impliesThroughPower(
    a.kind, b.kind, forwardPower.exponent, forwardPower.scaleSign
  )) return conclude('order.power-monotonicity', [], { exponent: forwardPower.exponent });

  const reversePower = powerRelationship(ce, b.diff, a.diff);
  if (reversePower && impliesThroughPower(
    a.kind, b.kind, reversePower.exponent, reversePower.scaleSign, true
  )) return conclude('order.power-monotonicity', [], { exponent: reversePower.exponent });

  const product = impliesThroughProduct(ce, a, b) ?? impliesThroughProduct(ce, b, a);
  if (product) {
    return conclude(
      product.sign > 0 ? 'order.positive-scale' : 'relation.nonzero-scale',
      [],
      { scaleLatex: scope.show(product.cofactor) },
    );
  }

  const affine = affineRelationship(ce, a.diff, b.diff);
  if (affine && impliesUnderAffine(a.kind, b.kind, signOf(affine.c), signOf(affine.k))) {
    // A pure rescaling is positive scaling; an offset as well makes it the
    // more general affine step, and the trace should not conflate them.
    const rule = signOf(affine.k) === 0 ? 'order.positive-scale' : 'order.affine-monotonicity';
    return conclude(rule, [], {
      scaleLatex: scope.show(affine.c),
      offsetLatex: scope.show(affine.k),
    });
  }

  if (a.kind === 'eq' && b.kind === 'eq' && dividesExactly(ce, a.diff, b.diff)) {
    return conclude('polynomial.multiple');
  }

  // Nonlinear, one variable: turn the antecedent into a domain and certify the
  // consequent's sign on it. This is what reaches `x > 2 => x^2 > 3`.
  const onDomain = proveImplicationBySign(ce, a, b);
  if (onDomain) return conclude(onDomain.rule, [], onDomain.data);

  return null;
}

/**
 * Symbolic attempt at `A <-> B`. Equivalence is implication both ways, which
 * covers scaling (`x > 2 <-> 2x > 4`) and rearrangement (`x + 1 = 2 <-> x = 1`)
 * without special-casing either.
 */
function proveEquivalent(ce, left, right, scope, top = null) {
  const a = normalizeRelation(ce, left);
  const b = normalizeRelation(ce, right);
  if (!a || !b) return null;

  const conclude = concluding(scope, () => ce.box(['Equivalent', left, right]), top);

  const forward = proveImplies(ce, left, right, scope);
  if (forward !== null) {
    const backward = proveImplies(ce, right, left, scope);
    if (backward !== null) return conclude('logic.iff-intro', [forward, backward]);
  }

  // Fallback for relations the affine test cannot pin down: identical normal
  // forms, or a constant multiple of one another.
  const bothEquality = (a.kind === 'eq' && b.kind === 'eq') || (a.kind === 'ne' && b.kind === 'ne');
  const bothInequality = a.kind === b.kind && (a.kind === 'gt' || a.kind === 'ge');
  if (!bothEquality && !bothInequality) return null;

  if (isZero(ce.box(['Subtract', a.diff, b.diff]))) return conclude('relation.normalize');

  const ratio = constantRatio(ce, a.diff, b.diff);
  if (ratio === null) return null;
  // Scaling an equation by any nonzero constant preserves it; scaling an
  // inequality preserves it only when the constant is positive.
  if (bothEquality) return conclude('relation.nonzero-scale');
  return ratio > 0 ? conclude('order.positive-scale') : null;
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
    variable: variables[0],
    counterexample: verdict.witness
      ? [{ id: variables[0], valueLatex: rationalLatex(verdict.witness) }]
      : null,
  };
}

/**
 * Symbolic proof over a whole statement. Chains arrive as `And` of their links,
 * so proving every link proves the chain.
 */
function proveSymbolically(ce, expr, scope, top = null) {
  const op = expr.operator;
  const conclude = concluding(scope, expr, top);

  if (booleanSkeletonTautology(expr) === true) return conclude('logic.tautology');

  // Compute Engine represents homogeneous relation chains as one n-ary
  // relation (`Equal(a, b, c)`, `Less(a, b, c)`, ...), rather than the `And`
  // of binary links used for mixed inequality chains. A chain holds exactly
  // when every adjacent link holds, so prove those links individually. Do not
  // apply this to NotEqual: its n-ary meaning is pairwise distinct, which is
  // stronger than adjacent inequality alone.
  if (expr.nops > 2 && CHAIN_RELATIONS.has(op)) {
    const links = [];
    for (let index = 1; index < expr.nops; index += 1) {
      const link = proveSymbolically(ce, ce.box([op, expr.ops[index - 1], expr.ops[index]]), scope);
      if (link === null) return null;
      links.push(link);
    }
    return conclude('logic.chain', links);
  }

  // Complete for Boolean combinations of univariate rational-polynomial
  // relations. One shared sign chart is essential for conjunction-defined
  // intervals and complementary disjunctions.
  const variables = expr.unknowns;
  if (variables.length === 1) {
    const formula = polynomialFormula(ce, expr, variables[0]);
    if (formula && decideRationalPolynomialFormula(formula)?.value === true) {
      return conclude('polynomial.sturm-sign-chart', [], { variableLatex: variables[0] });
    }
  }

  if (op === 'And' && expr.nops > 0) {
    const parts = [];
    for (const operand of expr.ops) {
      const part = proveSymbolically(ce, operand, scope);
      if (part === null) return null;
      parts.push(part);
    }
    return conclude('logic.and-intro', parts);
  }
  if (op === 'Or' && expr.nops > 0) {
    for (const operand of expr.ops) {
      const part = proveSymbolically(ce, operand, scope);
      if (part !== null) return conclude('logic.or-intro', [part]);
    }
    return null;
  }
  if ((op === 'Equivalent' || op === 'IdenticallyEqual') && expr.nops === 2) {
    return proveEquivalent(ce, expr.ops[0], expr.ops[1], scope, top);
  }
  if (op === 'Implies' && expr.nops === 2) {
    const [left, right] = expr.ops;
    if (left.symbol === 'False') return conclude('logic.vacuous');
    if (right.symbol === 'True') return conclude('logic.implies-intro');
    if (left.symbol === 'True') {
      const inner = proveSymbolically(ce, right, scope);
      return inner === null ? null : conclude('logic.implies-intro', [inner]);
    }
    // A homogeneous relation chain is conjunction-shaped even though Compute
    // Engine stores it as one n-ary relation. Domain lowering commonly places
    // such a chain on either side of an implication, so expose its adjacent
    // links here just as we do for a literal `And` below.
    if (right.nops > 2 && CHAIN_RELATIONS.has(right.operator)) {
      const parts = [];
      for (let index = 1; index < right.nops; index += 1) {
        const link = ce.box([right.operator, right.ops[index - 1], right.ops[index]]);
        const part = proveSymbolically(ce, ce.box(['Implies', left, link]), scope);
        if (part === null) return null;
        parts.push(part);
      }
      return conclude('logic.chain', parts);
    }
    if (left.nops > 2 && CHAIN_RELATIONS.has(left.operator)) {
      for (let index = 1; index < left.nops; index += 1) {
        const link = ce.box([left.operator, left.ops[index - 1], left.ops[index]]);
        const part = proveSymbolically(ce, ce.box(['Implies', link, right]), scope);
        // One link of the assumed chain already suffices; the rest is surplus.
        if (part !== null) return conclude('logic.and-elim', [part]);
      }
    }
    if (left.operator === 'Or') {
      const cases = [];
      for (const operand of left.ops) {
        const part = proveSymbolically(ce, ce.box(['Implies', operand, right]), scope);
        if (part === null) return null;
        cases.push(part);
      }
      return conclude('logic.cases', cases);
    }
    if (right.operator === 'And') {
      const parts = [];
      for (const operand of right.ops) {
        const part = proveSymbolically(ce, ce.box(['Implies', left, operand]), scope);
        if (part === null) return null;
        parts.push(part);
      }
      return conclude('logic.and-intro', parts);
    }
    if (left.operator === 'And') {
      for (const operand of left.ops) {
        const part = proveSymbolically(ce, ce.box(['Implies', operand, right]), scope);
        if (part !== null) return conclude('logic.and-elim', [part]);
      }
    }
    if (right.operator === 'Or') {
      for (const operand of right.ops) {
        const part = proveSymbolically(ce, ce.box(['Implies', left, operand]), scope);
        if (part !== null) return conclude('logic.or-intro', [part]);
      }
    }
    return proveImplies(ce, left, right, scope, top);
  }
  // A bare relation carrying free variables: is it an identity?
  if (RELATIONS.has(op)) {
    const relation = normalizeRelation(ce, expr);
    if (!relation) return null;
    const certificate = proveRelationBySign(ce, relation);
    return certificate ? conclude(certificate.rule, [], certificate.data) : null;
  }
  return null;
}

const MAX_SAMPLES = 320;
const MIN_DECISIVE = 8;
const TIME_BUDGET_MS = 250;

/**
 * Sampling cannot establish an equivalence between equations over different
 * sets of free variables. Almost every random point makes both equations
 * false, which would otherwise produce a very convincing but spurious `true`.
 */
function hasMismatchedEquationVariables(expr) {
  if (!['Equivalent', 'IdenticallyEqual'].includes(expr.operator) || expr.nops !== 2) return false;
  const [left, right] = expr.ops;
  if (!['Equal', 'IdenticallyEqual'].includes(left.operator)
    || !['Equal', 'IdenticallyEqual'].includes(right.operator)) return false;
  const a = [...new Set(left.unknowns)].sort();
  const b = [...new Set(right.unknowns)].sort();
  return a.length !== b.length || a.some((id, index) => id !== b[index]);
}

/**
 * Proved, but the evidence could not be recorded.
 *
 * Trace construction must never be able to cost a row its verdict, so a step
 * that fails to build yields this instead of null. It counts as a proof
 * everywhere the value matters and poisons the fragment it belongs to, which
 * degrades the result to `opaque` while leaving `true` exactly where it was.
 */
const OPAQUE_STEP = Symbol('opaque step');

/**
 * One trace under construction, shared by every branch of a single decision.
 *
 * Provers hand back the id of the step that concludes what they proved, so a
 * composite rule can cite its premises directly and a claim established twice
 * is recorded once. `enabled` is false whenever the engine cannot vouch for
 * the displayed form — after domain lowering, for one — and the trace is then
 * built but discarded rather than describing a statement nobody wrote.
 */
function createScope(context) {
  const builder = createTraceBuilder();
  const scope = {
    builder,
    enabled: Boolean(context?.statementLatex),
    statementLatex: context?.statementLatex ?? '',
    wrap: context?.wrap ?? null,
    // A pass that ran before the decider and already settled the statement;
    // the trivial re-evaluation below must not take the credit for it.
    decidedBy: context?.decidedBy ?? null,
    expansionIds: [],
    latexOf(expr) {
      try {
        return context?.latexOf ? context.latexOf(expr) : (expr?.latex ?? '');
      } catch {
        return '';
      }
    },
    step(rule, premises, conclusionLatex, data = null) {
      if (!this.enabled || premises.includes(OPAQUE_STEP)) return OPAQUE_STEP;
      try {
        return builder.step(rule, { premises, conclusionLatex, data });
      } catch {
        return OPAQUE_STEP;
      }
    },
    /** Display LaTeX for a supporting detail, or nothing when unused. */
    show(expr) {
      return this.enabled ? this.latexOf(expr) : '';
    },
    /** The whole statement, established in one exact step. */
    certificate(rule, data = null) {
      return this.step(rule, this.expansionIds, this.statementLatex, data);
    },
  };

  // What the whole derivation rests on, stated before it starts: the
  // definitions it unfolds, and any obligation the engine discharged before
  // handing the statement over — that an integral is proper, for one.
  for (const premise of context?.premises ?? []) {
    const id = scope.step(premise.rule, [], premise.conclusionLatex, premise.data ?? null);
    if (id !== OPAQUE_STEP) scope.expansionIds.push(id);
  }
  return scope;
}

/**
 * A step concluding `expr`.
 *
 * `top` marks the outermost call of a decision: only there does the trace show
 * the line as the reader wrote it, and only there do the definition expansions
 * attach, since that is the claim resting on them.
 */
const concluding = (scope, expr, top) => (rule, premises = [], data = null) => {
  // Nothing is rendered for a discarded trace, so a failed branch never pays
  // to serialize a conclusion it will not show.
  if (!scope.enabled) return OPAQUE_STEP;
  const subject = typeof expr === 'function' ? expr() : expr;
  return scope.step(
    rule,
    [...premises, ...(top?.premises ?? [])],
    top?.latex ?? scope.latexOf(subject),
    data,
  );
};

/**
 * Close the trace at the winning branch's step, or report an exact opaque
 * verdict.
 *
 * A `wrap` is the rewrite the engine performed before handing the statement
 * over — stripping universal quantifiers, so far. The branch proves the body;
 * the wrapping step carries that back to the line the reader wrote, and so it
 * is the root rather than a premise.
 */
function sealed(scope, root) {
  if (root === null || root === OPAQUE_STEP || !scope.enabled) return OPAQUE_PROOF;
  const closed = scope.wrap
    ? scope.step(scope.wrap.rule, [root], scope.wrap.latex, scope.wrap.data ?? null)
    : root;
  if (closed === OPAQUE_STEP) return OPAQUE_PROOF;
  return provedBy(scope.builder.finish(closed));
}

/**
 * @returns {{value: boolean|null, method: string, samples: number,
 *   counterexample: Array|null, proof: object|null, proofStatus: string}}
 */
export function decideStatement(ce, expr, options = {}) {
  const complex = options.complex ?? false;
  const allowSampling = options.allowSampling !== false;
  const allowDirectEvaluation = options.allowDirectEvaluation !== false;
  const realSymbols = new Set(options.realSymbols ?? []);
  const domains = options.domains instanceof Map ? options.domains : new Map();
  const scope = createScope(options.proofContext ?? null);

  // 1a. Outright proof by the CAS.
  let evaluated;
  if (allowDirectEvaluation) {
    try {
      evaluated = expr.evaluate();
    } catch {
      evaluated = null;
    }
  } else {
    evaluated = null;
  }
  const direct = evaluated ? truthOf(evaluated) : null;
  if (direct !== null) {
    return {
      value: direct,
      method: 'proved',
      samples: 0,
      counterexample: null,
      // Only a true verdict carries a derivation for now; explaining a false
      // one is the counterexample's job until refutations are instrumented.
      // Where an earlier pass already decided the statement, this evaluation
      // is only reading back its answer, so the trace names that pass.
      ...(direct === true
        ? sealed(scope, scope.certificate(
          scope.decidedBy?.rule ?? 'engine.exact-evaluation',
          scope.decidedBy?.data ?? null,
        ))
        : OPAQUE_PROOF),
    };
  }

  // 1b. The complete exact decision, where it applies. Run before the partial
  // provers because it settles both directions, and a false verdict here must
  // not be left to the sampling pass to rediscover — it generally cannot.
  const exact = decideExactly(ce, expr);
  if (exact?.value === true) {
    return {
      value: true,
      method: 'proved',
      samples: 0,
      counterexample: null,
      ...sealed(scope, scope.certificate('polynomial.sturm-sign-chart', {
        variableLatex: exact.variable,
      })),
    };
  }
  // The sign chart decides over ℝ. True there carries to any subdomain, but
  // false does not: the point where `n^2 >= n` fails is 2/3, which is no
  // counterexample at all to a claim made about ℕ. Where a variable has been
  // narrowed, leave the false verdict to the sampler, whose pool is drawn from
  // the declared domain and whose witnesses therefore lie inside it.
  const narrowed = expr.unknowns.some((id) => NARROWED_DOMAINS.has(domains.get(id)));
  if (exact?.value === false && !narrowed) {
    return {
      value: false,
      method: exact.counterexample ? 'counterexample' : 'disproved',
      samples: 0,
      counterexample: exact.counterexample,
      ...OPAQUE_PROOF,
    };
  }

  // 1c. Relation-level reasoning over the connectives.
  // The complex fragment is decided by rewriting both sides to a common exact
  // normal form — conjugation, `Re`, and the cosine identities — so that is
  // what the trace reports, without claiming the finer structure it does not
  // return.
  if (proveComplexStatement(ce, expr, realSymbols) === true) {
    return {
      value: true,
      method: 'proved',
      samples: 0,
      counterexample: null,
      ...sealed(scope, scope.certificate('relation.normalize')),
    };
  }
  const symbolic = proveSymbolically(ce, expr, scope, {
    premises: scope.expansionIds,
    latex: scope.statementLatex,
  });
  if (symbolic !== null) {
    return {
      value: true,
      method: 'proved',
      samples: 0,
      counterexample: null,
      ...sealed(scope, symbolic),
    };
  }

  if (!allowSampling) {
    return { value: null, method: 'undecided', samples: 0, counterexample: null, ...NO_PROOF };
  }

  // 2. Numeric search for a counterexample.
  const unknowns = expr.unknowns;
  if (unknowns.length === 0) {
    try {
      // Numeric evaluation of a closed statement. Reported as proved, but no
      // trace will ever be offered for it: floating-point agreement is not an
      // exact certificate, and dressing it as one is the mistake to avoid.
      const n = truthOf(expr.N());
      if (n !== null) {
        return { value: n, method: 'proved', samples: 0, counterexample: null, ...NO_PROOF };
      }
    } catch { /* fall through to undecided */ }
    return { value: null, method: 'undecided', samples: 0, counterexample: null, ...NO_PROOF };
  }

  // Domain evidence is per variable. The presence of `i` elsewhere in a
  // statement may make unconstrained variables complex, but a variable bound
  // by `x in R` must never receive one of those complex candidates.
  const pools = unknowns.map((id) => {
    const domain = domains.get(id) ?? null;
    const allowComplex = complex && !realSymbols.has(id)
      && (domain === null || domain === 'complex');
    return buildSamplePool(ce, expr, allowComplex, domain);
  });
  const random = makeRandom(hashString(expr.toString() + unknowns.join(',')));
  const started = Date.now();
  let decisive = 0;

  const trial = (assignment) => {
    let substituted;
    try {
      substituted = expr.subs(assignment);
    } catch {
      return null;
    }

    // Evaluate the closed relation as a whole first. Compute Engine knows many
    // transcendental identities at concrete arguments, while subtracting the
    // two sides first can turn exact equality into a tiny floating residual
    // (`Re(e^(i/2)) - cos(1/2)` was about 8e-17) and invent a counterexample.
    let direct = null;
    try { direct = truthOf(substituted.evaluate()); } catch { /* use exact relation handling */ }
    if (direct === true) return true;

    const exact = truthOfConstantStatement(ce, substituted);
    if (exact !== null) return exact;
    return direct;
  };

  const describe = (indices) => unknowns.map((id, k) => ({
    id,
    valueLatex: pools[k][indices[k]].latex,
  }));

  if (unknowns.length === 1) {
    const id = unknowns[0];
    const pool = pools[0];
    const limit = Math.min(pool.length, MAX_SAMPLES);
    for (let k = 0; k < limit; k++) {
      if (k % 16 === 0 && Date.now() - started > TIME_BUDGET_MS) break;
      const verdict = trial({ [id]: pool[k].expr });
      if (verdict === false) {
        return {
          value: false,
          method: 'counterexample',
          samples: decisive,
          counterexample: describe([k]),
          ...NO_PROOF,
        };
      }
      if (verdict === true) decisive++;
    }
  } else {
    const indices = new Array(unknowns.length).fill(0);
    const maxPoolLength = Math.max(...pools.map((pool) => pool.length));
    const zeroIndices = pools.map((pool) => pool.findIndex((candidate) => candidate.latex === '0'));
    for (let k = 0; k < MAX_SAMPLES; k++) {
      if (k % 16 === 0 && Date.now() - started > TIME_BUDGET_MS) break;
      // Probe the true diagonal, then each coordinate axis. Axis probes matter
      // for equations where an extra variable is the only semantic difference.
      if (k < maxPoolLength) {
        for (let v = 0; v < unknowns.length; v++) {
          indices[v] = Math.min(k, pools[v].length - 1);
        }
      } else if (zeroIndices.every((index) => index >= 0)
        && k < maxPoolLength * (unknowns.length + 1)) {
        for (let v = 0; v < unknowns.length; v++) indices[v] = zeroIndices[v];
        const offset = k - maxPoolLength;
        const variable = Math.floor(offset / maxPoolLength);
        indices[variable] = Math.min(offset % maxPoolLength, pools[variable].length - 1);
      } else {
        for (let v = 0; v < unknowns.length; v++) {
          indices[v] = Math.floor(random() * pools[v].length);
        }
      }
      const assignment = {};
      unknowns.forEach((id, v) => { assignment[id] = pools[v][indices[v]].expr; });
      const verdict = trial(assignment);
      if (verdict === false) {
        return {
          value: false,
          method: 'counterexample',
          samples: decisive,
          counterexample: describe(indices),
          ...NO_PROOF,
        };
      }
      if (verdict === true) decisive++;
    }
  }

  if (decisive >= MIN_DECISIVE && !hasMismatchedEquationVariables(expr)) {
    return { value: true, method: 'sampled', samples: decisive, counterexample: null, ...NO_PROOF };
  }
  return { value: null, method: 'undecided', samples: decisive, counterexample: null, ...NO_PROOF };
}
