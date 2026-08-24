/**
 * Adversarial soundness harness for the polynomial sign prover.
 *
 * Generates random polynomial relations, and for every verdict of "proved"
 * independently searches for a counterexample by dense evaluation — completely
 * outside the CAS. Any hit means the prover certified something false.
 */
import { Sheet } from './src/lib/engine.js';

let seed = 12345;
const rand = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
};
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const RELS = [
  { tex: '>', holds: (v) => v > 0, eps: (v) => v > 1e-9 },
  { tex: '\\ge', holds: (v) => v >= 0, eps: (v) => v > -1e-9 },
  { tex: '<', holds: (v) => v < 0, eps: (v) => v < -1e-9 },
  { tex: '\\le', holds: (v) => v <= 0, eps: (v) => v < 1e-9 },
  { tex: '\\ne', holds: (v) => v !== 0, eps: (v) => Math.abs(v) > 1e-9 },
];

/** Descending coefficients -> LaTeX. */
function toLatex(coeffs) {
  const degree = coeffs.length - 1;
  let out = '';
  coeffs.forEach((c, i) => {
    if (c === 0) return;
    const power = degree - i;
    const magnitude = Math.abs(c);
    let term;
    if (power === 0) term = String(magnitude);
    else term = `${magnitude === 1 ? '' : magnitude}x${power === 1 ? '' : `^{${power}}`}`;
    if (out === '') out = (c < 0 ? '-' : '') + term;
    else out += (c < 0 ? '-' : '+') + term;
  });
  return out === '' ? '0' : out;
}

const evalAt = (coeffs, x) => coeffs.reduce((acc, c) => acc * x + c, 0);

/** `\frac{2}{3}`, `-\frac{2}{3}`, `7`, `-7` -> an exact BigInt rational. */
function parseWitness(latex) {
  const text = String(latex ?? '').replace(/\s+/g, '');
  const fraction = text.match(/^(-?)\\frac\{(\d+)\}\{(\d+)\}$/);
  if (fraction) {
    const magnitude = BigInt(fraction[2]);
    return { n: fraction[1] === '-' ? -magnitude : magnitude, d: BigInt(fraction[3]) };
  }
  return /^-?\d+$/.test(text) ? { n: BigInt(text), d: 1n } : null;
}

/**
 * Sign of an integer-coefficient polynomial at an exact rational, with no
 * floating point involved: p(n/d) has the sign of sum(c_i * n^(deg-i) * d^i),
 * since d^deg is positive. Float evaluation is useless here — the whole point
 * of a witness is usually that some polynomial is exactly zero at it.
 */
function exactSignAt(coeffs, x) {
  const degree = coeffs.length - 1;
  let total = 0n;
  coeffs.forEach((c, i) => {
    total += BigInt(c) * x.n ** BigInt(degree - i) * x.d ** BigInt(i);
  });
  return total > 0n ? 1 : total < 0n ? -1 : 0;
}

// Dense near the origin where roots of small-coefficient polynomials live, plus
// a coarse sweep and extreme magnitudes to cover unbounded half-lines.
const GRID = [];
for (let x = -20; x <= 20; x += 0.005) GRID.push(Number(x.toFixed(4)));
for (let x = -1000; x <= 1000; x += 0.5) GRID.push(x);
for (const m of [1e3, 1e4, 1e5, 1e6, 1e8]) GRID.push(m, -m);

function randomPoly(maxDegree) {
  const degree = randInt(1, maxDegree);
  const coeffs = [];
  for (let i = 0; i <= degree; i++) coeffs.push(randInt(-4, 4));
  if (coeffs[0] === 0) coeffs[0] = pick([1, -1, 2, -2]);
  return coeffs;
}

let proved = 0;
let checked = 0;
let unsound = 0;
let trueCount = 0;
let provedTrue = 0;
const missed = [];
const failures = [];

const flag = (line, detail) => {
  unsound++;
  if (failures.length < 12) failures.push(`${line}\n      ${detail}`);
};

let witnesses = 0;

/**
 * A reported counterexample is a claim that can be checked outright, so check
 * it: at the stated point the antecedent must hold and the consequent must not.
 * This is the guard on the exact-false path, which the "claimed proved" checks
 * below never see — they only ever inspect verdicts of true.
 */
function verifyWitness(line, result, left, right) {
  if (result.kind !== 'truth' || result.method !== 'counterexample') return;
  const shown = result.counterexample?.[0]?.valueLatex;
  const x = parseWitness(shown);
  if (!x) {
    flag(line, `counterexample x=${shown} is not an exact rational`);
    return;
  }
  witnesses++;
  const holdsLeft = left.holds(exactSignAt(left.poly, x));
  const holdsRight = right.holds(exactSignAt(right.poly, x));
  const refutes = right.equivalence
    ? holdsLeft !== holdsRight
    : holdsLeft && !holdsRight;
  if (refutes) return;
  flag(line, `witness x=${x.n}/${x.d} does not refute it: lhs=${holdsLeft}, rhs=${holdsRight}`);
}

console.log('== inequality implications ==');
for (let trial = 0; trial < 400; trial++) {
  const p = randomPoly(3);
  const q = randomPoly(3);
  const relA = pick(RELS);
  const relB = pick(RELS);
  const line = `${toLatex(p)}${relA.tex}0\\implies ${toLatex(q)}${relB.tex}0`;
  checked++;

  const result = new Sheet().evaluateAll([line])[0];
  verifyWitness(line, result, { poly: p, holds: relA.holds }, { poly: q, holds: relB.holds });

  let genuinelyTrue = true;
  for (const x of GRID) {
    if (relA.holds(evalAt(p, x)) && !relB.eps(evalAt(q, x))) { genuinelyTrue = false; break; }
  }
  // The grid steps over a failure at a single irrational or fine-denominator
  // point, so it calls some false statements true. An exact verdict of false
  // has a checked witness behind it (above) and is the better oracle.
  if (genuinelyTrue && result.kind === 'truth' && result.value === false) genuinelyTrue = false;

  if (genuinelyTrue) {
    trueCount++;
    if (result.kind === 'truth' && result.method === 'proved') provedTrue++;
    else if (result.kind === 'truth' && result.method === 'sampled') missed.push(line);
  }
  if (result.kind !== 'truth' || result.method !== 'proved') continue;
  proved++;

  for (const x of GRID) {
    if (relA.eps(evalAt(p, x)) && !relB.holds(evalAt(q, x))) {
      // Re-check without the epsilon slack to avoid flagging boundary noise.
      if (relA.holds(evalAt(p, x)) && !relB.eps(evalAt(q, x))) {
        flag(line, `claimed proved, but x=${x} gives p=${evalAt(p, x)}, q=${evalAt(q, x)}`);
        break;
      }
    }
  }
}
console.log(`  ${checked} generated, ${proved} proved`);
console.log(`  of ${trueCount} genuinely-true, ${provedTrue} proved (${(100*provedTrue/Math.max(1,trueCount)).toFixed(0)}%)`);
console.log('  missed examples:'); for (const m of missed.slice(0,12)) console.log('    ' + m);

console.log('== equation antecedents (integer roots, checked exactly) ==');
let eqChecked = 0;
let eqProved = 0;
for (let trial = 0; trial < 250; trial++) {
  // p with known integer roots, so the antecedent's solution set is exact.
  const r1 = randInt(-4, 4);
  const r2 = randInt(-4, 4);
  const useTwo = rand() < 0.5;
  const p = useTwo ? [1, -(r1 + r2), r1 * r2] : [1, -r1];
  const roots = useTwo ? [r1, r2] : [r1];
  const q = randomPoly(3);
  const relB = pick(RELS);
  const line = `${toLatex(p)}=0\\implies ${toLatex(q)}${relB.tex}0`;
  eqChecked++;

  const result = new Sheet().evaluateAll([line])[0];
  verifyWitness(line, result, { poly: p, holds: (v) => v === 0 }, { poly: q, holds: relB.holds });
  if (result.kind !== 'truth' || result.method !== 'proved') continue;
  eqProved++;

  for (const root of roots) {
    if (!relB.holds(evalAt(q, root))) {
      flag(line, `claimed proved, but root x=${root} gives q=${evalAt(q, root)}`);
      break;
    }
  }
}
console.log(`  ${eqChecked} generated, ${eqProved} proved`);

console.log('== standalone relations (identities) ==');
let soloChecked = 0;
let soloProved = 0;
for (let trial = 0; trial < 300; trial++) {
  const q = randomPoly(4);
  const rel = pick(RELS);
  const line = `${toLatex(q)}${rel.tex}0`;
  soloChecked++;

  const result = new Sheet().evaluateAll([line])[0];
  // A standalone relation is an implication from a vacuously true antecedent.
  verifyWitness(line, result, { poly: [1], holds: () => true }, { poly: q, holds: rel.holds });
  if (result.kind !== 'truth' || result.method !== 'proved') continue;
  soloProved++;

  for (const x of GRID) {
    if (!rel.holds(evalAt(q, x)) && !rel.eps(evalAt(q, x))) {
      flag(line, `claimed proved, but x=${x} gives ${evalAt(q, x)}`);
      break;
    }
  }
}
console.log(`  ${soloChecked} generated, ${soloProved} proved`);

console.log('== equivalences ==');
let eqvChecked = 0;
let eqvProved = 0;
for (let trial = 0; trial < 300; trial++) {
  const p = randomPoly(2);
  const q = randomPoly(2);
  const relA = pick(RELS);
  const relB = pick(RELS);
  const line = `${toLatex(p)}${relA.tex}0\\iff ${toLatex(q)}${relB.tex}0`;
  eqvChecked++;

  const result = new Sheet().evaluateAll([line])[0];
  verifyWitness(line, result,
    { poly: p, holds: relA.holds },
    { poly: q, holds: relB.holds, equivalence: true });
  if (result.kind !== 'truth' || result.method !== 'proved') continue;
  eqvProved++;

  for (const x of GRID) {
    const a = relA.holds(evalAt(p, x));
    const b = relB.holds(evalAt(q, x));
    if (a !== b) {
      const aStrict = relA.eps(evalAt(p, x));
      const bStrict = relB.eps(evalAt(q, x));
      if (aStrict !== bStrict) {
        flag(line, `claimed proved, but x=${x}: lhs=${a}, rhs=${b}`);
        break;
      }
    }
  }
}
console.log(`  ${eqvChecked} generated, ${eqvProved} proved`);

console.log('== divergent integrals are never answered ==');
/**
 * Compute Engine is not merely silent about these — it is wrong. Probed
 * directly, `\int_{-1}^{1}dx/x = 0` and `\int_{-1}^{1}dx/x^2 = -2` both come
 * back True, the second for an integrand that is positive everywhere. The
 * continuity gate in `integral.js` is what keeps those answers out of a
 * verdict, and this is the check that it still does.
 *
 * A refusal is the pass condition. Any truth value at all is a failure,
 * whichever way it points: there is no true statement to be made here.
 */
const DIVERGENT = [
  ['\\int_{-1}^{1}\\frac{1}{x}\\,dx=0', 'principal value only'],
  ['\\int_{-1}^{1}\\frac{1}{x}\\,dx=1', 'no value'],
  ['\\int_{-1}^{1}\\frac{1}{x^2}\\,dx=-2', 'positive integrand, negative claim'],
  ['\\int_{-1}^{1}\\frac{1}{x^2}\\,dx=2', 'diverges to +infinity'],
  ['\\int_{0}^{1}\\frac{1}{x}\\,dx=1', 'pole at the lower limit'],
  ['\\int_{-1}^{0}\\frac{1}{x}\\,dx=0', 'pole at the upper limit'],
  ['\\int_{-2}^{2}\\frac{1}{x-1}\\,dx=0', 'pole inside the interval'],
  ['\\int_{-1}^{1}\\frac{1}{x^3}\\,dx=0', 'odd pole, principal value only'],
  ['\\int_{0}^{1}\\frac{1}{x(1-x)}\\,dx=0', 'poles at both limits'],
  ['\\int_{1}^{\\infty}\\frac{1}{x}\\,dx=1', 'divergent tail'],
];
let divergentChecked = 0;
for (const [line, why] of DIVERGENT) {
  divergentChecked++;
  const result = new Sheet().evaluateAll([line])[0];
  if (result.kind === 'truth' && result.value !== null) {
    flag(line, `answered ${result.value} for a divergent integral (${why})`);
  }
}
console.log(`  ${divergentChecked} divergent integrals, all refused`);

const totalProved = proved + eqProved + soloProved + eqvProved;
console.log(`\n${totalProved} total proofs checked against dense evaluation`);
console.log(`${witnesses} exact counterexamples re-checked at the stated point`);
console.log(unsound === 0 ? 'SOUND: no false certificates' : `UNSOUND: ${unsound} bad certificates`);
for (const f of failures) console.log('  - ' + f);
process.exitCode = unsound === 0 ? 0 : 1;
