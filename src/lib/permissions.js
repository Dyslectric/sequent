/**
 * The permission set: which appeals a sheet is allowed to make.
 *
 * A proof is only interesting if it can be refused. `docs/proof-kernel.md`
 * asks for "a permission set of theorem ids, consulted by each branch before
 * it runs", generalising the two booleans that came before it —
 * `allowDirectEvaluation`, which withheld Compute Engine's verdict, and
 * `allowSampling`, which withheld the numeric search. Both are entries here
 * now, and neither is special.
 *
 * Three commitments shape this file.
 *
 * **An appeal is listed only where a branch actually consults it.** A toggle
 * that changes no verdict is a lie about what the proof rests on, and it is a
 * more comfortable lie than the one it replaces. `set.extensionality` and
 * `set.finite-enumeration` are registered rules that no prover currently
 * emits, so they are absent; `calculus.continuity` is an obligation the engine
 * discharges before the decision rather than a branch it chooses, and there is
 * no undecided for it to fall back to, so it is absent too. Each of those
 * belongs here the moment there is something to withhold.
 *
 * **Withholding is never disproof.** A branch that may not run reports
 * nothing, and the decision falls through to whatever else can settle the
 * line — ending at `undecided`, never at `false`. The kernel's invariant is
 * that turning a theorem off may only ever move a verdict toward undecided,
 * and `test/kernel.test.mjs` runs the whole catalogue against every appeal in
 * this list to keep it true.
 *
 * **Anything unlisted is permitted.** `logic.and-intro` is not an appeal, it
 * is an inference the kernel re-derives, and a permission set that could
 * withhold it would be a way of asking for smaller proofs rather than more
 * honest ones.
 */
import { ruleLabel, ruleRests } from './proof-trace.js';

/**
 * The numeric search, which is not a rule and never will be: sampling suggests
 * a truth and cannot establish one, so it appears in no trace. It is an appeal
 * all the same — a row that reads `sampled` rests on it entirely — and it is
 * the one the reader is most likely to want off.
 */
export const SAMPLING = 'search.numeric-sampling';

/**
 * Every appeal a sheet may be asked to do without, with what withholding it
 * costs. `title` names the thing believed rather than the branch that believes
 * it, which is why most of them read it off the rule registry: the sidebar
 * should say "Sturm's theorem", not "Sturm sign chart".
 */
const APPEALS = [
  {
    id: 'engine.exact-evaluation',
    title: "Compute Engine's exact evaluation",
    cost: 'Everything only the CAS can settle: the transcendental identities, the closed forms, the limits.',
  },
  {
    id: 'polynomial.sturm-sign-chart',
    cost: 'Real-root reasoning about polynomials, which is most of the inequality fragment.',
  },
  {
    id: 'polynomial.discriminant',
    cost: 'Quadratics shown to keep their sign because they never cross zero.',
  },
  {
    id: 'polynomial.domain-sign',
    cost: 'Consequents certified on the domain their antecedent confines them to.',
  },
  {
    id: 'set.domain-closure',
    cost: 'Witnesses built from the quantified variable, and with them the epsilon-N idiom over the naturals.',
  },
  {
    id: 'algebra.finite-exhaustion',
    cost: 'The finite groups, rings, fields, modules, categories and functors.',
  },
  {
    id: 'topology.constructor-certificate',
    cost: 'The topology axioms, verified against a constructed family.',
  },
  {
    id: 'analysis.epsilon-delta-witness',
    cost: 'Continuity and limits at a point, where the reader supplies the witness.',
  },
  {
    id: 'analysis.induction',
    cost: 'Claims about every natural number carried from a base case by a step.',
  },
  {
    id: SAMPLING,
    title: 'numeric sampling',
    kind: 'search',
    cost: 'Every verdict that rests on evidence rather than proof, and the counterexamples the search finds.',
  },
];

/** The catalogue, with the registry's own words filled in. */
export const APPEAL_LIST = Object.freeze(APPEALS.map((appeal) => Object.freeze({
  kind: ruleRests(appeal.id).kind,
  title: ruleRests(appeal.id).theorem ?? ruleLabel(appeal.id),
  ...appeal,
})));

export const APPEAL_IDS = Object.freeze(APPEAL_LIST.map((appeal) => appeal.id));

/** The catalogue entry for an id, or `undefined` for anything unlisted. */
export function appeal(id) {
  return APPEAL_LIST.find((entry) => entry.id === id);
}

/**
 * A permission set from `{ id: false }`, where absent means permitted.
 *
 * Passing one straight back through is deliberate: the sheet builds its set
 * once and hands the same object to every branch, and a branch that receives
 * one should not have to know whether it was already made.
 */
export function createPermissions(spec = null) {
  if (spec && typeof spec.allows === 'function') return spec;
  const withheld = new Set();
  for (const [id, allowed] of Object.entries(spec ?? {})) {
    if (allowed === false) withheld.add(id);
  }
  return Object.freeze({
    allows: (id) => !withheld.has(id),
    withheld: Object.freeze([...withheld]),
    full: withheld.size === 0,
  });
}

/** Everything permitted, which is what every gate runs against. */
export const FULL_PERMISSIONS = createPermissions();
