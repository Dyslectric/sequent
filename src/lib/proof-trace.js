/**
 * Proof traces: the record of *why* a proved row is true.
 *
 * A verdict of `true` says nothing about how it was reached. Sequent decides
 * some statements by an exact sign chart, some by unfolding a definition and
 * scaling an inequality, and some by handing the whole thing to Compute
 * Engine. Those are not the same kind of evidence, and a reader who wants to
 * follow the reasoning deserves to be told which one actually ran.
 *
 * The constraint that shapes this module is soundness. A trace is evidence
 * emitted *by the branch that succeeded*, at the moment it succeeds. Nothing
 * here reconstructs a derivation from a finished `method: 'proved'` result,
 * because a plausible-looking reconstruction is exactly the failure mode worth
 * ruling out: it would show a rule that never ran. So a prover either builds
 * its trace as it works, or it reports `proofStatus: 'opaque'` and shows
 * nothing. Sampling, which can suggest a truth but never establish one, is
 * always `unavailable`.
 *
 * A trace is a directed acyclic graph rather than nested prose, so that two
 * steps can cite one premise without duplicating it, and so that a checker
 * could later verify a trace independently. Today the application still trusts
 * the prover that emitted the trace: this is a proof *explanation*, not a
 * machine-checked proof object.
 */

/** Bumped only for a breaking change to the step shape; traces may be shared. */
export const PROOF_VERSION = 1;

/**
 * Traces are for reading, so they are bounded rather than complete. A finite
 * exhaustion over 10^4 assignments is one summarized certificate step, never
 * 10^4 display nodes.
 */
export const MAX_STEPS = 128;
export const MAX_DEPTH = 32;

/**
 * Every rule a trace may cite. Three categories, deliberately kept apart:
 *
 * - `inference` manipulates propositions (assumption, implication introduction);
 * - `rewrite` justifies an equivalent or order-preserving transformation;
 * - `certificate` establishes a claim by an exact algorithm.
 *
 * A finite search is a certificate and exact simplification is normalization;
 * neither is a rule of inference, and labelling them so would misdescribe what
 * the prover did. Add an entry only when a concrete prover branch emits it.
 *
 * IDs are the stable contract. Labels and explanations are display copy and
 * may be reworded freely — tests assert IDs and graph shape, never prose.
 */
const RULES = {
  'logic.assumption': {
    category: 'inference',
    label: 'assumption',
    explanation: 'Supposed for the sake of the argument, to be discharged later.',
  },
  'logic.implies-intro': {
    category: 'inference',
    label: 'implication introduction',
    symbol: '⊢',
    explanation: 'The consequent was derived from the assumption, which is now discharged.',
  },
  'logic.implies-elim': {
    category: 'inference',
    label: 'modus ponens',
    explanation: 'The implication and its antecedent both hold, so the consequent does.',
  },
  'logic.and-intro': {
    category: 'inference',
    label: 'conjunction introduction',
    symbol: '∧',
    explanation: 'Both conjuncts were established separately.',
  },
  'logic.and-elim': {
    category: 'inference',
    label: 'conjunction elimination',
    explanation: 'One conjunct of an established conjunction.',
  },
  'logic.or-intro': {
    category: 'inference',
    label: 'disjunction introduction',
    symbol: '∨',
    explanation: 'One disjunct holds, so the disjunction does.',
  },
  'logic.cases': {
    category: 'inference',
    label: 'proof by cases',
    explanation: 'The cases are exhaustive and the conclusion follows in each.',
  },
  'logic.iff-intro': {
    category: 'inference',
    label: 'equivalence introduction',
    symbol: '⟺',
    explanation: 'Both directions of the implication were established.',
  },
  'logic.chain': {
    category: 'inference',
    label: 'transitive chain',
    explanation: 'Adjacent relations compose, so the endpoints are related.',
  },
  'logic.universal-generalization': {
    category: 'inference',
    label: 'universal generalization',
    symbol: '∀',
    explanation: 'The body was proved for an arbitrary element of the domain, so it holds for every element.',
  },
  // The reader's own witness, made into a proof: `data.witnessLatex` names the
  // term, one premise proves the body at it, and another places it in the
  // domain. The kernel checks all three; see `kernel.js`.
  'logic.exists-intro': {
    category: 'inference',
    label: 'existential introduction',
    symbol: '∃',
    explanation: 'A witness was named and the claim was proved of it, so something satisfies the claim.',
  },
  'logic.tautology': {
    category: 'certificate',
    label: 'propositional tautology',
    explanation: 'True under every assignment to its atoms, whatever they mean.',
  },
  'logic.vacuous': {
    category: 'inference',
    label: 'vacuously true',
    explanation: 'The premise never holds, so the implication holds without saying anything.',
  },
  'definition.unfold': {
    category: 'rewrite',
    label: 'unfold definition',
    explanation: 'A defined name replaced by the expression it stands for.',
  },
  'relation.normalize': {
    category: 'rewrite',
    label: 'exact normalization',
    explanation: 'Both sides reduced to a common exact normal form.',
  },
  'order.positive-scale': {
    category: 'rewrite',
    label: 'positive scaling',
    explanation: 'Multiplying by a positive quantity preserves the direction of an inequality.',
  },
  'order.affine-monotonicity': {
    category: 'rewrite',
    label: 'affine monotonicity',
    explanation: 'An affine map with positive slope is increasing, so the bound carries over.',
  },
  'order.power-monotonicity': {
    category: 'rewrite',
    label: 'power monotonicity',
    explanation: 'One side is a fixed power of the other, which transfers the sign.',
  },
  'relation.nonzero-scale': {
    category: 'rewrite',
    label: 'scaling by a nonzero factor',
    explanation: 'Multiplying an equation by a factor that is never zero preserves it.',
  },
  'polynomial.identity': {
    category: 'certificate',
    label: 'polynomial identity',
    explanation: 'The difference of the two sides expands to the zero polynomial.',
  },
  'polynomial.sturm-sign-chart': {
    category: 'certificate',
    label: 'Sturm sign chart',
    explanation: 'The exact real roots partition the line, and the sign is constant between them.',
  },
  'polynomial.even-power': {
    category: 'certificate',
    label: 'even powers are non-negative',
    explanation: 'Every term is an even power or an absolute value, so the sum cannot be negative.',
  },
  'polynomial.discriminant': {
    category: 'certificate',
    label: 'negative discriminant',
    explanation: 'A quadratic with no real root never crosses zero, so it keeps its leading sign.',
  },
  // The domain provers share one entry: `holdsOnDomain` certifies the sign on
  // a point, a half-line, or a punctured line by different means — a Taylor
  // shift, substitution — and reports which domain it used but not which
  // technique. `data.domain` carries what is actually known.
  'polynomial.domain-sign': {
    category: 'certificate',
    label: 'sign on the assumed domain',
    explanation: 'The premise confines the variable to a domain, and the conclusion keeps its sign throughout.',
  },
  'polynomial.multiple': {
    category: 'certificate',
    label: 'polynomial multiple',
    explanation: "The consequent's polynomial is an exact multiple of the antecedent's.",
  },
  'quadratic.psd': {
    category: 'certificate',
    label: 'positive semidefinite form',
    explanation: 'The quadratic form has no negative direction, so it is non-negative everywhere.',
  },
  'set.extensionality': {
    category: 'rewrite',
    label: 'set extensionality',
    explanation: 'Two sets are equal exactly when they have the same members.',
  },
  'set.finite-enumeration': {
    category: 'certificate',
    label: 'finite enumeration',
    explanation: 'The domain is finite and every member was checked.',
  },
  'analysis.induction': {
    category: 'certificate',
    label: 'induction certificate',
    explanation: 'The base case holds and the step carries it to every successor.',
  },
  'calculus.continuity': {
    category: 'certificate',
    label: 'proper on the interval',
    explanation: 'The limits are finite and the integrand has no singularity between them.',
  },
  'analysis.epsilon-delta-witness': {
    category: 'certificate',
    label: 'epsilon-delta witness',
    explanation: 'An explicit witness was produced and verified for every epsilon.',
  },
  'topology.constructor-certificate': {
    category: 'certificate',
    label: 'topology constructor certificate',
    explanation: 'The topology axioms were verified against the constructed family.',
  },
  'algebra.finite-exhaustion': {
    category: 'certificate',
    label: 'finite exhaustive verification',
    explanation: 'Every assignment over the finite carrier was checked.',
  },
  'group.free-reduction': {
    category: 'certificate',
    label: 'free-group reduction',
    explanation: 'Both words reduce to the same freely reduced normal form.',
  },
  // `data.radicandLatex` and `data.indexLatex` name the test, and
  // `data.rootLatex` carries the exact root where there is one. The kernel
  // re-runs the search rather than believing either; see `kernel.js`.
  'arithmetic.integer-root': {
    category: 'certificate',
    label: 'integer root test',
    explanation: 'A root of a non-negative integer is rational only when the radicand is an exact power of the index.',
  },
  // `data.prattLatex` is a Pratt certificate: for each prime in the tree, a
  // primitive root and the complete factorisation of that prime minus one.
  // `data.factorLatex` is the other direction — a proper divisor, which is all
  // a composite needs. The kernel re-runs the modular arithmetic itself.
  'arithmetic.primality': {
    category: 'certificate',
    label: 'primality certificate',
    explanation: 'A primitive root and the factorisation of p−1 witness that p is prime; a proper divisor witnesses that it is not.',
  },
  'engine.exact-evaluation': {
    category: 'certificate',
    label: 'exact evaluation',
    explanation: 'Compute Engine reduced the statement to a truth value exactly.',
  },
};

Object.freeze(RULES);
for (const entry of Object.values(RULES)) Object.freeze(entry);

/** Every registered rule ID, for tests and for the UI legend. */
export const RULE_IDS = Object.freeze(Object.keys(RULES));

/** The registry entry for a rule, or `undefined` for an unregistered ID. */
export function rule(id) {
  return RULES[id];
}

export function isRule(id) {
  return Object.hasOwn(RULES, id);
}

/** Display copy for a rule. Unknown IDs fall back to the raw ID, never to a guess. */
export function ruleLabel(id) {
  return RULES[id]?.label ?? id;
}

export function ruleCategory(id) {
  return RULES[id]?.category ?? null;
}

/**
 * The three proof states a result may be in. `opaque` is the honest answer for
 * an exact branch that has not been instrumented yet: the verdict is exact,
 * but this code cannot yet say how it was reached. It is not a licence to
 * invent a rule.
 */
export const PROOF_STATUSES = Object.freeze(['available', 'opaque', 'unavailable']);

/** An exact verdict whose branch does not build evidence yet. */
export const OPAQUE_PROOF = Object.freeze({ proof: null, proofStatus: 'opaque' });

/** Sampled, refuted by search, or undecided: there is no proof to show. */
export const NO_PROOF = Object.freeze({ proof: null, proofStatus: 'unavailable' });

/**
 * Result fields for a branch that built a trace. A trace that failed to build
 * or validate degrades to `opaque` rather than discarding the verdict: proof
 * display must never turn a proved row into an error.
 */
export function provedBy(trace) {
  if (!trace || validateTrace(trace).length) return OPAQUE_PROOF;
  return { proof: trace, proofStatus: 'available' };
}

const stepKey = (ruleId, premises, conclusionLatex, data) => JSON.stringify([
  ruleId, premises, conclusionLatex, data ?? null,
]);

/**
 * Accumulates steps and hands back stable IDs within one result.
 *
 * Structurally identical steps are interned rather than repeated, which is
 * what deduplicates a premise cited by several later steps — the graph keeps
 * one node and two edges instead of two copies of the same claim.
 */
class TraceBuilder {
  constructor() {
    this.steps = [];
    this.byId = new Map();
    this.byKey = new Map();
    this.counter = 0;
  }

  /**
   * Record one step and return its ID.
   * @param {string} ruleId a registered rule
   * @param {{premises?: string[], conclusionLatex?: string, data?: object}} [detail]
   */
  step(ruleId, detail = {}) {
    if (!isRule(ruleId)) throw new Error(`unregistered proof rule: ${ruleId}`);
    const premises = [...(detail.premises ?? [])];
    for (const premise of premises) {
      if (!this.byId.has(premise)) throw new Error(`unknown premise: ${premise}`);
    }
    const conclusionLatex = detail.conclusionLatex ?? '';
    const data = detail.data ?? null;

    const key = stepKey(ruleId, premises, conclusionLatex, data);
    const existing = this.byKey.get(key);
    if (existing) return existing;

    this.counter += 1;
    const id = `s${this.counter}`;
    const step = data === null
      ? { id, rule: ruleId, premises, conclusionLatex }
      : { id, rule: ruleId, premises, conclusionLatex, data };
    this.steps.push(step);
    this.byId.set(id, step);
    this.byKey.set(key, id);
    return id;
  }

  /**
   * Copy a fragment built elsewhere into this builder, renumbering its steps,
   * and return the ID its root now has. This is how a composite rule attaches
   * the evidence its premises returned.
   */
  adopt(fragment) {
    if (!fragment?.root || !Array.isArray(fragment.steps)) return null;
    const source = new Map(fragment.steps.map((step) => [step.id, step]));
    const mapped = new Map();

    const copy = (sourceId, seen = new Set()) => {
      if (mapped.has(sourceId)) return mapped.get(sourceId);
      if (seen.has(sourceId)) throw new Error(`cyclic fragment at ${sourceId}`);
      const step = source.get(sourceId);
      if (!step) throw new Error(`fragment premise missing: ${sourceId}`);
      seen.add(sourceId);
      const premises = (step.premises ?? []).map((premise) => copy(premise, seen));
      seen.delete(sourceId);
      const id = this.step(step.rule, {
        premises,
        conclusionLatex: step.conclusionLatex,
        data: step.data,
      });
      mapped.set(sourceId, id);
      return id;
    };

    return copy(fragment.root);
  }

  /**
   * Close the graph at `root`, keeping only what that root depends on.
   *
   * Steps come out in dependency order, so a renderer can number them as it
   * walks the list. Returns `null` if the result would not validate, which
   * callers report as `opaque` rather than as a failure.
   */
  finish(root) {
    if (!this.byId.has(root)) return null;

    const kept = [];
    const seen = new Set();
    const visit = (id, path = new Set()) => {
      if (seen.has(id)) return;
      if (path.has(id)) throw new Error(`cycle through ${id}`);
      path.add(id);
      const step = this.byId.get(id);
      for (const premise of step.premises) visit(premise, path);
      path.delete(id);
      seen.add(id);
      kept.push(step);
    };

    let trace;
    try {
      visit(root);
      trace = { version: PROOF_VERSION, root, steps: kept.map((step) => ({ ...step })) };
    } catch {
      return null;
    }

    if (kept.length > MAX_STEPS || traceDepth(trace) > MAX_DEPTH) trace = summarize(trace);
    return validateTrace(trace).length ? null : trace;
  }
}

export function createTraceBuilder() {
  return new TraceBuilder();
}

/**
 * The whole trace for a branch whose evidence is a single certificate — the
 * common shape for an exact decision procedure that either works or does not.
 */
export function singleStep(ruleId, conclusionLatex, data = null) {
  const builder = createTraceBuilder();
  return builder.finish(builder.step(ruleId, { conclusionLatex, data }));
}

/** Longest premise chain below the root; a lone step has depth 1. */
export function traceDepth(trace) {
  const byId = new Map(trace.steps.map((step) => [step.id, step]));
  const memo = new Map();
  const depth = (id, path = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (path.has(id)) return Infinity;
    const step = byId.get(id);
    if (!step) return 0;
    path.add(id);
    // Tolerates a malformed step: validation reports the missing premise list
    // as an error, and must not crash on the way there.
    const below = (step.premises ?? []).map((premise) => depth(premise, path));
    path.delete(id);
    const value = 1 + Math.max(0, ...below);
    memo.set(id, value);
    return value;
  };
  return depth(trace.root);
}

/**
 * Replace an oversized derivation with its conclusion alone.
 *
 * The root's own rule is preserved, because that rule is what actually
 * finished the proof; only the sub-derivation is dropped, and the count of
 * what was dropped is recorded so the UI can say so plainly.
 */
export function summarize(trace) {
  const root = trace.steps.find((step) => step.id === trace.root);
  if (!root) return trace;
  return {
    version: PROOF_VERSION,
    root: trace.root,
    steps: [{
      id: root.id,
      rule: root.rule,
      premises: [],
      conclusionLatex: root.conclusionLatex,
      data: { ...(root.data ?? {}), omittedSteps: trace.steps.length - 1 },
    }],
  };
}

export function isSummarized(step) {
  return Number.isFinite(step?.data?.omittedSteps) && step.data.omittedSteps > 0;
}

/**
 * Structural validation. Returns a list of problems; empty means valid.
 *
 * This is a shape check, not a proof check — it cannot tell whether a step
 * follows from its premises, only that the graph is well formed, bounded, and
 * cites rules that exist.
 */
export function validateTrace(trace) {
  const errors = [];
  if (!trace || typeof trace !== 'object') return ['trace is not an object'];
  if (trace.version !== PROOF_VERSION) errors.push(`unsupported version ${trace.version}`);
  if (!Array.isArray(trace.steps) || trace.steps.length === 0) {
    return [...errors, 'trace has no steps'];
  }
  if (trace.steps.length > MAX_STEPS) errors.push(`trace exceeds ${MAX_STEPS} steps`);

  const byId = new Map();
  for (const step of trace.steps) {
    if (!step || typeof step.id !== 'string' || !step.id) {
      errors.push('step is missing an id');
      continue;
    }
    if (byId.has(step.id)) errors.push(`duplicate step id ${step.id}`);
    if (!isRule(step.rule)) errors.push(`unregistered rule ${step.rule} at ${step.id}`);
    if (typeof step.conclusionLatex !== 'string') errors.push(`${step.id} has no conclusion`);
    if (!Array.isArray(step.premises)) errors.push(`${step.id} has no premise list`);
    byId.set(step.id, step);
  }

  for (const step of byId.values()) {
    for (const premise of step.premises ?? []) {
      if (!byId.has(premise)) errors.push(`${step.id} cites missing premise ${premise}`);
    }
  }

  if (typeof trace.root !== 'string' || !byId.has(trace.root)) {
    errors.push('trace has no root step');
    return errors;
  }

  // Cycles first: the depth walk cannot terminate meaningfully without it.
  const state = new Map();
  const walk = (id) => {
    const mark = state.get(id);
    if (mark === 'done') return false;
    if (mark === 'open') return true;
    state.set(id, 'open');
    for (const premise of byId.get(id)?.premises ?? []) {
      if (walk(premise)) return true;
    }
    state.set(id, 'done');
    return false;
  };
  for (const id of byId.keys()) {
    if (walk(id)) {
      errors.push(`trace has a cycle through ${id}`);
      return errors;
    }
  }

  if (traceDepth(trace) > MAX_DEPTH) errors.push(`trace exceeds depth ${MAX_DEPTH}`);
  return errors;
}

export function isValidTrace(trace) {
  return validateTrace(trace).length === 0;
}

const INTERNAL_ID = /\bId\d+\b/;

const restoreValue = (key, value, registry) => {
  if (Array.isArray(value)) return value.map((item) => restoreValue(key, item, registry));
  if (typeof value !== 'string') return value;
  if (/Latex$/.test(key) || key === 'latex') return registry.toDisplayLatex(value);
  if (/Name$/.test(key) || key === 'name') return registry.toDisplayName(value);
  return value;
};

/**
 * Rewrite a trace into the names the reader actually typed.
 *
 * Internal identifiers (`Id7`) are an implementation detail of lowering, and a
 * trace that showed them would be unreadable rather than merely ugly. Applied
 * once at the engine boundary, where the registry is in scope.
 */
export function restoreIdentifiers(trace, registry) {
  if (!trace || !registry) return trace;
  return {
    ...trace,
    steps: trace.steps.map((step) => {
      const restored = {
        ...step,
        conclusionLatex: registry.toDisplayLatex(step.conclusionLatex),
      };
      if (step.data) {
        restored.data = Object.fromEntries(Object.entries(step.data)
          .map(([key, value]) => [key, restoreValue(key, value, registry)]));
      }
      return restored;
    }),
  };
}

/** Guards the invariant that internal identifiers never reach the reader. */
export function containsInternalIdentifiers(trace) {
  if (!trace) return false;
  return trace.steps.some((step) => INTERNAL_ID.test(step.conclusionLatex)
    || (step.data ? INTERNAL_ID.test(JSON.stringify(step.data)) : false));
}
