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

  for (const b of subsets) {
    const B = literal(b);
    const subset = a.every((value) => b.includes(value));
    finiteCheck(`${A} subseteq ${B}`, `${A}\\subseteq${B}`, subset);
    finiteCheck(`${A} proper subset ${B}`, `${A}\\subset${B}`, subset && a.length < b.length);
    finiteCheck(`${A} equals ${B}`, `${A}=${B}`, a.length === b.length && subset);
    finiteCheck(`${A} union ${B}`, `(${A}\\cup${B})=${literal(union(a, b))}`, true);
    finiteCheck(`${A} intersection ${B}`, `(${A}\\cap${B})=${literal(intersection(a, b))}`, true);
    finiteCheck(`${A} minus ${B}`, `(${A}\\setminus${B})=${literal(difference(a, b))}`, true);
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
