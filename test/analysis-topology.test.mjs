import { Sheet } from '../src/lib/engine.js';

let passed = 0;
let failed = 0;
const failures = [];

function describe(result) {
  if (!result) return 'no result';
  if (result.kind === 'truth') return `truth ${result.value} [${result.method}]`;
  return `${result.kind}: ${result.message ?? result.latex ?? JSON.stringify(result)}`;
}

function check(label, lines, expect) {
  let results;
  try {
    results = new Sheet().evaluateAll(lines);
  } catch (error) {
    failed++;
    failures.push(`${label}\n    threw: ${error?.stack ?? error}`);
    return;
  }
  const result = results.at(-1);
  const problem = expect(result, results);
  if (problem) {
    failed++;
    failures.push(`${label}\n    got: ${describe(result)}\n    ${problem}`);
  } else passed++;
}

const exactTruth = (expected) => (result) => {
  if (result.kind !== 'truth' || result.value !== expected) return `expected exact ${expected}`;
  return result.method === 'sampled' ? 'sampling is not a proof' : null;
};
const proved = exactTruth(true);
const exactFalse = exactTruth(false);
const honestUnknown = (result) => (
  result.kind === 'truth' && result.value === null && result.method === 'undecided'
    ? null : 'expected an honest unknown'
);

console.log('== real metric balls ==');
check('an open ball is a first-class set', [
  '\\operatorname{OpenBall}(a,r)',
], (result) => (
  result.kind === 'set' && result.latex === 'B\\left(a,r\\right)'
    ? null : 'expected B(a,r)'
));
check('open-ball membership uses strict distance', [
  'x\\in\\operatorname{OpenBall}(a,r)'
    + '\\iff\\left|x-a\\right|<r',
], proved);
check('closed-ball membership includes the boundary', [
  'x\\in\\operatorname{ClosedBall}(a,r)'
    + '\\iff\\left|x-a\\right|\\le r',
], proved);
check('concrete point belongs to its open ball', [
  '2\\in\\operatorname{OpenBall}(0,3)',
], proved);
check('outside point is rejected by an open ball', [
  '4\\notin\\operatorname{OpenBall}(0,3)',
], proved);
check('boundary point is absent from an open ball', [
  '3\\notin\\operatorname{OpenBall}(0,3)',
], proved);
check('boundary point belongs to a closed ball', [
  '3\\in\\operatorname{ClosedBall}(0,3)',
], proved);
check('open balls are metric-open in R', [
  '\\operatorname{MetricOpen}(\\operatorname{OpenBall}(a,r),\\mathbb{R})',
], proved);
check('finite unions of open balls are metric-open', [
  '\\operatorname{MetricOpen}('
    + '\\operatorname{OpenBall}(0,1)\\cup\\operatorname{OpenBall}(2,1),'
    + '\\mathbb{R})',
], proved);
check('closed balls are metric-closed in R', [
  '\\operatorname{MetricClosed}(\\operatorname{ClosedBall}(a,r),\\mathbb{R})',
], proved);
check('finite real sets are metric-closed', [
  '\\operatorname{MetricClosed}(\\{1,2,3\\},\\mathbb{R})',
], proved);
check('a nonempty finite real set is not metric-open', [
  '\\operatorname{MetricOpen}(\\{1,2,3\\},\\mathbb{R})',
], exactFalse);
check('compact real-open symbol has an implicit real metric', [
  '\\mathcal{O}_{\\mathbb{R}}(\\operatorname{OpenBall}(a,r))',
], proved);
check('compact real-closed symbol has an implicit real metric', [
  '\\mathcal{C}_{\\mathbb{R}}(\\{1,2,3\\})',
], proved);

console.log('== indexed set families ==');
check('a finite indexed union materializes exactly', [
  'F(i):=\\{i,2\\}',
  '\\operatorname{IndexedUnion}(F,\\{1,2\\})=\\{1,2\\}',
], proved);
check('a finite indexed intersection materializes exactly', [
  'F(i):=\\{i,2\\}',
  '\\operatorname{IndexedIntersection}(F,\\{1,2\\})=\\{2\\}',
], proved);
check('indexed-union membership is exact on a finite index set', [
  'F(i):=\\{i,2\\}',
  '1\\in\\operatorname{IndexedUnion}(F,\\{1,2\\})',
], proved);
check('indexed-intersection membership is exact on a finite index set', [
  'F(i):=\\{i,2\\}',
  '2\\in\\operatorname{IndexedIntersection}(F,\\{1,2\\})',
], proved);
check('large union and intersection notation lowers to indexed families', [
  'F(i):=\\{i,2\\}',
  '\\mathop{\\bigcup}(F,\\{1,2\\})=\\{1,2\\}'
    + '\\land\\mathop{\\bigcap}(F,\\{1,2\\})=\\{2\\}',
], proved);

console.log('== explicit epsilon-delta certificates ==');
check('affine continuity witness is proved exactly', [
  'f(x):=2x+1',
  '\\operatorname{ContinuousAt}(f,a,\\epsilon,\\epsilon/2)',
], proved);
check('named delta witness is substituted and proved', [
  'f(x):=2x+1',
  'd(\\epsilon):=\\epsilon/2',
  '\\operatorname{ContinuousAt}(f,a,\\epsilon,d(\\epsilon))',
], proved);
check('negative-slope affine continuity is proved', [
  'f(x):=-3x+4',
  '\\operatorname{ContinuousAt}(f,a,\\epsilon,\\epsilon/3)',
], proved);
check('constant functions accept delta epsilon', [
  'f(x):=7',
  '\\operatorname{ContinuousAt}(f,a,\\epsilon,\\epsilon)',
], proved);
check('affine limit witness is proved exactly', [
  'f(x):=3x-2',
  '\\operatorname{LimitAt}(f,a,3a-2,\\epsilon,\\epsilon/3)',
], proved);
check('wrong continuity witness is never certified by sampling', [
  'f(x):=2x+1',
  '\\operatorname{ContinuousAt}(f,a,\\epsilon,\\epsilon/3)',
], honestUnknown);
check('undefined function continuity stays unknown', [
  '\\operatorname{ContinuousAt}(f,a,\\epsilon,\\epsilon)',
], honestUnknown);
check('a nonpositive delta witness stays unknown', [
  'f(x):=x',
  '\\operatorname{ContinuousAt}(f,a,\\epsilon,-\\epsilon)',
], honestUnknown);
check('a defined epsilon cannot masquerade as a universal witness variable', [
  'f(x):=x', '\\epsilon:=1',
  '\\operatorname{ContinuousAt}(f,a,\\epsilon,\\epsilon)',
], honestUnknown);

console.log('== finite topology propositions ==');
const sierpinski = [
  'X:=\\{1,2\\}',
  'T:=\\{\\varnothing,\\{1\\},\\{1,2\\}\\}',
];
check('Sierpinski family is a topology', [
  ...sierpinski, '\\operatorname{Topology}(T,X)',
], proved);
check('missing-universe family is not a topology', [
  'X:=\\{1,2\\}', 'T:=\\{\\varnothing,\\{1\\}\\}',
  '\\operatorname{Topology}(T,X)',
], exactFalse);
check('union failure is not a topology', [
  'X:=\\{1,2,3\\}',
  'T:=\\{\\varnothing,\\{1\\},\\{2\\},X\\}',
  '\\operatorname{Topology}(T,X)',
], exactFalse);
check('a concrete family containing a non-set is not a topology', [
  '\\operatorname{Topology}(\\{\\varnothing,1,\\{1\\}\\},\\{1\\})',
], exactFalse);
check('power set is the discrete topology', [
  'X:=\\{1,2,3\\}', 'T:=\\mathcal{P}(X)',
  '\\operatorname{Topology}(T,X)',
], proved);
check('open-set membership is exact', [
  ...sierpinski, '\\operatorname{OpenIn}(\\{1\\},T)',
], proved);
check('non-open subset is rejected exactly', [
  ...sierpinski, '\\operatorname{OpenIn}(\\{2\\},T)',
], exactFalse);
check('closed set uses the open complement', [
  ...sierpinski, '\\operatorname{ClosedIn}(\\{2\\},T,X)',
], proved);
check('non-closed set is rejected exactly', [
  ...sierpinski, '\\operatorname{ClosedIn}(\\{1\\},T,X)',
], exactFalse);
check('a neighborhood contains an open set around the point', [
  ...sierpinski, '\\operatorname{NeighborhoodOf}(\\{1\\},1,T)',
], proved);
check('a set without an open neighborhood is rejected', [
  ...sierpinski, '\\operatorname{NeighborhoodOf}(\\{2\\},2,T)',
], exactFalse);
check('topology facts compose propositionally', [
  ...sierpinski,
  '\\operatorname{Topology}(T,X)'
    + '\\land\\operatorname{OpenIn}(\\{1\\},T)'
    + '\\land\\operatorname{ClosedIn}(\\{2\\},T,X)',
], proved);
check('compact topology symbols compose propositionally', [
  ...sierpinski,
  '\\mathsf{Top}(T,X)'
    + '\\land\\mathcal{O}(\\{1\\},T)'
    + '\\land\\mathcal{C}(\\{2\\},T,X)'
    + '\\land\\mathcal{N}(\\{1\\},1,T)',
], proved);

console.log('== infinite topology axiom certificates ==');
const topologyAxioms = (topology, carrier) => (
  `\\mathsf{Ax}_{\\varnothing}(${topology},${carrier})`
  + `\\land\\mathsf{Ax}_{X}(${topology},${carrier})`
  + `\\land\\mathsf{Ax}_{\\bigcup}(${topology},${carrier})`
  + `\\land\\mathsf{Ax}_{\\cap}(${topology},${carrier})`
);
check('the discrete topology on an infinite carrier is certified axiom by axiom', [
  'T:=\\mathsf{Disc}(\\mathbb{R})',
  topologyAxioms('T', '\\mathbb{R}'),
  '\\mathsf{Top}(T,\\mathbb{R})',
], proved);
check('a symbolic power set is the discrete topology', [
  '\\mathsf{Top}(\\mathcal{P}(X),X)',
], proved);
check('the indiscrete topology on an infinite carrier is certified', [
  'T:=\\mathsf{Ind}(\\mathbb{R})',
  topologyAxioms('T', '\\mathbb{R}'),
  '\\mathsf{Top}(T,\\mathbb{R})',
], proved);
check('the direct indiscrete family works on a symbolic carrier', [
  'T:=\\{\\varnothing,X\\}',
  '\\mathsf{Top}(T,X)',
], proved);
check('the cofinite topology on an infinite carrier is certified', [
  'T:=\\mathsf{Cof}(\\mathbb{R})',
  topologyAxioms('T', '\\mathbb{R}'),
  '\\mathsf{Top}(T,\\mathbb{R})',
], proved);
check('the usual real metric topology is certified', [
  'T:=\\mathsf{Met}(\\mathbb{R})',
  '\\mathsf{Meet}(r,s,\\min(r,s))',
  topologyAxioms('T', '\\mathbb{R}'),
  '\\mathsf{Top}(T,\\mathbb{R})',
], proved);
check('the metric intersection radius is an explicit certified witness', [
  '\\mathsf{Meet}(r,s,\\min(r,s))',
], proved);
check('an invalid metric intersection witness stays undecided', [
  '\\mathsf{Meet}(r,s,r+s)',
], honestUnknown);
check('a subspace topology inherits all axioms', [
  'T:=\\mathsf{Met}(\\mathbb{R})',
  'K:=\\operatorname{ClosedBall}(0,1)',
  'S:=\\mathsf{Sub}(T,\\mathbb{R},K)',
  topologyAxioms('S', 'K'),
  '\\mathsf{Top}(S,K)',
], proved);
check('a product topology inherits all axioms', [
  'T:=\\mathsf{Met}(\\mathbb{R})',
  'P:=\\mathsf{Prod}(T,\\mathbb{R},T,\\mathbb{R})',
  topologyAxioms('P', '\\mathbb{R}\\times\\mathbb{R}'),
  '\\mathsf{Top}(P,\\mathbb{R}\\times\\mathbb{R})',
], proved);
check('a topology constructor cannot be certified on the wrong carrier', [
  'T:=\\mathsf{Disc}(\\mathbb{R})',
  '\\mathsf{Top}(T,\\mathbb{C})',
], honestUnknown);
check('a subspace certificate requires a known subset carrier', [
  'T:=\\mathsf{Met}(\\mathbb{R})',
  'S:=\\mathsf{Sub}(T,\\mathbb{R},Y)',
  '\\mathsf{Top}(S,Y)',
], honestUnknown);
check('an invalid finite family fails its missing carrier axiom exactly', [
  'T:=\\{\\varnothing,\\{1\\}\\}',
  '\\mathsf{Ax}_{X}(T,\\{1,2\\})',
], exactFalse);
check('open sets are recognized in the discrete topology', [
  'T:=\\mathsf{Disc}(\\mathbb{R})',
  '\\mathcal{O}(\\{1,2\\},T)',
], proved);
check('a sequent introduces arbitrary open-set assumptions locally', [
  'T:=\\mathsf{Disc}(\\mathbb{R})',
  '\\mathcal{O}(U,T)\\land\\mathcal{O}(V,T)'
    + '\\vdash\\mathcal{O}(U\\cap V,T)',
], proved);
check('cofinite open sets are recognized intensionally', [
  'T:=\\mathsf{Cof}(\\mathbb{R})',
  '\\mathcal{O}(\\mathbb{R}\\setminus\\{1,2\\},T)',
], proved);
check('metric balls are open in the usual metric topology', [
  'T:=\\mathsf{Met}(\\mathbb{R})',
  '\\mathcal{O}(\\operatorname{OpenBall}(0,1),T)',
], proved);
check('basic rectangles are open in the product topology', [
  'T:=\\mathsf{Met}(\\mathbb{R})',
  'P:=\\mathsf{Prod}(T,\\mathbb{R},T,\\mathbb{R})',
  '\\mathcal{O}(\\operatorname{OpenBall}(0,1)\\times\\operatorname{OpenBall}(0,1),P)',
], proved);

console.log('== continuous maps between finite topological spaces ==');
check('every map between discrete finite spaces is continuous', [
  'X:=\\{1,2\\}',
  'D:=\\{\\varnothing,\\{1\\},\\{2\\},X\\}',
  'f(x):=3-x',
  '\\operatorname{ContinuousMap}(f,X,D,X,D)',
], proved);
check('a Sierpinski swap is not continuous', [
  ...sierpinski,
  'f(x):=3-x',
  '\\operatorname{ContinuousMap}(f,X,T,X,T)',
], exactFalse);
check('a constant finite map is continuous', [
  ...sierpinski,
  'f(x):=1',
  '\\operatorname{ContinuousMap}(f,X,T,X,T)',
], proved);
check('compact continuous-map symbol is exact', [
  ...sierpinski,
  'f(x):=1',
  '\\mathsf{Cts}(f,X,T,X,T)',
], proved);

console.log('== exhaustive topology matrix on three points ==');
const universeSize = 3;
const subsetCount = 2 ** universeSize;
const universeMask = subsetCount - 1;
const subsetLiteral = (mask, size = universeSize) => {
  const values = Array.from({ length: size }, (_, index) => index).filter((_, index) => (
    mask & (1 << index)
  ));
  return values.length ? `\\{${values.join(',')}\\}` : '\\varnothing';
};
const familyMasks = (familyMask, count = subsetCount) => (
  Array.from({ length: count }, (_, mask) => mask).filter((mask) => familyMask & (1 << mask))
);
const familyLiteral = (familyMask, size = universeSize) => {
  const count = 2 ** size;
  const members = familyMasks(familyMask, count).map((mask) => subsetLiteral(mask, size));
  return members.length ? `\\{${members.join(',')}\\}` : '\\varnothing';
};
const isTopology = (familyMask, size = universeSize) => {
  const full = (2 ** size) - 1;
  if (!(familyMask & 1) || !(familyMask & (1 << full))) return false;
  const family = familyMasks(familyMask, 2 ** size);
  return family.every((left) => family.every((right) => (
    Boolean(familyMask & (1 << (left | right)))
    && Boolean(familyMask & (1 << (left & right)))
  )));
};

function finiteCheck(label, lines, expected) {
  const result = new Sheet().evaluateAll(lines).at(-1);
  const problem = exactTruth(expected)(result);
  if (problem) {
    failed++;
    failures.push(`${label}\n    got: ${describe(result)}\n    ${problem}`);
  } else passed++;
}

const validThreePointTopologies = [];
for (let familyMask = 0; familyMask < 2 ** subsetCount; familyMask++) {
  const expected = isTopology(familyMask);
  if (expected) validThreePointTopologies.push(familyMask);
  finiteCheck(
    `three-point topology family ${familyMask}`,
    [`\\operatorname{Topology}(${familyLiteral(familyMask)},${subsetLiteral(universeMask)})`],
    expected,
  );
}

for (const familyMask of validThreePointTopologies) {
  const topology = familyLiteral(familyMask);
  for (let subset = 0; subset < subsetCount; subset++) {
    finiteCheck(
      `open subset ${subset} in topology ${familyMask}`,
      [`\\operatorname{OpenIn}(${subsetLiteral(subset)},${topology})`],
      Boolean(familyMask & (1 << subset)),
    );
    finiteCheck(
      `closed subset ${subset} in topology ${familyMask}`,
      [`\\operatorname{ClosedIn}(${subsetLiteral(subset)},${topology},${subsetLiteral(universeMask)})`],
      Boolean(familyMask & (1 << (universeMask ^ subset))),
    );
  }
}

console.log('== exhaustive continuity matrix on two points ==');
const twoPointTopologyMasks = Array.from({ length: 2 ** 4 }, (_, mask) => mask)
  .filter((mask) => isTopology(mask, 2));
for (const domainTopologyMask of twoPointTopologyMasks) {
  for (const codomainTopologyMask of twoPointTopologyMasks) {
    for (let image0 = 0; image0 < 2; image0++) {
      for (let image1 = 0; image1 < 2; image1++) {
        const expected = familyMasks(codomainTopologyMask, 4).every((openMask) => {
          let preimage = 0;
          if (openMask & (1 << image0)) preimage |= 1;
          if (openMask & (1 << image1)) preimage |= 2;
          return Boolean(domainTopologyMask & (1 << preimage));
        });
        const slope = image1 - image0;
        finiteCheck(
          `map ${image0}${image1}: topology ${domainTopologyMask} -> ${codomainTopologyMask}`,
          [
            `f(x):=${image0}+(${slope})x`,
            `\\operatorname{ContinuousMap}(f,\\{0,1\\},${familyLiteral(domainTopologyMask, 2)},`
              + `\\{0,1\\},${familyLiteral(codomainTopologyMask, 2)})`,
          ],
          expected,
        );
      }
    }
  }
}

if (failures.length) {
  console.error(`\n${passed} passed, ${failed} failed`);
  console.error('\nFAILURES:');
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`\n${passed} analysis/topology cases passed`);
}
