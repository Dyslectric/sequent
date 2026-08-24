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
  ALGEBRA_LAYOUT,
  ANALYSIS_LAYOUT,
  DEFN_LAYOUT,
  EXPR_LAYOUT,
  INLINE_SHORTCUTS,
  KEYBOARD_LAYOUTS,
  LINEAR_ALGEBRA_LAYOUT,
  REL_LAYOUT,
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
checkChainLayout(
  'a single inequality conclusion does not chain through its assumptions',
  '\\epsilon>0\\vdash d(\\epsilon)>0',
  null,
);
checkChainLayout(
  'a chained conclusion keeps its proof assumptions in scope',
  'x>0\\vdash x+2>x+1>x',
  '\\begin{align}x>0\\vdash x+2 & > x+1\\\\  & > x\\end{align}',
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

const sequentCheckpoints = getTopLevelChainCheckpoints('x>0\\vdash x+2>x+1>x')?.checkpoints;
if (JSON.stringify(sequentCheckpoints) === JSON.stringify([
  'x>0\\vdash x+2>x+1',
  'x>0\\vdash x+2>x+1>x',
])) passed++;
else failures.push(`sequent conclusion checkpoints: got ${JSON.stringify(sequentCheckpoints)}`);

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
const rndKey = EXPR_LAYOUT.rows.flat().find((entry) => entry.label === 'rnd');
if (rndKey?.insert === '\\operatorname{rnd}(#?)' && INLINE_SHORTCUTS.rnd) passed++;
else failures.push('expression keyboard and inline shortcut should expose rnd');
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
  keyboardKeyStart(EXPR_LAYOUT.rows[row], latex)
));
if (numberStarts.every((start) => start === numberStarts[0])) passed++;
else failures.push(`expression number columns should align: ${numberStarts.join(', ')}`);
const numericRowWidths = EXPR_LAYOUT.rows.slice(0, 4)
  .map((row) => row.reduce((sum, entry) => sum + keyboardUnitWidth(entry), 0));
if (numericRowWidths.every((width) => width === numericRowWidths[0])) passed++;
else failures.push(`expression number rows should have equal widths: ${numericRowWidths.join(', ')}`);
const returnKey = EXPR_LAYOUT.rows.at(-1).find((entry) => entry.label === '[return]');
if (returnKey?.tooltip === 'new line') passed++;
else failures.push('expression keyboard should expose a bottom-row Return key');
const backspaceKey = EXPR_LAYOUT.rows.at(-1).find((entry) => entry.label === '[backspace]');
if (backspaceKey?.class?.split(/\s+/).includes('calc-backspace')) passed++;
else failures.push('expression Backspace should use the button-sized icon treatment');
const boxedTemplateKeys = EXPR_LAYOUT.rows.flat().filter((entry) => (
  [
    '\\lfloor#?\\rfloor', '\\lceil#?\\rceil', '\\frac{#?}{#?}',
    '#?^{#?}', '#?^2', '\\sqrt{#?}', '\\sqrt[#?]{#?}',
  ].includes(entry.latex) || entry.label === '|x|'
));
if (boxedTemplateKeys.length === 8
  && boxedTemplateKeys.every((entry) => entry.class?.split(/\s+/).includes('small'))) passed++;
else failures.push('boxed expression templates should use the smaller keycap scale');
const functionKeyLabels = EXPR_LAYOUT.rows[1]
  .filter((entry) => entry.label)
  .map((entry) => entry.label);
if (JSON.stringify(functionKeyLabels) === JSON.stringify(['sin', 'cos', 'tan', 'ln', 'log', '|x|'])) passed++;
else failures.push(`expression function row is incomplete: ${functionKeyLabels.join(', ')}`);

// The two leading tabs split calculating from claiming. Definitions and serif
// names have their own dedicated tab.
const exprKeys = EXPR_LAYOUT.rows.flat().map((entry) => entry.latex ?? entry.label);
const relKeys = REL_LAYOUT.rows.flat().map((entry) => entry.latex ?? entry.label);
if (['=', '\\ne', '<', '>', '\\le', '\\ge', '\\neg', '\\land', '\\lor',
  '\\implies', '\\impliedby', '\\iff']
  .every((expected) => relKeys.includes(expected))) passed++;
else failures.push('relation tab is missing a relation or connective');
if (['0', '7', 'i', '\\pi', 'e', '(', ')', '\\sqrt{#?}']
  .every((expected) => exprKeys.includes(expected))) passed++;
else failures.push('expression tab is missing a value key');
if (![EXPR_LAYOUT, REL_LAYOUT].some((layout) => (
  layout.rows.flat().some((entry) => entry.latex === '\\coloneq')
))) passed++;
else failures.push('define should live only on the definition tab');
if (!exprKeys.includes(',') && ![EXPR_LAYOUT, REL_LAYOUT].some((layout) => (
  layout.rows.flat().some((entry) => entry.command?.[0] === 'switchMode')
))) passed++;
else failures.push('expression and relation tabs should carry no serif toggle');
for (const layout of [EXPR_LAYOUT, REL_LAYOUT, SET_LAYOUT, LINEAR_ALGEBRA_LAYOUT]) {
  const bottom = layout.rows.at(-1);
  if (['(', ')'].every((latex) => bottom.some((entry) => entry.latex === latex))
    && layout.rows.slice(0, -1).flat().every((entry) => !['(', ')'].includes(entry.latex))) {
    passed++;
  } else {
    failures.push(`${layout.label} should keep both parentheses exclusively on its bottom row`);
  }
}

// Naming is its own tab, laid out like a QWERTY keyboard across four layers:
// case and alphabet are separate axes, each with its own shift.
const defnLayer = (id) => DEFN_LAYOUT.layers.find((layer) => layer.id === id);
const layerKeys = (id) => defnLayer(id).rows.flat()
  .map((entry) => entry.latex ?? entry.key ?? entry.label);

if (DEFN_LAYOUT.layers.length === 4
  && ['defn-lower', 'defn-upper', 'defn-greek', 'defn-greek-upper']
    .every((id) => defnLayer(id))) passed++;
else failures.push('definition tab should have a layer per case-and-alphabet pair');

// QWERTY order, not alphabetical — the point of the change.
const homeRow = defnLayer('defn-lower').rows[2]
  .filter((entry) => entry.latex).map((entry) => entry.latex).join('');
if (homeRow === 'asdfghjkl') passed++;
else failures.push(`definition home row should be QWERTY: ${homeRow}`);
const greekHomeRow = defnLayer('defn-greek').rows[2]
  .filter((entry) => entry.latex).map((entry) => entry.latex).join(' ');
if (greekHomeRow.startsWith('\\alpha \\sigma \\delta')) passed++;
else failures.push(`greek layer should follow the same positions: ${greekHomeRow}`);

if ('abcdefghijklmnopqrstuvwxyz'.split('')
  .every((letter) => layerKeys('defn-lower').includes(letter))) passed++;
else failures.push('definition tab is missing a latin letter');
if ('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  .every((letter) => layerKeys('defn-upper').includes(letter))) passed++;
else failures.push('definition tab is missing an uppercase letter');
if (['\\alpha', '\\beta', '\\gamma', '\\pi', '\\sigma', '\\omega', '\\theta', '\\lambda']
  .every((letter) => layerKeys('defn-greek').includes(letter))) passed++;
else failures.push('definition tab is missing a greek letter');
// Exactly the eleven that have a capital of their own; the rest stay blank
// rather than becoming a Latin capital, which would be a different name.
const greekCapitals = defnLayer('defn-greek-upper').rows.slice(1, 4).flat()
  .map((entry) => entry.latex).filter(Boolean);
if (greekCapitals.length === 11 && greekCapitals.includes('\\Gamma')
  && greekCapitals.includes('\\Omega') && !greekCapitals.includes('\\Alpha')) passed++;
else failures.push(`greek capitals should be the eleven real ones: ${greekCapitals.join(' ')}`);

// The six `var` letters are distinct names to this app, so each has to be
// typeable. They sit on a long press because all twenty-six QWERTY positions
// on the Greek layer are already spoken for.
const greekVariants = defnLayer('defn-greek').rows.slice(1, 4).flat()
  .flatMap((entry) => entry.variants ?? []);
const greekDirect = defnLayer('defn-greek').rows.slice(1, 4).flat()
  .map((entry) => entry.latex).filter(Boolean);
if (['\\varepsilon', '\\vartheta', '\\varpi', '\\varrho', '\\varsigma', '\\varphi']
  .every((form) => greekVariants.includes(form) || greekDirect.includes(form))) passed++;
else failures.push(`greek var forms should be reachable: ${greekVariants.join(' ')}`);
// A variant has to hang off the letter it is a form of, not an unrelated key.
const variantsOf = (latex) => defnLayer('defn-greek').rows.flat()
  .find((entry) => entry.latex === latex)?.variants ?? [];
if (variantsOf('\\epsilon').includes('\\varepsilon')
  && variantsOf('\\phi').includes('\\varphi')
  && variantsOf('\\pi').includes('\\varpi')
  && variantsOf('\\rho').includes('\\varrho')) passed++;
else failures.push('each greek var form should be a variant of its base letter');

// Every layer keeps the same non-letter keys, so switching moves nothing.
const commonKeys = ['0', '9', '\\coloneq', '#?_{#?}', '-', '_'];
if (['defn-lower', 'defn-upper', 'defn-greek', 'defn-greek-upper'].every((id) => (
  commonKeys.every((expected) => layerKeys(id).includes(expected))
))) passed++;
else failures.push('every definition layer should carry the digits and name operators');
// Subscript belongs to naming, not to arithmetic.
if (!exprKeys.includes('#?_{#?}')) passed++;
else failures.push('subscript should have moved off the expression tab');
// Each shift toggles one axis and leaves the other alone.
// Via `command`, not the `layer` keycap property — that property is in
// MathLive's types but nothing reads it, so a key using it silently typed its
// own label into the field instead of switching layer.
const shiftTarget = (id, label) => {
  const keycap = defnLayer(id).rows.flat().find((entry) => entry.label === label);
  return Array.isArray(keycap?.command) && keycap.command[0] === 'switchKeyboardLayer'
    ? keycap.command[1]
    : null;
};
if (shiftTarget('defn-lower', '⇧') === 'defn-upper'
  && shiftTarget('defn-upper', '⇧') === 'defn-lower'
  && shiftTarget('defn-greek', '⇧') === 'defn-greek-upper'
  && shiftTarget('defn-lower', 'α') === 'defn-greek'
  && shiftTarget('defn-greek', 'α') === 'defn-lower'
  && shiftTarget('defn-upper', 'α') === 'defn-greek-upper') passed++;
else failures.push('the two shifts should toggle case and alphabet independently');
// A hyphen or underscore in a name only works in the serif channel, so the
// toggle has to be within reach of the keys that need it.
if (DEFN_LAYOUT.layers.every((layer) => layer.rows.flat().some((entry) => (
  Array.isArray(entry.command) && entry.command[0] === 'switchMode'
)))) passed++;
else failures.push('every definition layer should expose the serif toggle');
if (relKeys.filter((entry) => entry === '=').length === 1) passed++;
else failures.push('relation tab should carry exactly one equals key');

if (KEYBOARD_LAYOUTS[0] === EXPR_LAYOUT
  && KEYBOARD_LAYOUTS[1] === REL_LAYOUT
  && KEYBOARD_LAYOUTS[2] === SET_LAYOUT
  && KEYBOARD_LAYOUTS[3] === ANALYSIS_LAYOUT
  && KEYBOARD_LAYOUTS[4] === TOPOLOGY_LAYOUT
  && KEYBOARD_LAYOUTS[5] === ALGEBRA_LAYOUT
  && KEYBOARD_LAYOUTS[6] === LINEAR_ALGEBRA_LAYOUT
  && KEYBOARD_LAYOUTS[7] === DEFN_LAYOUT
  && KEYBOARD_LAYOUTS.length === 8) passed++;
else failures.push('keyboard tabs should end with defn and omit the stock tabs');
const rowCount = (layout) => layout.rows?.length
  ?? (layout.layers.every((layer) => layer.rows.length === 5) ? 5 : null);
if (KEYBOARD_LAYOUTS.every((layout) => rowCount(layout) === 5)) passed++;
else failures.push(`every keyboard tab should have five rows: ${KEYBOARD_LAYOUTS
  .map((layout) => `${layout.label}=${rowCount(layout)}`).join(', ')}`);
if (ALGEBRA_LAYOUT.label === 'alg' && ALGEBRA_LAYOUT.tooltip === 'Algebra') passed++;
else failures.push('the algebra keyboard tab should be labelled alg');
const genericEditingLabels = new Set(['[left]', '[right]', '[backspace]', '[return]']);
if ([ANALYSIS_LAYOUT, TOPOLOGY_LAYOUT, ALGEBRA_LAYOUT].every((layout) => (
  [...genericEditingLabels].every((label) => (
    layout.rows.at(-1).some((entry) => entry.label === label)
  ))
))) passed++;
else failures.push('analysis, topology, and algebra bottom rows should retain the generic editing keys');
const topicBottomKeys = [
  [ANALYSIS_LAYOUT, new Set(['\\mathcal{O}_{\\mathbb{R}}', '\\mathcal{C}_{\\mathbb{R}}'])],
  [TOPOLOGY_LAYOUT, new Set(['\\bigcup_{i\\in I}', '\\bigcap_{i\\in I}'])],
  [ALGEBRA_LAYOUT, new Set(['mod'])],
];
if (topicBottomKeys.every(([layout, forbidden]) => layout.rows.at(-1).every((entry) => (
  !forbidden.has(entry.latex) && !forbidden.has(entry.label)
)))) passed++;
else failures.push('analysis, topology, and algebra topic keys should stay out of the bottom row');
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
const standardSetKeys = SET_LAYOUT.rows[3].filter((entry) => entry.latex !== ',');
// `\mathbb{P}` is on this row for a different reason from the other five:
// Compute Engine has no primes, so the row is the only way to type the one
// domain this application decides for itself.
if (['\\mathbb{N}', '\\mathbb{Z}', '\\mathbb{Q}', '\\mathbb{R}', '\\mathbb{C}', '\\mathbb{P}']
  .every((latex) => standardSetKeys.some((entry) => entry.latex === latex))
  && standardSetKeys.length === 6
  && standardSetKeys.every((entry) => !entry.class?.split(/\s+/).includes('small'))) passed++;
else failures.push('standard number-set keys should use the full keycap scale');
const analysisKeys = ANALYSIS_LAYOUT.rows.flat();
if (!['\\epsilon', '\\delta'].some((latex) => analysisKeys.some((entry) => entry.latex === latex))
  && ['ball', 'cball', 'cont', 'limit', '∂ at']
    .every((label) => analysisKeys.some((entry) => entry.label === label))) passed++;
else failures.push('analysis keyboard should expose analysis tools without standalone epsilon/delta keys');
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
check('a predicate definition is identified as proposition-valued', ['L(x):=x^2\\ge0'],
  (result) => result.kind === 'definition' && result.what === 'function'
    && result.proposition === true ? null : 'expected a proposition-valued definition');
check('a named lemma is expanded inside a sequent and proved exactly', [
  'L(x):=x>1',
  'L(x)\\vdash x>0',
], isProved);
check('nested named lemmas expand transitively', [
  'L(x):=x>1',
  'M(x):=L(x)\\land x<4',
  'M(x)\\vdash x>0',
], isProved);
check('a proposition constant is reusable as an exact premise', [
  'T:=x^2\\ge0',
  'T\\vdash x^2+1>0',
], isProved);
check('defining a false lemma does not certify it', [
  'L(x):=x^2<0',
  'L(x)',
], isFalse);
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

console.log('== domain-restricted quantification ==');
/**
 * `∀n ∈ ℕ` used to be inert: every ℕ- and ℤ-restricted line came back
 * undecided, true and false alike, because the quantifier lowering waited for
 * a finite set to materialise and ℕ never does. The domain now travels to the
 * sampler instead, which matters most for the statements that are true over ℕ
 * and false over ℝ — every inductive step is one of those.
 */
const isNotFalse = (r) => (
  r.kind === 'truth' && r.value === false
    ? `disproved a statement that holds on its declared domain` : null
);
/** A witness for a claim about ℕ has to be a natural number to mean anything. */
const isFalseWithIntegerWitness = (r) => {
  if (r.kind !== 'truth' || r.value !== false) return 'expected false';
  if (r.method !== 'counterexample') return `expected a witness, got ${r.method}`;
  const bad = r.counterexample.filter((c) => !/^-?\d+$/.test(c.valueLatex));
  return bad.length
    ? `witness outside ℕ: ${bad.map((c) => `${c.nameLatex}=${c.valueLatex}`).join(', ')}`
    : null;
};

check('N: n^2 >= n holds', ['\\forall n\\in\\mathbb{N},n^2\\ge n'], isTrue);
check('Z: n^2 >= n holds', ['\\forall n\\in\\mathbb{Z},n^2\\ge n'], isTrue);
check('N: 2^n >= n+1 step', ['\\forall n\\in\\mathbb{N},2^n\\ge n+1\\implies2^{n+1}\\ge n+2'],
  isTrue);
check('N: Bernoulli step',
  ['\\forall n\\in\\mathbb{N},x\\ge-1\\land(1+x)^n\\ge1+nx'
    + '\\implies(1+x)^{n+1}\\ge1+(n+1)x'], isTrue);
check('N: divisibility step', ['\\forall n\\in\\mathbb{N},\\operatorname{mod}(n^3-n,3)=0'],
  isTrue);
check('N: summation telescopes',
  ['\\forall n\\in\\mathbb{N},\\sum_{k=1}^{n+1}k-\\sum_{k=1}^{n}k=n+1'], isTrue);

// A narrowed domain must not become a licence to call anything true: a false
// claim stays false, and its witness has to lie inside the declared domain.
check('N: false claim stays false', ['\\forall n\\in\\mathbb{N},n^2>n'],
  isFalseWithIntegerWitness);
check('N: absurd claim stays false', ['\\forall n\\in\\mathbb{N},2^n<n'],
  isFalseWithIntegerWitness);

// ℝ is untouched: the sign chart still disproves at the fractional point.
check('R: n^2 >= n still false', ['\\forall n\\in\\mathbb{R},n^2\\ge n'], isFalse);
check('R: x^2 >= 0 still proved', ['\\forall x\\in\\mathbb{R},x^2\\ge0'], isProved);

// A summation with a symbolic bound says nothing at n = -6, so the sampler is
// no longer allowed to report what it finds there as a counterexample.
check('open summation is not disproved',
  ['\\sum_{k=1}^{n+1}k-\\sum_{k=1}^{n}k=n+1'], isNotFalse);
check('closed-form summation still proved',
  ['\\sum_{k=1}^{n}k=\\frac{n(n+1)}{2}'], isProved);

console.log('== differentiation, and the notation still refused ==');
/**
 * `\frac{d}{dx}` is an operator, but `sanitize` used to intern the `d` as a
 * user name, leaving the ordinary fraction `d / (d·x)` — which let the
 * sampling pass disprove the power rule with a witness naming a variable
 * nobody typed. The operator is now rewritten with `d` kept literal and only
 * the differentiation variable renamed.
 */
for (const [label, line] of [
  ['power rule, Leibniz', '\\frac{d}{dx}x^2=2x'],
  ['second derivative', '\\frac{d^2}{dx^2}x^3=6x'],
  ['second derivative, braced', '\\frac{d^{2}}{dx^{2}}x^3=6x'],
  ['upright d', '\\frac{\\mathrm{d}}{\\mathrm{d}x}x^2=2x'],
  ['partial derivative', '\\frac{\\partial}{\\partial x}(xy)=y'],
  ['partial derivative at a point', '\\operatorname{partial}(x,x^2y,3)=6y'],
  ['chain rule', '\\frac{d}{dx}\\sin(x^2)=2x\\cos(x^2)'],
  ['product rule', '\\frac{d}{dx}(x\\sin(x))=\\sin(x)+x\\cos(x)'],
  ['a variable other than x', '\\frac{d}{dt}t^2=2t'],
  ['a greek variable', '\\frac{d}{d\\theta}\\sin(\\theta)=\\cos(\\theta)'],
  ['differentiating a definition', 'f(x):=x^3'],
]) check(label, line.includes(':=') ? [line, '\\frac{d}{dx}f(x)=3x^2'] : [line], isProved);

check('a bare derivative is carried out', ['\\frac{d}{dx}x^2'], isSymbolic);

// What the analysis-tab keys insert, with their placeholders filled in as a
// reader would fill them. A key that produces notation the engine refuses is
// worse than no key.
for (const entry of ANALYSIS_LAYOUT.rows.flat()
  .filter((key) => /^(?:second |partial )?derivative(?: at a point)?$/.test(key.tooltip ?? ''))) {
  const template = entry.insert ?? entry.latex;
  let variable = 0;
  const values = entry.tooltip === 'partial derivative at a point'
    ? ['x', 'x^2y', '3']
    : ['x', 'x^2'];
  const line = template.replace(/#\?/g, () => values[variable++]);
  check(`the ${entry.tooltip} key inserts usable notation`, [line], (r) => (
    r.kind === 'error' ? `refused its own key: ${r.message}` : null
  ));
}

if (INLINE_SHORTCUTS.partial === '\\operatorname{partial}\\left(#?,#?,#?\\right)') passed++;
else failures.push('the partial shortcut should ask for a variable, expression, and point');
check('partial-at leaves other variables symbolic', [
  '\\operatorname{partial}(x,x^2y,3)',
], (r) => (
  r.kind === 'symbolic' && r.latex === '6y'
    && JSON.stringify(r.undefinedNames) === JSON.stringify(['y'])
    ? null : `expected 6y with only y free, got ${JSON.stringify(r)}`
));
check('partial-at requires a variable first', [
  '\\operatorname{partial}(x+1,x^2,3)',
], (r) => (
  r.kind === 'error' && /first partial input/.test(r.message)
    ? null : `expected a variable-input error, got ${JSON.stringify(r)}`
));
check('partial-at differentiates a defined function before substituting', [
  'f(x):=x^3',
  '\\operatorname{partial}(x,f(x),2)=12',
], isProved);
check('partial-at refuses an undefined function', [
  '\\operatorname{partial}(x,f(x),2)',
], (r) => (
  r.kind === 'error' && /define f before differentiating it/.test(r.message)
    ? null : `expected an undefined-function error, got ${JSON.stringify(r)}`
));

const limitKey = ANALYSIS_LAYOUT.rows.flat()
  .find((key) => /limit as the variable/.test(key.tooltip ?? ''));
check('the limit key inserts usable notation', [
  // variable, target, body
  (limitKey?.insert ?? limitKey?.latex ?? '')
    .replace(/#\?/g, ((values) => () => values.shift())(['x', '0', '\\frac{\\sin(x)}{x}']))
    + '=1',
], isProved);

// The bare arrow was only ever meaningful inside a limit subscript, and on its
// own said nothing — `x \to 0` has no verdict. The template carries it now.
if (!ANALYSIS_LAYOUT.rows.flat().some((key) => key.latex === '\\to')) passed++;
else failures.push('the bare arrow key is back without a limit around it');

const integralKey = ANALYSIS_LAYOUT.rows.flat()
  .find((key) => key.tooltip === 'definite integral');
check('the definite integral key inserts usable notation', [
  // lower, upper, integrand, variable — in the order the template asks.
  (integralKey?.insert ?? integralKey?.latex ?? '')
    .replace(/#\?/g, ((values) => () => values.shift())(['0', '1', 'x^2', 'x'])),
], (r) => (r.kind === 'error' ? `refused its own key: ${r.message}` : null));
check('a wrong derivative is not proved', ['\\frac{d}{dx}x^2=3x'], (r) => (
  r.kind === 'truth' && r.value === false ? null : 'expected false'
));

/**
 * Being wrong about whether we can answer is survivable; being confidently
 * wrong about the answer is not. These forms have no procedure here, and
 * Compute Engine is actively wrong about some of them — `dy/dx` evaluates to
 * 0, and `\int_{-1}^{1}dx/x^2` comes back negative — so they stay refused.
 */
const isRefused = (r) => {
  if (r.kind === 'truth') return `refused notation produced a ${r.value} verdict`;
  return r.kind === 'error' ? null : `expected a refusal, got ${r.kind}`;
};

for (const [label, line] of [
  ['Leibniz quotient', '\\frac{dy}{dx}=2x'],
  ['Leibniz quotient, zero', '\\frac{dy}{dx}=0'],
  ['mixed partial', '\\frac{\\partial^2 u}{\\partial x\\partial y}=0'],
  ['a lone partial', '\\partial f=0'],
  ['indefinite integral', '\\int x^2dx=\\frac{x^3}{3}'],
  ['double integral', '\\iint_{D}x\\,dx\\,dy=1'],
  ['contour integral', '\\oint_{C}z\\,dz=0'],
]) check(label, [line], isRefused);

console.log('== definite integrals, behind the continuity gate ==');
/**
 * Compute Engine answers an integral whether or not the answer exists, and is
 * wrong about some divergent ones — `\int_{-1}^{1}dx/x^2` comes back equal to
 * a negative number, for an integrand that is positive everywhere. So its
 * value is used only where the sheet has established the integral is proper.
 */
for (const [label, line] of [
  ['a polynomial', '\\int_{0}^{1}x^2\\,dx=\\frac{1}{3}'],
  ['a linear integrand', '\\int_{0}^{2}x\\,dx=2'],
  ['a constant', '\\int_{0}^{3}2\\,dx=6'],
  ['sine over a period', '\\int_{0}^{\\pi}\\sin(x)\\,dx=2'],
  ['an absolute value', '\\int_{-1}^{1}\\left|x\\right|\\,dx=1'],
  ['a pole outside the interval', '\\int_{1}^{2}\\frac{1}{x}\\,dx=\\ln(2)'],
  ['a denominator with no real root', '\\int_{0}^{1}\\frac{1}{x^2+1}\\,dx=\\frac{\\pi}{4}'],
  ['an exponential', '\\int_{0}^{1}e^{x}\\,dx=e-1'],
  // A bound need not be a literal — it needs to be a point on the line.
  ['sine over a full period', '\\int_{0}^{2\\pi}\\sin(x)\\,dx=0'],
  ['a fractional multiple of pi', '\\int_{0}^{\\frac{\\pi}{2}}\\cos(x)\\,dx=1'],
]) check(label, [line], isProved);

check('a wrong integral is disproved', ['\\int_{0}^{1}x^2\\,dx=\\frac{1}{4}'], (r) => (
  r.kind === 'truth' && r.value === false ? null : 'expected false'
));

// The gate exists for these. Each is either divergent or beyond what the
// sheet can check, and Compute Engine answers the first two *wrongly*.
for (const [label, line] of [
  ['1/x straddling the pole', '\\int_{-1}^{1}\\frac{1}{x}\\,dx=0'],
  ['1/x^2 straddling the pole', '\\int_{-1}^{1}\\frac{1}{x^2}\\,dx=-2'],
  ['a pole at the lower limit', '\\int_{0}^{1}\\frac{1}{x}\\,dx=1'],
  ['a pole at the upper limit', '\\int_{1}^{2}\\frac{1}{x-2}\\,dx=0'],
  ['an infinite limit', '\\int_{1}^{\\infty}\\frac{1}{x}\\,dx=1'],
  ['a convergent infinite limit', '\\int_{0}^{\\infty}e^{-x}\\,dx=1'],
  ['a logarithm', '\\int_{1}^{2}\\ln(x)\\,dx=0'],
  ['a tangent through its pole', '\\int_{0}^{2}\\tan(x)\\,dx=0'],
  ['a square root', '\\int_{0}^{1}\\sqrt{x}\\,dx=\\frac{2}{3}'],
  ['a symbolic limit', '\\int_{0}^{a}x\\,dx=0'],
  ['an undefined name as a limit', '\\int_{0}^{zz}x\\,dx=0'],
  // Irrational bounds put the pole test out of exact reach, so a rational
  // integrand between them is withheld even when it would have been fine.
  ['a pole test it cannot run exactly', '\\int_{-\\pi}^{\\pi}\\frac{1}{x}\\,dx=0'],
]) check(label, [line], isRefused);

// `f(x)` for an undefined `f` is read as `f · x`, whose derivative is `f` —
// so the line would be answered, wrongly. Say what is missing instead.
check('differentiating an undefined function', ['\\frac{d}{dx}f(x)=0'], isRefused);

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

console.log('== greek var forms are names of their own ==');
// Putting these on the keyboard is only worth doing because the identifier
// layer keeps them apart: ϵ and ε are two names, not one letter written twice.
for (const [base, alternate] of [
  ['epsilon', 'varepsilon'], ['theta', 'vartheta'],
  ['rho', 'varrho'], ['sigma', 'varsigma'], ['phi', 'varphi'],
]) {
  check(`\\${alternate} is usable as a name`,
    [`\\${alternate}:=3`, `\\${alternate}+1=4`], isProved);
  check(`\\${base} and \\${alternate} are distinct`,
    [`\\${base}:=1`, `\\${alternate}:=2`, `\\${base}\\ne\\${alternate}`], isProved);
}
// `\pi` is a reserved constant, but `\varpi` is an ordinary free name.
check('varpi is free although pi is reserved', ['\\varpi:=5', '\\varpi=5'], isProved);
check('pi keeps its built-in meaning', ['\\pi>3'], isProved);

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
