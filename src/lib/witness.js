/**
 * Witnesses for existential statements, found by looking rather than by
 * reasoning.
 *
 * `logic.exists-intro` has had a checker since the kernel's phase one and no
 * prover behind it, so `\exists x\in\mathbb{R}, x^2=4` was undecided while
 * `w:=2` sitting on the line above proved `w^2=4` perfectly well. The reader
 * could see the witness; the application could not use it. This is the search
 * that closes that gap.
 *
 * **It only ever answers `true`.** A search that finds nothing has found
 * nothing — the witness may be outside the candidates, or outside anything
 * this file could enumerate — so failure returns null and the row stays
 * undecided. Reporting `false` would be claiming a completeness the search
 * does not have.
 *
 * **A candidate is accepted only when exact evaluation settles both
 * obligations.** The body at the witness and the witness's membership in the
 * domain each have to come back `True` from Compute Engine directly, with no
 * heavier prover involved. That restraint is what lets the trace name
 * `engine.exact-evaluation` as the premises' rule and mean it — and the
 * kernel's ground checker then re-does the arithmetic on whichever of them it
 * can read.
 *
 * The order candidates are tried in is the one thing here aimed at the reader
 * rather than at the prover. A name the reader defined is tried first, so a
 * sheet that says `w:=2` and then `\exists x\in\mathbb{R}, x^2=4` cites `w`
 * rather than some number the search happened to reach first.
 */

import {
  PRIME_SETS,
  isPrimeLiteral,
  materializeFiniteSet,
  primeMembershipCertificate,
  radicalMembershipCertificate,
} from './sets.js';

/** Enough to reach the witnesses a reader would think of, and no further. */
const MAX_CANDIDATES = 96;
const SEARCH_BOUND = 12;

function truthOf(expr) {
  try {
    const value = expr.evaluate();
    if (value.symbol === 'True') return true;
    if (value.symbol === 'False') return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * The reader's own named constants.
 *
 * A definition whose body is a proposition is a named lemma rather than a
 * value, and a set is not a witness either; both are skipped.
 */
function namedConstants(definitions) {
  const out = [];
  for (const definition of definitions.values()) {
    if (definition?.kind !== 'constant' || definition.proposition) continue;
    if (definition.valueExpr) out.push(definition.valueExpr);
  }
  return out;
}

/**
 * Small numbers, in the order someone would try them.
 *
 * Zero and one first, then out from the origin in both directions, then the
 * halves and thirds — a rational witness is common enough to be worth the
 * handful of extra candidates, and rare enough not to be worth more.
 */
function smallNumbers(ce) {
  const out = [ce.box(0), ce.box(1), ce.box(-1)];
  for (let n = 2; n <= SEARCH_BOUND; n += 1) {
    out.push(ce.box(n));
    out.push(ce.box(-n));
  }
  for (const [numerator, denominator] of [[1, 2], [-1, 2], [1, 3], [-1, 3], [3, 2], [-3, 2]]) {
    out.push(ce.box(['Rational', numerator, denominator]));
  }
  return out;
}

/** Everything worth trying, the reader's own names first. */
function candidates(ce, domainExpr, definitions) {
  const found = [...namedConstants(definitions)];
  const finite = materializeFiniteSet(ce, domainExpr, definitions);
  if (finite && finite.symbol !== 'EmptySet') found.push(...finite.ops);
  found.push(...smallNumbers(ce));
  return found.slice(0, MAX_CANDIDATES);
}

/**
 * A witness for `\exists x \in D, P(x)`, or null.
 *
 * Returns the two obligations alongside it, already established, because the
 * kernel checks this rule by re-substituting: it wants a premise proving the
 * body at the witness and a premise placing the witness in the domain, and a
 * step that cited neither would be admitted rather than verified.
 */
export function existentialWitness(ce, expr, definitions = new Map()) {
  if (expr?.operator !== 'Exists' || expr.nops !== 2) return null;
  const [binding, body] = expr.ops;
  if (binding?.operator !== 'Element' || binding.nops !== 2) return null;
  const variable = binding.ops[0]?.symbol;
  const domainExpr = binding.ops[1];
  if (!variable || !domainExpr || !body) return null;

  for (const candidate of candidates(ce, domainExpr, definitions)) {
    let member;
    let specialized;
    try {
      member = ce.box(['Element', candidate, domainExpr]);
      specialized = body.subs({ [variable]: candidate });
    } catch {
      continue;
    }
    // Membership first: it is the cheaper of the two and rules out most of
    // the search — no negative number survives `\mathbb{N}`.
    const membership = settlesMembership(member, domainExpr, candidate);
    if (!membership) continue;
    if (truthOf(specialized) !== true) continue;
    return {
      witnessExpr: candidate,
      memberExpr: member,
      membership,
      bodyExpr: specialized,
    };
  }
  return null;
}

/**
 * That the witness is in the domain, and which rule says so.
 *
 * The premise has to cite what actually settled it. `\mathbb{P}` is decided by
 * this application rather than by Compute Engine, so a prime witness carries
 * its Pratt certificate and the kernel checks that; labelling it exact
 * evaluation would be claiming the CAS did work it cannot do.
 */
function settlesMembership(member, domainExpr, candidate) {
  if (domainExpr?.symbol && PRIME_SETS.has(domainExpr.symbol)) {
    if (isPrimeLiteral(candidate) !== true) return null;
    const certificate = primeMembershipCertificate(member);
    return certificate ? { rule: certificate.rule, data: certificate.data } : null;
  }
  if (truthOf(member) !== true) return null;
  const certificate = radicalMembershipCertificate(member);
  return certificate
    ? { rule: certificate.rule, data: certificate.data }
    : { rule: 'engine.exact-evaluation', data: null };
}
