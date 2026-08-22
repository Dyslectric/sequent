/**
 * Finite algebraic structures, verified exactly.
 *
 * Every axiom here is checkable by enumeration, so nothing in this file is
 * allowed to come back sampled: a structure is certified, refuted, or reported
 * as an honest unknown.
 */
import { Sheet } from '../src/lib/engine.js';

let passed = 0;
const failures = [];

function describe(result) {
  if (!result) return 'no result';
  if (result.kind === 'truth') return `truth ${result.value} [${result.method}]`;
  return `${result.kind}: ${result.message ?? result.latex ?? ''}`;
}

function check(label, lines, expect) {
  let result;
  try {
    result = new Sheet().evaluateAll(lines).at(-1);
  } catch (error) {
    failures.push(`${label}\n    threw: ${error?.message ?? error}`);
    return;
  }
  const problem = expect(result);
  if (problem) failures.push(`${label}\n    got: ${describe(result)}\n    ${problem}`);
  else passed++;
}

const exactTruth = (expected) => (result) => {
  if (result.kind !== 'truth' || result.value !== expected) return `expected ${expected}`;
  return result.method === 'sampled' ? 'sampling is not a proof' : null;
};
const proved = exactTruth(true);
const exactFalse = exactTruth(false);
const honestUnknown = (result) => (
  result.kind === 'truth' && result.value === null && result.method === 'undecided'
    ? null : 'expected an honest unknown'
);

/** ℤ/4 under addition — the worked example. */
const Z4 = ['G:=\\{0,1,2,3\\}', 'm(a,b):=\\operatorname{mod}(a+b,4)'];

console.log('== the group axioms, separately and together ==');
check('closure', [...Z4, '\\mathsf{Clo}(G,m)'], proved);
check('associativity', [...Z4, '\\mathsf{Asc}(G,m)'], proved);
check('identity', [...Z4, '\\mathsf{Idn}(G,m,0)'], proved);
check('inverses', [...Z4, '\\mathsf{Inv}(G,m,0)'], proved);
check('all four at once', [...Z4,
  '\\mathsf{Clo}(G,m)\\land\\mathsf{Asc}(G,m)'
  + '\\land\\mathsf{Idn}(G,m,0)\\land\\mathsf{Inv}(G,m,0)'], proved);
check('the structure itself', [...Z4, '\\mathsf{Grp}(G,m,0)'], proved);
check('abelian', [...Z4, '\\mathsf{Abl}(G,m)'], proved);
check('textual alias', [...Z4, '\\operatorname{group}(G,m,0)'], proved);

console.log('== other finite groups ==');
check('multiplicative group mod 5',
  ['U:=\\{1,2,3,4\\}', 'q(a,b):=\\operatorname{mod}(ab,5)',
    '\\mathsf{Grp}(U,q,1)'], proved);
check('Klein four-group by XOR',
  ['V:=\\{0,1,2,3\\}', 'x(a,b):=\\operatorname{mod}(a+b-2\\operatorname{mod}(a,2)'
    + '\\operatorname{mod}(b,2)-2\\cdot2\\left\\lfloor\\frac{a}{2}\\right\\rfloor'
    + '\\left\\lfloor\\frac{b}{2}\\right\\rfloor,4)',
    '\\mathsf{Idn}(V,x,0)'], proved);
check('trivial group', ['T:=\\{0\\}', 't(a,b):=0', '\\mathsf{Grp}(T,t,0)'], proved);

console.log('== what is not a group ==');
check('wrong identity element', [...Z4, '\\mathsf{Grp}(G,m,1)'], exactFalse);
check('unbounded addition is not closed',
  ['G:=\\{0,1,2,3\\}', 'p(a,b):=a+b', '\\mathsf{Clo}(G,p)'], exactFalse);
check('and so is not a group',
  ['G:=\\{0,1,2,3\\}', 'p(a,b):=a+b', '\\mathsf{Grp}(G,p,0)'], exactFalse);
check('subtraction is not associative',
  ['G:=\\{0,1,2,3\\}', 's(a,b):=\\operatorname{mod}(a-b,4)',
    '\\mathsf{Asc}(G,s)'], exactFalse);
check('multiplication mod 4 has no inverse for 2',
  ['V:=\\{1,2,3\\}', 'w(a,b):=\\operatorname{mod}(ab,4)',
    '\\mathsf{Grp}(V,w,1)'], exactFalse);
check('a non-commutative operation',
  ['G:=\\{0,1,2\\}', 'f(a,b):=\\operatorname{mod}(a+2b,3)',
    '\\mathsf{Abl}(G,f)'], exactFalse);

console.log('== subgroups, and Lagrange on an instance ==');
check('the even residues', [...Z4, 'H:=\\{0,2\\}', '\\mathsf{Sbg}(H,G,m,0)'], proved);
check('the trivial subgroup', [...Z4, 'E:=\\{0\\}', '\\mathsf{Sbg}(E,G,m,0)'], proved);
check('the whole group', [...Z4, '\\mathsf{Sbg}(G,G,m,0)'], proved);
check('a subset that is not closed',
  [...Z4, 'K:=\\{0,1\\}', '\\mathsf{Sbg}(K,G,m,0)'], exactFalse);
check('a subset missing the identity',
  [...Z4, 'K:=\\{1,3\\}', '\\mathsf{Sbg}(K,G,m,0)'], exactFalse);
// Lagrange is not proved here — it is witnessed on this instance, by counting.
check('order divides order', [...Z4, 'H:=\\{0,2\\}',
  '\\operatorname{mod}(\\operatorname{card}(G),\\operatorname{card}(H))=0'], proved);

console.log('== rings ==');
const ring = (n) => [
  `R:=\\{${Array.from({ length: n }, (_, i) => i).join(',')}\\}`,
  `p(a,b):=\\operatorname{mod}(a+b,${n})`,
  `t(a,b):=\\operatorname{mod}(ab,${n})`,
];
check('ℤ/4 is a ring', [...ring(4), '\\mathsf{Rng}(R,p,t,0)'], proved);
check('ℤ/5 is a ring', [...ring(5), '\\mathsf{Rng}(R,p,t,0)'], proved);
check('ℤ/6 is a ring', [...ring(6), '\\mathsf{Rng}(R,p,t,0)'], proved);
check('distributivity alone', [...ring(4), '\\mathsf{Dst}(R,p,t)'], proved);
check('multiplicative identity alone', [...ring(4), '\\mathsf{Uni}(R,t,1)'], proved);
check('textual alias', [...ring(4), '\\operatorname{ring}(R,p,t,0)'], proved);

check('a non-distributive pair',
  ['R:=\\{0,1,2,3\\}', 'p(a,b):=\\operatorname{mod}(a+b,4)',
    'g(a,b):=\\operatorname{mod}(a+2b,4)', '\\mathsf{Dst}(R,p,g)'], exactFalse);
check('wrong additive identity', [...ring(4), '\\mathsf{Rng}(R,p,t,1)'], exactFalse);

console.log('== fields ==');
check('ℤ/2 is a field', [...ring(2), '\\mathsf{Fld}(R,p,t,0,1)'], proved);
check('ℤ/3 is a field', [...ring(3), '\\mathsf{Fld}(R,p,t,0,1)'], proved);
check('ℤ/5 is a field', [...ring(5), '\\mathsf{Fld}(R,p,t,0,1)'], proved);
// The composite moduli are exactly where a field fails: 2 has no inverse mod 4.
check('ℤ/4 is not a field', [...ring(4), '\\mathsf{Fld}(R,p,t,0,1)'], exactFalse);
check('ℤ/6 is not a field', [...ring(6), '\\mathsf{Fld}(R,p,t,0,1)'], exactFalse);
// The one-element ring satisfies every other axiom and is still not a field,
// because 0 and 1 coincide.
check('the trivial ring is not a field',
  ['R:=\\{0\\}', 'p(a,b):=0', 't(a,b):=0', '\\mathsf{Fld}(R,p,t,0,0)'], exactFalse);

console.log('== honest unknowns ==');
check('ring on an infinite carrier',
  ['p(a,b):=a+b', 't(a,b):=ab', '\\mathsf{Rng}(\\mathbb{Z},p,t,0)'], honestUnknown);
check('ring with a missing operation',
  ['R:=\\{0,1\\}', 'p(a,b):=a+b', '\\mathsf{Rng}(R,p,zz,0)'], honestUnknown);
check('infinite carrier',
  ['n(a,b):=a+b', '\\mathsf{Grp}(\\mathbb{Z},n,0)'], honestUnknown);
check('operation is not defined', ['G:=\\{0,1\\}', '\\mathsf{Grp}(G,zz,0)'], honestUnknown);
check('operation has the wrong arity',
  ['G:=\\{0,1\\}', 'u(a):=a', '\\mathsf{Grp}(G,u,0)'], honestUnknown);
check('carrier is not a set', ['c:=5', 'm(a,b):=a+b', '\\mathsf{Grp}(c,m,0)'], honestUnknown);

if (failures.length) {
  console.error(`\n${failures.join('\n\n')}\n`);
  console.error(`${passed} passed, ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log(`\n${passed} algebra cases passed`);
}
