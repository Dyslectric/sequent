/**
 * Proof-trace schema checks. Run with `npm test`.
 *
 * What is under test is the graph, never the English. Rule IDs, premise
 * references, the root, and the bounds are the contract; labels are display
 * copy and may be reworded without touching this file.
 */
import {
  MAX_DEPTH,
  MAX_STEPS,
  NO_PROOF,
  OPAQUE_PROOF,
  PROOF_STATUSES,
  PROOF_VERSION,
  RULE_IDS,
  containsInternalIdentifiers,
  createTraceBuilder,
  isRule,
  isSummarized,
  isValidTrace,
  provedBy,
  restoreIdentifiers,
  rule,
  ruleLabel,
  singleStep,
  traceDepth,
  validateTrace,
} from '../src/lib/proof-trace.js';
import { IdentifierRegistry } from '../src/lib/identifiers.js';
import { Sheet } from '../src/lib/engine.js';
import { DEMOS } from '../src/lib/demos.js';

let passed = 0;
const failures = [];

function check(label, run) {
  let problem;
  try {
    problem = run();
  } catch (error) {
    problem = `threw: ${error.message}`;
  }
  if (problem) failures.push(`${label}\n    ${problem}`);
  else passed++;
}

const threw = (run) => {
  try {
    run();
    return false;
  } catch {
    return true;
  }
};

console.log('== the rule registry ==');

check('rule ids are unique and every entry carries complete copy', () => {
  if (new Set(RULE_IDS).size !== RULE_IDS.length) return 'duplicate rule ids';
  const categories = new Set(['inference', 'rewrite', 'certificate']);
  for (const id of RULE_IDS) {
    const entry = rule(id);
    if (!entry?.label) return `${id} has no label`;
    if (!entry?.explanation) return `${id} has no explanation`;
    if (!categories.has(entry.category)) return `${id} has category ${entry.category}`;
  }
  return null;
});

check('an unregistered rule falls back to its id rather than to a guess', () => {
  if (isRule('logic.wishful-thinking')) return 'an invented rule was accepted';
  return ruleLabel('logic.wishful-thinking') === 'logic.wishful-thinking'
    ? null : 'an unknown rule was given a plausible label';
});

check('a step citing an unregistered rule is refused at construction', () => (
  threw(() => createTraceBuilder().step('logic.wishful-thinking', { conclusionLatex: 'x' }))
    ? null : 'the builder accepted an unregistered rule'
));

console.log('== building a graph ==');

/** The worked example from the handoff: the epsilon vertical slice. */
function epsilonTrace() {
  const builder = createTraceBuilder();
  const assumption = builder.step('logic.assumption', {
    conclusionLatex: '\\epsilon > 0',
  });
  const unfold = builder.step('definition.unfold', {
    conclusionLatex: 'd(\\epsilon) = \\epsilon/2',
    data: { name: 'd' },
  });
  const scale = builder.step('order.positive-scale', {
    premises: [assumption, unfold],
    conclusionLatex: 'd(\\epsilon) > 0',
    data: { scaleLatex: '1/2' },
  });
  const root = builder.step('logic.implies-intro', {
    premises: [scale],
    conclusionLatex: '\\epsilon > 0 \\vdash d(\\epsilon) > 0',
    data: { discharged: [assumption] },
  });
  return { builder, root, trace: builder.finish(root) };
}

check('the epsilon slice builds the documented rule sequence', () => {
  const { trace } = epsilonTrace();
  if (!trace) return 'the trace did not build';
  const expected = [
    'logic.assumption',
    'definition.unfold',
    'order.positive-scale',
    'logic.implies-intro',
  ];
  const got = trace.steps.map((step) => step.rule);
  if (JSON.stringify(got) !== JSON.stringify(expected)) return `got ${got.join(', ')}`;
  if (trace.version !== PROOF_VERSION) return `version ${trace.version}`;
  if (trace.steps.at(-1).id !== trace.root) return 'the root is not the final step';
  return null;
});

check('steps are emitted in dependency order', () => {
  const { trace } = epsilonTrace();
  const seen = new Set();
  for (const step of trace.steps) {
    for (const premise of step.premises) {
      if (!seen.has(premise)) return `${step.id} cites ${premise} before it is stated`;
    }
    seen.add(step.id);
  }
  return null;
});

check('the discharged assumption is recorded on the implication', () => {
  const { trace } = epsilonTrace();
  const root = trace.steps.find((step) => step.id === trace.root);
  const discharged = root.data?.discharged ?? [];
  const assumption = trace.steps.find((step) => step.rule === 'logic.assumption');
  return discharged.includes(assumption.id) ? null : 'the assumption was never discharged';
});

check('a premise that was never stated is refused', () => (
  threw(() => createTraceBuilder().step('logic.chain', { premises: ['s99'] }))
    ? null : 'the builder accepted a dangling premise'
));

check('structurally identical steps are interned rather than repeated', () => {
  const builder = createTraceBuilder();
  const first = builder.step('logic.assumption', { conclusionLatex: '\\epsilon > 0' });
  const again = builder.step('logic.assumption', { conclusionLatex: '\\epsilon > 0' });
  if (first !== again) return 'the same claim was stated twice';
  const other = builder.step('logic.assumption', { conclusionLatex: '\\delta > 0' });
  return other === first ? 'two different claims collapsed into one' : null;
});

check('finishing keeps only what the root depends on', () => {
  const builder = createTraceBuilder();
  const used = builder.step('logic.assumption', { conclusionLatex: 'p' });
  builder.step('logic.assumption', { conclusionLatex: 'q unrelated' });
  const root = builder.step('logic.and-elim', { premises: [used], conclusionLatex: 'p' });
  const trace = builder.finish(root);
  if (trace.steps.length !== 2) return `expected 2 reachable steps, got ${trace.steps.length}`;
  return trace.steps.some((step) => step.conclusionLatex === 'q unrelated')
    ? 'an unreachable step was kept' : null;
});

check('finishing at an unknown root yields no trace at all', () => (
  createTraceBuilder().finish('s404') === null ? null : 'a rootless trace was returned'
));

check('a single certificate is a complete one-step trace', () => {
  const trace = singleStep('group.free-reduction', 'xy(yx)^{-1} = e', { reducedLatex: 'e' });
  if (!isValidTrace(trace)) return validateTrace(trace).join('; ');
  if (trace.steps.length !== 1) return `expected one step, got ${trace.steps.length}`;
  return traceDepth(trace) === 1 ? null : `depth ${traceDepth(trace)}`;
});

console.log('== rejecting malformed graphs ==');

const valid = epsilonTrace().trace;
const broken = (mutate) => {
  const copy = JSON.parse(JSON.stringify(valid));
  mutate(copy);
  return copy;
};

const rejects = [
  ['a duplicate step id', broken((t) => { t.steps[1].id = t.steps[0].id; })],
  ['a missing premise reference', broken((t) => { t.steps[2].premises = ['s99']; })],
  ['a root that is not among the steps', broken((t) => { t.root = 's99'; })],
  ['a missing root', broken((t) => { delete t.root; })],
  ['an unregistered rule', broken((t) => { t.steps[0].rule = 'logic.vibes'; })],
  ['an unsupported version', broken((t) => { t.version = 99; })],
  ['an empty step list', broken((t) => { t.steps = []; })],
  ['a conclusion that is not text', broken((t) => { t.steps[0].conclusionLatex = 42; })],
  ['a missing premise list', broken((t) => { delete t.steps[0].premises; })],
  ['a cycle', broken((t) => { t.steps[0].premises = [t.root]; })],
  ['a self-citing step', broken((t) => { t.steps[0].premises = [t.steps[0].id]; })],
  ['a trace that is not an object', null],
];

for (const [label, trace] of rejects) {
  check(`${label} is rejected`, () => {
    const errors = validateTrace(trace);
    if (!errors.length) return 'the validator accepted it';
    return isValidTrace(trace) ? 'isValidTrace disagreed with validateTrace' : null;
  });
}

check('a well-formed graph validates with no complaints', () => {
  const errors = validateTrace(valid);
  return errors.length ? errors.join('; ') : null;
});

console.log('== bounds ==');

check('an over-long derivation is summarized to an honest single step', () => {
  // Width, not depth: many independent premises under one certificate.
  const wide = createTraceBuilder();
  const premises = [];
  for (let index = 0; index <= MAX_STEPS + 5; index += 1) {
    premises.push(wide.step('logic.assumption', { conclusionLatex: `a_{${index}}` }));
  }
  const wideRoot = wide.step('set.finite-enumeration', {
    premises,
    conclusionLatex: 'every member checked',
    data: { checked: premises.length },
  });
  const trace = wide.finish(wideRoot);
  if (!trace) return 'the builder gave up instead of summarizing';
  if (trace.steps.length !== 1) return `expected one summarized step, got ${trace.steps.length}`;
  const [step] = trace.steps;
  if (step.rule !== 'set.finite-enumeration') return 'the summary lost the rule that finished the proof';
  if (step.data.checked !== premises.length) return 'the summary lost the certificate facts';
  if (!isSummarized(step)) return 'the summary does not say how much it dropped';
  if (step.data.omittedSteps !== premises.length) return `omitted ${step.data.omittedSteps}`;
  return isValidTrace(trace) ? null : validateTrace(trace).join('; ');
});

check('an over-deep derivation is summarized too', () => {
  const builder = createTraceBuilder();
  let previous = builder.step('logic.assumption', { conclusionLatex: 'a_{0}' });
  for (let index = 1; index <= MAX_DEPTH + 2; index += 1) {
    previous = builder.step('logic.chain', {
      premises: [previous],
      conclusionLatex: `a_{0} \\le a_{${index}}`,
    });
  }
  const trace = builder.finish(previous);
  if (!trace) return 'the builder gave up instead of summarizing';
  if (trace.steps.length !== 1) return `expected one summarized step, got ${trace.steps.length}`;
  if (traceDepth(trace) > MAX_DEPTH) return 'the summary is still too deep';
  return isValidTrace(trace) ? null : validateTrace(trace).join('; ');
});

check('a derivation just inside the bounds is kept whole', () => {
  const builder = createTraceBuilder();
  let previous = builder.step('logic.assumption', { conclusionLatex: 'a_{0}' });
  for (let index = 1; index < MAX_DEPTH; index += 1) {
    previous = builder.step('logic.chain', {
      premises: [previous],
      conclusionLatex: `a_{0} \\le a_{${index}}`,
    });
  }
  const trace = builder.finish(previous);
  if (trace.steps.length !== MAX_DEPTH) return `kept ${trace.steps.length} steps`;
  return traceDepth(trace) === MAX_DEPTH ? null : `depth ${traceDepth(trace)}`;
});

console.log('== joining fragments ==');

check('adopting fragments renumbers their steps without collision', () => {
  const left = epsilonTrace().trace;
  const right = singleStep('polynomial.identity', 'x^2 - y^2 = (x-y)(x+y)');
  const builder = createTraceBuilder();
  const leftRoot = builder.adopt(left);
  const rightRoot = builder.adopt(right);
  if (leftRoot === rightRoot) return 'two fragments landed on one step';
  const root = builder.step('logic.and-intro', {
    premises: [leftRoot, rightRoot],
    conclusionLatex: 'both',
  });
  const trace = builder.finish(root);
  if (!trace) return 'the joined trace did not build';
  const ids = trace.steps.map((step) => step.id);
  if (new Set(ids).size !== ids.length) return 'step ids collided';
  if (trace.steps.length !== left.steps.length + right.steps.length + 1) {
    return `expected ${left.steps.length + right.steps.length + 1} steps, got ${trace.steps.length}`;
  }
  return isValidTrace(trace) ? null : validateTrace(trace).join('; ');
});

check('adopting one fragment twice shares it instead of duplicating it', () => {
  const fragment = epsilonTrace().trace;
  const builder = createTraceBuilder();
  const first = builder.adopt(fragment);
  const second = builder.adopt(fragment);
  if (first !== second) return 'the same evidence was copied twice';
  const trace = builder.finish(first);
  return trace.steps.length === fragment.steps.length
    ? null : `expected ${fragment.steps.length} steps, got ${trace.steps.length}`;
});

check('a fragment with a dangling premise cannot be adopted', () => {
  const fragment = { root: 's2', steps: [{ id: 's2', rule: 'logic.chain', premises: ['s1'], conclusionLatex: 'x' }] };
  return threw(() => createTraceBuilder().adopt(fragment))
    ? null : 'a broken fragment was adopted';
});

console.log('== identifiers ==');

check('internal identifiers are restored to the names the reader typed', () => {
  const registry = new IdentifierRegistry();
  const internal = registry.createInternal('x', 'x');
  const builder = createTraceBuilder();
  const root = builder.step('set.extensionality', {
    conclusionLatex: `${internal.id} \\in A \\iff ${internal.id} \\in B`,
    data: { witnessLatex: internal.id, name: internal.id, checked: 3 },
  });
  const trace = builder.finish(root);
  if (!containsInternalIdentifiers(trace)) return 'the fixture contained no internal identifier';
  const restored = restoreIdentifiers(trace, registry);
  if (containsInternalIdentifiers(restored)) {
    return `an internal identifier survived: ${JSON.stringify(restored.steps[0])}`;
  }
  if (restored.steps[0].data.checked !== 3) return 'restoration damaged the certificate data';
  return isValidTrace(restored) ? null : 'restoration broke the graph';
});

check('restoration leaves a trace with no internal names alone', () => {
  const registry = new IdentifierRegistry();
  const trace = epsilonTrace().trace;
  const restored = restoreIdentifiers(trace, registry);
  return JSON.stringify(restored) === JSON.stringify(trace) ? null : 'a clean trace was rewritten';
});

console.log('== proof status ==');

check('a branch with no evidence reports opaque, never a proof', () => {
  if (OPAQUE_PROOF.proof !== null || OPAQUE_PROOF.proofStatus !== 'opaque') return 'wrong opaque shape';
  if (NO_PROOF.proof !== null || NO_PROOF.proofStatus !== 'unavailable') return 'wrong unavailable shape';
  return null;
});

check('a valid trace is reported as available', () => {
  const trace = epsilonTrace().trace;
  const result = provedBy(trace);
  if (result.proofStatus !== 'available') return `status ${result.proofStatus}`;
  return result.proof === trace ? null : 'the trace was not carried through';
});

check('a malformed trace degrades to opaque rather than failing the row', () => {
  if (provedBy(null).proofStatus !== 'opaque') return 'a missing trace was not opaque';
  const bogus = { version: PROOF_VERSION, root: 's1', steps: [{ id: 's1', rule: 'logic.vibes', premises: [], conclusionLatex: 'x' }] };
  const result = provedBy(bogus);
  if (result.proofStatus !== 'opaque') return `status ${result.proofStatus}`;
  return result.proof === null ? null : 'an invalid trace was published anyway';
});

console.log('== proof status through the engine ==');

const STATEMENTS = [
  'x^2+y^2\\ge 0',
  '2+2=4',
  '\\sin^2 x + \\cos^2 x = 1',
  'e^{x} \\ge x+1',
  'x^4 \\ge x^3',
  '|x+y| \\le |x|+|y|',
  '\\sqrt{x^2} = x',
  'x^3 - x = x(x-1)(x+1)',
  '\\mathsf{Grp} \\vdash (xy)^{-1} = y^{-1}x^{-1}',
];

let sampled = 0;
for (const line of STATEMENTS) {
  const result = new Sheet().evaluateAll([line]).at(-1);
  if (result.method === 'sampled') sampled += 1;
  check(`${line} carries a well-formed proof status`, () => {
    if (result.kind !== 'truth') return `expected a truth, got ${result.kind}`;
    if (!PROOF_STATUSES.includes(result.proofStatus)) return `status ${result.proofStatus}`;
    if (result.proofStatus !== 'available' && result.proof !== null) {
      return `a ${result.proofStatus} result carried a proof`;
    }
    if (result.proof && !isValidTrace(result.proof)) return validateTrace(result.proof).join('; ');
    if (result.proof && containsInternalIdentifiers(result.proof)) return 'internal identifiers leaked';
    return null;
  });
}

check('a proof is never claimed for a sampled result', () => {
  for (const line of STATEMENTS) {
    const result = new Sheet().evaluateAll([line]).at(-1);
    if (result.method === 'sampled' && result.proofStatus !== 'unavailable') {
      return `${line} sampled its way to ${result.proofStatus}`;
    }
  }
  return sampled > 0 ? null : 'no sampled result: the invariant was never exercised';
});

check('the control statement is still true and still proved', () => {
  const result = new Sheet().evaluateAll(['x^2+y^2\\ge 0']).at(-1);
  if (result.value !== true) return `control is ${result.value}`;
  return result.method === 'proved' ? null : `control method ${result.method}`;
});

console.log('== the epsilon vertical slice ==');

const EPSILON_SHEET = [
  'g(x):=2x+1',
  'd(\\epsilon):=\\epsilon/2',
  '\\epsilon>0\\vdash d(\\epsilon)>0',
];
const epsilonRow = new Sheet().evaluateAll(EPSILON_SHEET).at(-1);

check('the epsilon sequent is proved with a trace', () => {
  if (epsilonRow.value !== true) return `value ${epsilonRow.value}`;
  if (epsilonRow.method !== 'proved') return `method ${epsilonRow.method}`;
  return epsilonRow.proofStatus === 'available' ? null : `status ${epsilonRow.proofStatus}`;
});

check('it cites the definition it unfolded, then the branch that decided it', () => {
  const rules = epsilonRow.proof.steps.map((step) => step.rule);
  const expected = ['definition.unfold', 'polynomial.sturm-sign-chart'];
  return JSON.stringify(rules) === JSON.stringify(expected) ? null : `got ${rules.join(', ')}`;
});

check('the certificate rests on the expansion', () => {
  const { proof } = epsilonRow;
  const root = proof.steps.find((step) => step.id === proof.root);
  if (root.rule !== 'polynomial.sturm-sign-chart') return `root is ${root.rule}`;
  const unfold = proof.steps.find((step) => step.rule === 'definition.unfold');
  return root.premises.includes(unfold.id) ? null : 'the certificate ignores the expansion';
});

check('the sequent is shown as it was written, not as its normalized form', () => {
  const { proof } = epsilonRow;
  const root = proof.steps.find((step) => step.id === proof.root);
  if (!root.conclusionLatex.includes('\\vdash')) return `lost the turnstile: ${root.conclusionLatex}`;
  return root.conclusionLatex.includes('\\implies') ? 'showed the rewritten form' : null;
});

check('the expansion names the function and its body', () => {
  const unfold = epsilonRow.proof.steps.find((step) => step.rule === 'definition.unfold');
  if (!/\bd\s*\(/.test(unfold.conclusionLatex)) return `no call: ${unfold.conclusionLatex}`;
  if (!unfold.conclusionLatex.includes('\\epsilon')) return `no argument: ${unfold.conclusionLatex}`;
  return unfold.data?.name === 'd' ? null : `named ${unfold.data?.name}`;
});

check('no internal identifier reaches the reader', () => (
  containsInternalIdentifiers(epsilonRow.proof)
    ? `internal identifiers in ${JSON.stringify(epsilonRow.proof.steps)}` : null
));

check('the expansion shows the argument written at the call site', () => {
  const row = new Sheet().evaluateAll(['h(x):=x/2', 'y>0\\vdash h(2y)>0']).at(-1);
  if (row.proofStatus !== 'available') return `status ${row.proofStatus}`;
  const unfold = row.proof.steps.find((step) => step.rule === 'definition.unfold');
  return unfold.conclusionLatex.includes('2y') ? null : `got ${unfold.conclusionLatex}`;
});

check('a directly evaluated statement says so', () => {
  const row = new Sheet().evaluateAll(['2+2=4']).at(-1);
  if (row.proofStatus !== 'available') return `status ${row.proofStatus}`;
  return row.proof.steps[0].rule === 'engine.exact-evaluation'
    ? null : `rule ${row.proof.steps[0].rule}`;
});

check('a continuity witness names the definition it discharged', () => {
  const row = new Sheet().evaluateAll([
    'g(x):=2x+1',
    'd(\\epsilon):=\\epsilon/2',
    '\\operatorname{cont}(g,a,\\epsilon,d(\\epsilon))',
  ]).at(-1);
  if (row.value !== true) return `the control line stopped being true: ${row.value}`;
  if (row.proofStatus !== 'available') return `status ${row.proofStatus}`;
  const root = row.proof.steps.find((step) => step.id === row.proof.root);
  return root.rule === 'analysis.epsilon-delta-witness' ? null : `root is ${root.rule}`;
});

check('epsilon-delta traces name the arbitrary nearby point t, not element', () => {
  const results = new Sheet().evaluateAll([
    'g(x):=2x+1',
    'd(\\epsilon):=\\epsilon/2',
    '\\operatorname{cont}(g,a,\\epsilon,d(\\epsilon))',
    '\\operatorname{limitw}(g,a,2a+1,\\epsilon,d(\\epsilon))',
  ]);
  for (const row of results.slice(-2)) {
    if (row.proofStatus !== 'available') return `status ${row.proofStatus}`;
    const claims = row.proof.steps.map((step) => step.conclusionLatex).join(' ');
    if (claims.includes('\\text{element}')) return `generic element leaked: ${claims}`;
    if (!claims.includes('t-a')) return `the nearby point was not named t: ${claims}`;
  }
  return null;
});

check('an existing t makes the epsilon-delta point choose another name', () => {
  const row = new Sheet().evaluateAll([
    'g(x):=2x+1',
    'd(\\epsilon):=\\epsilon/2',
    't:=0',
    '\\operatorname{cont}(g,t,\\epsilon,d(\\epsilon))',
  ]).at(-1);
  if (row.proofStatus !== 'available') return `status ${row.proofStatus}`;
  const claims = row.proof.steps.map((step) => step.conclusionLatex).join(' ');
  if (claims.includes('\\text{element}')) return `generic element leaked: ${claims}`;
  return claims.includes('y') ? null : `no collision-free point name: ${claims}`;
});

check('a set rewrite this code cannot name stays opaque', () => {
  // Membership in a power set is expanded pointwise, which is a
  // transformation with no rule to describe it yet.
  const row = new Sheet().evaluateAll([
    'X\\in\\mathcal{P}(A)\\land A\\subseteq B\\vdash X\\in\\mathcal{P}(B)',
  ]).at(-1);
  if (row.value !== true) return `the control line stopped being true: ${row.value}`;
  if (row.proofStatus !== 'opaque') return `status ${row.proofStatus}`;
  return row.proof === null ? null : 'a lowered line carried a trace';
});

check('a refuted statement offers no proof', () => {
  const row = new Sheet().evaluateAll(['x^4\\ge x^3']).at(-1);
  if (row.value !== false) return `value ${row.value}`;
  return row.proof === null && row.proofStatus !== 'available'
    ? null : 'a false verdict carried a proof';
});

console.log('== propositional structure ==');

/** The rules cited by the last line of a sheet, in dependency order. */
const rulesFor = (lines) => {
  const row = new Sheet().evaluateAll(lines).at(-1);
  return { row, rules: row.proof ? row.proof.steps.map((step) => step.rule) : [] };
};

const composites = [
  ['a conjunction cites both conjuncts', ['x^2\\ge 0\\land y^2\\ge 0'], 'logic.and-intro', 2],
  ['an equivalence cites both directions', ['x>y\\iff x+1>y+1'], 'logic.iff-intro', 2],
  ['a chain cites its links', ['x^2+2x+1=(x+1)^2=(1+x)^2'], 'logic.chain', 2],
];

for (const [label, lines, rootRule, premiseCount] of composites) {
  check(label, () => {
    const { row } = rulesFor(lines);
    if (row.value !== true) return `value ${row.value}`;
    if (row.proofStatus !== 'available') return `status ${row.proofStatus}`;
    const root = row.proof.steps.find((step) => step.id === row.proof.root);
    if (root.rule !== rootRule) return `root is ${root.rule}`;
    if (root.premises.length !== premiseCount) {
      return `expected ${premiseCount} premises, got ${root.premises.length}`;
    }
    // Every premise must be a step that was actually established.
    const ids = new Set(row.proof.steps.map((step) => step.id));
    return root.premises.every((id) => ids.has(id)) ? null : 'a premise was never stated';
  });
}

const leaves = [
  ['positive scaling names its factor', ['a>b\\vdash a/2>b/2'], 'order.positive-scale'],
  ['an offset makes it affine monotonicity', ['x>y\\vdash x+1>y'], 'order.affine-monotonicity'],
  ['a propositional tautology is named as one', ['x>y\\land u>v\\vdash x>y'], 'logic.tautology'],
  ['a false premise is called vacuous', ['x^2+y^2<0\\vdash u>v'], 'logic.vacuous'],
  ['scaling an equation by a negative factor', ['x=y\\vdash -x=-y'], 'relation.nonzero-scale'],
  ['a power transfers the sign', ['x-y=0\\vdash (x-y)^3=0'], 'order.power-monotonicity'],
  ['a bare identity names its certificate', ['x^2+y^2\\ge 0'], 'polynomial.even-power'],
];

for (const [label, lines, expected] of leaves) {
  check(label, () => {
    const { row, rules } = rulesFor(lines);
    if (row.value !== true) return `value ${row.value}`;
    if (row.proofStatus !== 'available') return `status ${row.proofStatus}`;
    return rules.includes(expected) ? null : `cited ${rules.join(', ')}`;
  });
}

check('positive scaling records the factor it scaled by', () => {
  const { row } = rulesFor(['a>b\\vdash a/2>b/2']);
  const step = row.proof.steps.find((s) => s.rule === 'order.positive-scale');
  return step.data?.scaleLatex ? null : `no factor recorded: ${JSON.stringify(step.data)}`;
});

check('a composite trace is a graph, not a repeated claim', () => {
  const { row } = rulesFor(['x^2\\ge 0\\land y^2\\ge 0']);
  const conclusions = row.proof.steps.map((step) => step.conclusionLatex);
  return new Set(conclusions).size === conclusions.length
    ? null : `duplicated claims: ${conclusions.join(' | ')}`;
});

check('every step of every composite trace is registered and reachable', () => {
  for (const [, lines] of [...composites, ...leaves]) {
    const { row } = rulesFor(lines);
    if (!row.proof) continue;
    if (!isValidTrace(row.proof)) return `${lines.at(-1)}: ${validateTrace(row.proof).join('; ')}`;
    if (containsInternalIdentifiers(row.proof)) return `${lines.at(-1)}: internal identifiers leaked`;
  }
  return null;
});

check('a statement that cannot be proved offers nothing', () => {
  const row = new Sheet().evaluateAll(['e^{x} \\ge x+1']).at(-1);
  if (row.method !== 'sampled') return `method ${row.method}`;
  return row.proof === null && row.proofStatus === 'unavailable'
    ? null : `status ${row.proofStatus}`;
});

console.log('== arithmetic certificates ==');

// Each shape is chosen to reach a different strategy inside the sign prover.
// If one of these starts citing a neighbour's rule, the prover changed which
// certificate it produced — which is exactly what the trace exists to report.
const certificates = [
  ['even powers, several variables', ['x^2+y^2\\ge 0'], 'polynomial.even-power'],
  ['a square, unexpanded', ['(x-y)^2\\ge 0'], 'polynomial.even-power'],
  ['a rational sign chart', ['x^4+1>0'], 'polynomial.sturm-sign-chart'],
  ['a quadratic with no real root', ['x^2+x+\\pi>0'], 'polynomial.discriminant'],
  ['an expanded identity', ['(a+b)^2=a^2+2ab+b^2'], 'polynomial.identity'],
  ["Lagrange's identity", ['(a^2+b^2)(c^2+d^2)-(ac+bd)^2-(ad-bc)^2=0'], 'polynomial.identity'],
  ['a square recovered by factoring', ['x^4+y^4-2x^2y^2\\ge 0'], 'polynomial.even-power'],
  ['a positive semidefinite form', ['a^2+b^2+c^2\\ge ab+bc+ca'], 'quadratic.psd'],
  ['a sign on the assumed domain', ['x>2\\vdash x^2>3'], 'polynomial.sturm-sign-chart'],
];

for (const [label, lines, expected] of certificates) {
  check(`${label} cites ${expected}`, () => {
    const row = new Sheet().evaluateAll(lines).at(-1);
    if (row.value !== true) return `value ${row.value}`;
    if (row.proofStatus !== 'available') return `status ${row.proofStatus}`;
    const rules = row.proof.steps.map((step) => step.rule);
    return rules.includes(expected) ? null : `cited ${rules.join(', ')}`;
  });
}

check('a factoring certificate shows the factorization it used', () => {
  const row = new Sheet().evaluateAll(['x^4+y^4-2x^2y^2\\ge 0']).at(-1);
  const step = row.proof.steps.find((s) => s.rule === 'polynomial.even-power');
  return step.data?.factoredLatex
    ? null : `no factorization recorded: ${JSON.stringify(step.data)}`;
});

check('a sign chart records the variable it charted', () => {
  const row = new Sheet().evaluateAll(['x^4+1>0']).at(-1);
  const step = row.proof.steps.find((s) => s.rule === 'polynomial.sturm-sign-chart');
  return step.data?.variableLatex === 'x' ? null : `recorded ${JSON.stringify(step.data)}`;
});

check('the retired generic certificate is gone from the registry', () => (
  isRule('polynomial.sign-certificate')
    ? 'the unspecific sign certificate is still registered' : null
));

console.log('== lowering evidence ==');

const universalRow = new Sheet().evaluateAll(['\\forall x\\in\\mathbb{R},x^2\\ge 0']).at(-1);

check('a universally quantified line is closed by generalization', () => {
  if (universalRow.value !== true) return `value ${universalRow.value}`;
  if (universalRow.proofStatus !== 'available') return `status ${universalRow.proofStatus}`;
  const { proof } = universalRow;
  const root = proof.steps.find((step) => step.id === proof.root);
  if (root.rule !== 'logic.universal-generalization') return `root is ${root.rule}`;
  if (root.premises.length !== 1) return `expected one premise, got ${root.premises.length}`;
  // The premise is the proof of the body, which must be a real step.
  const body = proof.steps.find((step) => step.id === root.premises[0]);
  return body ? null : 'the generalization cites nothing';
});

check('generalization concludes the line as it was written', () => {
  const { proof } = universalRow;
  const root = proof.steps.find((step) => step.id === proof.root);
  return root.conclusionLatex.includes('\\forall')
    ? null : `lost the quantifier: ${root.conclusionLatex}`;
});

check('nested quantifiers are discharged together', () => {
  const row = new Sheet().evaluateAll([
    '\\forall a\\in\\mathbb{R},\\forall b\\in\\mathbb{R},a^2+b^2\\ge2ab',
  ]).at(-1);
  if (row.proofStatus !== 'available') return `status ${row.proofStatus}`;
  const root = row.proof.steps.find((step) => step.id === row.proof.root);
  if (root.rule !== 'logic.universal-generalization') return `root is ${root.rule}`;
  return root.data?.bindingsLatex?.length === 2
    ? null : `bindings ${JSON.stringify(root.data?.bindingsLatex)}`;
});

check('a named proposition is unfolded as an equivalence, not an equation', () => {
  const row = new Sheet().evaluateAll([
    '\\text{sq}(x):=x^2\\ge0',
    '\\forall x\\in\\mathbb{R},\\text{sq}(x)',
  ]).at(-1);
  if (row.proofStatus !== 'available') return `status ${row.proofStatus}`;
  const unfold = row.proof.steps.find((step) => step.rule === 'definition.unfold');
  if (!unfold) return 'the definition was never unfolded';
  return unfold.conclusionLatex.includes('\\iff')
    ? null : `unfolded as ${unfold.conclusionLatex}`;
});

check('a complex identity reports the normalization that decided it', () => {
  const row = new Sheet().evaluateAll([
    '\\forall t\\in\\mathbb{R},\\frac{e^{it}+e^{-it}}{2}=\\cos(t)',
  ]).at(-1);
  if (row.proofStatus !== 'available') return `status ${row.proofStatus}`;
  const rules = row.proof.steps.map((step) => step.rule);
  return rules.includes('relation.normalize') ? null : `cited ${rules.join(', ')}`;
});

// The safety property of this phase: a rewrite this code cannot name must not
// be described. Each of these is lowered into something quite unlike the line
// the reader wrote, and each must therefore stay opaque.
const mustStayOpaque = [
  ['a subset relation collapsing to a truth value', ['A\\subseteq B\\vdash A\\times C\\subseteq B\\times C']],
  ['a power-set membership lowered pointwise', ['X\\in\\mathcal{P}(A)\\land A\\subseteq B\\vdash X\\in\\mathcal{P}(B)']],
  ['an induction certificate', ['\\mathsf{Base}(P,0)\\land\\mathsf{Step}(P,0)']],
];

for (const [label, lines] of mustStayOpaque) {
  check(`${label} describes nothing`, () => {
    const row = new Sheet().evaluateAll(lines).at(-1);
    if (row.kind !== 'truth') return `kind ${row.kind}`;
    if (row.proofStatus === 'available') {
      return `claimed a derivation: ${JSON.stringify(row.proof?.steps?.map((s) => s.rule))}`;
    }
    return row.proof === null ? null : 'carried a proof while not available';
  });
}

check('an existential is not passed off as a generalization', () => {
  const row = new Sheet().evaluateAll(['\\exists x\\in\\mathbb{R},x^2=4']).at(-1);
  return row.proofStatus === 'available' ? 'an unlowered existential claimed a proof' : null;
});

console.log('== algebra and groups ==');

check('a group identity reports the word both sides reduce to', () => {
  const row = new Sheet().evaluateAll(['\\mathsf{Grp}\\vdash (xy)^{-1}=y^{-1}x^{-1}']).at(-1);
  if (row.value !== true) return `value ${row.value}`;
  if (row.proofStatus !== 'available') return `status ${row.proofStatus}`;
  const [step] = row.proof.steps;
  if (step.rule !== 'group.free-reduction') return `rule ${step.rule}`;
  return step.data?.normalFormLatex ? null : `no normal form: ${JSON.stringify(step.data)}`;
});

check('adjacent generators do not run internal names together', () => {
  // `Id0Id1Id2` has no word boundary for the registry to split on, so the
  // word must be rendered generator by generator rather than as one string.
  const row = new Sheet().evaluateAll(['\\mathsf{Grp}\\vdash x(yz)=(xy)z']).at(-1);
  if (row.proofStatus !== 'available') return `status ${row.proofStatus}`;
  if (containsInternalIdentifiers(row.proof)) {
    return `internal names leaked: ${JSON.stringify(row.proof.steps[0].data)}`;
  }
  return row.proof.steps[0].data.normalFormLatex === 'xyz'
    ? null : `normal form ${row.proof.steps[0].data.normalFormLatex}`;
});

check('an identity that fails in the free group offers no proof', () => {
  const row = new Sheet().evaluateAll(['\\mathsf{Grp}\\vdash xy=yx']).at(-1);
  if (row.value !== false) return `value ${row.value}`;
  return row.proof === null ? null : 'a refuted identity carried a proof';
});

// These predicates need their carrier definitions in scope, so they are read
// from the demos that set them up.
const finiteCertificates = [
  ['a finite group axiom', 'finite-group', 'algebra.finite-exhaustion'],
  ['a topology axiom', 'topology-axioms', 'topology.constructor-certificate'],
];

for (const [label, demoId, expected] of finiteCertificates) {
  check(`${label} is summarized as ${expected}`, () => {
    const demo = DEMOS.find((entry) => entry.id === demoId);
    if (!demo) return `no demo ${demoId}`;
    const traced = new Sheet().evaluateAll(demo.lines)
      .filter((row) => row.kind === 'truth' && row.proofStatus === 'available');
    if (!traced.length) return 'no traced row in the demo';
    for (const row of traced) {
      const rules = row.proof.steps.map((step) => step.rule);
      if (!rules.includes(expected)) return `cited ${rules.join(', ')}`;
      // A finite check must never enumerate its assignments as display nodes.
      if (row.proof.steps.length > 4) {
        return `${row.proof.steps.length} steps for a summarized certificate`;
      }
    }
    return null;
  });
}

console.log('== induction, witnesses, and counts ==');

/** The obligations only mean anything once the predicate is defined. */
const INDUCTION_SHEET = ['P(n):=n^2\\ge n'];

check('an induction certificate names the principle it used', () => {
  const row = new Sheet().evaluateAll(INDUCTION_SHEET.concat('\\mathsf{Induct}(P,0)')).at(-1);
  if (row.proofStatus !== 'available') return `status ${row.proofStatus}`;
  const root = row.proof.steps.find((step) => step.id === row.proof.root);
  if (root.rule !== 'analysis.induction') return `root is ${root.rule}`;
  // The obligations are the premise; induction is what carries them.
  return root.premises.length === 1 ? null : `${root.premises.length} premises`;
});

// `Base` and `Step` on their own are not induction — each stands for the one
// obligation it names, which is an unfolding and is labelled as one.
for (const [label, line] of [
  ['a base case', '\\mathsf{Base}(P,0)'],
  ['an inductive step', '\\mathsf{Step}(P,0)'],
]) {
  check(`${label} is unfolded, not called induction`, () => {
    const row = new Sheet().evaluateAll(INDUCTION_SHEET.concat(line)).at(-1);
    if (row.proofStatus !== 'available') return `status ${row.proofStatus}`;
    const root = row.proof.steps.find((step) => step.id === row.proof.root);
    return root.rule === 'definition.unfold' ? null : `root is ${root.rule}`;
  });
}

check('a finite check reports the carrier it ran over', () => {
  const demo = DEMOS.find((entry) => entry.id === 'finite-group');
  const row = new Sheet().evaluateAll(demo.lines)
    .find((entry) => entry.kind === 'truth' && entry.proofStatus === 'available');
  if (!row) return 'no traced row';
  const step = row.proof.steps.find((s) => s.rule === 'algebra.finite-exhaustion');
  return Number.isFinite(step?.data?.carrier)
    ? null : `no carrier recorded: ${JSON.stringify(step?.data)}`;
});

check('an integral rests on the continuity it was gated by', () => {
  const row = new Sheet().evaluateAll(['\\int_{0}^{1}x^2\\,dx=\\frac{1}{3}']).at(-1);
  if (row.proofStatus !== 'available') return `status ${row.proofStatus}`;
  const rules = row.proof.steps.map((step) => step.rule);
  if (!rules.includes('calculus.continuity')) return `cited ${rules.join(', ')}`;
  // The obligation is a premise of the evaluation, not the conclusion.
  const root = row.proof.steps.find((step) => step.id === row.proof.root);
  return root.rule === 'engine.exact-evaluation' ? null : `root is ${root.rule}`;
});

check('a line with no integral claims no continuity obligation', () => {
  const row = new Sheet().evaluateAll(['2+2=4']).at(-1);
  const rules = row.proof?.steps.map((step) => step.rule) ?? [];
  return rules.includes('calculus.continuity') ? 'claimed an unrelated obligation' : null;
});

console.log('== traces across the demo catalogue ==');

let demoTraces = 0;
for (const demo of DEMOS) {
  const results = new Sheet().evaluateAll(demo.lines);
  for (const [index, result] of results.entries()) {
    if (result.kind !== 'truth' || result.proofStatus !== 'available') continue;
    demoTraces += 1;
    check(`${demo.id} line ${index + 1} shows a sound trace`, () => {
      if (!isValidTrace(result.proof)) return validateTrace(result.proof).join('; ');
      if (containsInternalIdentifiers(result.proof)) return 'internal identifiers leaked';
      return result.value === true ? null : 'a trace was attached to a non-true row';
    });
  }
}

check('the epsilon demonstration is one of them', () => (
  demoTraces > 0 ? null : 'no demo row exposes a trace'
));

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`${passed} proof-trace cases passed`);
