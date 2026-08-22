/**
 * Headless checks for the evaluation core. Run with `npm test`.
 * Each case is a sheet: a list of lines, then expectations on the last line.
 */
import { Sheet } from '../src/lib/engine.js';
import {
  flattenTopLevelChain,
  formatTopLevelChain,
  getTopLevelChainCheckpoints,
} from '../src/lib/top-level.js';
import {
  ANALYSIS_LAYOUT,
  CALCULATOR_LAYOUT,
  INLINE_SHORTCUTS,
  KEYBOARD_LAYOUTS,
  SET_LAYOUT,
  TOPOLOGY_LAYOUT,
} from '../src/lib/mathfield.js';
import { parseSheetStateHash, serializeSheetState } from '../src/lib/url-state.js';

let passed = 0;
let failed = 0;
const failures = [];

console.log('== live URL sheet state ==');
const urlHash = serializeSheetState({
  lines: ['x^2+y^2\\ge 0', '\\text{speed}:=3', ''],
  display: 'decimal',
});
const urlRoundTrip = parseSheetStateHash(urlHash);
if (JSON.stringify(urlRoundTrip) === JSON.stringify({
  lines: ['x^2+y^2\\ge 0', '\\text{speed}:=3', ''],
  display: 'decimal',
})) passed++;
else failures.push(`URL state did not round-trip: ${JSON.stringify(urlRoundTrip)}`);

for (const invalidHash of ['#sheet=', '#sheet=%7Bbad', '#sheet=%7B%22v%22%3A2%7D', '#demo']) {
  if (parseSheetStateHash(invalidHash) === null) passed++;
  else failures.push(`invalid URL state was accepted: ${invalidHash}`);
}

function describeResult(r) {
  switch (r.kind) {
    case 'value': return `value ${r.exactLatex}${r.approxLatex ? ` (~${r.approxLatex})` : ''}`;
    case 'truth': return `truth ${r.value} [${r.method}]${r.counterexample ? ' ce:' + r.counterexample.map(c => `${c.nameLatex}=${c.valueLatex}`).join(',') : ''}`;
    case 'definition': return `definition ${r.what} ${r.name}`;
    case 'symbolic': return `symbolic ${r.latex}`;
    case 'error': return `error ${r.message}`;
    case 'empty': return 'empty';
    default: return JSON.stringify(r);
  }
}

function check(label, lines, expect) {
  const sheet = new Sheet();
  let results;
  try {
    results = sheet.evaluateAll(lines);
  } catch (e) {
    failed++;
    failures.push(`${label}\n    threw: ${e.stack?.split('\n').slice(0, 3).join('\n')}`);
    return;
  }
  const last = results[results.length - 1];
  const problem = expect(last, results);
  if (problem) {
    failed++;
    failures.push(`${label}\n    got: ${describeResult(last)}\n    ${problem}`);
  } else {
    passed++;
  }
}

const isValue = (latex) => (r) => {
  if (r.kind !== 'value') return `expected a value, got kind=${r.kind}`;
  if (latex !== undefined && r.exactLatex !== latex) return `expected exact ${latex}`;
  return null;
};
const isApprox = (num) => (r) => {
  if (r.kind !== 'value') return `expected a value, got kind=${r.kind}`;
  const got = Number.parseFloat(r.approxLatex ?? r.exactLatex);
  if (!Number.isFinite(got) || Math.abs(got - num) > 1e-9) return `expected ~${num}, got ${r.approxLatex ?? r.exactLatex}`;
  return null;
};
const isTrue = (r) => (r.kind === 'truth' && r.value === true) ? null : `expected true`;
/** True *and* established symbolically — sampling alone is not good enough. */
const isProved = (r) => {
  if (r.kind !== 'truth' || r.value !== true) return 'expected true';
  return r.method === 'proved' ? null : `expected a proof, got ${r.method}`;
};
const isFalse = (r) => (r.kind === 'truth' && r.value === false) ? null : `expected false`;
/** False, with the exact point where it fails — not merely a sampled miss. */
const isCounterexample = (valueLatex) => (r) => {
  if (r.kind !== 'truth' || r.value !== false) return 'expected false';
  if (r.method !== 'counterexample') return `expected a counterexample, got ${r.method}`;
  const got = r.counterexample?.[0]?.valueLatex;
  return got === valueLatex ? null : `expected the witness ${valueLatex}, got ${got}`;
};
/** False by exact decision, at a point with no exact display form. */
const isDisproved = (r) => {
  if (r.kind !== 'truth' || r.value !== false) return 'expected false';
  return r.method === 'disproved' ? null : `expected disproved, got ${r.method}`;
};
const isDefinition = (what) => (r) =>
  (r.kind === 'definition' && (what === undefined || r.what === what)) ? null : `expected a ${what ?? ''} definition`;
const isSymbolic = (r) => r.kind === 'symbolic' ? null : 'expected a symbolic result';

function checkChainLayout(label, input, expected) {
  const actual = formatTopLevelChain(input)?.latex ?? null;
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
  } else {
    failed++;
    failures.push(`${label}\n    expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log('== editor chain layout ==');
checkChainLayout(
  'trailing second implication',
  'A\\implies B\\implies',
  '\\begin{align}A & \\implies B\\\\  & \\implies \\placeholder{}\\end{align}',
);
checkChainLayout(
  'pasted equivalence chain',
  'A\\iff B\\iff C\\iff D',
  '\\begin{align}A & \\iff B\\\\  & \\iff C\\\\  & \\iff D\\end{align}',
);
checkChainLayout(
  'trailing equality chain',
  'a=b=',
  '\\begin{align}a & = b\\\\  & = \\placeholder{}\\end{align}',
);
checkChainLayout(
  'mixed strict and non-strict inequality chain',
  'x<x+1\\le x+2',
  '\\begin{align}x & < x+1\\\\  & \\le x+2\\end{align}',
);
checkChainLayout(
  'real-domain equality chain',
  '\\forall t\\in\\mathbb{R},A=B=C',
  '\\begin{align}\\forall t\\in\\mathbb{R},A & = B\\\\  & = C\\end{align}',
);
checkChainLayout(
  'set-builder predicate relation stays inside the first chain term',
  '\\{x\\in\\mathbb{R}\\mid x=0\\}=\\{0\\}=\\{0\\}',
  '\\begin{align}\\{x\\in\\mathbb{R}\\mid x=0\\} & = \\{0\\}\\\\  & = \\{0\\}\\end{align}',
);
checkChainLayout(
  'logical chains take priority over their relations',
  'x>3\\implies x>2\\implies x>1',
  '\\begin{align}x>3 & \\implies x>2\\\\  & \\implies x>1\\end{align}',
);
checkChainLayout('mixed equality and inequality stays inline', 'a=b<c', null);
checkChainLayout('parenthesized implication is not top-level', 'A\\implies(B\\implies C)', null);
checkChainLayout('mixed connectives retain precedence', 'A\\iff B\\implies C\\iff D', null);

const formattedChain = formatTopLevelChain('x>3\\implies x>2\\implies x>1');
if (formattedChain && flattenTopLevelChain(formattedChain.latex) === formattedChain.logical) {
  passed++;
} else {
  failed++;
  failures.push('formatted implication chain round-trips to its logical value');
}

const completeCheckpoints = getTopLevelChainCheckpoints('A\\implies B\\implies C')?.checkpoints;
if (JSON.stringify(completeCheckpoints) === JSON.stringify([
  'A\\implies B',
  'A\\implies B\\implies C',
])) passed++;
else {
  failed++;
  failures.push(`complete chain checkpoints: got ${JSON.stringify(completeCheckpoints)}`);
}

const partialCheckpoints = getTopLevelChainCheckpoints('A\\iff B\\iff')?.checkpoints;
if (JSON.stringify(partialCheckpoints) === JSON.stringify(['A\\iff B', null])) passed++;
else {
  failed++;
  failures.push(`partial chain checkpoints: got ${JSON.stringify(partialCheckpoints)}`);
}

const inequalityCheckpoints = getTopLevelChainCheckpoints('x<x+1\\le x+2')?.checkpoints;
if (JSON.stringify(inequalityCheckpoints) === JSON.stringify([
  'x<x+1',
  'x<x+1\\le x+2',
])) passed++;
else {
  failed++;
  failures.push(`inequality checkpoints: got ${JSON.stringify(inequalityCheckpoints)}`);
}

const domainChain = getTopLevelChainCheckpoints(
  '\\forall t\\in\\mathbb{R},A=B=C'
);
if (domainChain?.scope === '\\forall t\\in\\mathbb{R},'
  && JSON.stringify(domainChain.parts) === JSON.stringify(['A', 'B', 'C'])
  && JSON.stringify(domainChain.checkpoints) === JSON.stringify([
    '\\forall t\\in\\mathbb{R},A=B',
    '\\forall t\\in\\mathbb{R},A=B=C',
  ])) passed++;
else {
  failed++;
  failures.push(`domain chain scope/checkpoints: got ${JSON.stringify(domainChain)}`);
}

const finiteDomainChain = getTopLevelChainCheckpoints(
  '\\forall x\\in\\{1,2\\},x=x+0=0+x'
);
if (finiteDomainChain?.scope === '\\forall x\\in\\{1,2\\},'
  && finiteDomainChain.checkpoints.every((checkpoint) => (
    checkpoint.startsWith('\\forall x\\in\\{1,2\\},')
  ))) passed++;
else {
  failed++;
  failures.push(`finite domain chain lost its scope: got ${JSON.stringify(finiteDomainChain)}`);
}

const bareEqualityCheckpoint = new Sheet().evaluateLine('a=b', { allowDefinitions: false });
if (bareEqualityCheckpoint.kind === 'truth') passed++;
else {
  failed++;
  failures.push(`bare equality checkpoint became ${describeResult(bareEqualityCheckpoint)}`);
}

console.log('== numeric expressions (N/I/Q/R/C) ==');
check('natural', ['2+3'], isValue('5'));
check('integer', ['7-19'], isValue('-12'));
check('rational stays exact', ['\\frac{1}{3}+\\frac{1}{6}'], isValue('\\frac{1}{2}'));
check('real irrational', ['\\sqrt{8}'], isValue('2\\sqrt{2}'));
check('real decimal', ['\\sqrt{2}'], isApprox(Math.SQRT2));
check('complex arithmetic', ['(2+3i)(2-3i)'], isValue('13'));
check('complex result', ['(1+i)^2'], (r) => r.kind === 'value' && /2i/.test(r.exactLatex) ? null : 'expected 2i');
check('i is defined', ['i^2'], isValue('-1'));
check('sqrt of negative', ['\\sqrt{-1}'], (r) => r.kind === 'value' && /i/.test(r.exactLatex) ? null : 'expected i');
check('pi', ['2\\pi'], isApprox(2 * Math.PI));
check('e', ['e^0'], isValue('1'));

console.log('== floor / ceil / rnd / Re / Im ==');
check('floor brackets', ['\\lfloor 3.7\\rfloor'], isValue('3'));
check('ceil brackets', ['\\lceil 3.2\\rceil'], isValue('4'));
check('floor negative', ['\\lfloor -3.2\\rfloor'], isValue('-4'));
check('floor operator', ['\\operatorname{floor}(3.7)'], isValue('3'));
check('ceil operator', ['\\operatorname{ceil}(3.2)'], isValue('4'));
check('rnd operator', ['\\operatorname{rnd}(3.5)'], isValue('4'));
check('MathLive copied rnd', ['\\operatorname{\\mathrm{rnd}}\\left(3.5\\right)'], isValue('4'));
check('legacy round operator', ['\\operatorname{round}(3.5)'], isValue('4'));
check('Re', ['\\operatorname{Re}(3+4i)'], isValue('3'));
check('Im', ['\\operatorname{Im}(3+4i)'], isValue('4'));
check('MathLive typed Re', ['\\mathrm{Re}(3+4i)'], isValue('3'));
check('MathLive typed Im', ['\\mathrm{Im}(3+4i)'], isValue('4'));
check('MathLive copied Re', ['\\operatorname{\\mathrm{Re}}\\left(3+4i\\right)'], isValue('3'));
check('MathLive copied Im', ['\\operatorname{\\mathrm{Im}}\\left(3+4i\\right)'], isValue('4'));
check('Re of expression', ['\\operatorname{Re}((1+i)^2)'], isValue('0'));
check('ceil of pi', ['\\lceil\\pi\\rceil'], isValue('4'));
check('floor of -pi', ['\\lfloor-\\pi\\rfloor'], isValue('-4'));
check('rounding over symbolic constants folds', ['\\lceil\\pi\\rceil+\\lfloor-\\pi\\rfloor'], isValue('0'));
check('rnd of e', ['\\operatorname{rnd}(e)'], isValue('3'));
const rndKey = CALCULATOR_LAYOUT.rows.flat().find((entry) => entry.label === 'rnd');
if (rndKey?.insert === '\\operatorname{rnd}(#?)' && INLINE_SHORTCUTS.rnd) passed++;
else failures.push('calculator keyboard and inline shortcut should expose rnd');
const keyboardUnitWidth = (entry) => {
  if (entry.width) return entry.width;
  const widthClass = entry.class?.match(/(?:^|\s)w(\d+)(?:\s|$)/)?.[1];
  return widthClass ? Number(widthClass) / 10 : 1;
};
const keyboardKeyStart = (row, latex) => {
  let position = 0;
  for (const entry of row) {
    if (entry.latex === latex) return position;
    position += keyboardUnitWidth(entry);
  }
  return -1;
};
const numberStarts = ['7', '4', '1', '0'].map((latex, row) => (
  keyboardKeyStart(CALCULATOR_LAYOUT.rows[row], latex)
));
if (numberStarts.every((start) => start === numberStarts[0])) passed++;
else failures.push(`calculator number columns should align: ${numberStarts.join(', ')}`);
const calculatorRowWidths = CALCULATOR_LAYOUT.rows.slice(0, 4)
  .map((row) => row.reduce((sum, entry) => sum + keyboardUnitWidth(entry), 0));
if (calculatorRowWidths.every((width) => width === calculatorRowWidths[0])) passed++;
else failures.push(`calculator number rows should have equal widths: ${calculatorRowWidths.join(', ')}`);
const returnKey = CALCULATOR_LAYOUT.rows.at(-1).find((entry) => entry.label === '[return]');
if (returnKey?.tooltip === 'new line') passed++;
else failures.push('calculator keyboard should expose a bottom-row Return key');
const backspaceKey = CALCULATOR_LAYOUT.rows.at(-1).find((entry) => entry.label === '[backspace]');
if (backspaceKey?.class?.split(/\s+/).includes('calc-backspace')) passed++;
else failures.push('calculator Backspace should use the button-sized icon treatment');
const boxedTemplateKeys = CALCULATOR_LAYOUT.rows.flat().filter((entry) => (
  [
    '\\lfloor#?\\rfloor', '\\lceil#?\\rceil', '\\frac{#?}{#?}',
    '#?^{#?}', '#?_{#?}', '\\sqrt{#?}',
  ].includes(entry.latex) || entry.label === '|x|'
));
if (boxedTemplateKeys.length === 7
  && boxedTemplateKeys.every((entry) => entry.class?.split(/\s+/).includes('small'))) passed++;
else failures.push('boxed calculator templates should use the smaller keycap scale');
const functionKeyLabels = CALCULATOR_LAYOUT.rows.at(-2)
  .filter((entry) => entry.label)
  .map((entry) => entry.label);
if (JSON.stringify(functionKeyLabels) === JSON.stringify(['sin', 'cos', 'tan', 'ln', 'log', 'conj'])) passed++;
else failures.push(`calculator function row is incomplete: ${functionKeyLabels.join(', ')}`);
if (KEYBOARD_LAYOUTS[0] === CALCULATOR_LAYOUT
  && KEYBOARD_LAYOUTS[1] === SET_LAYOUT
  && KEYBOARD_LAYOUTS[2] === ANALYSIS_LAYOUT
  && KEYBOARD_LAYOUTS[3] === TOPOLOGY_LAYOUT
  && JSON.stringify(KEYBOARD_LAYOUTS.slice(4)) === JSON.stringify(['alphabetic', 'greek'])) passed++;
else failures.push('redundant numeric and symbols keyboard tabs should be removed');
const setKeys = SET_LAYOUT.rows.flat().map((entry) => entry.latex ?? entry.insert ?? entry.label);
if (['\\in', '\\notin', '\\subseteq', '\\cup', '\\cap', '\\setminus', '\\varnothing', '\\times',
  '\\mathcal{P}\\left(#?\\right)', '\\mathbb{R}']
  .every((expected) => setKeys.includes(expected))) passed++;
else failures.push('set keyboard should expose the core relation, operation, and domain keys');
const cartesianKey = SET_LAYOUT.rows.flat().find((entry) => entry.tooltip === 'Cartesian product');
if (cartesianKey?.insert === '#?\\times#?') passed++;
else failures.push('the Cartesian-product key should create two operand slots');
if (INLINE_SHORTCUTS.powerset === '\\mathcal{P}\\left(#?\\right)') passed++;
else failures.push('the powerset inline shortcut should insert conventional power-set notation');
if (INLINE_SHORTCUTS.cart === '\\operatorname{CartesianProduct}\\left(#?,#?\\right)') passed++;
else failures.push('the cart inline shortcut should insert an unambiguous Cartesian product');
if (setKeys.filter((entry) => entry === '\\varnothing' || entry === '\\emptyset').length === 1) passed++;
else failures.push('set keyboard should expose exactly one empty-set key');
const standardSetKeys = SET_LAYOUT.rows[2];
if (standardSetKeys.length === 5
  && standardSetKeys.every((entry) => !entry.class?.split(/\s+/).includes('small'))) passed++;
else failures.push('standard number-set keys should use the full keycap scale');
const analysisKeys = ANALYSIS_LAYOUT.rows.flat();
if (['\\epsilon', '\\delta'].every((latex) => analysisKeys.some((entry) => entry.latex === latex))
  && ['ball', 'cball', 'cont', 'limit']
    .every((label) => analysisKeys.some((entry) => entry.label === label))) passed++;
else failures.push('analysis keyboard should expose witnesses and metric balls');
const topologyKeys = TOPOLOGY_LAYOUT.rows.flat();
if (['\\mathsf{Disc}', '\\mathsf{Ind}', '\\mathsf{Cof}', '\\mathsf{Met}',
  '\\mathsf{Sub}', '\\mathsf{Prod}', '\\mathsf{Ax}_{\\varnothing}',
  '\\mathsf{Ax}_{\\bigcup}', '\\mathsf{Top}', '\\bigcup_{i\\in I}']
  .every((latex) => topologyKeys.some((entry) => entry.latex === latex))) passed++;
else failures.push('topology keyboard should expose constructors, axioms, and indexed families');
if (INLINE_SHORTCUTS.cont?.includes('\\operatorname{cont}')
  && INLINE_SHORTCUTS.topology?.includes('\\mathsf{Top}')
  && INLINE_SHORTCUTS.metricopen?.includes('\\mathcal{O}_{\\mathbb{R}}')
  && INLINE_SHORTCUTS.cofinite?.includes('\\mathsf{Cof}')
  && INLINE_SHORTCUTS.axunions?.includes('\\mathsf{Ax}_{\\bigcup}')) passed++;
else failures.push('analysis proof predicates should have inline shortcuts');
check('closed forms survive the fold', ['\\sqrt{8}'], isValue('2\\sqrt{2}'));
check('pi stays symbolic', ['2\\pi'], isApprox(2 * Math.PI));
check('third stays exact', ['\\frac{1}{3}'], isValue('\\frac{1}{3}'));
check('large numbers are not digit-grouped', ['123456.789'], isValue('123456.789'));
check('large integer', ['99999\\cdot 99999'], isValue('9999800001'));
check('nested', ['\\lfloor\\operatorname{Re}(3.7+2i)\\rfloor'], isValue('3'));

console.log('== numerical equations ==');
check('true equation', ['2+2=4'], isTrue);
check('false equation', ['2+2=5'], isFalse);
check('exact rational equation', ['\\frac{1}{3}+\\frac{1}{6}=\\frac{1}{2}'], isTrue);
check('float equation', ['0.1+0.2=0.3'], isTrue);
check('complex equation', ['(1+i)(1-i)=2'], isTrue);

console.log('== numerical inequalities ==');
check('lt true', ['2<3'], isTrue);
check('lt false', ['3<2'], isFalse);
check('le true', ['3\\le 3'], isTrue);
check('ge false', ['2\\ge 3'], isFalse);
check('ne true', ['2\\ne 3'], isTrue);
check('chained true', ['1<2<3'], isTrue);
check('chained false', ['1<2<2'], isFalse);
check('irrational compare', ['\\sqrt{2}<1.5'], isTrue);

console.log('== definitions ==');
check('constant via =', ['x=5'], isDefinition('constant'));
check('constant via :=', ['x:=5'], isDefinition('constant'));
check('constant used below', ['x=5', 'x^2'], isValue('25'));
check('text-mode constant', ['\\text{maxSpeed}=42', '\\text{maxSpeed}+8'], isValue('50'));
check('snake_case name', ['\\text{max\\_speed}=10', '\\text{max\\_speed}\\cdot 2'], isValue('20'));
check('hyphen name', ['\\text{max-speed}=10', '\\text{max-speed}+5'], isValue('15'));
check('PascalCase name', ['\\text{MaxSpeed}=3', '\\text{MaxSpeed}^2'], isValue('9'));
check('camelCase name', ['\\text{maxSpeed}=3', '\\text{maxSpeed}^3'], isValue('27'));
check('greek name', ['\\alpha=7', '\\alpha+1'], isValue('8'));
check('capital greek (Gamma clash)', ['\\Gamma=4', '\\Gamma\\cdot 3'], isValue('12'));
check('subscripted name', ['v_{\\text{max}}=9', 'v_{\\text{max}}+1'], isValue('10'));
check('numeric subscript', ['x_1=2', 'x_2=3', 'x_1+x_2'], isValue('5'));
check('subscript is distinct from base', ['x=1', 'x_1=100', 'x+x_1'], isValue('101'));
check('function definition', ['f(x)=x^2'], isDefinition('function'));
check('function applied', ['f(x)=x^2', 'f(6)'], isValue('36'));
check('function via :=', ['f(x):=x^3', 'f(2)'], isValue('8'));
// What the editor actually stores once `:=` has been typed: the operator inside
// its presentational `\mathrel` wrapper. Every `:=` path has to see through it.
check('constant via the spaced := the editor inserts',
  ['x\\mathrel{\\coloneq}5', 'x+1'], isValue('6'));
check('function via the spaced :=',
  ['f(x)\\mathrel{\\coloneq}x^3', 'f(2)'], isValue('8'));
check('spaced := is a definition, not an equation',
  ['k\\mathrel{\\coloneq}9'], isDefinition('constant'));
check('spaced := still forces a definition over a taken name',
  ['x=1', 'x\\mathrel{\\coloneq}2', 'x'], isValue('2'));
check('two-arg function', ['g(x,y)=x+y', 'g(3,4)'], isValue('7'));
check('text-mode function', ['\\text{sq}(x)=x^2', '\\text{sq}(9)'], isValue('81'));
check('function of constant', ['c=3', 'f(x)=x+c', 'f(4)'], isValue('7'));
check('nested functions', ['f(x)=x^2', 'g(x)=f(x)+1', 'g(3)'], isValue('10'));
check('redefining is an equation', ['x=5', 'x=5'], isTrue);
check('redefining false', ['x=5', 'x=6'], isFalse);
check('self-reference is not a definition', ['x=x+1'], isFalse);

console.log('== undefined terms stay algebraic ==');
check('bare unknown', ['2y+1'], isSymbolic);
check('partially defined', ['a=2', 'a\\cdot b'], isSymbolic);

console.log('== algebraic equation truthiness ==');
check('identity', ['(x+1)^2=x^2+2x+1'], isTrue);
check('non-identity', ['(x+1)^2=x^2+1'], isFalse);
check('trig identity', ['\\sin(x)^2+\\cos(x)^2=1'], isTrue);

console.log('== domain-aware transcendental sampling ==');
const eulerRealPart = '\\operatorname{\\mathrm{Re}}\\left(e^{it}\\right)=\\cos\\left(t\\right)';
check('Euler real-part identity is false for an unrestricted complex variable',
  [eulerRealPart], isCounterexample('i'));
check('a real universal domain excludes complex samples',
  [`\\forall t\\in\\mathbb{R},${eulerRealPart}`], isProved);
check('a real-domain implication excludes complex samples',
  [`t\\in\\mathbb{R}\\implies${eulerRealPart}`], isProved);
check('a finite-domain universal equality chain is proved link by link', [
  '\\forall x\\in\\{-2,-1,0,1,2\\},x=x+0=0+x',
], isProved);
check('a finite-domain premise scopes every equality-chain conclusion', [
  'x\\in\\{-2,-1,0,1,2\\}\\implies x=x+0=0+x',
], isProved);
check('a real quantifier scopes a complete implication chain', [
  '\\forall x\\in\\mathbb{R},x>3\\implies x>2\\implies x>1',
], isProved);
check('nested real quantifiers scope a complete equivalence chain', [
  '\\forall x\\in\\mathbb{R},\\forall y\\in\\mathbb{R},'
    + 'x+y=y+x\\iff 2(x+y)=2(y+x)\\iff 3(x+y)=3(y+x)',
], isProved);
const eulerDerivation = [
  '\\forall t\\in\\mathbb{R},\\operatorname{Re}(e^{it})='
    + '\\frac{e^{it}+\\overline{e^{it}}}{2}',
  '\\forall t\\in\\mathbb{R},\\frac{e^{it}+\\overline{e^{it}}}{2}='
    + '\\frac{e^{it}+e^{\\overline{it}}}{2}',
  '\\forall t\\in\\mathbb{R},\\frac{e^{it}+e^{\\overline{it}}}{2}='
    + '\\frac{e^{it}+e^{-it}}{2}',
  '\\forall t\\in\\mathbb{R},\\frac{e^{it}+e^{-it}}{2}=\\cos(t)',
];
eulerDerivation.forEach((line, index) => {
  check(`Euler derivation step ${index + 1} is exactly checked`, [line], isProved);
});
const eulerDerivationChain = '\\forall t\\in\\mathbb{R},\\operatorname{Re}(e^{it})='
  + '\\frac{e^{it}+\\overline{e^{it}}}{2}='
  + '\\frac{e^{it}+e^{\\overline{it}}}{2}='
  + '\\frac{e^{it}+e^{-it}}{2}=\\cos(t)';
const eulerChainCheckpoints = getTopLevelChainCheckpoints(eulerDerivationChain)?.checkpoints;
if (eulerChainCheckpoints?.length === 4 && eulerChainCheckpoints.every((checkpoint) => (
  isProved(new Sheet().evaluateLine(checkpoint, { allowDefinitions: false })) === null
))) passed++;
else {
  failed++;
  failures.push(`domain-scoped Euler chain was not proved at every checkpoint: ${
    JSON.stringify(eulerChainCheckpoints)
  }`);
}
check('the real assumption is necessary for conjugating it', [
  '\\overline{e^{it}}=e^{-it}',
], isFalse);

console.log('== equivalence of algebraic equations ==');
check('scaled equation', ['x^2-1=0\\iff 2x^2-2=0'], isTrue);
check('factored form', ['x^2-1=0\\iff (x-1)(x+1)=0'], isTrue);
check('rearranged', ['x+1=2\\iff x=1'], isTrue);
check('not equivalent', ['x^2=1\\iff x=1'], isFalse);
check('equiv symbol', ['x+1=2\\equiv x=1'], isTrue);
check('equations with an extra variable are not equivalent',
  ['x+y=0\\iff x+y+z=0'], isFalse);
check('extra-variable equation with a nonzero level is not equivalent',
  ['x+y=1\\iff x+y+z=1'], isFalse);

console.log('== equivalence of inequalities ==');
check('scaled inequality', ['x>2\\iff 2x>4'], isTrue);
check('flipped by negative', ['x>2\\iff -2x<-4'], isTrue);
check('strictness matters', ['x>2\\iff x\\ge 2'], isFalse);
check('shifted inequality', ['x-3>0\\iff x>3'], isTrue);
check('not equivalent ineq', ['x>2\\iff x>1'], isFalse);

console.log('== implications ==');
check('implication true', ['x>2\\implies x>1'], isTrue);
check('implication false', ['x>1\\implies x>2'], isFalse);
check('equation implication', ['x=2\\implies x^2=4'], isTrue);
check('equation implication false', ['x^2=4\\implies x=2'], isFalse);
check('reverse implication', ['x>1\\impliedby x>2'], isTrue);
check('reverse implication false', ['x>2\\impliedby x>1'], isFalse);
check('mixed relation implication', ['x\\ge 3\\implies x>2'], isTrue);

console.log('== logical and, or, and not ==');
check('numeric and true', ['2<3\\land 4=4'], isTrue);
check('numeric and false', ['2<3\\land 4=5'], isFalse);
check('numeric or true', ['2>3\\lor 4=4'], isTrue);
check('numeric or false', ['2>3\\lor 4=5'], isFalse);
check('numeric not', ['\\neg(2=3)'], isTrue);
check('and binds tighter than or', ['1=1\\lor 1=2\\land 1=2'], isTrue);
check('complementary disjunction proved', ['x\\ge 0\\lor x\\le 0'], isProved);
check('nonzero as disjunction', ['x>0\\lor x<0\\iff x\\ne 0'], isProved);
check('conjunction defines implication domain', ['x>0\\land x<2\\implies x^2<4'], isProved);
check('compound consequent', ['x>0\\implies x\\ne 0\\land x^2>0'], isProved);
check('not equivalent to complementary relation', ['\\neg(x=0)\\iff x\\ne 0'], isProved);
check('de Morgan with nested connective', ['\\neg(x>0\\lor x<-1)\\iff x\\le 0\\land x\\ge-1'], isProved);
check('nested implication stays inside not', ['\\neg(x>0\\implies x>1)\\iff x>0\\land x\\le1'], isProved);
check('false compound implication has witness', ['x>0\\land x<2\\implies x<1'], isFalse);

console.log('== implications proved, not sampled ==');
check('shifted bound', ['x>2\\implies x>1'], isProved);
check('scaled and shifted bound', ['2x>4\\implies x>1'], isProved);
check('strict implies non-strict', ['x>2\\implies x\\ge 2'], isProved);
check('non-strict implies strict past the gap', ['x\\ge 3\\implies x>2'], isProved);
check('negative scaling flips', ['x>2\\implies -3x<-6'], isProved);
check('offset with fractions', ['x>\\frac{1}{2}\\implies 4x>1'], isProved);
check('two variables', ['x+y>3\\implies 2x+2y>5'], isProved);
check('equation to its multiple', ['x=2\\implies x^2=4'], isProved);
check('equation to a rearrangement', ['x=2\\implies 3x-6=0'], isProved);
check('equation implies inequality', ['x=2\\implies x>1'], isProved);
check('implies not-equal', ['x>2\\implies x\\ne 0'], isProved);
check('equivalences still proved', ['x>2\\iff 2x>4'], isProved);
check('rearranged equivalence proved', ['x+1=2\\iff x=1'], isProved);
check('chain of implications proved', ['x>3\\implies x>2\\implies x>1'], isProved);
check('chain of equivalences proved', ['x>2\\iff 2x>4\\iff 3x>6'], isProved);

console.log('== ... and unsound proofs are not claimed ==');
check('weaker does not imply stronger', ['x>1\\implies x>2'], isFalse);
check('non-strict does not imply strict', ['x\\ge 2\\implies x>2'], isFalse);
check('square root direction', ['x^2=4\\implies x=2'], isFalse);
check('wrong offset sign', ['x>2\\implies x>3'], isFalse);
check('scaling by a negative keeps direction false', ['x>2\\implies -x>-1'], isFalse);
console.log('== nonlinear implications, proved by sign on a domain ==');
check('square past a bound', ['x>2\\implies x^2>3'], isProved);
check('square exactly at the bound', ['x>2\\implies x^2>4'], isProved);
check('cube dominates square', ['x>1\\implies x^3>x^2'], isProved);
check('closed domain', ['x\\ge 2\\implies x^2\\ge 4'], isProved);
check('negative direction', ['x<-2\\implies x^2>4'], isProved);
check('shifted quartic', ['x>1\\implies x^4-1>0'], isProved);
check('rational boundary', ['x>\\frac{1}{2}\\implies 4x^2>1'], isProved);
check('irrational boundary', ['x>\\sqrt{2}\\implies x^2>2'], isProved);
check('point domain, non-polynomial consequent', ['x=4\\implies \\sqrt{x}=2'], isProved);
check('point domain, cubic', ['x=2\\implies x^3-8=0'], isProved);
check('not-equal antecedent', ['x\\ne 0\\implies x^2>0'], isProved);
check('degree five', ['x>1\\implies x^5>x'], isProved);

console.log('== exact sign charts for rational polynomials ==');
check('multi-root equation implies a bound', ['x^2=4\\implies x^2\\ge 4'], isProved);
check('multi-root equation implies nonzero', ['x^2=4\\implies x\\ne 0'], isProved);
check('polynomial equation maps every root', ['x^2=1\\implies x^4=1'], isProved);
check('equations with the same real roots', ['x^2=1\\iff x^4=1'], isProved);
check('bounded open interval', ['x^2<4\\implies x<3'], isProved);
check('bounded closed interval', ['x^2\\le 4\\implies x^2\\le 9'], isProved);
check('two unbounded components', ['x^2>4\\implies x^4>16'], isProved);
check('nonlinear strict equivalence', ['x^2>1\\iff x^4>1'], isProved);
check('nonlinear closed equivalence', ['x^2\\le 1\\iff x^4\\le 1'], isProved);
check('equation equivalent to nonpositive square', ['x=1\\iff (x-1)^2\\le 0'], isProved);
check('repeated root equivalence', ['(x-1)^2=0\\iff x=1'], isProved);
check('three-root equation implies interval', ['x^3-x=0\\implies x^2\\le 1'], isProved);
check('nonzero polynomial has positive square', ['x^3-x\\ne 0\\implies (x^3-x)^2>0'], isProved);
check('different equation root sets remain false', ['x^2=4\\iff x=2'], isFalse);

// The exact sign chart decides both directions. Where it says false, that must
// reach the user: these all fail at a single point no sample ever visits, so
// without the exact verdict the sampling pass reports them true.
console.log('== exactly disproved, where sampling would say true ==');
check('fails only at an off-pool rational', ['4x^2+2x-2>0\\implies -3x+2\\ne 0'], isFalse);
check('... with that rational as the witness', ['4x^2+2x-2>0\\implies -3x+2\\ne 0'],
  isCounterexample('\\frac{2}{3}'));
check('fails only at an integer', ['x>1\\implies x-2\\ne 0'], isCounterexample('2'));
check('equation antecedent, negative witness', ['x^2=4\\implies x=2'], isCounterexample('-2'));
check('fails only at an irrational root', ['-4x-4<0\\implies -4x^3+3x+2\\ne 0'], isFalse);
check('... and claims no witness it cannot write exactly',
  ['-4x-4<0\\implies -4x^3+3x+2\\ne 0'], isDisproved);
check('a genuinely true \\ne consequent is still proved',
  ['x>1\\implies x\\ne 0'], isProved);
check('narrow denominators are found', ['x>0\\implies 97x-13\\ne 0'],
  isCounterexample('\\frac{13}{97}'));

console.log('== identities proved rather than sampled ==');
check('square is non-negative', ['x^2\\ge 0'], isProved);
check('positive definite', ['x^2+1>0'], isProved);
check('two variables non-negative', ['x^2+y^2\\ge 0'], isProved);
check('two variables positive', ['x^2+y^2+1>0'], isProved);
check('discriminant negative', ['x^2+x+1>0'], isProved);
check('rootless quartic with mixed powers', ['x^4+x+1>0'], isProved);
check('perfect square', ['x^2-2x+1\\ge 0'], isProved);
check('polynomial identity', ['(x+1)^2=x^2+2x+1'], isProved);
check('difference of squares', ['(x-3)(x+3)=x^2-9'], isProved);

console.log('== the boundary is still respected ==');
check('strict fails at the tangent', ['x^2>0'], isFalse);
check('quadratic with real roots', ['x^2-1>0'], isFalse);
check('not an identity', ['(x+1)^2=x^2+1'], isFalse);
check('transcendental falls back', ['\\sin(x)^2+\\cos(x)^2=1'], isTrue);
// x just above 2 gives x^2 just above 4, so 5 is genuinely not implied.
check('square does not reach a higher bound', ['x>2\\implies x^2>5'], isFalse);
check('wrong direction', ['x^2>4\\implies x>2'], isFalse);

console.log('== chains of relations and connectives ==');
check('equality chain proved', ['x=x+0=x+0'], isProved);
check('nonlinear equality chain proved link-by-link', ['(x+1)^2=x^2+2x+1=x^2+1+2x'], isProved);
check('equality chain broken', ['x=x+0=2x'], isFalse);
check('inequality chain proved', ['x<x+1\\le x+2'], isProved);
check('inequality chain broken', ['x<x+1<x'], isFalse);
check('equivalence chain, all equivalent', ['x>2\\iff 2x>4\\iff 3x>6'], isTrue);
check('equivalence chain, one differs', ['x>2\\iff 2x>4\\iff x>1'], isFalse);
check('equation equivalence chain', ['x+1=2\\iff x=1\\iff 2x=2'], isTrue);
check('implication chain', ['x>3\\implies x>2\\implies x>1'], isTrue);
check('implication chain broken', ['x>3\\implies x>1\\implies x>2'], isFalse);
// Mixed connectives follow standard precedence rather than chaining: `<=>` is
// loosest, so this reads A <=> (B => C), which is false at x = -6 where A is
// false but the implication is vacuously true.
check('mixed chain uses standard precedence', ['x>2\\iff 2x>4\\implies x>1'], isFalse);

console.log('== definitions feeding statements ==');
check('constants make equation numeric', ['a=3', 'b=4', 'a^2+b^2=25'], isTrue);
check('constants make it false', ['a=3', 'b=4', 'a^2+b^2=26'], isFalse);
check('function in an equation', ['f(x)=x^2', 'f(3)=9'], isTrue);

console.log('== proposition-valued definitions ==');
check('predicate call is true', ['P(x):=x>0', 'P(3)'], isProved);
check('predicate call is false', ['P(x):=x>0', 'P(-1)'], isFalse);
check('predicate composes logically', ['P(x):=x>0', 'P(3)\\land\\neg P(-1)'], isProved);
check('compound predicate', ['B(x):=x>0\\land x<2', 'B(1)'], isProved);
check('compound predicate false', ['B(x):=x>0\\land x<2', 'B(3)'], isFalse);
check('implication-valued predicate',
  ['N(x):=x\\ne0\\implies x^2>0', 'N(2)'], isProved);
check('equivalence-valued predicate',
  ['Z(x):=x=0\\iff x^2=0', 'Z(3)'], isProved);
check('true propositional constant', ['T:=2<3', 'T'], isProved);
check('false propositional constant', ['F:=2>3', 'F'], isFalse);
check('propositional constant composes', ['T:=2<3', 'T\\land 4=4'], isProved);
check('compound propositional constant',
  ['T:=2<3\\implies 4=4', 'T'], isProved);
check('function in an inequality', ['f(x)=x^2', 'f(3)>8'], isTrue);
check('defined names in implication', ['k=2', 'x>k\\implies x>1'], isTrue);

console.log('== calculus notation is refused, never disproved ==');
/**
 * `\frac{d}{dx}` parses as the ordinary fraction `d / (d·x)`, which used to
 * leave `d` as a free variable and let the sampling pass disprove the power
 * rule with a witness naming a variable nobody typed. Being wrong about
 * whether we can answer is survivable; being confidently wrong about the
 * answer is not — so the only thing these assert is "not a verdict".
 */
const isRefused = (r) => {
  if (r.kind === 'truth') return `refused notation produced a ${r.value} verdict`;
  return r.kind === 'error' ? null : `expected a refusal, got ${r.kind}`;
};

for (const [label, line] of [
  ['power rule, Leibniz', '\\frac{d}{dx}x^2=2x'],
  ['bare derivative', '\\frac{d}{dx}x^2'],
  ['second derivative', '\\frac{d^2}{dx^2}x^3=6x'],
  ['second derivative, braced', '\\frac{d^{2}}{dx^{2}}x^3=6x'],
  ['Leibniz quotient', '\\frac{dy}{dx}=2x'],
  ['upright d', '\\frac{\\mathrm{d}}{\\mathrm{d}x}x^2=2x'],
  ['partial derivative', '\\frac{\\partial}{\\partial x}(xy)=y'],
  ['definite integral', '\\int_{0}^{1}x^2dx=\\frac{1}{3}'],
  ['indefinite integral', '\\int x^2dx=\\frac{x^3}{3}'],
  ['double integral', '\\iint_{D}x\\,dx\\,dy=1'],
  ['contour integral', '\\oint_{C}z\\,dz=0'],
]) check(label, [line], isRefused);

// The guard must not reach past calculus notation into ordinary division, and
// `d` remains an ordinary name — the demo sheet defines `d(\epsilon)`.
check('d stays a function name', ['d(\\epsilon):=\\epsilon/2', 'd(4)=2'], isProved);
check('epsilon-delta witness survives',
  ['g(x):=2x+1', 'd(\\epsilon):=\\epsilon/2',
    '\\operatorname{cont}(g,a,\\epsilon,d(\\epsilon))'], isProved);
check('d stays a constant name', ['d:=4', '\\frac{1}{d}=\\frac{1}{4}'], isProved);
check('ordinary fraction over d', ['d:=4', '\\frac{d}{2}=2'], isProved);

// Prime notation really does differentiate, which is what the refusal message
// points at. It must keep working, and must still be able to say "false".
check('prime notation proves', ['f(x):=x^3', "f'(x)=3x^2"], isProved);
check('prime notation disproves', ['f(x):=x^3', "f'(x)=2x^2"], isFalse);
check('second prime notation', ['f(x):=x^3', "f''(x)=6x"], isProved);

console.log('== errors and edge cases ==');
check('empty line', [''], (r) => r.kind === 'empty' ? null : 'expected empty');
check('division by zero', ['\\frac{1}{0}'], (r) => (r.kind === 'value' || r.kind === 'error') ? null : 'expected value or error');
check('unbalanced is not fatal', ['2+'], (r) => r.kind !== undefined ? null : 'expected some result');

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log('  - ' + f);
  process.exitCode = 1;
}
