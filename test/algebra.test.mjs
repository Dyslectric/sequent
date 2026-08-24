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

console.log('== identities in every group ==');
/**
 * `Grp ⊢ L = R` is a claim about every group, decided by freely reducing both
 * sides. Both directions matter: a different reduced word means the identity
 * already fails in the free group, so a group refuting it exists and the claim
 * is false rather than unproven.
 */
const inEveryGroup = (equation) => [`\\mathsf{Grp}\\vdash ${equation}`];
const inEveryAbelian = (equation) => [`\\mathsf{Abl}\\vdash ${equation}`];

check('socks and shoes', inEveryGroup('(xy)^{-1}=y^{-1}x^{-1}'), proved);
check('double inverse', inEveryGroup('(x^{-1})^{-1}=x'), proved);
check('inverse of the identity', inEveryGroup('1^{-1}=1'), proved);
check('right identity', inEveryGroup('x1=x'), proved);
check('left identity', inEveryGroup('1x=x'), proved);
check('right inverse', inEveryGroup('xx^{-1}=1'), proved);
check('left inverse', inEveryGroup('x^{-1}x=1'), proved);
check('associativity', inEveryGroup('(xy)z=x(yz)'), proved);
check('inverse of a triple', inEveryGroup('(xyz)^{-1}=z^{-1}y^{-1}x^{-1}'), proved);
check('conjugation distributes',
  inEveryGroup('x(yz)x^{-1}=(xyx^{-1})(xzx^{-1})'), proved);
check('powers add', inEveryGroup('x^2x^3=x^5'), proved);
check('negative powers cancel', inEveryGroup('x^3x^{-3}=1'), proved);
check('a long cancellation', inEveryGroup('xyy^{-1}z z^{-1}x^{-1}=1'), proved);

// Not theorems. Each of these fails in the free group, so each is false.
check('groups need not commute', inEveryGroup('xy=yx'), exactFalse);
check('inverses do not distribute',
  inEveryGroup('(xy)^{-1}=x^{-1}y^{-1}'), exactFalse);
check('not every element is idempotent', inEveryGroup('x^2=x'), exactFalse);
check('not every element is an involution', inEveryGroup('xx=1'), exactFalse);
check('conjugation is not trivial', inEveryGroup('xyx^{-1}=y'), exactFalse);

console.log('== identities in every abelian group ==');
check('commutativity', inEveryAbelian('xy=yx'), proved);
check('inverses distribute when abelian',
  inEveryAbelian('(xy)^{-1}=x^{-1}y^{-1}'), proved);
check('powers distribute when abelian', inEveryAbelian('(xy)^3=x^3y^3'), proved);
check('reordering a long word', inEveryAbelian('xyzxy=x^2y^2z'), proved);
// Commutativity does not make everything true.
check('still false when abelian', inEveryAbelian('x^2=x'), exactFalse);
check('still false when abelian, inverses', inEveryAbelian('x=x^{-1}'), exactFalse);

console.log('== outside the decidable fragment ==');
check('not an equation', inEveryGroup('xy'), honestUnknown);
check('an inequality', inEveryGroup('xy\\ne yx'), honestUnknown);
check('a function nobody defined', inEveryGroup('\\sin(x)=x'), honestUnknown);

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

console.log('== modules ==');
/**
 * `Mdl(M, p, R, q, t, 1, s)` checks the four action axioms and that the action
 * lands in M. It does NOT re-check that (M, p) is an abelian group or that
 * (R, q, t) is a ring — those are separate obligations with their own names,
 * so a failing module says which axiom failed rather than hiding it.
 */
const moduleOver = (ring, mod) => [
  `M:=\\{${Array.from({ length: mod }, (_, i) => i).join(',')}\\}`,
  `p(x,y):=\\operatorname{mod}(x+y,${mod})`,
  `R:=\\{${Array.from({ length: ring }, (_, i) => i).join(',')}\\}`,
  `q(a,b):=\\operatorname{mod}(a+b,${ring})`,
  `t(a,b):=\\operatorname{mod}(ab,${ring})`,
  `s(a,x):=\\operatorname{mod}(ax,${mod})`,
];
const MODULE = '\\mathsf{Mdl}(M,p,R,q,t,1,s)';

check('ℤ/4 over ℤ/4', [...moduleOver(4, 4), MODULE], proved);
check('ℤ/3 over ℤ/3', [...moduleOver(3, 3), MODULE], proved);
check('ℤ/2 over ℤ/2 is a vector space', [...moduleOver(2, 2), MODULE], proved);
check('ℤ/2 over ℤ/4', [...moduleOver(4, 2), MODULE], proved);
check('textual alias',
  [...moduleOver(4, 4), '\\operatorname{module}(M,p,R,q,t,1,s)'], proved);

check('an action that is not unital',
  [...moduleOver(4, 4).slice(0, 5), 's(a,x):=\\operatorname{mod}(a+x,4)', MODULE],
  exactFalse);
check('the wrong unit element',
  [...moduleOver(4, 4), '\\mathsf{Mdl}(M,p,R,q,t,2,s)'], exactFalse);
check('an action that escapes the module',
  ['M:=\\{0,1\\}', 'p(x,y):=\\operatorname{mod}(x+y,2)', 'R:=\\{0,1,2,3\\}',
    'q(a,b):=\\operatorname{mod}(a+b,4)', 't(a,b):=\\operatorname{mod}(ab,4)',
    's(a,x):=\\operatorname{mod}(ax,4)', MODULE], exactFalse);

console.log('== vector spaces ==');
/**
 * `Vec(V, p, 0, F, q, t, 0, 1, s)` is the whole claim rather than a piece of
 * it: the vectors are an abelian group, the scalars are a *field*, and the
 * four action axioms hold. That middle requirement is the entire difference
 * between this and `Mdl` — ℤ/4 is a fine ring and ℤ/4 acting on itself is a
 * fine module, but 2 has no inverse, so it is not a vector space.
 */
const VECTOR_SPACE = '\\mathsf{Vec}(M,p,0,R,q,t,0,1,s)';

check('F₂ over itself', [...moduleOver(2, 2), VECTOR_SPACE], proved);
check('F₃ over itself', [...moduleOver(3, 3), VECTOR_SPACE], proved);
check('F₅ over itself', [...moduleOver(5, 5), VECTOR_SPACE], proved);
check('textual alias',
  [...moduleOver(3, 3), '\\operatorname{vectorspace}(M,p,0,R,q,t,0,1,s)'], proved);

// The scalars have to be a field, and these are the rings that are not.
check('ℤ/4 scalars are not a field', [...moduleOver(4, 4), VECTOR_SPACE], exactFalse);
check('ℤ/6 scalars are not a field', [...moduleOver(6, 6), VECTOR_SPACE], exactFalse);
check('the same data is still a module',
  [...moduleOver(4, 4), MODULE], proved);

// ℤ/4 is not a ℤ/2-space either: (1+1)·x is 0 while x + x is 2x.
check('an action that does not distribute over scalar sums',
  [...moduleOver(2, 4), VECTOR_SPACE], exactFalse);

check('the wrong scalar unit',
  [...moduleOver(3, 3), '\\mathsf{Vec}(M,p,0,R,q,t,0,2,s)'], exactFalse);
check('the wrong vector zero',
  [...moduleOver(3, 3), '\\mathsf{Vec}(M,p,1,R,q,t,0,1,s)'], exactFalse);
check('the wrong scalar zero',
  [...moduleOver(3, 3), '\\mathsf{Vec}(M,p,0,R,q,t,1,1,s)'], exactFalse);
check('vectors that are not closed under addition',
  ['M:=\\{0,1\\}', 'p(x,y):=x+y', 'R:=\\{0,1\\}',
    'q(a,b):=\\operatorname{mod}(a+b,2)', 't(a,b):=\\operatorname{mod}(ab,2)',
    's(a,x):=\\operatorname{mod}(ax,2)', VECTOR_SPACE], exactFalse);

check('vector space on an infinite carrier',
  ['p(x,y):=x+y', 'R:=\\{0,1\\}', 'q(a,b):=\\operatorname{mod}(a+b,2)',
    't(a,b):=\\operatorname{mod}(ab,2)', 's(a,x):=ax',
    '\\mathsf{Vec}(\\mathbb{Z},p,0,R,q,t,0,1,s)'], honestUnknown);
check('vector space with a missing action',
  [...moduleOver(3, 3).slice(0, 5), '\\mathsf{Vec}(M,p,0,R,q,t,0,1,z)'], honestUnknown);
check('vector space with the wrong arity',
  [...moduleOver(3, 3), '\\mathsf{Vec}(M,p,0,R,q,t,0,1)'], honestUnknown);

console.log('== honest unknowns ==');
check('module on an infinite carrier',
  ['p(x,y):=x+y', 'R:=\\{0,1\\}', 'q(a,b):=\\operatorname{mod}(a+b,2)',
    't(a,b):=\\operatorname{mod}(ab,2)', 's(a,x):=ax',
    '\\mathsf{Mdl}(\\mathbb{Z},p,R,q,t,1,s)'], honestUnknown);
check('module with a missing action',
  [...moduleOver(4, 4).slice(0, 5), '\\mathsf{Mdl}(M,p,R,q,t,1,z)'], honestUnknown);
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

console.log('== small categories ==');

/**
 * The poset 0 <= 1 <= 2 as a category, with `i -> j` encoded as `3i + j`.
 *
 * The encoding is the point: composition is partial, and making source and
 * target arithmetic is what lets a sheet say so without any notion of a pair.
 */
const POSET = [
  'O:=\\{0,1,2\\}',
  'M:=\\{0,1,2,4,5,8\\}',
  's(m):=\\lfloor m/3\\rfloor',
  't(m):=\\operatorname{mod}(m,3)',
  'c(f,g):=3s(f)+t(g)',
  'i(x):=4x',
];

check('composition is well-typed', [...POSET, '\\mathsf{Cmp}(O,M,s,t,c)'], proved);
check('identities and unit laws', [...POSET, '\\mathsf{Idt}(O,M,s,t,c,i)'], proved);
check('associativity over composable triples', [...POSET, '\\mathsf{Aso}(M,s,t,c)'], proved);
check('the whole category', [...POSET, '\\mathsf{Cat}(O,M,s,t,c,i)'], proved);

/** A monoid is a one-object category, including one that is not a group. */
const MONOID = [
  'O:=\\{0\\}',
  'M:=\\{0,1,2,3,4,5\\}',
  's(m):=0',
  't(m):=0',
  'c(f,g):=\\operatorname{mod}(f\\cdot g,6)',
  'i(x):=1',
];
check('multiplication mod 6 is a one-object category', [...MONOID, '\\mathsf{Cat}(O,M,s,t,c,i)'], proved);
check('and it is not a group', [...MONOID, '\\mathsf{Inv}(M,c,1)'], exactFalse);

// Each axiom must fail on its own, or the conjunction proves nothing: a `Cat`
// that only ever answered through one of its three parts would pass every
// positive test above.
check('a missing composite is refused', [
  'O:=\\{0,1,2\\}', 'M:=\\{0,1,4,5,8\\}',
  's(m):=\\lfloor m/3\\rfloor', 't(m):=\\operatorname{mod}(m,3)',
  'c(f,g):=3s(f)+t(g)', 'i(x):=4x',
  '\\mathsf{Cmp}(O,M,s,t,c)',
], exactFalse);
check('an object with no identity is refused', [
  'O:=\\{0,1,2,3\\}', 'M:=\\{0,1,2,4,5,8\\}',
  's(m):=\\lfloor m/3\\rfloor', 't(m):=\\operatorname{mod}(m,3)',
  'c(f,g):=3s(f)+t(g)', 'i(x):=4x',
  '\\mathsf{Idt}(O,M,s,t,c,i)',
], exactFalse);
check('an identity that is not a unit is refused', [
  ...POSET.slice(0, 5), 'i(x):=8',
  '\\mathsf{Idt}(O,M,s,t,c,i)',
], exactFalse);
check('a non-associative composition is refused', [
  'O:=\\{0\\}', 'M:=\\{0,1,2,3\\}', 's(m):=0', 't(m):=0',
  'c(f,g):=\\operatorname{mod}(f+g\\cdot g,4)', 'i(x):=0',
  '\\mathsf{Aso}(M,s,t,c)',
], exactFalse);
check('an endpoint outside the objects is refused', [
  'O:=\\{0,1\\}', 'M:=\\{0,1,2,4,5,8\\}',
  's(m):=\\lfloor m/3\\rfloor', 't(m):=\\operatorname{mod}(m,3)',
  'c(f,g):=3s(f)+t(g)', 'i(x):=4x',
  '\\mathsf{Cmp}(O,M,s,t,c)',
], exactFalse);

check('a category on an infinite carrier is an honest unknown', [
  'O:=\\{0\\}', 's(m):=0', 't(m):=0', 'c(f,g):=f+g', 'i(x):=0',
  '\\mathsf{Cat}(O,\\mathbb{Z},s,t,c,i)',
], honestUnknown);
check('a source that is not a one-argument definition is an honest unknown', [
  ...POSET.slice(0, 2), 't(m):=\\operatorname{mod}(m,3)', 'c(f,g):=3+t(g)', 'i(x):=4x',
  '\\mathsf{Cat}(O,M,zz,t,c,i)',
], honestUnknown);

console.log('== functors ==');

/** C is the poset; D is Z/3 as a one-object category. */
const FUNCTOR = [
  ...POSET,
  'C:=\\mathsf{Cat}(O,M,s,t,c,i)',
  'P:=\\{0\\}',
  'N:=\\{0,1,2\\}',
  'u(n):=0',
  'v(n):=0',
  'd(m,n):=\\operatorname{mod}(m+n,3)',
  'j(x):=0',
  'D:=\\mathsf{Cat}(P,N,u,v,d,j)',
];

check('a named category is itself askable', [...FUNCTOR, 'C'], proved);
check('the length functor to Z/3', [
  ...FUNCTOR, 'F(m):=\\operatorname{mod}(t(m)-s(m),3)', 'G(x):=0', '\\mathsf{Fun}(C,D,F,G)',
], proved);
check('the identity functor', [
  ...FUNCTOR, 'F(m):=m', 'G(x):=x', '\\mathsf{Fun}(C,C,F,G)',
], proved);

// One failure per law, since a checker that ran only one of the three would
// pass both positives above.
check('a map that breaks composition is not a functor', [
  ...FUNCTOR, 'F(m):=\\operatorname{mod}((t(m)-s(m))^2,3)', 'G(x):=0', '\\mathsf{Fun}(C,D,F,G)',
], exactFalse);
check('a map that moves identities is not a functor', [
  ...FUNCTOR, 'F(m):=\\operatorname{mod}(t(m)-s(m)+1,3)', 'G(x):=0', '\\mathsf{Fun}(C,D,F,G)',
], exactFalse);
check('an object map disagreeing with the morphism map is not a functor', [
  ...FUNCTOR, 'F(m):=m', 'G(x):=\\operatorname{mod}(x+1,3)', '\\mathsf{Fun}(C,C,F,G)',
], exactFalse);
check('a morphism map leaving the target category is not a functor', [
  ...FUNCTOR, 'F(m):=m+100', 'G(x):=x', '\\mathsf{Fun}(C,C,F,G)',
], exactFalse);

check('a functor between things that are not named categories is an honest unknown', [
  ...FUNCTOR, 'F(m):=m', 'G(x):=x', '\\mathsf{Fun}(O,M,F,G)',
], honestUnknown);

console.log('== category rows carry a trace ==');
check('a proved category row cites the exhaustion it ran', [
  ...POSET, '\\mathsf{Cat}(O,M,s,t,c,i)',
], (result) => {
  if (result.proofStatus !== 'available') return 'expected a trace';
  const step = result.proof.steps.at(-1);
  if (step?.rule !== 'algebra.finite-exhaustion') return `cited ${step?.rule}`;
  // The exhaustion runs over morphisms; reporting the three objects would
  // describe a search that never happened.
  return step.data?.carrier === 6 ? null : `carrier reported as ${step.data?.carrier}`;
});

if (failures.length) {
  console.error(`\n${failures.join('\n\n')}\n`);
  console.error(`${passed} passed, ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log(`\n${passed} algebra cases passed`);
}
