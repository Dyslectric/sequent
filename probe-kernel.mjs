/**
 * Adversarial soundness harness for the proof kernel.
 *
 * `probe-soundness.mjs` asks whether the prover ever certifies something
 * false. This asks the same question of the checker, which since phase two
 * makes two claims of its own that no amount of structural testing can
 * settle:
 *
 *   - that two relations it treats as one proposition really are one;
 *   - that a rewrite it marks `verified` really does follow;
 *   - that a witness it marks `certified` really is non-negative and equal to
 *     the claimed polynomial.
 *
 * Both are checked by dense evaluation of random polynomial relations,
 * entirely outside the kernel's own arithmetic. That cannot prove either
 * claim, but it destroys them quickly if they are false — and a kernel that
 * verifies something false is worse than no kernel, because the row now says
 * so in as many words.
 *
 * Run it by hand after touching `kernel.js` or `kernel-polynomial.js`:
 *
 *     node probe-kernel.mjs [seed] [cases]
 */
import { checkTrace, parseProposition, sameProposition } from './src/lib/kernel.js';
import { PROOF_VERSION } from './src/lib/proof-trace.js';

let seed = Number(process.argv[2] ?? 20260823);
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (xs) => xs[Math.min(xs.length - 1, Math.floor(rand() * xs.length))];
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const BASIS = [
  ['x^2', (x) => x * x],
  ['xy', (x, y) => x * y],
  ['y^2', (_, y) => y * y],
  ['x', (x) => x],
  ['y', (_, y) => y],
];

/** A small polynomial in x and y, as LaTeX and as a function of a point. */
function polynomial() {
  const parts = [];
  const terms = [];
  for (const [label, at] of BASIS) {
    const c = randInt(-3, 3);
    if (!c) continue;
    parts.push(`${c < 0 ? '-' : '+'}${Math.abs(c) === 1 ? '' : Math.abs(c)}${label}`);
    terms.push((x, y) => c * at(x, y));
  }
  const constant = randInt(-3, 3);
  if (constant) {
    parts.push(`${constant < 0 ? '-' : '+'}${Math.abs(constant)}`);
    terms.push(() => constant);
  }
  if (!parts.length) return polynomial();
  return {
    latex: parts.join('').replace(/^\+/, ''),
    at: (x, y) => terms.reduce((sum, term) => sum + term(x, y), 0),
  };
}

/** A small word in the free group on x, y, and z. */
function groupWord() {
  return Array.from({ length: randInt(1, 10) }, () => ({
    name: pick(['x', 'y', 'z']),
    inverse: rand() < 0.5,
  }));
}

/** Free reduction, implemented independently of both prover and kernel. */
function reduceGroupWord(word) {
  const stack = [];
  for (const letter of word) {
    const previous = stack.at(-1);
    if (previous?.name === letter.name && previous.inverse !== letter.inverse) stack.pop();
    else stack.push(letter);
  }
  return stack;
}

const groupLatex = (word, identity = '1') => (word.length
  ? word.map(({ name, inverse }) => (inverse ? `${name}^{-1}` : name)).join('')
  : identity);

const RELS = [
  { tex: '=', holds: (v) => v === 0 },
  { tex: '\\ne', holds: (v) => v !== 0 },
  { tex: '>', holds: (v) => v > 0 },
  { tex: '\\ge', holds: (v) => v >= 0 },
];

/** A rational constant, written the several ways the reader must accept. */
function constant() {
  const numerator = randInt(-4, 4) || 2;
  const denominator = pick([1, 1, 1, 2, 3]);
  return {
    latex: denominator === 1 ? `${numerator}` : `\\frac{${numerator}}{${denominator}}`,
    value: numerator / denominator,
  };
}

/**
 * A second polynomial built from the first the way a rewrite might build it.
 *
 * Random pairs are almost never related by a rewrite, so the kernel would
 * accept nothing and the probe would pass by doing nothing. These are the
 * shapes it is supposed to accept — plus `unrelated`, to keep it honest.
 */
function derive(base) {
  const how = pick(['scale', 'affine', 'power', 'multiple', 'same', 'unrelated']);
  if (how === 'scale') {
    const c = constant();
    return { how, latex: `${c.latex}(${base.latex})`, at: (x, y) => c.value * base.at(x, y) };
  }
  if (how === 'affine') {
    const c = constant();
    const k = randInt(-3, 3);
    return {
      how,
      latex: `${c.latex}(${base.latex})${k < 0 ? '-' : '+'}${Math.abs(k)}`,
      at: (x, y) => c.value * base.at(x, y) + k,
    };
  }
  if (how === 'power') {
    const c = constant();
    const n = randInt(2, 4);
    return {
      how,
      latex: `${c.latex}(${base.latex})^${n}`,
      at: (x, y) => c.value * base.at(x, y) ** n,
    };
  }
  if (how === 'multiple') {
    const q = polynomial();
    return { how, latex: `(${q.latex})(${base.latex})`, at: (x, y) => q.at(x, y) * base.at(x, y) };
  }
  if (how === 'same') return { how, latex: `(${base.latex})`, at: base.at };
  return { ...polynomial(), how };
}

/**
 * A bounded sum or product with an integer value, and that value.
 *
 * The summand is deliberately kept integer-valued so the independent
 * evaluation is a plain BigInt loop: nothing here parses LaTeX, and nothing
 * here knows how the kernel decides where a summand stops. The trailing term
 * is the case that matters most — Compute Engine binds `\sum_{n=1}^{3}n+5` as
 * 11 rather than 21, and a reader that guessed the other way would *refuse* a
 * true row rather than merely miss it.
 */
function boundedEnumeration() {
  const index = pick(['n', 'k', 'm']);
  const product = rand() < 0.3;
  const lower = BigInt(randInt(product ? 1 : 0, 3));
  const upper = lower + BigInt(randInt(0, product ? 3 : 7));
  const body = pick([
    { latex: index, at: (v) => v },
    { latex: `${index}^2`, at: (v) => v * v },
    { latex: `${index}^3`, at: (v) => v * v * v },
    { latex: `3${index}`, at: (v) => 3n * v },
    { latex: `${index}(${index}+1)`, at: (v) => v * (v + 1n) },
    { latex: `2^${index}`, at: (v) => 2n ** v },
    { latex: `\\gcd(${index},6)`, at: (v) => gcd(v, 6n) },
  ]);
  // The trailing term is outside the operator, which is the whole point of
  // generating one: a reader that swallowed it would be wrong by exactly the
  // number of remaining indices.
  const tail = BigInt(randInt(-4, 4));
  const latex = `${product ? '\\prod' : '\\sum'}_{${index}=${lower}}^{${upper}}${body.latex}`
    + (tail === 0n ? '' : `${tail < 0n ? '-' : '+'}${tail < 0n ? -tail : tail}`);

  let value = product ? 1n : 0n;
  for (let at = lower; at <= upper; at += 1n) {
    value = product ? value * body.at(at) : value + body.at(at);
  }
  return { latex, value: value + tail };
}

/**
 * Trial division, which is the oracle the primality probe is checked against.
 *
 * The kernel deliberately refuses to do this — a checker that factors is a
 * prover — so it belongs here, where being slow costs nothing and where being
 * independent of everything else is the entire point.
 */
function isPrimeByDivision(n) {
  if (n < 2n) return false;
  if (n % 2n === 0n) return n === 2n;
  for (let d = 3n; d * d <= n; d += 2n) if (n % d === 0n) return false;
  return true;
}

const power = (base, exponent, modulus) => {
  let result = 1n;
  let value = base % modulus;
  let rest = exponent;
  while (rest > 0n) {
    if (rest & 1n) result = (result * value) % modulus;
    value = (value * value) % modulus;
    rest >>= 1n;
  }
  return result;
};

/** A Pratt certificate for a prime, generated here rather than by the prover. */
function prattFor(p, into = new Map()) {
  if (into.has(p)) return into;
  if (p === 2n) {
    into.set(p, { numberLatex: '2', rootLatex: null, factorsLatex: [] });
    return into;
  }
  const factors = [];
  let rest = p - 1n;
  for (let d = 2n; d * d <= rest; d += 1n) while (rest % d === 0n) { factors.push(d); rest /= d; }
  if (rest > 1n) factors.push(rest);
  const distinct = [...new Set(factors)];
  for (const q of distinct) prattFor(q, into);
  for (let root = 2n; root < p; root += 1n) {
    if (power(root, p - 1n, p) !== 1n) continue;
    if (distinct.some((q) => power(root, (p - 1n) / q, p) === 1n)) continue;
    into.set(p, { numberLatex: String(p), rootLatex: String(root), factorsLatex: factors.map(String) });
    return into;
  }
  return into;
}

const prattList = (p) => [...prattFor(p).values()]
  .sort((a, b) => (BigInt(a.numberLatex) < BigInt(b.numberLatex) ? -1 : 1));

/** Independently of the kernel's, and only for the generated summands. */
function gcd(a, b) {
  let [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  while (y) [x, y] = [y, x % y];
  return x;
}

// Quarter-integer points, so that equalities and boundaries are actually hit
// rather than being stepped over by a random real.
const POINTS = [];
for (let i = 0; i < 300; i += 1) POINTS.push([randInt(-24, 24) / 4, randInt(-24, 24) / 4]);

const REWRITES = ['relation.normalize', 'polynomial.identity', 'order.positive-scale',
  'relation.nonzero-scale', 'order.affine-monotonicity', 'order.power-monotonicity',
  'polynomial.multiple'];

const oneStep = (rule, conclusionLatex, data = null) => ({
  version: PROOF_VERSION,
  root: 's1',
  steps: [{ id: 's1', rule, premises: [], conclusionLatex, data }],
});

const CASES = Number(process.argv[3] ?? 8000);
let identified = 0;
let verified = 0;
let certified = 0;
let psdCertified = 0;
let tautologyCertified = 0;
let groupCertified = 0;
let enumerated = 0;
let prattChecked = 0;
let unsound = 0;
const failures = [];
const byRule = new Map();

for (let i = 0; i < CASES; i += 1) {
  const base = polynomial();
  const derived = derive(base);
  const exponent = randInt(2, 4);
  const left = pick(RELS);
  const right = pick(RELS);
  const a = { latex: `${base.latex}${left.tex}0`, holds: (x, y) => left.holds(base.at(x, y)) };
  const b = { latex: `${derived.latex}${right.tex}0`, holds: (x, y) => right.holds(derived.at(x, y)) };
  if (!parseProposition(a.latex) || !parseProposition(b.latex)) continue;

  // Claim one: these are the same proposition.
  if (sameProposition(a.latex, b.latex)) {
    identified += 1;
    for (const [x, y] of POINTS) {
      if (a.holds(x, y) !== b.holds(x, y)) {
        unsound += 1;
        failures.push(`identified but different at (${x}, ${y}): ${a.latex}  ///  ${b.latex}`);
        break;
      }
    }
  }

  // Claim two: this rewrite follows.
  const conclusionLatex = `${a.latex}\\implies ${b.latex}`;
  for (const rule of REWRITES) {
    if (checkTrace(oneStep(rule, conclusionLatex, { exponent })).steps.get('s1').trust !== 'verified') {
      continue;
    }
    verified += 1;
    byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
    for (const [x, y] of POINTS) {
      if (a.holds(x, y) && !b.holds(x, y)) {
        unsound += 1;
        failures.push(`verified but false at (${x}, ${y}) under ${rule}: ${conclusionLatex}`);
        break;
      }
    }
  }

  // Claim three: an explicit square supplied as a witness is non-negative.
  // The dense evaluator knows the base polynomial independently of the
  // kernel's parser and expansion code.
  const witnessLatex = `(${base.latex})^2`;
  const certificateLatex = `${witnessLatex}\\ge0`;
  const certificate = oneStep('polynomial.even-power', certificateLatex, { witnessLatex });
  if (checkTrace(certificate).steps.get('s1').trust === 'certified') {
    certified += 1;
    for (const [x, y] of POINTS) {
      if (base.at(x, y) ** 2 < 0) {
        unsound += 1;
        failures.push(`certified but negative at (${x}, ${y}): ${certificateLatex}`);
        break;
      }
    }
  }

  // The same witness must not certify a stronger, generally false claim.
  const corrupted = oneStep(
    'polynomial.even-power',
    `${witnessLatex}-1\\ge0`,
    { witnessLatex },
  );
  if (checkTrace(corrupted).steps.get('s1').trust === 'certified') {
    unsound += 1;
    failures.push(`mismatched witness was certified: ${witnessLatex}-1\\ge0`);
  }

  // Claim four: a rational sum of squares is non-negative. The checker sees
  // only the two bases as LaTeX; this evaluator retains their independently
  // generated JavaScript functions.
  const other = polynomial();
  const firstCoefficient = randInt(1, 4);
  const secondCoefficient = randInt(1, 4);
  const sosLatex = `${firstCoefficient}(${base.latex})^2`
    + `+${secondCoefficient}(${other.latex})^2`;
  const sosData = {
    sosCoefficientsLatex: [`${firstCoefficient}`, `${secondCoefficient}`],
    sosBasesLatex: [base.latex, other.latex],
  };
  const sos = oneStep('quadratic.psd', `${sosLatex}\\ge0`, sosData);
  if (checkTrace(sos).steps.get('s1').trust === 'certified') {
    psdCertified += 1;
    for (const [x, y] of POINTS) {
      const value = firstCoefficient * base.at(x, y) ** 2
        + secondCoefficient * other.at(x, y) ** 2;
      if (value < 0) {
        unsound += 1;
        failures.push(`sum of squares certified but negative at (${x}, ${y}): ${sosLatex}`);
        break;
      }
    }
  }

  const corruptedSos = oneStep('quadratic.psd', `${sosLatex}-1\\ge0`, sosData);
  if (checkTrace(corruptedSos).steps.get('s1').trust === 'certified') {
    unsound += 1;
    failures.push(`mismatched sum-of-squares witness was certified: ${sosLatex}-1\\ge0`);
  }

  // Claim five: excluded middle is a tautology for an arbitrary proposition,
  // while the corresponding contradiction is not. Nesting a generated
  // polynomial relation under the connective keeps this probe independent of
  // the kernel's choice of what counts as an atom.
  const proposition = `(${a.latex})`;
  const excludedMiddle = `${proposition}\\vee\\neg${proposition}`;
  const tautology = oneStep('logic.tautology', excludedMiddle);
  if (checkTrace(tautology).steps.get('s1').trust === 'certified') {
    tautologyCertified += 1;
  } else {
    unsound += 1;
    failures.push(`excluded middle was not certified: ${excludedMiddle}`);
  }

  const contradiction = `${proposition}\\wedge\\neg${proposition}`;
  if (checkTrace(oneStep('logic.tautology', contradiction)).steps.get('s1').trust === 'certified') {
    unsound += 1;
    failures.push(`a contradiction was certified as a tautology: ${contradiction}`);
  }

  // Claim six: inserting a generator beside its inverse does not change a
  // free-group word. The independent stack above supplies the expected normal
  // form, while the kernel sees only LaTeX and must parse and reduce it again.
  const group = groupWord();
  const inserted = { name: pick(['x', 'y', 'z']), inverse: rand() < 0.5 };
  const at = randInt(0, group.length);
  const equivalent = [
    ...group.slice(0, at),
    inserted,
    { name: inserted.name, inverse: !inserted.inverse },
    ...group.slice(at),
  ];
  const groupNormal = groupLatex(reduceGroupWord(group), 'e');
  const groupConclusion = `\\mathsf{Grp}\\vdash ${groupLatex(group)}=${groupLatex(equivalent)}`;
  const groupData = { normalFormLatex: groupNormal, abelian: false };
  if (checkTrace(oneStep('group.free-reduction', groupConclusion, groupData))
    .steps.get('s1').trust === 'certified') {
    groupCertified += 1;
  } else {
    unsound += 1;
    failures.push(`an equivalent free-group word was not certified: ${groupConclusion}`);
  }

  const corruptedGroup = {
    normalFormLatex: `${groupNormal}x`,
    abelian: false,
  };
  if (checkTrace(oneStep('group.free-reduction', groupConclusion, corruptedGroup))
    .steps.get('s1').trust === 'certified') {
    unsound += 1;
    failures.push(`an incorrect free-group normal form was certified: ${groupConclusion}`);
  }

  // Claim seven: a bounded sum or product the kernel expands really does have
  // the value it verified. The independent evaluator is the BigInt loop below,
  // which shares nothing with the kernel's reader — not the parse, not the
  // arithmetic, and not the convention about where the summand ends.
  const enumeration = boundedEnumeration();
  const trueLatex = `${enumeration.latex}=${enumeration.value}`;
  if (checkTrace(oneStep('engine.exact-evaluation', trueLatex)).steps.get('s1').trust
    === 'verified') {
    enumerated += 1;
  } else if (checkTrace(oneStep('engine.exact-evaluation', trueLatex)).steps.get('s1').trust
    === 'rejected') {
    unsound += 1;
    failures.push(`a true enumeration was refused: ${trueLatex}`);
  }

  const falseLatex = `${enumeration.latex}=${enumeration.value + 1n}`;
  if (checkTrace(oneStep('engine.exact-evaluation', falseLatex)).steps.get('s1').trust
    === 'verified') {
    unsound += 1;
    failures.push(`a false enumeration was verified: ${falseLatex}`);
  }

  // Claim eight: a Pratt certificate the kernel certifies is a certificate for
  // a number that really is prime, and no corruption of one survives. Trial
  // division above is the oracle; the kernel never sees it.
  const candidate = BigInt(randInt(2, 4000));
  const truly = isPrimeByDivision(candidate);
  const prattLatex = truly ? prattList(candidate) : null;
  const primeLatex = `${candidate}\\in\\mathbb{P}`;
  const claim = checkTrace(oneStep('arithmetic.primality', primeLatex, { prattLatex }));
  if (claim.steps.get('s1').trust === 'certified') {
    prattChecked += 1;
    if (!truly) {
      unsound += 1;
      failures.push(`a composite was certified prime: ${primeLatex}`);
    }
  } else if (truly && prattLatex?.length) {
    unsound += 1;
    failures.push(`a valid Pratt certificate was not accepted: ${primeLatex}`);
  }

  // Corrupt one entry, chosen at random, in a way that is certainly fatal, and
  // require that the certificate stops establishing anything.
  //
  // Every corruption below breaks a condition outright. Shifting the *root* by
  // one would not: a prime generally has many primitive roots, and the kernel
  // accepting a different one is correct rather than lax.
  if (truly && prattLatex.length > 1) {
    const damaged = prattLatex.map((entry) => ({ ...entry }));
    const at = randInt(0, damaged.length - 1);
    const entry = damaged[at];
    const how = entry.numberLatex === '2'
      ? 'renumber'
      : pick(['renumber', 'root', 'extra factor', 'drop factor', 'drop entry']);
    if (how === 'renumber') damaged[at] = { ...entry, numberLatex: String(BigInt(entry.numberLatex) + 1n) };
    // 1 has order 1 modulo everything, so it is a primitive root of nothing.
    if (how === 'root') damaged[at] = { ...entry, rootLatex: '1' };
    if (how === 'extra factor') damaged[at] = { ...entry, factorsLatex: [...entry.factorsLatex, '2'] };
    if (how === 'drop factor') damaged[at] = { ...entry, factorsLatex: entry.factorsLatex.slice(1) };
    if (how === 'drop entry') damaged.splice(at, 1);

    const corrupt = checkTrace(oneStep('arithmetic.primality', primeLatex, {
      prattLatex: damaged,
    }));
    if (corrupt.steps.get('s1').trust === 'certified') {
      unsound += 1;
      failures.push(`a Pratt certificate survived "${how}": ${primeLatex}`);
    }
  }

  // The other direction: a divisor certifies compositeness, and only a real one.
  if (!truly && candidate > 2n) {
    let divisor = 2n;
    while (candidate % divisor !== 0n) divisor += 1n;
    const compositeLatex = `${candidate}\\notin\\mathbb{P}`;
    if (checkTrace(oneStep('arithmetic.primality', compositeLatex, {
      factorLatex: String(divisor),
    })).steps.get('s1').trust !== 'certified') {
      unsound += 1;
      failures.push(`a real divisor was not accepted: ${compositeLatex} by ${divisor}`);
    }
    if (checkTrace(oneStep('arithmetic.primality', compositeLatex, {
      factorLatex: String(divisor + 1n),
    })).steps.get('s1').trust === 'certified' && candidate % (divisor + 1n) !== 0n) {
      unsound += 1;
      failures.push(`a non-divisor was accepted: ${compositeLatex} by ${divisor + 1n}`);
    }
  }
}

console.log(`seed ${process.argv[2] ?? 20260823}, ${CASES} generated cases`);
console.log(`${identified} identifications and ${verified} verified rewrites`);
console.log(`${certified} independently evaluated even-power certificates`);
console.log(`${psdCertified} independently evaluated sum-of-squares certificates`);
console.log(`${tautologyCertified} generated truth-table certificates`);
console.log(`${groupCertified} independently reduced free-group certificates`);
console.log(`${enumerated} independently evaluated bounded sums and products`);
console.log(`${prattChecked} Pratt certificates re-checked against trial division`);
for (const [rule, count] of [...byRule].sort()) console.log(`  ${String(count).padStart(6)} ${rule}`);
console.log(`each re-checked at ${POINTS.length} points by dense evaluation`);
console.log(unsound === 0
  ? 'SOUND: no false identifications, rewrites, or certificates'
  : `UNSOUND: ${unsound} bad checks`);
for (const failure of failures.slice(0, 20)) console.log(`  - ${failure}`);
process.exitCode = unsound === 0 ? 0 : 1;
