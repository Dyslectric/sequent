import { Sheet } from '../src/lib/engine.js';

let passed = 0;
let failed = 0;
const failures = [];

function describe(result) {
  if (!result) return 'no result';
  if (result.kind === 'truth') return `truth ${result.value} [${result.method}]`;
  if (result.kind === 'definition') return `${result.what} definition ${result.name}`;
  if (result.kind === 'set') return `set ${result.latex}`;
  if (result.kind === 'symbolic') return `symbolic ${result.latex}`;
  return `${result.kind}: ${result.message ?? JSON.stringify(result)}`;
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
  } else {
    passed++;
  }
}

const exactTruth = (expected) => (result) => {
  if (result.kind !== 'truth' || result.value !== expected) return `expected ${expected}`;
  if (result.method === 'sampled') return 'expected an exact result, got sampling';
  return null;
};
const proved = exactTruth(true);
const exactFalse = exactTruth(false);
const unknown = (result) => (
  result.kind === 'truth' && result.value === null && result.method === 'undecided'
    ? null : 'expected an honest unknown'
);

console.log('== first-class set definitions and values ==');
check('explicit finite set definition', ['A:=\\{1,2,3\\}'], (result) => (
  result.kind === 'definition' && result.what === 'set' ? null : 'expected a set definition'
));
check('implicit finite set definition', ['A=\\{1,2,3\\}'], (result) => (
  result.kind === 'definition' && result.what === 'set' ? null : 'expected a set definition'
));
check('set-builder definition', ['S:=\\{x\\mid x>0\\}'], (result) => (
  result.kind === 'definition' && result.what === 'set' ? null : 'expected a set definition'
));
check('set union displays as a set value', ['A:=\\{1,2\\}', 'B:=\\{2,3\\}', 'A\\cup B'], (result) => (
  result.kind === 'set' && /1/.test(result.latex) && /2/.test(result.latex) && /3/.test(result.latex)
    ? null : 'expected the exact union set'
));
check('set intersection displays as a set value', ['A:=\\{1,2\\}', 'B:=\\{2,3\\}', 'A\\cap B'], (result) => (
  result.kind === 'set' && /2/.test(result.latex) ? null : 'expected the exact intersection set'
));
check('set difference displays as a set value', ['A:=\\{1,2\\}', 'B:=\\{2,3\\}', 'A\\setminus B'], (result) => (
  result.kind === 'set' && /1/.test(result.latex) && !/3/.test(result.latex)
    ? null : 'expected the exact difference set'
));
check('undefined set expression stays set-valued', ['A\\cup B'], (result) => (
  result.kind === 'set' && result.undefinedNames.join(',') === 'A,B'
    ? null : 'expected a set expression with A and B undefined'
));

console.log('== power sets ==');
check('finite power set displays every subset', ['\\mathcal{P}(\\{1,2\\})'], (result) => (
  result.kind === 'set'
    && result.latex.includes('\\emptyset')
    && result.latex.includes('\\lbrace1\\rbrace')
    && result.latex.includes('\\lbrace2\\rbrace')
    && result.latex.includes('\\lbrace1, 2\\rbrace')
    ? null : 'expected the four subsets of {1,2}'
));
check('power set of empty set has one element', ['\\mathcal{P}(\\varnothing)'], (result) => (
  result.kind === 'set' && result.latex === '\\lbrace\\emptyset\\rbrace'
    ? null : 'expected {empty set}'
));
check('power set definition is set-valued', [
  'A:=\\{1,2\\}', 'B:=\\mathcal{P}(A)',
], (result) => (
  result.kind === 'definition' && result.what === 'set' ? null : 'expected a set definition'
));
check('wp is accepted as a power-set alias', ['\\wp(\\{1\\})'], (result) => (
  result.kind === 'set' && result.latex.includes('\\emptyset')
    && result.latex.includes('\\lbrace1\\rbrace') ? null : 'expected {empty set,{1}}'
));
check('a subset is a member of the power set', [
  '\\{1\\}\\in\\mathcal{P}(\\{1,2\\})',
], proved);
check('a non-subset is not a member of the power set', [
  '\\{1,3\\}\\notin\\mathcal{P}(\\{1,2\\})',
], proved);
check('nested power-set membership is exact', [
  '\\{\\{1\\}\\}\\in\\mathcal{P}(\\mathcal{P}(\\{1,2\\}))',
], proved);
check('power-set membership is definitionally subset', [
  'X\\in\\mathcal{P}(A)\\iff X\\subseteq A',
], proved);
check('empty set belongs to every power set', [
  '\\varnothing\\in\\mathcal{P}(A)',
], proved);
check('power set preserves subset', [
  'A\\subseteq B\\implies\\mathcal{P}(A)\\subseteq\\mathcal{P}(B)',
], proved);
check('power-set subset reduces in both directions', [
  '\\mathcal{P}(A)\\subseteq\\mathcal{P}(B)\\iff A\\subseteq B',
], proved);
check('power-set equality is injective', [
  '\\mathcal{P}(A)=\\mathcal{P}(B)\\iff A=B',
], proved);
check('power set of empty set is the singleton empty set', [
  '\\mathcal{P}(\\varnothing)=\\{\\varnothing\\}',
], proved);
check('large finite membership uses subset lowering without enumeration', [
  '\\{1,9\\}\\in\\mathcal{P}(\\{1,2,3,4,5,6,7,8,9\\})',
], proved);
check('unions of finite power sets materialize', [
  '\\mathcal{P}(\\{1\\})\\cup\\mathcal{P}(\\{2\\})',
], (result) => (
  result.kind === 'set' && result.latex.includes('\\emptyset')
    && result.latex.includes('\\lbrace1\\rbrace')
    && result.latex.includes('\\lbrace2\\rbrace') ? null : 'expected three subsets'
));
check('finite power-set universal quantifier is exact', [
  '\\forall X\\in\\mathcal{P}(\\{1,2\\}),\\varnothing\\subseteq X',
], proved);
check('finite power-set existential quantifier is exact', [
  '\\exists X\\in\\mathcal{P}(\\{1,2\\}),X=\\{1,2\\}',
], proved);
check('false finite power-set existential is exact', [
  '\\exists X\\in\\mathcal{P}(\\{1,2\\}),X=\\{3\\}',
], exactFalse);
check('oversized power-set values stay exact but unexpanded', [
  '\\mathcal{P}(\\{1,2,3,4,5,6,7,8,9\\})',
], (result) => (
  result.kind === 'set' && result.latex.includes('\\mathcal{P}')
    ? null : 'expected a symbolic power-set value rather than exponential expansion'
));
check('power set of an infinite standard domain stays compact', [
  '\\mathcal{P}(\\mathbb{R})',
], (result) => (
  result.kind === 'set' && result.latex.includes('\\mathcal{P}')
    ? null : 'expected a compact symbolic power-set value'
));
check('a standard subset belongs to the larger-domain power set', [
  '\\mathbb{R}\\in\\mathcal{P}(\\mathbb{C})',
], proved);
check('a standard superset does not belong to the smaller-domain power set', [
  '\\mathbb{C}\\notin\\mathcal{P}(\\mathbb{R})',
], proved);
check('power sets preserve the standard number-set lattice', [
  '\\mathcal{P}(\\mathbb{R})\\subseteq\\mathcal{P}(\\mathbb{C})',
], proved);

console.log('== Cartesian products ==');
check('finite Cartesian product materializes as tuples', [
  '\\{1,2\\}\\times\\{3,4\\}',
], (result) => (
  result.kind === 'set'
    && ['(1,3)', '(1,4)', '(2,3)', '(2,4)'].every((tuple) => result.latex.includes(tuple))
    ? null : 'expected all four ordered pairs'
));
check('power set accepts MathLive lbrace Cartesian factors', [
  '\\mathcal{P}\\left(\\left\\lbrace1,2\\right\\rbrace'
    + '\\times\\left\\lbrace3,4\\right\\rbrace\\right)',
], (result) => (
  result.kind === 'set'
    && result.latex.includes('\\emptyset')
    && result.latex.includes('\\lbrace(1,3), (1,4), (2,3), (2,4)\\rbrace')
    ? null : 'expected the 16 subsets of the four-pair product'
));
check('a Cartesian-product definition is set-valued', [
  'A:=\\{1,2\\}', 'B:=\\{3,4\\}', 'C:=A\\times B',
], (result) => (
  result.kind === 'definition' && result.what === 'set'
    ? null : 'expected a set definition'
));
check('cart is accepted as an explicit Cartesian-product alias', [
  '\\operatorname{cart}(\\{1,2\\},\\{3\\})',
], (result) => (
  result.kind === 'set' && result.latex.includes('(1,3)') && result.latex.includes('(2,3)')
    ? null : 'expected two ordered pairs'
));
check('numeric multiplication remains multiplication', ['2\\times3'], (result) => (
  result.kind === 'value' && result.exactLatex === '6'
    ? null : 'expected ordinary multiplication to remain 6'
));
check('tuple membership lowers coordinate by coordinate', [
  '(x,y)\\in A\\times B\\iff x\\in A\\land y\\in B',
], proved);
check('grouped tuple membership lowers coordinate by coordinate', [
  '(x,y)\\in(A\\times B)\\iff x\\in A\\land y\\in B',
], proved);
check('non-membership negates coordinate membership', [
  '(x,y)\\notin A\\times B\\iff\\neg(x\\in A\\land y\\in B)',
], proved);
check('wrong tuple arity is rejected exactly', [
  '(1,2,3)\\notin\\{1\\}\\times\\{2\\}',
], proved);
check('three-factor membership uses ordered triples', [
  '(x,y,z)\\in A\\times B\\times C'
    + '\\iff x\\in A\\land y\\in B\\land z\\in C',
], proved);
check('nested binary products retain nested tuples', [
  '((1,2),3)\\in(\\{1\\}\\times\\{2\\})\\times\\{3\\}',
], proved);
check('a left empty factor makes the product empty', [
  '\\varnothing\\times A=\\varnothing',
], proved);
check('a right empty factor makes the product empty', [
  'A\\times\\varnothing=\\varnothing',
], proved);
check('finite Cartesian universal quantification is exact', [
  '\\forall p\\in\\{1,2\\}\\times\\{3,4\\},'
    + 'p\\in\\{(1,3),(1,4),(2,3),(2,4)\\}',
], proved);
check('finite Cartesian existential quantification is exact', [
  '\\exists p\\in\\{1,2\\}\\times\\{3,4\\},p=(2,4)',
], proved);
check('false finite Cartesian existential is exact', [
  '\\exists p\\in\\{1,2\\}\\times\\{3,4\\},p=(2,5)',
], exactFalse);
check('real Cartesian domains accept real coordinates', [
  '(1,2)\\in\\mathbb{R}\\times\\mathbb{R}',
], proved);
check('real Cartesian domains reject a complex coordinate', [
  '(1,i)\\notin\\mathbb{R}\\times\\mathbb{R}',
], proved);
check('a product may be used as a set-builder domain', [
  'S:=\\{p\\in\\{1,2\\}\\times\\{3,4\\}\\mid p\\ne(1,3)\\}',
  '(2,4)\\in S',
], proved);
check('power-set membership accepts a Cartesian base', [
  'X\\in\\mathcal{P}(A\\times B)\\iff X\\subseteq A\\times B',
], proved);
check('a symbolic power set of a product stays in conventional notation', [
  '\\mathcal{P}(A\\times B)',
], (result) => (
  result.kind === 'set'
    && result.latex.includes('\\mathcal{P}')
    && result.latex.includes('\\times')
    && !result.latex.includes('CartesianProduct')
    ? null : 'expected compact P(A x B) notation'
));
check('Cartesian products distribute over union on the right', [
  'A\\times(B\\cup C)=(A\\times B)\\cup(A\\times C)',
], proved);
check('Cartesian products distribute over union on the left', [
  '(A\\cup B)\\times C=(A\\times C)\\cup(B\\times C)',
], proved);
check('Cartesian products distribute over intersection', [
  'A\\times(B\\cap C)=(A\\times B)\\cap(A\\times C)',
], proved);
check('Cartesian products are monotone in one factor', [
  'A\\subseteq B\\implies A\\times C\\subseteq B\\times C',
], proved);
check('Cartesian products are monotone in every factor', [
  'A\\subset B\\land C\\subseteq D'
    + '\\implies A\\times C\\subseteq B\\times D',
], proved);
check('reverse product monotonicity is not invented', [
  'A\\subseteq B\\implies B\\times C\\subseteq A\\times C',
], unknown);
check('oversized finite products stay compact', [
  '\\{0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16\\}'
    + '\\times\\{0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16\\}',
], (result) => (
  result.kind === 'set' && result.latex.includes('\\times')
    ? null : 'expected a compact product instead of more than 256 tuples'
));

console.log('== set-builder membership and extensional proofs ==');
check('membership substitutes the builder predicate', ['S:=\\{x\\mid x>0\\}', '2\\in S'], proved);
check('failed builder membership is exact', ['S:=\\{x\\mid x>0\\}', '-1\\in S'], exactFalse);
check('not-membership negates the builder predicate', ['S:=\\{x\\mid x>0\\}', '-1\\notin S'], proved);
check('real-domain builder accepts a real member',
  ['S:=\\{x\\in\\mathbb{R}\\mid x^2<4\\}', '1\\in S'], proved);
check('real-domain builder rejects an outside member',
  ['S:=\\{x\\in\\mathbb{R}\\mid x^2<4\\}', '3\\notin S'], proved);
check('builder subset reduces to implication',
  ['A:=\\{x\\mid x>0\\}', 'B:=\\{x\\mid x>-1\\}', 'A\\subseteq B'], proved);
check('builder equality reduces to equivalence', [
  'A:=\\{x\\in\\mathbb{R}\\mid x^2<4\\}',
  'A=\\{x\\in\\mathbb{R}\\mid -2<x\\land x<2\\}',
], proved);
check('unequal builders are exactly rejected', [
  'A:=\\{x\\mid x>0\\}',
  'A=\\{x\\mid x\\ge0\\}',
], exactFalse);
check('union of builders lowers membership to or', [
  'A:=\\{x\\mid x>1\\}', 'B:=\\{x\\mid x<-1\\}', '2\\in A\\cup B',
], proved);
check('intersection of builders lowers membership to and', [
  'A:=\\{x\\mid x>0\\}', 'B:=\\{x\\mid x<2\\}', '1\\in A\\cap B',
], proved);
check('difference of builders lowers membership to and-not', [
  'A:=\\{x\\mid x>0\\}', 'B:=\\{x\\mid x>2\\}', '1\\in A\\setminus B',
], proved);

console.log('== exact standard number-set lattice ==');
for (const [label, proposition, expected] of [
  ['naturals are integers', '\\mathbb{N}\\subseteq\\mathbb{Z}', true],
  ['integers are rationals', '\\mathbb{Z}\\subseteq\\mathbb{Q}', true],
  ['rationals are reals', '\\mathbb{Q}\\subseteq\\mathbb{R}', true],
  ['reals are complex', '\\mathbb{R}\\subseteq\\mathbb{C}', true],
  ['reals are not all rational', '\\mathbb{R}\\subseteq\\mathbb{Q}', false],
  ['finite naturals', '\\{0,1,2\\}\\subseteq\\mathbb{N}', true],
]) check(label, [proposition], exactTruth(expected));
check('symbolic natural-domain subset does not become vacuously true', [
  'A:=\\{x\\in\\mathbb{N}\\mid x>0\\}', 'A\\subseteq\\varnothing',
], unknown);
check('symbolic natural-domain equality does not become vacuously true', [
  'A:=\\{x\\in\\mathbb{N}\\mid x>0\\}', 'A=\\varnothing',
], unknown);

console.log('== symbolic set algebra, implication, and equivalence ==');
for (const [label, proposition] of [
  ['union identity', 'A\\cup\\varnothing=A'],
  ['intersection idempotence', 'A\\cap A=A'],
  ['union commutes', 'A\\cup B=B\\cup A'],
  ['intersection commutes', 'A\\cap B=B\\cap A'],
  ['union associates', 'A\\cup(B\\cup C)=(A\\cup B)\\cup C'],
  ['intersection associates', 'A\\cap(B\\cap C)=(A\\cap B)\\cap C'],
  ['intersection distributes', 'A\\cap(B\\cup C)=(A\\cap B)\\cup(A\\cap C)'],
  ['union distributes', 'A\\cup(B\\cap C)=(A\\cup B)\\cap(A\\cup C)'],
  ['difference definition', 'A\\setminus B=A\\cap\\{x\\mid x\\notin B\\}'],
  ['intersection is a subset', 'A\\cap B\\subseteq A'],
  ['union contains each side', 'A\\subseteq A\\cup B'],
  ['extensionality', 'A=B\\iff A\\subseteq B\\land B\\subseteq A'],
  ['subset transitivity', 'A\\subseteq B\\land B\\subseteq C\\implies A\\subseteq C'],
  ['intersection preserves subset', 'A\\subseteq B\\implies A\\cap C\\subseteq B'],
  ['union preserves subset', 'A\\subseteq B\\implies A\\cup C\\subseteq B\\cup C'],
  ['equal sets have equal unions', 'A=B\\implies A\\cup C=B\\cup C'],
  ['mutual subset equivalence', 'A=B\\iff A\\subseteq B\\land B\\subseteq A'],
]) check(label, [proposition], proved);
check('non-identity over arbitrary sets stays unknown', ['A\\cup B=A'], unknown);
check('symbolic proper subset needs an existential witness', ['A\\subset B'], unknown);

console.log('== finite and restricted quantifiers ==');
check('finite forall true', ['\\forall x\\in\\{1,2,3\\},x>0'], proved);
check('finite forall false', ['\\forall x\\in\\{1,2,3\\},x<3'], exactFalse);
check('finite exists true', ['\\exists x\\in\\{1,2,3\\},x=2'], proved);
check('finite exists false', ['\\exists x\\in\\{1,2,3\\},x>3'], exactFalse);
check('builder forall is a proved implication', [
  'A:=\\{x\\in\\mathbb{R}\\mid x>2\\}', '\\forall x\\in A,x>1',
], proved);
check('non-finite exists remains honest when not directly decidable', [
  'A:=\\{x\\in\\mathbb{R}\\mid x^2=2\\}', '\\exists x\\in A,x>0',
], unknown);

console.log('== exhaustive finite-set matrix ==');
const universe = [0, 1, 2];
const subsets = Array.from({ length: 2 ** universe.length }, (_, mask) => (
  universe.filter((_, bit) => mask & (1 << bit))
));
const literal = (values) => values.length ? `\\{${values.join(',')}\\}` : '\\varnothing';
const union = (a, b) => [...new Set([...a, ...b])].sort((x, y) => x - y);
const intersection = (a, b) => a.filter((value) => b.includes(value));
const difference = (a, b) => a.filter((value) => !b.includes(value));
const powerSetLiteral = (values) => {
  const members = subsets.filter((candidate) => candidate.every((value) => values.includes(value)));
  return `\\{${members.map(literal).join(',')}\\}`;
};
const finiteSheet = new Sheet();

function finiteCheck(label, proposition, expected) {
  let result;
  try {
    result = finiteSheet.evaluateLine(proposition);
  } catch (error) {
    failed++;
    failures.push(`${label}\n    threw: ${error?.stack ?? error}`);
    return;
  }
  const problem = exactTruth(expected)(result);
  if (problem) {
    failed++;
    failures.push(`${label}\n    ${proposition}\n    got: ${describe(result)}\n    ${problem}`);
  } else passed++;
}

for (const a of subsets) {
  const A = literal(a);
  for (const value of [-1, 0, 1, 2, 3]) {
    finiteCheck(`${A} contains ${value}`, `${value}\\in${A}`, a.includes(value));
    finiteCheck(`${A} excludes ${value}`, `${value}\\notin${A}`, !a.includes(value));
  }

  finiteCheck(`forall is reflexive on ${A}`, `\\forall x\\in${A},x\\in${A}`, true);
  finiteCheck(`exists follows nonemptiness for ${A}`, `\\exists x\\in${A},x\\in${A}`, a.length > 0);
  finiteCheck(
    `power set of ${A} enumerates exactly`,
    `\\mathcal{P}(${A})=${powerSetLiteral(a)}`,
    true,
  );

  for (const candidate of subsets) {
    const X = literal(candidate);
    finiteCheck(
      `${X} belongs to power set of ${A}`,
      `${X}\\in\\mathcal{P}(${A})`,
      candidate.every((value) => a.includes(value)),
    );
  }

  for (const b of subsets) {
    const B = literal(b);
    const subset = a.every((value) => b.includes(value));
    finiteCheck(`${A} subseteq ${B}`, `${A}\\subseteq${B}`, subset);
    finiteCheck(`${A} proper subset ${B}`, `${A}\\subset${B}`, subset && a.length < b.length);
    finiteCheck(`${A} equals ${B}`, `${A}=${B}`, a.length === b.length && subset);
    finiteCheck(`${A} union ${B}`, `(${A}\\cup${B})=${literal(union(a, b))}`, true);
    finiteCheck(`${A} intersection ${B}`, `(${A}\\cap${B})=${literal(intersection(a, b))}`, true);
    finiteCheck(`${A} minus ${B}`, `(${A}\\setminus${B})=${literal(difference(a, b))}`, true);
    finiteCheck(
      `power set of ${A} subseteq power set of ${B}`,
      `\\mathcal{P}(${A})\\subseteq\\mathcal{P}(${B})`,
      subset,
    );
    finiteCheck(
      `power set of ${A} equals power set of ${B}`,
      `\\mathcal{P}(${A})=\\mathcal{P}(${B})`,
      a.length === b.length && subset,
    );
  }
}

console.log('== exhaustive finite Cartesian-product matrix ==');
const cartesianLiteral = (a, b) => (
  a.length && b.length
    ? `\\{${a.flatMap((left) => b.map((right) => `(${left},${right})`)).join(',')}\\}`
    : '\\varnothing'
);
const coordinateSamples = [-1, 0, 1, 2, 3];

for (const a of subsets) {
  const A = literal(a);
  for (const b of subsets) {
    const B = literal(b);
    finiteCheck(
      `${A} x ${B} materializes exactly`,
      `${A}\\times${B}=${cartesianLiteral(a, b)}`,
      true,
    );
    for (const x of coordinateSamples) {
      for (const y of coordinateSamples) {
        finiteCheck(
          `(${x},${y}) in ${A} x ${B}`,
          `(${x},${y})\\in${A}\\times${B}`,
          a.includes(x) && b.includes(y),
        );
      }
    }
  }
}

// Exhaust every subset relation between products over {0,1}. This includes
// the easily-missed vacuous cases where either left factor is empty.
const smallSubsets = subsets.filter((values) => !values.includes(2));
for (const a of smallSubsets) {
  for (const b of smallSubsets) {
    for (const c of smallSubsets) {
      for (const d of smallSubsets) {
        const expected = a.length === 0 || b.length === 0 || (
          a.every((value) => c.includes(value))
          && b.every((value) => d.includes(value))
        );
        finiteCheck(
          `${literal(a)} x ${literal(b)} subseteq ${literal(c)} x ${literal(d)}`,
          `${literal(a)}\\times${literal(b)}`
            + `\\subseteq${literal(c)}\\times${literal(d)}`,
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
  console.log(`\n${passed} set-theory cases passed`);
}
