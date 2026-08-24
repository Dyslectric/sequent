/**
 * Matrices and vectors. Run with `npm test`.
 *
 * Compute Engine does the arithmetic; what is tested here is that the app
 * lets it through intact, decides the relations exactly, and refuses rather
 * than samples. Matrix statements must never be settled numerically — the
 * sampler substitutes numbers for free variables, which against a matrix
 * produces confident nonsense.
 */
import { Sheet } from '../src/lib/engine.js';
import { sanitize } from '../src/lib/identifiers.js';
import {
  INLINE_SHORTCUTS,
  fillEmptyMatrixCells,
  LINEAR_ALGEBRA_LAYOUT,
  matrixResizeAllowed,
} from '../src/lib/mathfield.js';

let passed = 0;
const failures = [];

const M = '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}';
const I = '\\begin{pmatrix}1&0\\\\0&1\\end{pmatrix}';

function check(label, lines, expect) {
  let result;
  try {
    result = new Sheet().evaluateAll(lines).at(-1);
  } catch (error) {
    failures.push(`${label}\n    threw: ${error.message}`);
    return;
  }
  const problem = expect(result);
  if (problem) {
    failures.push(`${label}\n    got: ${JSON.stringify(result).slice(0, 160)}\n    ${problem}`);
  } else {
    passed++;
  }
}

const isProved = (value) => (result) => {
  if (result.kind !== 'truth') return `expected a truth, got ${result.kind}`;
  if (result.value !== value) return `expected ${value}`;
  return result.method === 'proved' ? null : `expected a proof, got ${result.method}`;
};

const isValue = (latex) => (result) => {
  if (result.kind !== 'value') return `expected a value, got ${result.kind}`;
  return result.exactLatex === latex ? null : `expected ${latex}`;
};

console.log('== the notation survives sanitising ==');

check('a matrix is not read as a pile of variables', [M], isValue(
  '\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}'
));

// The environment name used to be interned character by character, which left
// `\begin{\mathrm{Id0}...}` and an `unknown-environment` error on every line.
if (!/Id\d/.test(sanitize(M, new Sheet().registry).latex)) passed++;
else failures.push('the environment name was interned as identifiers');

check('a matrix sum evaluates', [`${M}+${M}`], isValue(
  '\\begin{pmatrix}2 & 4 \\\\ 6 & 8\\end{pmatrix}'
));

check('a column vector sums', [
  '\\begin{pmatrix}1\\\\2\\end{pmatrix}+\\begin{pmatrix}3\\\\4\\end{pmatrix}'
], isValue('\\begin{pmatrix}4 \\\\ 6\\end{pmatrix}'));

console.log('== matrix and vector multiplication ==');

check('a matrix multiplies a column vector', [
  `${M}\\begin{pmatrix}5\\\\6\\end{pmatrix}`,
], isValue('\\begin{pmatrix}17 \\\\ 39\\end{pmatrix}'));
check('a row vector multiplies a matrix', [
  `\\begin{pmatrix}5&6\\end{pmatrix}${M}`,
], isValue('\\begin{pmatrix}23 & 34\\end{pmatrix}'));
check('the explicit multiplication sign works for matrices', [
  `${M}\\times${I}`,
], isValue('\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}'));
check('named matrix multiplication preserves operand order', [
  `A:=${M}`,
  'B:=\\begin{pmatrix}0&1\\\\1&0\\end{pmatrix}',
  'BA',
], isValue('\\begin{pmatrix}3 & 4 \\\\ 1 & 2\\end{pmatrix}'));
check('a named matrix multiplies a named vector', [
  `A:=${M}`,
  'v:=\\begin{pmatrix}5\\\\6\\end{pmatrix}',
  'Av',
], isValue('\\begin{pmatrix}17 \\\\ 39\\end{pmatrix}'));

console.log('== matrix and vector subscripts ==');

check('a literal matrix entry can be subscripted', [`${M}_{1,2}`], isValue('2'));
check('a named matrix entry can be subscripted', [
  `A:=${M}`, 'A_{2,1}',
], isValue('3'));
check('a column vector has one-index access', [
  'v:=\\begin{pmatrix}5\\\\6\\end{pmatrix}', 'v_2',
], isValue('6'));
check('a tuple vector has one-index access', ['v:=(5,6)', 'v_2'], isValue('6'));
check('a column vector also accepts row-column access', [
  'v:=\\begin{pmatrix}5\\\\6\\end{pmatrix}', 'v_{2,1}',
], isValue('6'));
check('a matrix-valued function result can be subscripted', [
  'A(t):=\\begin{pmatrix}t&1\\\\0&t\\end{pmatrix}', 'A(3)_{1,2}',
], isValue('1'));
check('a column-vector-valued function result can be subscripted', [
  'v(t):=\\begin{pmatrix}t\\\\t^2\\end{pmatrix}', 'v(3)_2',
], isValue('9'));
check('a row-vector-valued function result can be subscripted', [
  'v(t):=\\begin{pmatrix}t&t^2\\end{pmatrix}', 'v(3)_2',
], isValue('9'));
check('a tuple-valued function result can be subscripted', [
  'p(t):=(t,t^2)', 'p(3)_2',
], isValue('9'));
check('a symbolic function-result subscript simplifies to its entry', [
  'A(t):=\\begin{pmatrix}t&1\\\\0&t\\end{pmatrix}', 'A(x)_{2,2}',
], (result) => (
  result.kind === 'symbolic' && result.latex === 'x'
    ? null : `expected symbolic x, got ${result.kind} ${result.latex ?? ''}`
));
check('an out-of-range subscript is refused', [`${M}_{3,1}`], (result) => (
  result.kind === 'error' ? null : `expected an error, got ${result.kind}`
));
check('an out-of-range function-result subscript is refused', [
  'A(t):=\\begin{pmatrix}t&1\\\\0&t\\end{pmatrix}', 'A(3)_{3,1}',
], (result) => (result.kind === 'error' ? null : `expected an error, got ${result.kind}`));
check('an ordinary numeric identifier subscript remains a name', ['x_1'], (result) => (
  result.kind === 'symbolic' && result.undefinedNames?.[0] === 'x_1'
    ? null : 'x_1 was mistaken for collection access'
));

console.log('== exact matrix relations ==');

check('equal matrices are proved equal', [`${M}=${M}`], isProved(true));
check('different matrices are proved unequal', [`${M}=${I}`], isProved(false));
check('multiplying by the identity', [`${M}${I}=${M}`], isProved(true));
check('matrix multiplication does not commute', [
  `${M}\\begin{pmatrix}0&1\\\\1&0\\end{pmatrix}=\\begin{pmatrix}0&1\\\\1&0\\end{pmatrix}${M}`
], isProved(false));
check('a determinant', [`\\det${M}=-2`], isProved(true));
check('a wrong determinant', [`\\det${M}=5`], isProved(false));
check('a 3x3 determinant', [
  '\\det\\begin{pmatrix}1&2&3\\\\4&5&6\\\\7&8&10\\end{pmatrix}=-3'
], isProved(true));
check('a symbolic determinant', [
  '\\det\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}=ad-bc'
], isProved(true));
check('the determinant is multiplicative', [`\\det(${M}${M})=4`], isProved(true));
check('a matrix defined by name', [`A:=${M}`, `A=${M}`], isProved(true));
check('the bmatrix spelling', [
  '\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}=\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}'
], isProved(true));

console.log('== transposes ==');

// `^T` is a transpose on a matrix and a power everywhere else. Read as a
// power, `M^T = ...` became a claim about a variable named T, and the sampler
// reported a counterexample to a true statement.
check('a transpose', [`${M}^{T}=\\begin{pmatrix}1&3\\\\2&4\\end{pmatrix}`], isProved(true));
check('a transpose without braces', [`${M}^T=\\begin{pmatrix}1&3\\\\2&4\\end{pmatrix}`], isProved(true));
check('the \\top spelling', [`${M}^{\\top}=\\begin{pmatrix}1&3\\\\2&4\\end{pmatrix}`], isProved(true));
check('transposing twice is the identity', [`(${M}^{T})^{T}=${M}`], isProved(true));
check('a wrong transpose', [`${M}^{T}=${M}`], isProved(false));

check('an ordinary power keeps its reading', ['x^T'], (result) => (
  result.kind === 'symbolic' ? null : `expected a symbolic power, got ${result.kind}`
));

console.log('== vectors ==');

check('a norm', ['\\|(3,4)\\|=5'], isProved(true));
check('a wrong norm', ['\\|(3,4)\\|=6'], isProved(false));

// Compute Engine computes `Dot` but its LaTeX parser refuses the infix form,
// so `(1,2,3)·(4,5,6)` is rewritten into the call before parsing.
check('a dot product has a value', ['(1,2,3)\\cdot(4,5,6)'], isValue('32'));
check('a dot product equation', ['(1,2,3)\\cdot(4,5,6)=32'], isProved(true));
check('a wrong dot product', ['(1,2,3)\\cdot(4,5,6)=33'], isProved(false));
check('a dot product in two dimensions', ['(3,4)\\cdot(3,4)=25'], isProved(true));
check('a dot product inside arithmetic', ['(1,2)\\cdot(3,4)+1=12'], isProved(true));
check('a symbolic dot product expands', ['(a,b)\\cdot(c,d)=ac+bd'], isProved(true));
check('column vectors have an inner product', [
  '\\begin{pmatrix}1\\\\2\\\\3\\end{pmatrix}'
  + '\\cdot\\begin{pmatrix}4\\\\5\\\\6\\end{pmatrix}',
], isValue('32'));
check('row vectors have an inner product', [
  '\\begin{pmatrix}1&2&3\\end{pmatrix}'
  + '\\cdot\\begin{pmatrix}4&5&6\\end{pmatrix}',
], isValue('32'));
check('row and column orientations can be mixed in an inner product', [
  '\\begin{pmatrix}1&2&3\\end{pmatrix}'
  + '\\cdot\\begin{pmatrix}4\\\\5\\\\6\\end{pmatrix}',
], isValue('32'));
check('named column vectors have an inner product', [
  'v:=\\begin{pmatrix}1\\\\2\\\\3\\end{pmatrix}',
  'w:=\\begin{pmatrix}4\\\\5\\\\6\\end{pmatrix}',
  'v\\cdot w',
], isValue('32'));
check('vector-valued function results have an inner product', [
  'v(t):=\\begin{pmatrix}t\\\\t^2\\\\1\\end{pmatrix}',
  'w:=\\begin{pmatrix}1\\\\2\\\\3\\end{pmatrix}',
  'v(2)\\cdot w',
], isValue('13'));
check('vectors of different lengths are refused', ['(1,2)\\cdot(1,2,3)'], (result) => (
  result.kind === 'error' ? null : `expected an error, got ${result.kind}`
));

console.log('== cross products ==');

check('tuple vectors have a cross product', [
  '(1,0,0)\\times(0,1,0)',
], isValue('(0,0,1)'));
check('column vectors have a cross product', [
  '\\begin{pmatrix}1\\\\0\\\\0\\end{pmatrix}'
  + '\\times\\begin{pmatrix}0\\\\1\\\\0\\end{pmatrix}',
], isValue('\\begin{pmatrix}0 \\\\ 0 \\\\ 1\\end{pmatrix}'));
check('row vectors have a cross product', [
  '\\begin{pmatrix}1&0&0\\end{pmatrix}'
  + '\\times\\begin{pmatrix}0&1&0\\end{pmatrix}',
], isValue('\\begin{pmatrix}0 & 0 & 1\\end{pmatrix}'));
check('named column vectors have a cross product', [
  'v:=\\begin{pmatrix}1\\\\0\\\\0\\end{pmatrix}',
  'w:=\\begin{pmatrix}0\\\\1\\\\0\\end{pmatrix}',
  'v\\times w',
], isValue('\\begin{pmatrix}0 \\\\ 0 \\\\ 1\\end{pmatrix}'));
check('cross products preserve operand order', [
  '(0,1,0)\\times(1,0,0)',
], isValue('(0,0,-1)'));
check('cross products require three components', ['(1,2)\\times(3,4)'], (result) => (
  result.kind === 'error' ? null : `expected an error, got ${result.kind}`
));

// The rewrite must not touch ordinary multiplication...
check('a product of numbers', ['2\\cdot3=6'], isProved(true));
check('a scalar against a bracket', ['2\\cdot(3+4)=14'], isProved(true));
check('a bracket against a bracket', ['(1+2)\\cdot(3+4)=21'], isProved(true));

// ...nor the Cartesian products that share the `\times` token.
check('a Cartesian product still works', [
  '\\{1,2\\}\\times\\{3\\}=\\{(1,3),(2,3)\\}',
], isProved(true));
check('membership of a Cartesian product', [
  '(1,3)\\in\\{1,2\\}\\times\\{3\\}',
], isProved(true));

console.log('== refusing rather than guessing ==');

check('mismatched shapes are refused, not answered', [
  '\\begin{pmatrix}1&2\\end{pmatrix}+\\begin{pmatrix}1\\\\2\\end{pmatrix}'
], (result) => (result.kind === 'error' ? null : `expected an error, got ${result.kind}`));

// A template straight off the keyboard is half-typed. `stripDecorations`
// removes the placeholders, leaving rows of unequal length, which must not be
// shown back as though it were the answer.
const incompleteGrids = [
  ['an untouched template', '\\begin{pmatrix}\\placeholder{} & \\placeholder{}\\\\ \\placeholder{} & \\placeholder{}\\end{pmatrix}'],
  ['a half-filled template', '\\begin{pmatrix}1 & \\placeholder{} \\\\ 3 & 4\\end{pmatrix}'],
];
for (const [label, line] of incompleteGrids) {
  check(`${label} says it is unfinished`, [line], (result) => (
    result.kind === 'error' ? null : `expected an error, got ${result.kind}`
  ));
}

// The invariant behind all of the above.
const MATRIX_STATEMENTS = [
  `${M}=${M}`,
  `${M}=${I}`,
  `${M}^{T}=${M}`,
  `\\det${M}=-2`,
  `${M}${I}=${M}`,
  '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}=\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}',
];

for (const line of MATRIX_STATEMENTS) {
  check(`no numeric guessing for ${line.slice(0, 34)}`, [line], (result) => {
    if (result.kind !== 'truth') return `expected a truth, got ${result.kind}`;
    return ['sampled', 'counterexample'].includes(result.method)
      ? `settled by sampling (${result.method})` : null;
  });
}

console.log('== the keyboard actually produces matrices ==');

/** Fill a template's placeholders with distinct digits so it can be evaluated. */
const fillPlaceholders = (latex) => {
  let n = 0;
  return latex.replace(/#\?/g, () => String((n++ % 9) + 1));
};

const matrixKeys = LINEAR_ALGEBRA_LAYOUT.rows.flat()
  .filter((entry) => typeof entry.latex === 'string' && entry.latex.includes('pmatrix'));

const entryKey = LINEAR_ALGEBRA_LAYOUT.rows.flat()
  .find((entry) => entry.insert === '_{#?,#?}');
if (entryKey?.tooltip) passed++;
else failures.push('the matrix tab is missing its row-column subscript key');

// Two starting shapes only: a 2-entry column vector and a 2x2. Every other
// size is reached by resizing the blank grid.
if (matrixKeys.length === 2) passed++;
else failures.push(`expected two matrix templates, found ${matrixKeys.length}`);

for (const entry of matrixKeys) {
  const filled = fillPlaceholders(entry.insert ?? entry.latex);
  check(`the ${entry.tooltip} key builds a matrix`, [filled], (result) => {
    if (result.kind === 'error') return `errored: ${result.message}`;
    return /pmatrix/.test(result.exactLatex ?? result.latex ?? '')
      ? null : 'did not evaluate to a matrix';
  });
}

const shortcutTemplates = ['mat', 'vec'];
for (const name of shortcutTemplates) {
  const template = INLINE_SHORTCUTS[name];
  check(`the "${name}" shortcut builds a matrix`, [fillPlaceholders(template ?? '')], (result) => {
    if (!template) return 'the shortcut is not registered';
    if (result.kind === 'error') return `errored: ${result.message}`;
    return /pmatrix/.test(result.exactLatex ?? result.latex ?? '')
      ? null : 'did not evaluate to a matrix';
  });
}

check('the norm shortcut measures a vector', [fillPlaceholders(INLINE_SHORTCUTS.norm ?? '')],
  (result) => (result.kind === 'value' ? null : `expected a value, got ${result.kind}`));

// The row and column keys are what let a blank 2x2 grow, so they must name
// real MathLive commands rather than inserting LaTeX. Add and remove only —
// inserting before the caret as well was more keys than the job needs.
const EDIT_COMMANDS = ['addRowAfter', 'removeRow', 'addColumnAfter', 'removeColumn'];
const editKeys = LINEAR_ALGEBRA_LAYOUT.rows.flat().filter((entry) => entry.command);
if (editKeys.length === EDIT_COMMANDS.length
  && editKeys.every((entry, index) => entry.command[0] === EDIT_COMMANDS[index])) {
  passed++;
} else {
  failures.push(`expected the four row/column keys, found ${editKeys.map((e) => e.command[0]).join(', ')}`);
}

// Every resize key must carry the hook the sheet greys out.
if (editKeys.every((entry) => /\bmatrix-resize\b/.test(entry.class ?? ''))) passed++;
else failures.push('a row/column key is missing the matrix-resize class');

console.log('== a new column gets cells to type into ==');

/**
 * MathLive's `addRowAfter` fills the new row with placeholders, but
 * `addColumnAfter` leaves its cells genuinely empty — and an empty cell draws
 * no box, so the column appears as a gap that cannot be tabbed to.
 */
const cellCases = [
  [
    'the column MathLive actually produces',
    '\\begin{pmatrix}1 &  & 2\\\\3 &  & 4\\end{pmatrix}',
    6,
  ],
  [
    'a blank grid after adding a column',
    '\\begin{pmatrix}\\placeholder{} &  & \\placeholder{}\\\\ \\placeholder{} &  & \\placeholder{}\\end{pmatrix}',
    6,
  ],
  ['an empty trailing row', '\\begin{pmatrix}1 & 2\\\\ & \\end{pmatrix}', 2],
];

for (const [label, latex, expectedCells] of cellCases) {
  const filled = fillEmptyMatrixCells(latex);
  const boxes = (filled.match(/\\placeholder\{\}/g) ?? []).length;
  const gaps = /&\s*&|&\s*\\end|\\begin\{[a-z]*matrix\}\s*&/.test(filled);
  if (!gaps && boxes + (filled.match(/\d/g) ?? []).length >= expectedCells) passed++;
  else failures.push(`${label}: left ${boxes} placeholders${gaps ? ' and an empty cell' : ''}`);
}

// Filling must not disturb a grid that is already complete.
for (const untouched of [
  '\\begin{pmatrix}1 & 2\\\\3 & 4\\end{pmatrix}',
  'x^2+y^2',
  '',
]) {
  if (fillEmptyMatrixCells(untouched) === untouched) passed++;
  else failures.push(`filling rewrote something it should have left alone: ${untouched}`);
}

// A filled grid stays unresizable afterwards; a blank one stays resizable.
if (matrixResizeAllowed(fillEmptyMatrixCells('\\begin{pmatrix} &  & \\end{pmatrix}'))) passed++;
else failures.push('filling a blank grid should leave it resizable');

console.log('== resizing is offered only on a blank grid ==');

/**
 * The rule: a grid may be reshaped while it is still a template, because
 * removing a column from a filled matrix silently destroys entries.
 */
const resizeCases = [
  ['an untouched 2x2 template', '\\begin{pmatrix}\\placeholder{} & \\placeholder{}\\\\ \\placeholder{} & \\placeholder{}\\end{pmatrix}', true],
  ['an empty grid with bare cells', '\\begin{pmatrix} & \\\\ & \\end{pmatrix}', true],
  ['an untouched column vector', '\\begin{pmatrix}\\placeholder{}\\\\ \\placeholder{}\\end{pmatrix}', true],
  ['a filled matrix', '\\begin{pmatrix}1 & 2\\\\ 3 & 4\\end{pmatrix}', false],
  ['a partly filled matrix', '\\begin{pmatrix}1 & \\placeholder{}\\\\ \\placeholder{} & \\placeholder{}\\end{pmatrix}', false],
  ['a line with no grid at all', 'x^2+y^2', false],
  ['an empty line', '', false],
  ['a filled grid beside an empty one', '\\begin{pmatrix}1\\\\2\\end{pmatrix}+\\begin{pmatrix} \\\\ \\end{pmatrix}', false],
  ['a bmatrix template', '\\begin{bmatrix}\\placeholder{} & \\placeholder{}\\end{bmatrix}', true],
];

for (const [label, latex, expected] of resizeCases) {
  if (matrixResizeAllowed(latex) === expected) passed++;
  else failures.push(`${label}: expected resizing to be ${expected ? 'offered' : 'withheld'}`);
}

if (LINEAR_ALGEBRA_LAYOUT.label && LINEAR_ALGEBRA_LAYOUT.tooltip) passed++;
else failures.push('the linear algebra tab needs a label and a tooltip');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`${passed} linear-algebra cases passed`);
