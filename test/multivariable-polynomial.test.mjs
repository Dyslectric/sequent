/**
 * Broad proof/decision matrix for multivariable polynomial statements.
 *
 * Every true case in this file must be certified (`method: proved`). A sampled
 * true is a test failure: these cases deliberately stay inside proof families
 * supported by the engine. False cases must be refuted, normally with a
 * concrete sampled counterexample.
 */
import { Sheet } from '../src/lib/engine.js';

let passed = 0;
const failures = [];

function evaluate(latex) {
  return new Sheet().evaluateAll([latex])[0];
}

function expectProved(group, label, latex) {
  const result = evaluate(latex);
  if (result.kind === 'truth' && result.value === true && result.method === 'proved') {
    passed++;
    return;
  }
  failures.push(`${group}: ${label}\n    ${latex}\n    expected proved true, got ${JSON.stringify(result)}`);
}

function expectFalse(group, label, latex) {
  const result = evaluate(latex);
  if (result.kind === 'truth' && result.value === false) {
    passed++;
    return;
  }
  failures.push(`${group}: ${label}\n    ${latex}\n    expected false, got ${JSON.stringify(result)}`);
}

const polynomials = [
  ['linear two variables', 'x+y-1'],
  ['linear three variables', '2x-y+3z-4'],
  ['bilinear', 'xy+z-2'],
  ['quadratic circle', 'x^2+y^2-4'],
  ['quadratic with cross term', 'x^2+xy+2y^2-z'],
  ['factored cubic', '(x-y)(y-z)(z-x)'],
  ['mixed cubic', 'x^3+xy^2-z+1'],
  ['four variables', 'w^2+xy-yz+3'],
  ['degree four', 'x^4+x^2y^2+y^4-z^2'],
  ['degree five', 'x^3y^2-xyz+z^5-2'],
];

console.log('== multivariable equation equivalence: nonzero scaling ==');
for (const [label, p] of polynomials) {
  expectProved('scaled equation equivalence', `${label}, positive scale`,
    `(${p})=0\\iff 3(${p})=0`);
  expectProved('scaled equation equivalence', `${label}, negative scale`,
    `(${p})=0\\iff -2(${p})=0`);
}

const rearrangedEquations = [
  ['linear rearrangement', 'x+y=3\\iff 4x+4y-12=0'],
  ['three-variable rearrangement', 'x-2y+z=5\\iff -3x+6y-3z=-15'],
  ['quadratic rearrangement', 'x^2+xy=2-y^2\\iff 5x^2+5xy+5y^2-10=0'],
  ['bilinear rearrangement', 'xy+z=2\\iff 2xy=-2z+4'],
  ['quartic rearrangement', 'x^4+y^4=z^2\\iff 7x^4+7y^4-7z^2=0'],
  ['factored rearrangement', '(x-y)(x+y)=z\\iff 3x^2-3y^2-3z=0'],
];
for (const [label, latex] of rearrangedEquations) {
  expectProved('rearranged equation equivalence', label, latex);
}

console.log('== multivariable equation implication: polynomial multiples ==');
const equationConsequences = [
  ['linear times another variable', 'x+y=0\\implies z(x+y)=0'],
  ['linear times a polynomial', 'x-y+z=0\\implies (x-y+z)(x^2+y^2+1)=0'],
  ['circle times a linear factor', 'x^2+y^2-1=0\\implies (x^2+y^2-1)(x+y+z)=0'],
  ['bilinear times itself', 'xy-z=0\\implies (xy-z)^2=0'],
  ['cubic times quadratic', 'x^3+y^3-z^3=0\\implies (x^3+y^3-z^3)(x^2+yz+1)=0'],
  ['rearranged antecedent', 'x+y=2\\implies (x+y-2)(xy+z)=0'],
  ['constant-scaled multiple', '2x-y+z=4\\implies -5(2x-y+z-4)(x^2+1)=0'],
  ['four-variable factor', 'w+x-y-z=0\\implies (w+x-y-z)(wxyz+1)=0'],
  ['higher-degree factor', 'x^2y+yz^2-3=0\\implies (x^2y+yz^2-3)^3=0'],
  ['identity consequence', 'xy+z=2\\implies (x+y)^2=x^2+2xy+y^2'],
];
for (const [label, latex] of equationConsequences) {
  expectProved('equation implication', label, latex);
}

console.log('== multivariable equations: power-preserved zero sets ==');
const equationPowerCases = [
  ['square has the same zero set', '(x+y-z)^2=0\\iff x+y-z=0'],
  ['fourth power has the same zero set', '(xy+z-2)^4=0\\iff xy+z-2=0'],
  ['odd power has the same zero set', 'x^2+y^2-z=0\\iff (x^2+y^2-z)^5=0'],
  ['powered antecedent implies base', '(x^2+xy-z)^3=0\\implies x^2+xy-z=0'],
  ['scaled powered antecedent implies base', '-7(xy+yz+zx)^6=0\\implies xy+yz+zx=0'],
  ['nonzero preserved by square', 'x+y-z\\ne 0\\iff (x+y-z)^2\\ne 0'],
  ['nonzero preserved by sixth power', '(xy+z)^6\\ne 0\\iff xy+z\\ne 0'],
];
for (const [label, latex] of equationPowerCases) {
  expectProved('equation power relation', label, latex);
}

console.log('== multivariable equations: globally nonzero factors ==');
const nonzeroFactorEquationCases = [
  ['positive quadratic factor',
    'x+y-z=0\\iff (x+y-z)(x^2+y^2+z^2+1)=0'],
  ['positive squared-linear factor',
    'xy+z-2=0\\iff (xy+z-2)((x-y)^2+1)=0'],
  ['positive four-variable factor',
    'w+x-y-z=0\\iff (w+x-y-z)(w^2+x^2+y^2+z^2+2)=0'],
  ['scaled positive factor',
    'x^2+xy-z=0\\iff 3(x^2+xy-z)(y^2+z^2+1)=0'],
];
for (const [label, latex] of nonzeroFactorEquationCases) {
  expectProved('nonzero-factor equation equivalence', label, latex);
}

console.log('== multivariable inequality equivalence: affine normalization ==');
for (const [label, p] of polynomials) {
  expectProved('strict inequality equivalence', `${label}, positive scaling`,
    `(${p})>2\\iff 4(${p})>8`);
  expectProved('closed inequality equivalence', `${label}, positive scaling`,
    `(${p})\\ge -1\\iff 3(${p})+3\\ge 0`);
  expectProved('strict inequality equivalence', `${label}, negative sign flip`,
    `(${p})<5\\iff -2(${p})>-10`);
}

console.log('== multivariable inequalities: power-preserved signs ==');
const inequalityPowerCases = [
  ['positive base has positive square', 'x+y-z>0\\implies (x+y-z)^2>0'],
  ['positive base has positive fourth power', 'xy+z>0\\implies (xy+z)^4>0'],
  ['odd power preserves strict sign', 'x^2+y-z>0\\iff (x^2+y-z)^3>0'],
  ['odd power preserves closed sign', 'xy+yz+zx\\ge 0\\iff (xy+yz+zx)^5\\ge 0'],
  ['negative sign via normalized odd power', 'x+y-z<0\\iff (x+y-z)^3<0'],
  ['nonzero iff even power positive', 'x^2+xy-z\\ne 0\\iff (x^2+xy-z)^4>0'],
  ['positive square implies nonzero base', '(xy+z)^2>0\\implies xy+z\\ne 0'],
  ['scaled odd power preserves sign', 'x-y+z>0\\iff 5(x-y+z)^7>0'],
];
for (const [label, latex] of inequalityPowerCases) {
  expectProved('inequality power relation', label, latex);
}

console.log('== multivariable inequalities: globally positive factors ==');
const positiveFactorInequalityCases = [
  ['strict equivalence',
    'x+y-z>0\\iff (x+y-z)(x^2+y^2+z^2+1)>0'],
  ['closed equivalence',
    'xy+z\\ge 0\\iff (xy+z)((x-y)^2+1)\\ge 0'],
  ['forward strict implication',
    'x^2+xy-z>0\\implies (x^2+xy-z)(y^2+z^2+1)>0'],
  ['reverse strict implication',
    '(w+x-y-z)(w^2+x^2+y^2+z^2+1)>0\\implies w+x-y-z>0'],
  ['negative direction normalized',
    'x+y-z<0\\iff (x+y-z)(x^2+y^2+1)<0'],
];
for (const [label, latex] of positiveFactorInequalityCases) {
  expectProved('positive-factor inequality relation', label, latex);
}

console.log('== multivariable inequality implication: affine bounds ==');
for (const [label, p] of polynomials) {
  expectProved('strict inequality implication', `${label}, weaker strict bound`,
    `(${p})>2\\implies 2(${p})>3`);
  expectProved('strict inequality implication', `${label}, closed consequence`,
    `(${p})>2\\implies (${p})\\ge 2`);
  expectProved('closed inequality implication', `${label}, strict gap`,
    `(${p})\\ge 2\\implies 3(${p})>5`);
  expectProved('negative-scale implication', `${label}, direction reversal`,
    `(${p})>2\\implies -(${p})<-1`);
}

const structuralImplications = [
  ['equation implies global sum-of-squares bound', 'xy=z\\implies x^2+y^2+z^2\\ge 0'],
  ['inequality implies global positive polynomial', 'xy>z\\implies x^2+y^2+z^2+1>0'],
  ['vacuous strict implication', '-x^2-y^2-1>0\\implies xy+z>100'],
  ['vacuous closed implication', '-x^2-y^2-1\\ge 0\\implies x^3+y^3=z'],
  ['four-variable nonnegative consequence', 'w+x+y+z>0\\implies w^2+x^2+y^2+z^2\\ge 0'],
  ['square of polynomial is nonnegative', 'x+y>z\\implies (xy+z^2-x)^2\\ge 0'],
];
for (const [label, latex] of structuralImplications) {
  expectProved('structural implication', label, latex);
}

console.log('== multivariable polynomial counterexamples ==');
const falseStatements = [
  ['extra variable changes zero set', 'x+y=0\\iff x+y+z=0'],
  ['extra variable at nonzero level', 'x+y=1\\iff x+y+z=1'],
  ['multiplication adds roots', 'x+y=0\\iff z(x+y)=0'],
  ['different conics', 'x^2+y^2=1\\iff x^2+2y^2=1'],
  ['equation implication gains extra term', 'x+y=0\\implies x+y+z=0'],
  ['factor implication reversed', 'z(x+y)=0\\implies x+y=0'],
  ['stronger strict bound', 'x+y>1\\implies x+y>2'],
  ['closed does not imply strict endpoint', 'x^2+y^2\\ge 0\\implies x^2+y^2>0'],
  ['strictness breaks equivalence', 'xy+z>0\\iff xy+z\\ge 0'],
  ['negative scaling without direction flip', 'x-y>0\\iff -x+y>0'],
  ['nonlinear magnitude loses sign', 'x+y>0\\iff (x+y)^2>0'],
  ['unrelated inequality', 'x^2+y^2>1\\implies x>0'],
];
for (const [label, latex] of falseStatements) {
  expectFalse('counterexample', label, latex);
}

/**
 * Global sign certificates in several variables. Every one of these used to be
 * reported as "no counterexample in N samples"; each has a one-line proof, and
 * the point of the certificate is to find it.
 */
const quadraticForms = [
  ['AM-GM, two variables', 'a^2+b^2\\ge2ab'],
  ['AM-GM, reversed', '2ab\\le a^2+b^2'],
  ['three-variable cross terms', 'x^2+y^2+z^2\\ge xy+yz+zx'],
  ['positive definite with cross term', 'x^2+xy+y^2\\ge0'],
  ['strict, shifted', 'x^2-2xy+y^2+1>0'],
  ['strict, no cross term', 'x^2+y^2+1>0'],
  ['degenerate direction stays strict', 'x^2+1>0'],
  ['completed square in two variables', 'x^2+2xy+y^2+2x+2y+1\\ge0'],
  ['scaled form', '4x^2+4xy+y^2\\ge0'],
  ['rational coefficients', '\\frac{1}{2}x^2+\\frac{1}{2}y^2\\ge xy'],
];
for (const [label, latex] of quadraticForms) {
  expectProved('quadratic form', label, latex);
}

const squaresInDisguise = [
  ['Cauchy-Schwarz in two dimensions', '(ac+bd)^2\\le(a^2+b^2)(c^2+d^2)'],
  ['Lagrange identity', '(a^2+b^2)(c^2+d^2)-(ac+bd)^2=(ad-bc)^2'],
  ['quartic AM-GM', 'x^4+y^4\\ge2x^2y^2'],
  ['difference of squares, squared', '(x^2-y^2)^2\\ge0'],
];
for (const [label, latex] of squaresInDisguise) {
  expectProved('square in disguise', label, latex);
}

// The certificate must not turn indefinite forms into proofs. Each of these is
// negative somewhere and has to be refuted, not certified.
const indefiniteForms = [
  ['cross term too large', 'x^2+3xy+y^2\\ge0'],
  ['cross term too large, reversed', 'x^2+y^2\\ge3xy'],
  ['missing constant makes it strict-false', 'x^2+2x\\ge0'],
  ['negative diagonal', '-x^2-y^2\\ge1'],
  ['semidefinite is not definite', '(x-y)^2>0'],
  ['saddle', 'x^2-y^2\\ge0'],
];
for (const [label, latex] of indefiniteForms) {
  expectFalse('indefinite form', label, latex);
}

if (failures.length) {
  console.error(`\n${failures.join('\n\n')}\n`);
  console.error(`${passed} passed, ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log(`\n${passed} multivariable polynomial cases passed`);
}
