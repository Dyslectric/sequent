/**
 * Kernel checks. Run with `npm test`.
 *
 * A checker that accepts everything passes every positive test, so most of
 * this file is negative. Three properties matter, in rising order of value:
 *
 *   - a valid step is verified;
 *   - a step that is not an instance of the rule it names is refused;
 *   - corrupting any step of a real proof destroys its verification.
 *
 * The third is the mutation test, generated mechanically from the demo
 * catalogue, and it is the one that would catch a checker quietly rotting into
 * a rubber stamp.
 */
import {
  CHECKED_RULES,
  TRUST_ORDER,
  certify,
  checkTrace,
  parseProposition,
  sameProposition,
  stepTrustLabel,
  trustSummary,
  weakestTrust,
} from '../src/lib/kernel.js';
import {
  addPolynomials,
  affineRatio,
  constantOf,
  constantPolynomial,
  dividePolynomials,
  isZeroPolynomial,
  multiplyPolynomials,
  polynomialKey,
  powerPolynomial,
  rational,
  sameRational,
  samePolynomial,
  scalarRatio,
  scalePolynomial,
  subtractPolynomials,
  variablePolynomial,
} from '../src/lib/kernel-polynomial.js';
import { PROOF_VERSION, isValidTrace } from '../src/lib/proof-trace.js';
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

/** A trace built by hand, so that a checker can be aimed at one step. */
function trace(...steps) {
  return {
    version: PROOF_VERSION,
    root: steps.at(-1).id,
    steps: steps.map((step) => ({ premises: [], data: null, ...step })),
  };
}

const rootTrust = (built) => checkTrace(built).steps.get(built.root).trust;

/** Assert the root step of a hand-built trace reaches `expected`. */
const roots = (expected, built) => (rootTrust(built) === expected
  ? null : `root is ${rootTrust(built)}, expected ${expected}`);

console.log('== the kernel arithmetic ==');

const x = variablePolynomial('x');
const y = variablePolynomial('y');
const int = (n) => constantPolynomial(rational(BigInt(n)));

check('rationals stay exact and in lowest terms', () => {
  const half = rational(2n, 4n);
  if (half.n !== 1n || half.d !== 2n) return `2/4 became ${half.n}/${half.d}`;
  const negative = rational(3n, -6n);
  if (negative.n !== -1n || negative.d !== 2n) return 'the sign did not move to the numerator';
  // Well past a double's integer range, where floating point would round.
  const big = rational(9007199254740991n, 3n);
  return big.n === 9007199254740991n && big.d === 3n ? null : 'a large integer was rounded';
});

check('the ring operations agree with algebra', () => {
  // (x + y)^2 = x^2 + 2xy + y^2
  const square = powerPolynomial(addPolynomials(x, y), 2);
  const expanded = addPolynomials(
    addPolynomials(powerPolynomial(x, 2), powerPolynomial(y, 2)),
    scalePolynomial(multiplyPolynomials(x, y), rational(2n)),
  );
  if (!samePolynomial(square, expanded)) return '(x+y)^2 did not expand';
  if (!isZeroPolynomial(subtractPolynomials(square, expanded))) return 'the difference is not zero';
  return null;
});

check('a constant is recognised and a variable is not', () => {
  if (!sameRational(constantOf(int(7)), rational(7n))) return '7 was not constant';
  if (constantOf(x) !== null) return 'x was called constant';
  return null;
});

check('exact division finds the cofactor, and refuses when there is none', () => {
  // x^2 - 4 = (x - 2)(x + 2)
  const difference = subtractPolynomials(powerPolynomial(x, 2), int(4));
  const quotient = dividePolynomials(difference, subtractPolynomials(x, int(2)));
  if (!quotient) return 'x - 2 was said not to divide x^2 - 4';
  if (!samePolynomial(quotient, addPolynomials(x, int(2)))) return 'the cofactor is wrong';
  const impossible = dividePolynomials(subtractPolynomials(powerPolynomial(x, 2), int(5)),
    subtractPolynomials(x, int(2)));
  return impossible === null ? null : 'a non-multiple was divided';
});

check('a scalar ratio is found only when one really scales the other', () => {
  const ratio = scalarRatio(subtractPolynomials(x, y),
    scalePolynomial(subtractPolynomials(x, y), rational(3n, 2n)));
  if (!ratio || !sameRational(ratio, rational(3n, 2n))) return 'the ratio 3/2 was missed';
  if (scalarRatio(x, addPolynomials(x, int(1)))) return 'x and x+1 were called proportional';
  return null;
});

check('an affine map is recovered from the two polynomials', () => {
  // 2(x - y) + 5
  const target = addPolynomials(scalePolynomial(subtractPolynomials(x, y), rational(2n)), int(5));
  const affine = affineRatio(subtractPolynomials(x, y), target);
  if (!affine) return 'no affine map was found';
  if (!sameRational(affine.c, rational(2n))) return `scale is ${affine.c.n}/${affine.c.d}`;
  if (!sameRational(affine.k, rational(5n))) return `offset is ${affine.k.n}/${affine.k.d}`;
  return affineRatio(int(3), x) === null ? null : 'a constant was treated as an affine source';
});

check('an expansion too large to be worth doing is refused, not attempted', () => {
  // A reader may type `(x+y+z+w)^{64}`, which has eleven million terms. The
  // kernel gives up rather than expanding it, and the step it could not check
  // simply stays admitted.
  const wide = [x, y, variablePolynomial('z'), variablePolynomial('w')]
    .reduce((sum, term) => addPolynomials(sum, term));
  const started = Date.now();
  if (powerPolynomial(wide, 64) !== null) return 'an eleven-million-term expansion was attempted';
  if (Date.now() - started > 2000) return 'giving up took longer than doing it should';
  return powerPolynomial(wide, 4) ? null : 'a reasonable expansion was refused too';
});

check('the canonical key identifies exactly what the scaling allows', () => {
  const difference = subtractPolynomials(x, y);
  const doubled = scalePolynomial(difference, rational(2n));
  const flipped = subtractPolynomials(y, x);
  const positive = { upToPositiveScale: true };
  if (polynomialKey(difference, positive) !== polynomialKey(doubled, positive)) {
    return 'x - y and 2x - 2y differ under positive scaling';
  }
  if (polynomialKey(difference, positive) === polynomialKey(flipped, positive)) {
    return 'x - y and y - x were identified under positive scaling';
  }
  if (polynomialKey(difference, { upToScale: true }) !== polynomialKey(flipped, { upToScale: true })) {
    return 'x - y and y - x differ under free scaling';
  }
  return null;
});

console.log('== reading propositions ==');

check('the same claim in different spellings is one proposition', () => {
  const pairs = [
    ['x < y', 'y>x'],
    ['x \\lt y', 'x<y'],
    ['0\\le x^2', 'x^2\\ge 0'],
    ['a \\vdash b', 'a\\implies b'],
    ['p\\land q', 'p\\wedge q'],
    ['\\frac{\\epsilon}{2}>0', '\\epsilon/2>0'],
    ['x\\in\\mathbb{R}', 'x\\in\\R'],
    ['a=b', 'b=a'],
    ['p\\wedge q', 'q\\wedge p'],
    ['\\neg p', '\\lnot p'],
  ];
  for (const [left, right] of pairs) {
    if (!sameProposition(left, right)) return `${left} did not match ${right}`;
  }
  return null;
});

check('propositions that differ are not conflated', () => {
  const pairs = [
    ['x<y', 'x\\le y'],
    ['x^2\\ge 0', 'x^2\\ge 1'],
    ['p\\wedge q', 'p\\vee q'],
    ['p\\implies q', 'q\\implies p'],
    ['a<b', 'b<a'],
    ['\\neg p', 'p'],
    // Equality is symmetric and is normalized; an order relation is not.
    ['a\\le b', 'b\\le a'],
  ];
  for (const [left, right] of pairs) {
    if (sameProposition(left, right)) return `${left} was conflated with ${right}`;
  }
  return null;
});

check('a chain is the conjunction of its adjacent links', () => (
  sameProposition('a=b\\ge 0', 'a=b\\wedge b\\ge 0')
    ? null : 'a mixed relation chain was not read as its links'
));

check('a chain of inequations is not weakened to its adjacent links', () => {
  // `a \ne b \ne c` means pairwise distinct, which is strictly more than the
  // adjacent links; reading it as the links would accept a proof of less.
  const parsed = parseProposition('a\\ne b\\ne c');
  return parsed === null ? null : 'an inequation chain was read as a conjunction';
});

check('an unreadable proposition is null rather than a guess', () => {
  for (const latex of ['', '   ', 'x\\wedge', '(x>0', '\\forall x']) {
    if (parseProposition(latex) !== null) return `${latex} was given a parse`;
  }
  return null;
});

check('an ambiguous identity sign is declined rather than guessed at', () => {
  // `\equiv` is an equality between terms and a connective between
  // propositions, and the two readings of `a\wedge b\equiv c` are different
  // claims. Alone it is readable; mixed with a connective it is not.
  if (parseProposition('a\\equiv b') === null) return 'a plain identity was refused';
  for (const latex of ['a\\wedge b\\equiv c', 'a\\equiv b\\implies c', '\\neg a\\equiv b']) {
    if (parseProposition(latex) !== null) return `${latex} was given a reading`;
  }
  return null;
});

check('an opaque predicate is an atom, not a failure', () => (
  sameProposition('\\mathsf{Grp}(G,m,0)', '\\mathsf{Grp}(G, m, 0)')
    ? null : 'a predicate application was not read as an atom'
));

console.log('== the trust ordering ==');

check('the ordering runs from refused to checked', () => {
  const expected = ['rejected', 'oracle', 'axiom', 'certified', 'verified'];
  if (TRUST_ORDER.join() !== expected.join()) return `order is ${TRUST_ORDER.join()}`;
  if (weakestTrust('verified', 'oracle') !== 'oracle') return 'oracle did not win';
  if (weakestTrust('axiom', 'certified') !== 'axiom') return 'axiom did not win';
  return null;
});

check('a trace reports its weakest step, not its best', () => {
  const built = certify(trace(
    { id: 's1', rule: 'engine.exact-evaluation', conclusionLatex: 'x^2\\ge 0' },
    { id: 's2', rule: 'logic.implies-intro', premises: ['s1'], conclusionLatex: '\\top\\vdash x^2\\ge 0' },
  ));
  if (built.steps[1].trust !== 'verified') return 'the checked step was not verified';
  return built.trust === 'oracle' ? null : `trace trust is ${built.trust}`;
});

console.log('== the rules the kernel checks ==');

check('a propositional tautology is certified by its complete truth table', () => roots(
  'certified', trace({
    id: 's1',
    rule: 'logic.tautology',
    conclusionLatex: 'A\\wedge B\\vdash A',
  }),
));

check('a non-tautology is not certified', () => roots(
  'axiom', trace({ id: 's1', rule: 'logic.tautology', conclusionLatex: 'A\\vdash B' }),
));

check('the tautology checker handles negation and equivalence', () => roots(
  'certified', trace({
    id: 's1',
    rule: 'logic.tautology',
    conclusionLatex: '\\neg(A\\vee B)\\iff(\\neg A\\wedge\\neg B)',
  }),
));

check('the same normalized relation is one Boolean atom', () => roots(
  'certified', trace({
    id: 's1',
    rule: 'logic.tautology',
    conclusionLatex: 'x>y\\vdash 2x>2y',
  }),
));

check('a truth table beyond the kernel bound stays admitted', () => {
  const atoms = Array.from({ length: 13 }, (_, index) => `P_{${index}}`);
  const conclusion = `(${atoms[0]}\\vee\\neg ${atoms[0]})\\vee${atoms.slice(1).join('\\vee')}`;
  return roots('axiom', trace({ id: 's1', rule: 'logic.tautology', conclusionLatex: conclusion }));
});

check('free-group reduction certifies the socks-and-shoes identity', () => roots(
  'certified', trace({
    id: 's1',
    rule: 'group.free-reduction',
    conclusionLatex: '\\mathsf{Grp}\\vdash(xy)^{-1}=y^{-1}x^{-1}',
    data: { normalFormLatex: 'y^{-1}x^{-1}', abelian: false },
  }),
));

check('a false group identity is not certified', () => roots(
  'axiom', trace({
    id: 's1',
    rule: 'group.free-reduction',
    conclusionLatex: '\\mathsf{Grp}\\vdash xy=yx',
    data: { normalFormLatex: 'xy', abelian: false },
  }),
));

check('an incorrect displayed group normal form breaks the certificate', () => roots(
  'axiom', trace({
    id: 's1',
    rule: 'group.free-reduction',
    conclusionLatex: '\\mathsf{Grp}\\vdash xx^{-1}=1',
    data: { normalFormLatex: 'x', abelian: false },
  }),
));

check('free-abelian reduction certifies commutativity', () => roots(
  'certified', trace({
    id: 's1',
    rule: 'group.free-reduction',
    conclusionLatex: '\\mathsf{Abl}\\vdash xy=yx',
    data: { normalFormLatex: 'xy', abelian: true },
  }),
));

check('an abelian certificate cannot be used under the group axioms', () => roots(
  'axiom', trace({
    id: 's1',
    rule: 'group.free-reduction',
    conclusionLatex: '\\mathsf{Grp}\\vdash xy=yx',
    data: { normalFormLatex: 'xy', abelian: true },
  }),
));

check('commands outside the group-word fragment stay admitted', () => roots(
  'axiom', trace({
    id: 's1',
    rule: 'group.free-reduction',
    conclusionLatex: '\\mathsf{Grp}\\vdash\\sin(x)=x',
    data: { normalFormLatex: 'x', abelian: false },
  }),
));

check('conjunction introduction takes both conjuncts', () => roots('verified', trace(
  { id: 's1', rule: 'polynomial.even-power', conclusionLatex: '0\\le x^2' },
  { id: 's2', rule: 'polynomial.even-power', conclusionLatex: '0\\le y^2' },
  { id: 's3', rule: 'logic.and-intro', premises: ['s1', 's2'], conclusionLatex: 'x^2\\ge 0\\wedge y^2\\ge 0' },
)));

check('conjunction introduction refuses a conjunct nobody proved', () => roots('axiom', trace(
  { id: 's1', rule: 'polynomial.even-power', conclusionLatex: '0\\le x^2' },
  { id: 's2', rule: 'logic.and-intro', premises: ['s1'], conclusionLatex: 'x^2\\ge 0\\wedge y^2\\ge 0' },
)));

check('conjunction introduction refuses a conclusion that is not a conjunction', () => roots('rejected', trace(
  { id: 's1', rule: 'polynomial.even-power', conclusionLatex: '0\\le x^2' },
  { id: 's2', rule: 'logic.and-intro', premises: ['s1'], conclusionLatex: 'x^2\\ge 0\\vee y^2\\ge 0' },
)));

check('conjunction introduction works under a shared antecedent', () => roots('verified', trace(
  { id: 's1', rule: 'order.affine-monotonicity', conclusionLatex: 'y\\lt x\\implies y\\lt x+1' },
  { id: 's2', rule: 'order.affine-monotonicity', conclusionLatex: 'y\\lt x\\implies y\\lt x+2' },
  { id: 's3', rule: 'logic.and-intro', premises: ['s1', 's2'], conclusionLatex: 'x>y\\vdash x+1>y\\wedge x+2>y' },
)));

check('a different antecedent is not a shared one', () => roots('axiom', trace(
  { id: 's1', rule: 'order.affine-monotonicity', conclusionLatex: 'y\\lt x\\implies y\\lt x+1' },
  { id: 's2', rule: 'order.affine-monotonicity', conclusionLatex: 'y\\lt z\\implies y\\lt x+2' },
  { id: 's3', rule: 'logic.and-intro', premises: ['s1', 's2'], conclusionLatex: 'x>y\\vdash x+1>y\\wedge x+2>y' },
)));

check('an unused premise does not spoil a step', () => roots('verified', trace(
  { id: 's1', rule: 'definition.unfold', conclusionLatex: 'd(\\epsilon) = \\frac{\\epsilon}{2}' },
  { id: 's2', rule: 'polynomial.even-power', conclusionLatex: '0\\le x^2' },
  { id: 's3', rule: 'polynomial.even-power', conclusionLatex: '0\\le y^2' },
  { id: 's4', rule: 'logic.and-intro', premises: ['s2', 's3', 's1'], conclusionLatex: 'x^2\\ge 0\\wedge y^2\\ge 0' },
)));

check('disjunction introduction takes one disjunct', () => roots('verified', trace(
  { id: 's1', rule: 'polynomial.even-power', conclusionLatex: '0\\le y^2' },
  { id: 's2', rule: 'logic.or-intro', premises: ['s1'], conclusionLatex: 'y^2\\ge 0\\vee y^2<0' },
)));

check('disjunction introduction refuses a disjunct nobody proved', () => roots('axiom', trace(
  { id: 's1', rule: 'polynomial.even-power', conclusionLatex: '0\\le x^2' },
  { id: 's2', rule: 'logic.or-intro', premises: ['s1'], conclusionLatex: 'y^2\\ge 0\\vee y^2<0' },
)));

check('conjunction elimination weakens an antecedent', () => roots('verified', trace(
  { id: 's1', rule: 'order.positive-scale', conclusionLatex: 'y\\lt x\\implies0\\le x^2' },
  { id: 's2', rule: 'logic.and-elim', premises: ['s1'], conclusionLatex: 'x>y\\wedge y>0\\vdash x^2\\ge 0' },
)));

check('conjunction elimination refuses an antecedent that was never assumed', () => roots('axiom', trace(
  { id: 's1', rule: 'order.positive-scale', conclusionLatex: 'y\\lt z\\implies0\\le x^2' },
  { id: 's2', rule: 'logic.and-elim', premises: ['s1'], conclusionLatex: 'x>y\\wedge y>0\\vdash x^2\\ge 0' },
)));

check('proof by cases needs every case', () => roots('verified', trace(
  { id: 's1', rule: 'polynomial.even-power', conclusionLatex: 'y\\lt x\\implies0\\le x^2' },
  { id: 's2', rule: 'polynomial.even-power', conclusionLatex: 'x\\lt y\\implies0\\le x^2' },
  { id: 's3', rule: 'logic.cases', premises: ['s1', 's2'], conclusionLatex: 'x>y\\vee y>x\\vdash x^2\\ge 0' },
)));

check('proof by cases refuses a case left out', () => roots('axiom', trace(
  { id: 's1', rule: 'polynomial.even-power', conclusionLatex: 'y\\lt x\\implies0\\le x^2' },
  { id: 's2', rule: 'logic.cases', premises: ['s1'], conclusionLatex: 'x>y\\vee y>x\\vdash x^2\\ge 0' },
)));

check('equivalence introduction needs both directions', () => roots('verified', trace(
  { id: 's1', rule: 'relation.normalize', conclusionLatex: 'y\\lt x\\implies y+1\\lt x+1' },
  { id: 's2', rule: 'relation.normalize', conclusionLatex: 'y+1\\lt x+1\\implies y\\lt x' },
  { id: 's3', rule: 'logic.iff-intro', premises: ['s1', 's2'], conclusionLatex: 'x>y\\iff x+1>y+1' },
)));

check('equivalence introduction refuses one direction twice', () => roots('axiom', trace(
  // Both sides of this equivalence are genuinely different claims, so one
  // direction cannot stand in for the other. (`x > y \iff x+1 > y+1` no longer
  // makes the point: since phase two the kernel sees those as one atom.)
  { id: 's1', rule: 'order.power-monotonicity', conclusionLatex: '0\\lt x\\implies0\\lt x^2' },
  { id: 's2', rule: 'logic.iff-intro', premises: ['s1', 's1'], conclusionLatex: 'x>0\\iff x^2>0' },
)));

check('modus ponens needs the implication and its antecedent', () => roots('verified', trace(
  { id: 's1', rule: 'polynomial.even-power', conclusionLatex: '0\\lt x' },
  { id: 's2', rule: 'relation.normalize', conclusionLatex: '0\\lt x\\implies0\\lt x^2' },
  { id: 's3', rule: 'logic.implies-elim', premises: ['s1', 's2'], conclusionLatex: 'x^2>0' },
)));

check('modus ponens refuses an antecedent nobody established', () => roots('axiom', trace(
  { id: 's2', rule: 'relation.normalize', conclusionLatex: '0\\lt x\\implies0\\lt x^2' },
  { id: 's3', rule: 'logic.implies-elim', premises: ['s2'], conclusionLatex: 'x^2>0' },
)));

check('implication introduction discharges an antecedent it never needed', () => roots('verified', trace(
  { id: 's1', rule: 'polynomial.even-power', conclusionLatex: '0\\le x^2' },
  { id: 's2', rule: 'logic.implies-intro', premises: ['s1'], conclusionLatex: '\\top\\vdash x^2\\ge 0' },
)));

check('implication introduction refuses a consequent nobody proved', () => roots('axiom', trace(
  { id: 's1', rule: 'polynomial.even-power', conclusionLatex: '0\\le y^2' },
  { id: 's2', rule: 'logic.implies-intro', premises: ['s1'], conclusionLatex: '\\top\\vdash x^2\\ge 0' },
)));

check('implication introduction refuses a conclusion that is not an implication', () => roots('rejected', trace(
  { id: 's1', rule: 'polynomial.even-power', conclusionLatex: '0\\le x^2' },
  { id: 's2', rule: 'logic.implies-intro', premises: ['s1'], conclusionLatex: 'x^2\\ge 0' },
)));

check('a false antecedent is vacuously enough', () => roots('verified', trace(
  { id: 's1', rule: 'logic.vacuous', conclusionLatex: '\\bot\\vdash x^2<0' },
)));

check('an antecedent merely believed impossible is not checked', () => roots('axiom', trace(
  { id: 's1', rule: 'logic.vacuous', conclusionLatex: 'x^2<0\\vdash x>x' },
)));

console.log('== the rewrites ==');

/** A one-step trace whose only step is the rewrite under test. */
const rewrite = (rule, conclusionLatex, data = null) => trace({ id: 's1', rule, conclusionLatex, data });

check('exact normalization accepts a restatement of the same relation', () => roots(
  'verified', rewrite('relation.normalize', 'y\\lt x\\implies y+1\\lt x+1'),
));

check('exact normalization accepts an equivalence both ways', () => roots(
  'verified', rewrite('relation.normalize', 'x>y\\iff x+1>y+1'),
));

check('exact normalization refuses a relation it did not restate', () => roots(
  'axiom', rewrite('relation.normalize', 'y\\lt x\\implies y+1\\lt x+2'),
));

check('an identity that expands to zero is checked outright', () => roots(
  'verified', rewrite('polynomial.identity', 'a^2+b^2-2ab=(a-b)^2'),
));

check('an identity that does not expand to zero is not checked', () => roots(
  'axiom', rewrite('polynomial.identity', 'a^2+b^2-2ab=(a+b)^2'),
));

check('an even-power witness is certified by exact expansion', () => roots(
  'certified', rewrite('polynomial.even-power', 'x^2+y^2\\ge 2xy', {
    witnessLatex: '(x-y)^2',
  }),
));

check('an even-power rule without its witness stays admitted', () => roots(
  'axiom', rewrite('polynomial.even-power', 'x^2+y^2\\ge 2xy'),
));

check('a witness for a different polynomial is not accepted', () => roots(
  'axiom', rewrite('polynomial.even-power', 'x^2+y^2\\ge 2xy', {
    witnessLatex: '(x+y)^2',
  }),
));

check('mixed-sign monomials do not masquerade as an even-power witness', () => roots(
  'axiom', rewrite('polynomial.even-power', 'x^2-y^2\\ge 0', {
    witnessLatex: 'x^2-y^2',
  }),
));

check('a square alone does not certify strict positivity', () => roots(
  'axiom', rewrite('polynomial.even-power', '(x-y)^2>0', {
    witnessLatex: '(x-y)^2',
  }),
));

check('a positive constant makes an even-monomial witness strictly positive', () => roots(
  'certified', rewrite('polynomial.even-power', 'x^2+y^2+1>0', {
    witnessLatex: 'x^2+y^2+1',
  }),
));

check('a compound square is certified without trusting its expansion', () => roots(
  'certified', rewrite('polynomial.even-power', '(xy+z)^2\\ge0', {
    witnessLatex: '(xy+z)^2',
  }),
));

const psdWitness = {
  sosCoefficientsLatex: ['1', '\\frac{3}{4}'],
  sosBasesLatex: ['a-\\frac{1}{2}b-\\frac{1}{2}c', 'b-c'],
};

check('a rational sum of squares certifies a positive-semidefinite form', () => roots(
  'certified', rewrite('quadratic.psd', 'a^2+b^2+c^2\\ge ab+bc+ca', psdWitness),
));

check('a PSD rule without its decomposition stays admitted', () => roots(
  'axiom', rewrite('quadratic.psd', 'a^2+b^2+c^2\\ge ab+bc+ca'),
));

check('a changed PSD coefficient breaks the certificate', () => roots(
  'axiom', rewrite('quadratic.psd', 'a^2+b^2+c^2\\ge ab+bc+ca', {
    ...psdWitness,
    sosCoefficientsLatex: ['1', '\\frac{1}{2}'],
  }),
));

check('a negative square coefficient is never a PSD certificate', () => roots(
  'axiom', rewrite('quadratic.psd', 'x^2-y^2\\ge0', {
    sosCoefficientsLatex: ['1', '-1'],
    sosBasesLatex: ['x', 'y'],
  }),
));

check('a sum of squares for another polynomial is not accepted', () => roots(
  'axiom', rewrite('quadratic.psd', 'a^2+b^2+c^2\\ge ab+bc+ca', {
    ...psdWitness,
    sosBasesLatex: ['a+\\frac{1}{2}b+\\frac{1}{2}c', 'b-c'],
  }),
));

check('a positive constant square certifies strict positivity', () => roots(
  'certified', rewrite('quadratic.psd', 'x^2+y^2+1>0', {
    sosCoefficientsLatex: ['1', '1', '1'],
    sosBasesLatex: ['x', 'y', '1'],
  }),
));

check('squares that can vanish do not certify strict positivity', () => roots(
  'axiom', rewrite('quadratic.psd', 'x^2+y^2>0', {
    sosCoefficientsLatex: ['1', '1'],
    sosBasesLatex: ['x', 'y'],
  }),
));

check('a difference of exactly zero refutes an inequation', () => roots(
  // Whatever `\cos` means, it cannot differ from itself.
  'rejected', rewrite('relation.normalize', '\\cos(t)\\ne\\cos(t)'),
));

check('positive scaling accepts a positive factor', () => roots(
  'verified', rewrite('order.positive-scale', 'x>y\\implies 2x>2y', { scaleLatex: '2' }),
));

check('positive scaling accepts a positive fraction', () => roots(
  'verified', rewrite('order.positive-scale', 'a>b\\implies a/2>b/2', { scaleLatex: '\\frac{1}{2}' }),
));

check('positive scaling refuses a negative factor, whatever the step claims', () => roots(
  // The prover's own label says the factor was positive; the kernel finds -2
  // and declines to take its word for it.
  'axiom', rewrite('order.positive-scale', 'x>y\\implies 2y-2x>0', { scaleLatex: '2' }),
));

check('scaling by a nonzero factor accepts a negative one on an equation', () => roots(
  'verified', rewrite('relation.nonzero-scale', 'x=y\\implies-3x=-3y', { scaleLatex: '-3' }),
));

check('scaling refuses to strengthen a relation it may not', () => roots(
  // `x >= 0` scaled by 2 gives `2x >= 0`, never `2x > 0`.
  'axiom', rewrite('order.positive-scale', 'x\\ge 0\\implies 2x>0', { scaleLatex: '2' }),
));

check('affine monotonicity accepts an offset in the safe direction', () => roots(
  'verified', rewrite('order.affine-monotonicity', 'x>y\\implies x+1>y',
    { scaleLatex: '1', offsetLatex: '1' }),
));

check('affine monotonicity refuses an offset in the unsafe direction', () => roots(
  // `x > 0` does not give `x - 1 > 0`.
  'axiom', rewrite('order.affine-monotonicity', 'x>0\\implies x-1>0',
    { scaleLatex: '1', offsetLatex: '-1' }),
));

check('power monotonicity carries a strict sign through an odd power', () => roots(
  'verified', rewrite('order.power-monotonicity', 'x>0\\implies x^3>0', { exponent: 3 }),
));

check('power monotonicity refuses to make a weak sign strict', () => roots(
  // `x >= 0` gives `x^2 >= 0`, never `x^2 > 0`.
  'axiom', rewrite('order.power-monotonicity', 'x\\ge 0\\implies x^2>0', { exponent: 2 }),
));

check('power monotonicity refuses an exponent that does not relate the sides', () => roots(
  'axiom', rewrite('order.power-monotonicity', 'x>0\\implies x^3>0', { exponent: 2 }),
));

check('a polynomial multiple carries an equation', () => roots(
  'verified', rewrite('polynomial.multiple', 'x=2\\implies x^2=4'),
));

check('a polynomial that is not a multiple does not', () => roots(
  'axiom', rewrite('polynomial.multiple', 'x=2\\implies x^2=5'),
));

check('an application is never read as a product', () => {
  // Reading `h(2y)` as `h * 2 * y` is the one mistake in the arithmetic reader
  // that could accept a bad step, so it is refused by construction.
  if (sameProposition('h(2y)=0', '2hy=0')) return 'an application was multiplied out';
  return sameProposition('h(2y)=0', 'h(2y)=0') ? null : 'an application stopped matching itself';
});

check('an opaque term is an indeterminate, not an excuse', () => {
  // Nothing here knows what `\cos` is, and it does not need to.
  if (!sameProposition('2\\cos(t)+1=1+2\\cos(t)', '0=0')) return 'a rearrangement was missed';
  if (sameProposition('\\cos(t)=\\sin(t)', '0=0')) return 'two different terms were identified';
  return null;
});

console.log('== quantifiers ==');

check('universal generalization carries an arbitrary variable', () => roots('verified', trace(
  { id: 's1', rule: 'polynomial.even-power', conclusionLatex: '0\\le x^2' },
  {
    id: 's2',
    rule: 'logic.universal-generalization',
    premises: ['s1'],
    conclusionLatex: '\\forall x\\in\\mathbb{R},x^2\\ge 0',
    data: { bindingsLatex: ['x\\in\\R'] },
  },
)));

check('universal generalization refuses a variable that was assumed something', () => roots('axiom', trace(
  { id: 's1', rule: 'logic.assumption', conclusionLatex: 'x>0' },
  { id: 's2', rule: 'polynomial.even-power', premises: ['s1'], conclusionLatex: '0\\le x^2' },
  {
    id: 's3',
    rule: 'logic.universal-generalization',
    premises: ['s2'],
    conclusionLatex: '\\forall x\\in\\mathbb{R},x^2\\ge 0',
    data: { bindingsLatex: ['x\\in\\R'] },
  },
)));

check('universal generalization refuses a conclusion with no quantifier', () => roots('rejected', trace(
  { id: 's1', rule: 'polynomial.even-power', conclusionLatex: '0\\le x^2' },
  { id: 's2', rule: 'logic.universal-generalization', premises: ['s1'], conclusionLatex: 'x^2\\ge 0' },
)));

check('universal generalization refuses a body that is not what was proved', () => roots('axiom', trace(
  { id: 's1', rule: 'polynomial.even-power', conclusionLatex: '0\\le y^2' },
  {
    id: 's2',
    rule: 'logic.universal-generalization',
    premises: ['s1'],
    conclusionLatex: '\\forall x\\in\\mathbb{R},x^2\\ge 0',
    data: { bindingsLatex: ['x\\in\\R'] },
  },
)));

check('existential introduction takes a witness, the claim at it, and its membership', () => roots('verified', trace(
  { id: 's1', rule: 'engine.exact-evaluation', conclusionLatex: '2^2=4' },
  { id: 's2', rule: 'engine.exact-evaluation', conclusionLatex: '2\\in\\mathbb{R}' },
  {
    id: 's3',
    rule: 'logic.exists-intro',
    premises: ['s1', 's2'],
    conclusionLatex: '\\exists x\\in\\mathbb{R},x^2=4',
    data: { witnessLatex: '2' },
  },
)));

check('existential introduction refuses a witness the claim was not proved of', () => roots('axiom', trace(
  // The claim was established at 2 while the step names 3 as its witness, so
  // nothing in the trace says anything about 3.
  { id: 's1', rule: 'engine.exact-evaluation', conclusionLatex: '2^2=4' },
  { id: 's2', rule: 'engine.exact-evaluation', conclusionLatex: '3\\in\\mathbb{R}' },
  {
    id: 's3',
    rule: 'logic.exists-intro',
    premises: ['s1', 's2'],
    conclusionLatex: '\\exists x\\in\\mathbb{R},x^2=4',
    data: { witnessLatex: '3' },
  },
)));

check('existential introduction refuses a witness nobody placed in the domain', () => roots('axiom', trace(
  { id: 's1', rule: 'engine.exact-evaluation', conclusionLatex: '2^2=4' },
  {
    id: 's2',
    rule: 'logic.exists-intro',
    premises: ['s1'],
    conclusionLatex: '\\exists x\\in\\mathbb{R},x^2=4',
    data: { witnessLatex: '2' },
  },
)));

check('existential introduction refuses a step with no witness named', () => roots('axiom', trace(
  { id: 's1', rule: 'engine.exact-evaluation', conclusionLatex: '2^2=4' },
  { id: 's2', rule: 'logic.exists-intro', premises: ['s1'], conclusionLatex: '\\exists x\\in\\mathbb{R},x^2=4' },
)));

console.log('== the demo catalogue, checked ==');

/**
 * Statements that reach a logic rule the demo catalogue happens not to use.
 *
 * Sheets of one variable are settled by a sign chart before the propositional
 * rules get a look in, so disjunction introduction and proof by cases need two
 * variables to appear at all.
 */
const EXTRA = [
  ['x>y\\vee y>x\\vdash x^2\\ge 0'],
  ['x^2\\ge 0\\vdash y^2\\ge 0\\vee y^2<0'],
  ['\\top\\vdash x^2\\ge 0'],
  ['x>y\\vdash x+1>y\\wedge x+2>y'],
  ['\\forall x\\in\\mathbb{R},x^2\\ge 0'],
];

/** Every trace the catalogue produces, with the line that produced it. */
const catalogue = [];
for (const { id, lines } of [...DEMOS.map((demo) => ({ id: demo.id, lines: demo.lines })),
  ...EXTRA.map((lines) => ({ id: 'extra', lines }))]) {
  const results = new Sheet().evaluateAll(lines);
  results.forEach((row, index) => {
    if (row?.proofStatus === 'available' && row.proof) {
      catalogue.push({ id: `${id}:${lines[index]}`, proof: row.proof });
    }
  });
}

check('the catalogue produces traces to check', () => (
  catalogue.length >= 30 ? null : `only ${catalogue.length} traces`
));

check('no step of any demo is refused', () => {
  for (const { id, proof } of catalogue) {
    const refused = checkTrace(proof).rejected;
    if (refused.length) return `${id} refused ${refused.join(', ')}`;
  }
  return null;
});

check('every demo trace carries a trust level on every step', () => {
  for (const { id, proof } of catalogue) {
    if (!TRUST_ORDER.includes(proof.trust)) return `${id} has trace trust ${proof.trust}`;
    for (const step of proof.steps) {
      if (!TRUST_ORDER.includes(step.trust)) return `${id}/${step.id} has trust ${step.trust}`;
    }
  }
  return null;
});

check('a rule whose conclusion is still folded up is admitted, not refused', () => {
  // `P(x,y)` is a conjunction only once its definition is unfolded, so the
  // conjunction introduction that proved it does not look like one. Unfolding
  // is not a checker the kernel has yet, and mistaking that for a bad step
  // would throw away a perfectly good proof.
  const row = new Sheet().evaluateAll(['P(x,y):=x^2\\ge 0\\wedge y^2\\ge 0', 'P(x,y)']).at(-1);
  if (row.proofStatus !== 'available') return 'the row lost its proof';
  const root = row.proof.steps.find((step) => step.id === row.proof.root);
  if (root.rule !== 'logic.and-intro') return `the root is ${root.rule}`;
  return root.trust === 'axiom' ? null : `the folded conclusion was ${root.trust}`;
});

/**
 * Both ways of naming a claim must abstain alike.
 *
 * A predicate call unfolds through `definition.unfold`, and the guard in
 * `checkStep` reads that step and abstains on a conclusion it cannot match.
 * A name standing for a whole proposition used to unfold silently, so the
 * same unmatched conclusion was refused outright — the application's worst
 * verdict, on a true statement, for the most ordinary thing a reader can do.
 */
check('naming a whole proposition is not a refused step', () => {
  for (const [shape, lines] of [
    ['constant', ['\\text{lemma}:=\\forall x\\in\\mathbb{R},x^2\\ge 0', '\\text{lemma}']],
    ['predicate', ['\\text{sq}(x):=x^2\\ge 0', '\\text{sq}(a-1)']],
  ]) {
    const row = new Sheet().evaluateAll(lines).at(-1);
    if (row.value !== true) return `the ${shape} form came back ${row.value}`;
    if (row.proofStatus !== 'available') return `the ${shape} form lost its proof`;
    if (row.proof.trust === 'rejected') return `the ${shape} form was refused`;
    if (!row.proof.steps.some((step) => step.rule === 'definition.unfold')) {
      return `the ${shape} form never says what the name stood for`;
    }
  }
  return null;
});

check('certifying does not disturb the trace', () => {
  for (const { id, proof } of catalogue) {
    if (!isValidTrace(proof)) return `${id} no longer validates`;
  }
  return null;
});

check('the logic rules the catalogue reaches are actually checked', () => {
  const reached = new Set();
  for (const { proof } of catalogue) {
    for (const step of proof.steps) {
      if (CHECKED_RULES.includes(step.rule) && step.trust === 'verified') reached.add(step.rule);
    }
  }
  // Not every checkable rule appears in the catalogue, but the common ones do,
  // and a checker that stopped firing would show up here first.
  const wanted = ['logic.and-intro', 'logic.and-elim', 'logic.or-intro', 'logic.cases',
    'logic.iff-intro', 'logic.implies-intro', 'logic.chain', 'logic.universal-generalization'];
  const missing = wanted.filter((id) => !reached.has(id));
  return missing.length ? `never verified: ${missing.join(', ')}` : null;
});

check('a proof that rests on nothing but the CAS says so', () => {
  // `\pi` is an indeterminate to the kernel, so nothing about this row can be
  // worked out from its tokens. `2 + 2 = 4` used to stand here and no longer
  // can: ground arithmetic is checked now, which is the point of the checker.
  const row = new Sheet().evaluateAll(['\\pi>3']).at(-1);
  if (row.proofStatus !== 'available') return 'the row lost its proof';
  if (row.proof.trust !== 'oracle') return `trust is ${row.proof.trust}`;
  return trustSummary(row.proof) === "the CAS's word" ? null : trustSummary(row.proof);
});

/**
 * The easy end of the oracle, done again by hand.
 *
 * Everything here is arithmetic a reader could check on paper, and until the
 * ground checker landed all of it read *the CAS's word*. What must not happen
 * is the checker reaching past its evidence: a statement resting on a constant
 * the kernel cannot evaluate has to keep the oracle it had.
 */
check('closed rational arithmetic is checked, and nothing further', () => {
  const verified = ['2+2=4', '\\frac{7}{3}>\\frac{9}{4}', '2^{10}=1024', '3\\ne 4',
    '\\frac{1}{3}+\\frac{1}{6}=\\frac{1}{2}', '(2+3)^2=25',
    '\\gcd(12,18)=6', '\\operatorname{mod}(17,5)=2'];
  for (const line of verified) {
    const row = new Sheet().evaluateAll([line]).at(-1);
    if (row.value !== true) return `${line} came back ${row.value}`;
    if (row.proof?.trust !== 'verified') return `${line} is ${row.proof?.trust}`;
  }
  for (const line of ['\\pi>3', 'e>2.7', '\\sum_{n=1}^{\\infty}\\frac{1}{n^2}=\\frac{\\pi^2}{6}']) {
    const row = new Sheet().evaluateAll([line]).at(-1);
    if (row.proof?.trust !== 'oracle') return `${line} claims ${row.proof?.trust}`;
  }
  return null;
});

/**
 * Bounded sums and products, expanded rather than believed.
 *
 * These were the last arithmetic the kernel had no reading for, and they are
 * the last rows in the application whose whole content is a computation a
 * reader could do on paper while the badge said *the CAS's word*.
 */
check('a bounded sum is expanded term by term', () => {
  const verified = [
    '\\sum_{n=1}^{10}n=55',
    '\\sum_{n=1}^{4}n^2=30',
    '\\sum_{n=0}^{5}2^n=63',
    '\\sum_{n=1}^{3}\\frac{1}{n}=\\frac{11}{6}',
    '\\sum_{n=1}^{10}n>50',
    '\\prod_{n=1}^{5}n=120',
    '\\prod_{n=1}^{3}\\frac{n+1}{n}=4',
    // The summand is the product that follows and no more, which is where
    // Compute Engine stops too: this is 55 + 5, not the sum of ten `n+5`.
    '\\sum_{n=1}^{10}n+5=60',
    '\\sum_{n=1}^{3}\\gcd(n,6)=6',
    '\\sum_{k=1}^{3}\\sum_{m=1}^{2}km=18',
    // `i` is the imaginary unit outside the limits, but an ordinary bound
    // identifier throughout this outer summand.
    '\\sum_{i=1}^{3}\\sum_{j=1}^{2}i=12',
  ];
  for (const line of verified) {
    const row = new Sheet().evaluateAll([line]).at(-1);
    if (row.value !== true) return `${line} came back ${row.value}`;
    if (row.proof?.trust !== 'verified') return `${line} is ${row.proof?.trust}`;
  }
  return null;
});

/**
 * What the expansion declines to read.
 *
 * A bound the kernel cannot evaluate is a sum it cannot expand, and an
 * unreadable sum has to abstain rather than guess: `\sum_{k=1}^{n}` says
 * nothing at all until `n` is known. The last line is the reason the range is
 * capped — the answer is right, but checking it on every keystroke is not.
 */
check('a sum the kernel cannot expand keeps the trust it had', () => {
  for (const line of ['\\sum_{n=1}^{\\infty}\\frac{1}{2^n}=1',
    '\\sum_{n=1}^{2000}n=2001000']) {
    const row = new Sheet().evaluateAll([line]).at(-1);
    if (row.proofStatus === 'available' && row.proof.trust !== 'oracle') {
      return `${line} claims ${row.proof.trust}`;
    }
  }
  return null;
});

check('the kernel refuses a bounded sum the expansion contradicts', () => {
  for (const latex of ['\\sum_{n=1}^{10}n=56', '\\prod_{n=1}^{5}n<120',
    '\\sum_{n=1}^{3}\\frac{1}{n}=2']) {
    const problem = roots('rejected', trace(
      { id: 's1', rule: 'engine.exact-evaluation', conclusionLatex: latex },
    ));
    if (problem) return `${latex}: ${problem}`;
  }
  return null;
});

/**
 * The row that had no trace at all.
 *
 * `\sqrt{2} \notin \mathbb{Q}` was proved with nothing recorded, which made
 * the easiest proof in the application its worst-documented one. It is an
 * integer search, so the kernel does the search.
 */
check('an irrational root is checked, and a rational one is not called irrational', () => {
  for (const [line, value] of [
    ['\\sqrt{2}\\notin\\mathbb{Q}', true],
    ['\\sqrt{2}\\notin\\mathbb{Z}', true],
    ['\\sqrt[3]{5}\\notin\\mathbb{Q}', true],
    ['\\sqrt[3]{8}\\in\\mathbb{Q}', true],
    ['\\sqrt[3]{8}\\notin\\mathbb{Q}', false],
    ['\\sqrt{2}\\in\\mathbb{Q}', false],
  ]) {
    const row = new Sheet().evaluateAll([line]).at(-1);
    if (row.value !== value) return `${line} came back ${row.value}`;
    if (!value) continue;
    if (row.proof?.trust !== 'verified') return `${line} is ${row.proof?.trust}`;
  }
  return null;
});

check('the kernel refuses an integer-root claim the search contradicts', () => {
  for (const latex of ['\\sqrt{4}\\notin\\mathbb{Q}', '\\sqrt[3]{8}\\notin\\mathbb{Q}',
    '\\sqrt{2}\\in\\mathbb{Q}']) {
    const problem = roots('rejected', trace({
      id: 's1', rule: 'arithmetic.integer-root', conclusionLatex: latex,
    }));
    if (problem) return `${latex}: ${problem}`;
  }
  // A radicand the kernel cannot read is not a refusal; it is a gap.
  return roots('axiom', trace({
    id: 's1', rule: 'arithmetic.integer-root', conclusionLatex: '\\sqrt{x}\\notin\\mathbb{Q}',
  }));
});

/**
 * Primality: the one Tier 1 statement that needs a witness.
 *
 * Every other closed arithmetic claim is settled by the kernel redoing the
 * calculation. Factoring is not, so the prover hands over a Pratt certificate
 * and the kernel does the modular arithmetic that confirms it. What must not
 * happen is a certificate being taken on its shape rather than its content.
 */
const primality = (latex, data) => trace({
  id: 's1', rule: 'arithmetic.primality', conclusionLatex: latex, data,
});

/** The certificate the prover emits for 7, written out by hand. */
const SEVEN = [
  { numberLatex: '2', rootLatex: null, factorsLatex: [] },
  { numberLatex: '3', rootLatex: '2', factorsLatex: ['2'] },
  { numberLatex: '7', rootLatex: '3', factorsLatex: ['2', '3'] },
];

check('a Pratt certificate is checked by modular exponentiation', () => roots(
  'certified', primality('7\\in\\mathbb{P}', { prattLatex: SEVEN }),
));

check('a proper divisor certifies that a number is not prime', () => roots(
  'certified', primality('8\\notin\\mathbb{P}', { factorLatex: '2' }),
));

check('nothing below two is prime, and no witness is needed to say so', () => {
  for (const latex of ['1\\notin\\mathbb{P}', '0\\notin\\mathbb{P}']) {
    const problem = roots('certified', primality(latex, {}));
    if (problem) return `${latex}: ${problem}`;
  }
  return roots('rejected', primality('1\\in\\mathbb{P}', {}));
});

check('a certificate that contradicts its claim is refused', () => {
  const problem = roots('rejected', primality('7\\notin\\mathbb{P}', { prattLatex: SEVEN }));
  if (problem) return `a certified prime called composite: ${problem}`;
  return roots('rejected', primality('8\\in\\mathbb{P}', { factorLatex: '2' }));
});

check('a divisor that does not divide is not a witness', () => {
  for (const factorLatex of ['3', '8', '1', '0', 'x', null]) {
    const problem = roots('axiom', primality('8\\notin\\mathbb{P}', { factorLatex }));
    if (problem) return `${factorLatex}: ${problem}`;
  }
  return null;
});

/**
 * The mutations that matter, one per condition the Lucas test imposes.
 *
 * A checker that walked the tree without doing the arithmetic would pass every
 * positive test above and every one of these.
 */
check('a corrupted Pratt certificate establishes nothing', () => {
  const swap = (numberLatex, changes) => SEVEN.map((entry) => (
    entry.numberLatex === numberLatex ? { ...entry, ...changes } : entry
  ));
  const corruptions = {
    'a root that is not primitive': swap('7', { rootLatex: '6' }),
    'an incomplete factorisation': swap('7', { factorsLatex: ['2', '2'] }),
    'a factorisation of the wrong number': swap('7', { factorsLatex: ['2', '2', '3'] }),
    'a factor never established': swap('7', { factorsLatex: ['6'] }),
    'a subtree quietly dropped': SEVEN.filter((entry) => entry.numberLatex !== '3'),
    'a root out of range': swap('7', { rootLatex: '7' }),
    'a corrupted subtree': swap('3', { rootLatex: '1' }),
    'nothing at all': null,
    'an empty certificate': [],
  };
  for (const [label, prattLatex] of Object.entries(corruptions)) {
    const problem = roots('axiom', primality('7\\in\\mathbb{P}', { prattLatex }));
    if (problem) return `${label}: ${problem}`;
  }
  // The uncorrupted certificate still checks, or the test above proves nothing.
  return roots('certified', primality('7\\in\\mathbb{P}', { prattLatex: SEVEN }));
});

check('a Pratt certificate is checked against every prime it names', () => {
  // 341 = 11 x 31 is a Fermat pseudoprime to base 2: `2^{340} = 1 (mod 341)`,
  // so a checker that stopped at Fermat's test would certify it. The order
  // condition is what catches it, and 341 has no primitive root to offer.
  const forged = [
    { numberLatex: '2', rootLatex: null, factorsLatex: [] },
    { numberLatex: '5', rootLatex: '2', factorsLatex: ['2', '2'] },
    { numberLatex: '17', rootLatex: '3', factorsLatex: ['2', '2', '2', '2'] },
    { numberLatex: '341', rootLatex: '2', factorsLatex: ['2', '2', '5', '17'] },
  ];
  return roots('axiom', primality('341\\in\\mathbb{P}', { prattLatex: forged }));
});

check('the kernel refuses ground arithmetic that does not add up', () => {
  // No prover emits this, and none should be able to: a step claiming exact
  // evaluation of a false sum is refused rather than left alone, because the
  // kernel can see for itself that no exact evaluation produced it.
  return roots('rejected', trace({
    id: 's1', rule: 'engine.exact-evaluation', conclusionLatex: '2+2=5',
  }));
});

check('a checked even-power witness no longer rests on a theorem', () => {
  const row = new Sheet().evaluateAll(['x^2+y^2\\ge 2xy']).at(-1);
  if (row.proofStatus !== 'available') return 'the row lost its proof';
  return trustSummary(row.proof) === 'witnessed'
    ? null : trustSummary(row.proof);
});

check('a checked PSD decomposition no longer rests on a theorem', () => {
  const row = new Sheet().evaluateAll(['a^2+b^2+c^2\\ge ab+bc+ca']).at(-1);
  if (row.proofStatus !== 'available') return 'the row lost its proof';
  const root = row.proof.steps.find((step) => step.id === row.proof.root);
  if (root.rule !== 'quadratic.psd') return `the root is ${root.rule}`;
  return trustSummary(row.proof) === 'witnessed'
    ? null : trustSummary(row.proof);
});

check('quantifying a PSD inequality does not cost it its certificate', () => {
  // Stripping `\forall x \in \mathbb{R}` leaves the body inside the scope the
  // quantifier opened, where Compute Engine will not collect like terms. The
  // PSD prover verifies its guess symbolically, so it saw its own
  // reconstruction fail to cancel and withdrew a proof it had.
  const quantified = ['a', 'b', 'c']
    .map((name) => `\\forall ${name}\\in\\mathbb{R},`).join('');
  const row = new Sheet().evaluateAll([
    `${quantified}a^2+b^2+c^2\\ge ab+bc+ca`,
  ]).at(-1);
  if (row.value !== true) return `the quantified claim came back ${row.value}`;
  if (row.method !== 'proved') return `the quantified claim was ${row.method}`;
  if (row.proofStatus !== 'available') return 'the row lost its proof';
  const rules = row.proof.steps.map((step) => step.rule);
  if (!rules.includes('quadratic.psd')) return `the trace cites ${rules.join(', ')}`;
  const psd = row.proof.steps.find((step) => step.rule === 'quadratic.psd');
  return psd.trust === 'certified' ? null : `the quantified witness is ${psd.trust}`;
});

check('a checked truth table no longer rests on a theorem', () => {
  const row = new Sheet().evaluateAll(['x>y\\land u>v\\vdash x>y']).at(-1);
  if (row.proofStatus !== 'available') return 'the row lost its proof';
  const root = row.proof.steps.find((step) => step.id === row.proof.root);
  if (root.rule !== 'logic.tautology') return `the root is ${root.rule}`;
  return trustSummary(row.proof) === 'witnessed'
    ? null : trustSummary(row.proof);
});

check('a checked free-group reduction no longer rests on a theorem', () => {
  const row = new Sheet().evaluateAll([
    '\\mathsf{Grp}\\vdash (xy)^{-1}=y^{-1}x^{-1}',
  ]).at(-1);
  if (row.proofStatus !== 'available') return 'the row lost its proof';
  const root = row.proof.steps.find((step) => step.id === row.proof.root);
  if (root.rule !== 'group.free-reduction') return `the root is ${root.rule}`;
  return trustSummary(row.proof) === 'witnessed'
    ? null : trustSummary(row.proof);
});

check('the PSD prover emits the constant square needed for a strict claim', () => {
  const row = new Sheet().evaluateAll(['a^2+b^2+c^2+1>ab+bc+ca']).at(-1);
  if (row.value !== true || row.proofStatus !== 'available') return 'the strict claim lost its proof';
  const root = row.proof.steps.find((step) => step.id === row.proof.root);
  if (root.rule !== 'quadratic.psd') return `the root is ${root.rule}`;
  if (!root.data?.sosBasesLatex?.includes('1')) return 'the witness has no constant square';
  return root.trust === 'certified' ? null : `the strict witness is ${root.trust}`;
});

check('a step taken on trust is labelled differently from a checked one', () => {
  const labels = new Set([
    stepTrustLabel({ rule: 'logic.and-intro', trust: 'verified' }),
    stepTrustLabel({ rule: 'polynomial.even-power', trust: 'certified' }),
    stepTrustLabel({ rule: 'polynomial.sturm-sign-chart', trust: 'axiom' }),
    stepTrustLabel({ rule: 'engine.exact-evaluation', trust: 'oracle' }),
  ]);
  return labels.size === 4 ? null : 'trust levels share a label';
});

console.log('== mutation ==');

/**
 * Corrupting a verified step's conclusion must cost it its verification.
 *
 * The mutation is deliberately small — one relation weakened, one constant
 * changed — because a checker that only notices wholesale nonsense is not
 * checking anything.
 *
 * Only the rules whose conclusion is left no slack are mutated. Two kinds are
 * excluded on purpose, because a survivor there would be the checker being
 * right rather than lax:
 *
 * The weakening rules — `A \wedge B \implies C` from `B \implies C` stays a
 * correct conjunction elimination however `A` is corrupted, because the rule
 * never read `A`.
 *
 * And the self-contained rewrites — `x > y \implies x+2 > y` corrupted to
 * `x+3 > y` is simply another true instance of affine monotonicity, since
 * nothing in the trace pins which offset was meant. Those are covered by the
 * targeted negatives above instead, where the part the rule does read is the
 * part that changes.
 */
const DETERMINED = new Set(['logic.and-intro', 'logic.chain', 'logic.iff-intro',
  'logic.cases', 'logic.universal-generalization',
  // Both of these leave no slack either: one demands the two relations be the
  // same claim, the other that a difference expand to exactly zero.
  'relation.normalize', 'polynomial.identity']);

const MUTATIONS = [
  { name: 'a constant changed', apply: (latex) => latex.replace(/0/, '7') },
  { name: 'a coefficient changed', apply: (latex) => latex.replace(/2/, '3') },
  { name: 'a relation weakened', apply: (latex) => latex.replace(/\\ge|\\le|>|</, '\\ne') },
  { name: 'a conjunct dropped', apply: (latex) => latex.replace(/\\wedge|\\land/, '\\vee') },
];

check('corrupting a verified step withdraws its verification', () => {
  let mutated = 0;
  for (const { id, proof } of catalogue) {
    for (const step of proof.steps) {
      if (step.trust !== 'verified' || !DETERMINED.has(step.rule)) continue;
      for (const mutation of MUTATIONS) {
        const corrupted = mutation.apply(step.conclusionLatex);
        if (corrupted === step.conclusionLatex) continue;
        // Since phase two a change to the text is not always a change to the
        // claim: `\epsilon/2 > 0` and `\epsilon/3 > 0` are the same
        // proposition, and a step proving one really does prove the other.
        // What must not survive is a mutation that says something else.
        if (sameProposition(step.conclusionLatex, corrupted)) continue;
        const damaged = {
          ...proof,
          steps: proof.steps.map((other) => (other.id === step.id
            ? { ...other, conclusionLatex: corrupted } : other)),
        };
        mutated += 1;
        if (checkTrace(damaged).steps.get(step.id).trust === 'verified') {
          return `${id}/${step.id} survived ${mutation.name}: ${corrupted}`;
        }
      }
    }
  }
  return mutated >= 20 ? null : `only ${mutated} mutations were possible`;
});

check('corrupting a premise withdraws the verification of what rests on it', () => {
  let mutated = 0;
  for (const { id, proof } of catalogue) {
    for (const step of proof.steps) {
      if (step.trust !== 'verified' || !step.premises.length) continue;
      const [first] = step.premises;
      const premise = proof.steps.find((other) => other.id === first);
      const corrupted = premise.conclusionLatex.replace(/0/, '7');
      if (corrupted === premise.conclusionLatex) continue;
      const damaged = {
        ...proof,
        steps: proof.steps.map((other) => (other.id === first
          ? { ...other, conclusionLatex: corrupted } : other)),
      };
      mutated += 1;
      if (checkTrace(damaged).steps.get(step.id).trust === 'verified') {
        return `${id}/${step.id} survived a corrupted premise`;
      }
    }
  }
  return mutated >= 5 ? null : `only ${mutated} mutations were possible`;
});

console.log('== monotonicity ==');

/**
 * Withholding the CAS oracle may only ever move a verdict toward undecided.
 *
 * This is the invariant the whole plan rests on: a theorem turned off may cost
 * a proof, never reverse one. `allowDirectEvaluation` is the one permission
 * that exists today, so it is the one that can be tested.
 */
check('refusing the oracle never turns a verdict around', () => {
  for (const demo of DEMOS) {
    const full = new Sheet().evaluateAll(demo.lines);
    const restricted = new Sheet({ allowDirectEvaluation: false }).evaluateAll(demo.lines);
    for (let index = 0; index < full.length; index += 1) {
      const before = full[index]?.value;
      const after = restricted[index]?.value;
      if (before === undefined || after === undefined) continue;
      if (after !== null && after !== before) {
        return `${demo.id}:${demo.lines[index]} went from ${before} to ${after}`;
      }
    }
  }
  return null;
});

if (failures.length) {
  console.error(`\n${failures.length} kernel cases failed:\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\n${passed} kernel cases passed`);
