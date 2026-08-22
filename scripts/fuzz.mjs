/**
 * Deterministic property fuzzing for scoped chains and statement evaluation.
 *
 * Usage:
 *   npm run fuzz
 *   npm run fuzz -- --seed 12345 --iterations 50000 --engine-iterations 1000
 */

import { Sheet } from '../src/lib/engine.js';
import {
  flattenTopLevelChain,
  formatTopLevelChain,
  getTopLevelChainCheckpoints,
} from '../src/lib/top-level.js';

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0 || process.argv[at + 1] === undefined) return fallback;
  const value = Number(process.argv[at + 1]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative safe integer`);
  }
  return value;
}

const seed = option('seed', 0x5e0e17);
const iterations = option('iterations', 10000);
const engineIterations = option('engine-iterations', Math.max(100, Math.floor(iterations / 40)));

// Mulberry32: tiny, repeatable, and sufficient for input generation.
let randomState = seed >>> 0;
function random() {
  randomState += 0x6d2b79f5;
  let value = randomState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

const integer = (minimum, maximum) => (
  minimum + Math.floor(random() * (maximum - minimum + 1))
);
const pick = (items) => items[integer(0, items.length - 1)];
const normalize = (latex) => String(latex ?? '').replace(/\s+/g, '');

function invariant(condition, label, context) {
  if (condition) return;
  throw new Error(`${label}\nseed=${seed}\ncase=${JSON.stringify(context)}`);
}

const domains = [
  '\\mathbb{R}',
  '\\mathbb{Z}',
  'D',
  '\\{1,2,3\\}',
  '\\left\\{-2,0,2\\right\\}',
  '\\lbrace1,2,3\\rbrace',
  '\\left[0,1\\right]',
  '\\lbrack0,1\\rbrack',
  '\\{y\\in\\mathbb{R}\\mid y=0\\}',
  '\\left\\{y\\in\\mathbb{R}\\mid y=0\\right\\}',
  '\\mathcal{P}(\\{1,2\\})',
  '\\wp(\\{1,2\\})',
  '\\{1,2\\}\\times\\{-1,1\\}',
  '\\mathbb{R}\\times\\mathbb{R}',
];

function term() {
  const n = integer(-9, 9);
  return pick([
    `x+(${n})`,
    `f(x)+(${n})`,
    `\\frac{x+(${n})}{${integer(1, 9)}}`,
    `\\left(x+(${n})\\right)`,
    `\\{z\\mid z=${n}\\}`,
    `\\left\\{z\\mid z=${n}\\right\\}`,
    `\\lbrace z\\mid z=${n}\\rbrace`,
    `\\left|z=${n}\\right|`,
    `\\left\\langle z=${n}\\right\\rangle`,
    `\\mathcal{P}(\\{z\\mid z=${n}\\})`,
    `\\operatorname{g}\\left(x+(${n})\\right)`,
  ]);
}

function expectedCheckpoint(scope, parts, operators, through) {
  if (!parts[through + 1]) return null;
  let result = parts[0];
  for (let index = 0; index <= through; index++) {
    const separator = operators[index].startsWith('\\') ? `${operators[index]} ` : operators[index];
    result += `${separator}${parts[index + 1]}`;
  }
  return normalize(`${scope}${result}`);
}

let parserCases = 0;
for (let run = 0; run < iterations; run++) {
  let scope = `${pick(['\\forall', '\\exists'])} x\\in${pick(domains)},`;
  if (random() < 0.2) {
    scope += `${pick(['\\forall', '\\exists'])} y\\in${pick(domains)},`;
  }

  const kind = pick(['equality', 'equality', 'inequality', 'logical']);
  const linkCount = integer(2, 6);
  const logicalOperator = pick(['\\implies', '\\iff']);
  const operators = Array.from({ length: linkCount }, () => {
    if (kind === 'equality') return '=';
    if (kind === 'logical') return logicalOperator;
    return pick(['<', '>', '\\le', '\\ge', '\\lt', '\\gt']);
  });
  const parts = Array.from({ length: linkCount + 1 }, term);
  if (random() < 0.08) parts[parts.length - 1] = '';

  let logical = `${scope}${parts[0]}`;
  for (let index = 0; index < operators.length; index++) {
    const separator = operators[index].startsWith('\\') ? `${operators[index]} ` : operators[index];
    logical += `${separator}${parts[index + 1]}`;
  }

  const chain = getTopLevelChainCheckpoints(logical);
  const context = { logical, scope, parts, operators, kind };
  invariant(chain, 'generated scoped chain was not detected', context);
  invariant(normalize(chain.scope) === normalize(scope), 'scope changed', { ...context, chain });
  invariant(chain.links === linkCount, 'an inner relation became a chain link', { ...context, chain });
  invariant(
    JSON.stringify(chain.parts.map(normalize)) === JSON.stringify(parts.map(normalize)),
    'chain terms changed',
    { ...context, chain },
  );
  invariant(
    JSON.stringify(chain.operators) === JSON.stringify(operators),
    'chain operators changed',
    { ...context, chain },
  );
  chain.checkpoints.forEach((checkpoint, index) => {
    invariant(
      checkpoint === null
        ? expectedCheckpoint(scope, parts, operators, index) === null
        : normalize(checkpoint) === expectedCheckpoint(scope, parts, operators, index),
      'checkpoint lost or changed its scope',
      { ...context, chain, checkpoint, index },
    );
  });

  const formatted = formatTopLevelChain(logical);
  invariant(formatted, 'generated chain did not format', context);
  const roundTrip = getTopLevelChainCheckpoints(flattenTopLevelChain(formatted.latex));
  invariant(roundTrip, 'formatted chain did not parse after flattening', { ...context, formatted });
  invariant(
    JSON.stringify(roundTrip.checkpoints.map((item) => item === null ? null : normalize(item)))
      === JSON.stringify(chain.checkpoints.map((item) => item === null ? null : normalize(item))),
    'formatted chain changed its checkpoints',
    { ...context, chain, roundTrip, formatted },
  );
  parserCases++;
}

// Arbitrary incomplete input must never make editor-time chain analysis throw.
const malformedTokens = [
  'x', '0', '=', '<', '>', ',', '{', '}', '(', ')', '[', ']', '\\', '\\{', '\\}',
  '\\forall', '\\exists', '\\in', '\\implies', '\\iff', '\\left', '\\right',
  '\\lbrace', '\\rbrace', '\\frac{', '\\placeholder{}', '&', '\\\\',
  '\\mathcal{P}', '\\wp', '\\operatorname{PowerSet}',
  '\\times', '\\operatorname{CartesianProduct}',
  '\\operatorname{cont}', '\\operatorname{limitw}', '\\operatorname{ball}',
  '\\operatorname{topology}', '\\operatorname{openin}', '\\operatorname{closedin}',
  '\\mathsf{Disc}', '\\mathsf{Ind}', '\\mathsf{Cof}', '\\mathsf{Met}',
  '\\mathsf{Sub}', '\\mathsf{Prod}', '\\mathsf{Ax}_{\\bigcup}',
  '\\operatorname{IndexedUnion}', '\\operatorname{IndexedIntersection}',
];
let malformedCases = 0;
let malformedEvaluations = 0;
for (let run = 0; run < Math.max(1000, Math.floor(iterations / 5)); run++) {
  const source = Array.from({ length: integer(0, 35) }, () => pick(malformedTokens)).join('');
  try {
    const chain = getTopLevelChainCheckpoints(source);
    const formatted = formatTopLevelChain(source);
    if (formatted) {
      flattenTopLevelChain(formatted.latex);
      getTopLevelChainCheckpoints(formatted.latex);
    }
    if (chain?.checkpoints) chain.checkpoints.forEach((checkpoint) => String(checkpoint));
    if (run % 10 === 0) {
      const results = new Sheet().evaluateAll([source]);
      invariant(
        Array.isArray(results) && results.length === 1 && typeof results[0]?.kind === 'string',
        'sheet evaluation did not contain malformed input safely',
        { source, results },
      );
      malformedEvaluations++;
    }
  } catch (error) {
    invariant(false, 'chain analysis threw on incomplete input', { source, error: error?.stack });
  }
  malformedCases++;
}

const proved = (result) => (
  result?.kind === 'truth' && result.value === true && result.method === 'proved'
);
const exactTruth = (result, expected) => (
  result?.kind === 'truth' && result.value === expected && result.method !== 'sampled'
);
let evaluatedCheckpoints = 0;
let powerSetCases = 0;
let cartesianProductCases = 0;
let analysisCases = 0;
let topologyCases = 0;
let indexedFamilyCases = 0;
let infiniteTopologyCases = 0;
for (let run = 0; run < engineIterations; run++) {
  const a = integer(-5, 5);
  const b = integer(-5, 5);
  const c = integer(-5, 5);
  const polynomial = `(${a})x^2+(${b})x+(${c})`;
  const identities = [
    polynomial,
    `(${polynomial})+0`,
    `0+(${polynomial})`,
    `1(${polynomial})`,
  ];
  const equality = `\\forall x\\in\\mathbb{R},${identities.join('=')}`;
  const equalityCheckpoints = getTopLevelChainCheckpoints(equality)?.checkpoints;
  invariant(equalityCheckpoints?.length === 3, 'identity chain checkpoints were lost', { equality });
  equalityCheckpoints.forEach((checkpoint) => {
    const result = new Sheet().evaluateLine(checkpoint, { allowDefinitions: false });
    invariant(proved(result), 'valid polynomial identity checkpoint was not proved', {
      checkpoint, result,
    });
    evaluatedCheckpoints++;
  });

  const broken = `${equality}=${polynomial}+1`;
  const brokenResult = new Sheet().evaluateLine(broken, { allowDefinitions: false });
  invariant(
    brokenResult.kind === 'truth' && brokenResult.value === false,
    'false polynomial chain was accepted',
    { broken, brokenResult },
  );

  const offset = integer(-9, 9);
  const firstGap = integer(1, 7);
  const secondGap = integer(0, 7);
  const inequality = `\\forall x\\in\\mathbb{R},x+(${offset})`
    + `<x+(${offset + firstGap})\\le x+(${offset + firstGap + secondGap})`;
  const inequalityCheckpoints = getTopLevelChainCheckpoints(inequality)?.checkpoints;
  invariant(inequalityCheckpoints?.length === 2, 'inequality checkpoints were lost', { inequality });
  inequalityCheckpoints.forEach((checkpoint) => {
    const result = new Sheet().evaluateLine(checkpoint, { allowDefinitions: false });
    invariant(proved(result), 'valid real-domain inequality checkpoint was not proved', {
      checkpoint, result,
    });
    evaluatedCheckpoints++;
  });

  const values = Array.from({ length: integer(2, 6) }, () => integer(-8, 8));
  const finiteDomain = `\\{${values.join(',')}\\}`;
  const finiteChain = `\\forall x\\in${finiteDomain},x=x+0=0+x`;
  const finiteCheckpoints = getTopLevelChainCheckpoints(finiteChain)?.checkpoints;
  invariant(finiteCheckpoints?.length === 2, 'finite-domain checkpoints were lost', { finiteChain });
  finiteCheckpoints.forEach((checkpoint) => {
    const result = new Sheet().evaluateLine(checkpoint, { allowDefinitions: false });
    invariant(proved(result), 'valid finite-domain equality checkpoint was not proved', {
      checkpoint, result,
    });
    evaluatedCheckpoints++;
  });

  const implication = `\\forall x\\in\\mathbb{R},x>${offset + 2}`
    + `\\implies x>${offset + 1}\\implies x>${offset}`;
  const implicationCheckpoints = getTopLevelChainCheckpoints(implication)?.checkpoints;
  invariant(implicationCheckpoints?.length === 2, 'quantified implication checkpoints were lost', {
    implication,
  });
  implicationCheckpoints.forEach((checkpoint) => {
    const result = new Sheet().evaluateLine(checkpoint, { allowDefinitions: false });
    invariant(proved(result), 'valid quantified implication checkpoint was not proved', {
      checkpoint, result,
    });
    evaluatedCheckpoints++;
  });

  const shifted = `x+(${offset})`;
  const equivalence = `\\forall x\\in\\mathbb{R},${shifted}>0`
    + `\\iff 2(${shifted})>0\\iff 3(${shifted})>0`;
  const equivalenceCheckpoints = getTopLevelChainCheckpoints(equivalence)?.checkpoints;
  invariant(equivalenceCheckpoints?.length === 2, 'quantified equivalence checkpoints were lost', {
    equivalence,
  });
  equivalenceCheckpoints.forEach((checkpoint) => {
    const result = new Sheet().evaluateLine(checkpoint, { allowDefinitions: false });
    invariant(proved(result), 'valid quantified equivalence checkpoint was not proved', {
      checkpoint, result,
    });
    evaluatedCheckpoints++;
  });

  const universe = [-2, -1, 0, 1, 2];
  const base = universe.filter(() => random() < 0.55);
  const candidate = universe.filter(() => random() < 0.4);
  if (random() < 0.2) candidate.push(9);
  const setLiteral = (values) => values.length ? `\\{${values.join(',')}\\}` : '\\varnothing';
  const powerNotation = random() < 0.5 ? '\\mathcal{P}' : '\\wp';
  const membership = `${setLiteral(candidate)}\\in${powerNotation}(${setLiteral(base)})`;
  const membershipResult = new Sheet().evaluateLine(membership, { allowDefinitions: false });
  const expectedMembership = candidate.every((value) => base.includes(value));
  invariant(
    exactTruth(membershipResult, expectedMembership),
    'power-set membership disagreed with the subset oracle',
    { base, candidate, membership, membershipResult, expectedMembership },
  );
  powerSetCases++;

  const powerValue = new Sheet().evaluateLine(
    `${powerNotation}(${setLiteral(base)})`, { allowDefinitions: false }
  );
  invariant(powerValue.kind === 'set', 'finite power set was not a set value', {
    base, powerValue,
  });
  powerSetCases++;

  const leftFactor = [...new Set(base)];
  const rightFactor = [...new Set(candidate)];
  const x = integer(-3, 3);
  const y = integer(-3, 3);
  const productMembership = `(${x},${y})\\in${setLiteral(leftFactor)}`
    + `\\times${setLiteral(rightFactor)}`;
  const productMembershipResult = new Sheet().evaluateLine(
    productMembership, { allowDefinitions: false }
  );
  const expectedProductMembership = leftFactor.includes(x) && rightFactor.includes(y);
  invariant(
    exactTruth(productMembershipResult, expectedProductMembership),
    'Cartesian-product membership disagreed with the ordered-pair oracle',
    {
      leftFactor, rightFactor, x, y, productMembership,
      productMembershipResult, expectedProductMembership,
    },
  );
  cartesianProductCases++;

  const productValue = new Sheet().evaluateLine(
    `${setLiteral(leftFactor)}\\times${setLiteral(rightFactor)}`,
    { allowDefinitions: false },
  );
  invariant(productValue.kind === 'set', 'finite Cartesian product was not a set value', {
    leftFactor, rightFactor, productValue,
  });
  cartesianProductCases++;

  const slope = pick([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]);
  const intercept = integer(-9, 9);
  const continuityLines = [
    `f(x):=(${slope})x+(${intercept})`,
    `\\operatorname{cont}(f,a,\\epsilon,\\epsilon/${Math.abs(slope)})`,
  ];
  const continuityResult = new Sheet().evaluateAll(continuityLines).at(-1);
  invariant(proved(continuityResult), 'valid affine epsilon-delta witness was not proved', {
    slope, intercept, continuityLines, continuityResult,
  });
  analysisCases++;

  const center = integer(-5, 5);
  const radius = integer(1, 6);
  const point = integer(-10, 10);
  const ballMembership = `${point}\\in\\operatorname{ball}(${center},${radius})`;
  const ballResult = new Sheet().evaluateLine(ballMembership, { allowDefinitions: false });
  invariant(
    exactTruth(ballResult, Math.abs(point - center) < radius),
    'open-ball membership disagreed with the distance oracle',
    { center, radius, point, ballMembership, ballResult },
  );
  analysisCases++;

  const topologyFamilyMask = integer(0, 255);
  const subsetLatex = (mask) => {
    const members = [0, 1, 2].filter((_, bit) => mask & (1 << bit));
    return setLiteral(members);
  };
  const family = Array.from({ length: 8 }, (_, mask) => mask)
    .filter((mask) => topologyFamilyMask & (1 << mask));
  const topologyLatex = family.length
    ? `\\{${family.map(subsetLatex).join(',')}\\}` : '\\varnothing';
  const expectedTopology = Boolean(topologyFamilyMask & 1)
    && Boolean(topologyFamilyMask & (1 << 7))
    && family.every((left) => family.every((right) => (
      Boolean(topologyFamilyMask & (1 << (left | right)))
      && Boolean(topologyFamilyMask & (1 << (left & right)))
    )));
  const topologyProposition = `\\operatorname{topology}(${topologyLatex},\\{0,1,2\\})`;
  const topologyResult = new Sheet().evaluateLine(topologyProposition, { allowDefinitions: false });
  invariant(
    exactTruth(topologyResult, expectedTopology),
    'finite topology predicate disagreed with the closure oracle',
    { topologyFamilyMask, topologyProposition, topologyResult, expectedTopology },
  );
  topologyCases++;

  const indexCount = integer(2, 5);
  const indexValues = Array.from({ length: indexCount }, (_, index) => index);
  const indexedLines = [
    'F(i):=\\{i,10\\}',
    `\\operatorname{IndexedUnion}(F,${setLiteral(indexValues)})`
      + `=${setLiteral([...indexValues, 10])}`
      + `\\land\\operatorname{IndexedIntersection}(F,${setLiteral(indexValues)})=\\{10\\}`,
  ];
  const indexedResult = new Sheet().evaluateAll(indexedLines).at(-1);
  invariant(proved(indexedResult), 'finite indexed-family algebra was not proved', {
    indexValues, indexedLines, indexedResult,
  });
  indexedFamilyCases++;

  const topologyKind = pick(['Disc', 'Ind', 'Cof', 'Met', 'Sub', 'Prod']);
  let infiniteLines;
  let topologyName;
  let carrier;
  if (topologyKind === 'Sub') {
    infiniteLines = [
      'M:=\\mathsf{Met}(\\mathbb{R})',
      'K:=\\operatorname{ClosedBall}(0,1)',
      'T:=\\mathsf{Sub}(M,\\mathbb{R},K)',
    ];
    topologyName = 'T';
    carrier = 'K';
  } else if (topologyKind === 'Prod') {
    infiniteLines = [
      'M:=\\mathsf{Met}(\\mathbb{R})',
      'T:=\\mathsf{Prod}(M,\\mathbb{R},M,\\mathbb{R})',
    ];
    topologyName = 'T';
    carrier = '\\mathbb{R}\\times\\mathbb{R}';
  } else {
    infiniteLines = [`T:=\\mathsf{${topologyKind}}(\\mathbb{R})`];
    topologyName = 'T';
    carrier = '\\mathbb{R}';
  }
  infiniteLines.push(
    `\\mathsf{Ax}_{\\varnothing}(${topologyName},${carrier})`
      + `\\land\\mathsf{Ax}_{X}(${topologyName},${carrier})`
      + `\\land\\mathsf{Ax}_{\\bigcup}(${topologyName},${carrier})`
      + `\\land\\mathsf{Ax}_{\\cap}(${topologyName},${carrier})`
      + `\\land\\mathsf{Top}(${topologyName},${carrier})`,
  );
  const infiniteResult = new Sheet().evaluateAll(infiniteLines).at(-1);
  invariant(proved(infiniteResult), 'infinite topology certificate was not proved', {
    topologyKind, infiniteLines, infiniteResult,
  });
  infiniteTopologyCases++;
}

console.log(JSON.stringify({
  seed,
  parserCases,
  malformedCases,
  malformedEvaluations,
  engineCases: engineIterations,
  evaluatedCheckpoints,
  powerSetCases,
  cartesianProductCases,
  analysisCases,
  topologyCases,
  indexedFamilyCases,
  infiniteTopologyCases,
}, null, 2));
