/**
 * MathLive configuration: typing shortcuts, the text-mode keybindings, and the
 * permanently docked virtual keyboard.
 */

/** Typing these letter runs in math mode inserts the real command. */
export const INLINE_SHORTCUTS = {
  floor: '\\lfloor#?\\rfloor',
  ceil: '\\lceil#?\\rceil',
  ceiling: '\\lceil#?\\rceil',
  rnd: '\\operatorname{rnd}\\left(#?\\right)',
  Re: '\\operatorname{Re}\\left(#?\\right)',
  Im: '\\operatorname{Im}\\left(#?\\right)',
  conj: '\\operatorname{conj}\\left(#?\\right)',
  powerset: '\\mathcal{P}\\left(#?\\right)',
  cart: '\\operatorname{CartesianProduct}\\left(#?,#?\\right)',
  ball: '\\operatorname{ball}\\left(#?,#?\\right)',
  closedball: '\\operatorname{closedball}\\left(#?,#?\\right)',
  compact: '\\mathsf{Cpt}\\left(#?,#?\\right)',
  group: '\\mathsf{Grp}\\left(#?,#?,#?\\right)',
  abelian: '\\mathsf{Abl}\\left(#?,#?\\right)',
  subgroup: '\\mathsf{Sbg}\\left(#?,#?,#?,#?\\right)',
  closure: '\\mathsf{Clo}\\left(#?,#?\\right)',
  ring: '\\mathsf{Rng}\\left(#?,#?,#?,#?\\right)',
  distributive: '\\mathsf{Dst}\\left(#?,#?,#?\\right)',
  unity: '\\mathsf{Uni}\\left(#?,#?,#?\\right)',
  field: '\\mathsf{Fld}\\left(#?,#?,#?,#?,#?\\right)',
  module: '\\mathsf{Mdl}\\left(#?,#?,#?,#?,#?,#?,#?\\right)',
  vectorspace: '\\mathsf{Vec}\\left(#?,#?,#?,#?,#?,#?,#?,#?,#?\\right)',
  category: '\\mathsf{Cat}\\left(#?,#?,#?,#?,#?,#?\\right)',
  functor: '\\mathsf{Fun}\\left(#?,#?,#?,#?\\right)',
  grpeq: '\\mathsf{Grp}\\vdash #?=#?',
  ableq: '\\mathsf{Abl}\\vdash #?=#?',
  assoc: '\\mathsf{Asc}\\left(#?,#?\\right)',
  identity: '\\mathsf{Idn}\\left(#?,#?,#?\\right)',
  inverses: '\\mathsf{Inv}\\left(#?,#?,#?\\right)',
  card: '\\operatorname{card}\\left(#?\\right)',
  // Typed entry for the two starting shapes. Other sizes are reached by
  // resizing the blank grid, so there is no `mat3` or `vec3` to remember.
  mat: '\\begin{pmatrix}#? & #? \\\\ #? & #?\\end{pmatrix}',
  vec: '\\begin{pmatrix}#? \\\\ #?\\end{pmatrix}',
  norm: '\\left\\|#?\\right\\|',
  deriv: '\\frac{d}{d#?}#?',
  partial: '\\operatorname{partial}\\left(#?,#?,#?\\right)',
  integral: '\\int_{#?}^{#?}#?\\,d#?',
  lim: '\\lim_{#?\\to#?}#?',
  induct: '\\mathsf{Induct}\\left(#?,#?\\right)',
  indbase: '\\mathsf{Base}\\left(#?,#?\\right)',
  indstep: '\\mathsf{Step}\\left(#?,#?\\right)',
  cont: '\\operatorname{cont}\\left(#?,#?,#?,#?\\right)',
  limitw: '\\operatorname{limitw}\\left(#?,#?,#?,#?,#?\\right)',
  topology: '\\mathsf{Top}\\left(#?,#?\\right)',
  openin: '\\mathcal{O}\\left(#?,#?\\right)',
  closedin: '\\mathcal{C}\\left(#?,#?,#?\\right)',
  nbrhd: '\\mathcal{N}\\left(#?,#?,#?\\right)',
  metricopen: '\\mathcal{O}_{\\mathbb{R}}\\left(#?\\right)',
  metricclosed: '\\mathcal{C}_{\\mathbb{R}}\\left(#?\\right)',
  continuousmap: '\\mathsf{Cts}\\left(#?,#?,#?,#?,#?\\right)',
  disc: '\\mathsf{Disc}\\left(#?\\right)',
  indisc: '\\mathsf{Ind}\\left(#?\\right)',
  cofinite: '\\mathsf{Cof}\\left(#?\\right)',
  metrictop: '\\mathsf{Met}\\left(#?\\right)',
  subtop: '\\mathsf{Sub}\\left(#?,#?,#?\\right)',
  prodtop: '\\mathsf{Prod}\\left(#?,#?,#?,#?\\right)',
  axempty: '\\mathsf{Ax}_{\\varnothing}\\left(#?,#?\\right)',
  axcarrier: '\\mathsf{Ax}_{X}\\left(#?,#?\\right)',
  axunions: '\\mathsf{Ax}_{\\bigcup}\\left(#?,#?\\right)',
  axintersections: '\\mathsf{Ax}_{\\cap}\\left(#?,#?\\right)',
  meetw: '\\mathsf{Meet}\\left(#?,#?,\\min(#?,#?)\\right)',
  iunion: '\\mathop{\\bigcup}\\left(#?,#?\\right)',
  iintersection: '\\mathop{\\bigcap}\\left(#?,#?\\right)',
  given: '\\vdash',
  iff: '\\iff',
  implies: '\\implies',
  impl: '\\implies',
  impliedby: '\\impliedby',
  equiv: '\\iff',
  and: '\\land',
  or: '\\lor',
  not: '\\neg',
  // `\coloneq` alone is laid out as an ordinary symbol and comes out visibly
  // tighter than `=` or `\ne`. `\mathrel` restores the relation spacing;
  // `normalizeOperators` strips the wrapper again before parsing.
  ':=': '\\mathrel{\\coloneq}',
  '!=': '\\ne',
  '<=': '\\le',
  '>=': '\\ge',
};

/**
 * Toggles for the serif channel, in both directions, plus `}` to leave it —
 * which costs the ability to type a literal `}` inside text, by design.
 *
 * Ctrl+T is bound as asked, but browsers reserve it for "new tab" and never
 * deliver it to the page; it only arrives in a standalone/PWA window. Alt+T is
 * bound alongside it as the combination that works in an ordinary tab.
 */
/**
 * Combinations the host gets to keep.
 *
 * MathLive claims several of these by default, and a mathfield holds focus for
 * almost the whole time this app is open — so the address bar and the back
 * button quietly stop working, with no clue as to why. A handful of MathLive
 * shortcuts are worth less than the browser behaving like a browser.
 *
 * `alt+[Home]`, `alt+e` and `alt+f` are not bound by MathLive today; they are
 * listed so that they stay unbound if that changes.
 */
export const BROWSER_RESERVED_KEYS = new Set([
  'alt+d',             // focus the address bar
  'alt+[ArrowLeft]',   // back
  'alt+[ArrowRight]',  // forward
  'alt+[Home]',        // home page
  'alt+e',             // browser menu (Chrome) / Edit menu (Firefox)
  'alt+f',             // browser menu (Chrome) / File menu (Firefox)
]);

/** Drop the bindings that would shadow the browser's own shortcuts. */
export function releaseBrowserKeys(keybindings) {
  return keybindings.filter((binding) => !BROWSER_RESERVED_KEYS.has(binding.key));
}

export const KEYBINDINGS = [
  { key: 'ctrl+t', ifMode: 'math', command: ['switchMode', 'text'] },
  { key: 'ctrl+t', ifMode: 'text', command: ['switchMode', 'math'] },
  { key: 'alt+t', ifMode: 'math', command: ['switchMode', 'text'] },
  { key: 'alt+t', ifMode: 'text', command: ['switchMode', 'math'] },
  // `}` is shift+] on a US layout; MathLive remaps it per keyboard layout.
  { key: 'shift+]', ifMode: 'text', command: ['switchMode', 'math'] },
];

const key = (latex, extra = {}) => ({ latex, ...extra });

/** Word-labelled keys: a text label stays narrow where rendered math would not. */
const fn = (label, insert, tooltip) => ({ label, insert, tooltip, class: 'small' });

/**
 * A leading layer with the operators this app cares about, so none of them
 * require LaTeX knowledge. The stock layers stay available behind it.
 */
/** Bare on the keycap, spaced when inserted. */
const defineKey = {
  latex: '\\coloneq', insert: '\\mathrel{\\coloneq}', tooltip: 'define (:=)',
};

/**
 * Everything that builds a value: the number pad, the constants, and the
 * functions. No comma and no serif toggle — those belong to lines that are
 * naming or arguing rather than calculating.
 *
 * The four numeric rows are deliberately the same total width so the digit
 * columns line up; `test/core.test.mjs` holds that invariant.
 */
export const EXPR_LAYOUT = {
  label: 'expr',
  tooltip: 'Expressions',
  rows: [
    [
      { latex: '\\lfloor#?\\rfloor', tooltip: 'floor', class: 'small' },
      { latex: '\\lceil#?\\rceil', tooltip: 'ceiling', class: 'small' },
      fn('rnd', '\\operatorname{rnd}(#?)', 'round to nearest'),
      fn('Re', '\\operatorname{Re}(#?)', 'real part'),
      fn('Im', '\\operatorname{Im}(#?)', 'imaginary part'),
      fn('conj', '\\overline{#?}', 'complex conjugate'),
      key('i', { tooltip: 'imaginary unit' }),
      { class: 'separator w5' },
      key('7'), key('8'), key('9'), key('\\div'),
    ],
    [
      fn('sin', '\\sin(#?)', 'sine'),
      fn('cos', '\\cos(#?)', 'cosine'),
      fn('tan', '\\tan(#?)', 'tangent'),
      fn('ln', '\\ln(#?)', 'natural logarithm'),
      fn('log', '\\log(#?)', 'logarithm'),
      fn('|x|', '\\left|#?\\right|', 'absolute value'),
      key('\\pi'),
      { class: 'separator w5' },
      key('4'), key('5'), key('6'), key('\\times'),
    ],
    [
      { latex: '\\frac{#?}{#?}', class: 'small' },
      { latex: '#?^{#?}', insert: '^{#?}', tooltip: 'power', class: 'small' },
      { latex: '#?^2', insert: '^2', tooltip: 'square', class: 'small' },
      { latex: '\\sqrt{#?}', tooltip: 'square root', class: 'small' },
      { latex: '\\sqrt[#?]{#?}', tooltip: 'radical', class: 'small' },
      key('e', { tooltip: "Euler's number" }),
      // Subscript is part of a *name*, so it lives on the `defn` tab. The
      // separator widens to keep the digit column where the other rows put it.
      { class: 'separator w15' },
      key('1'), key('2'), key('3'), key('-'),
    ],
    [
      // Keep the number pad aligned after moving punctuation to the editing
      // row. MathLive ignores numeric widths on separators, so its supported
      // five-unit class plus one ordinary unit make the required six.
      { class: 'separator w50' }, { class: 'separator' },
      { class: 'separator w15' },
      key('0', { width: 2 }), key('.'), key('+'),
    ],
    [
      key('('), key(')'),
      { label: '[left]', tooltip: 'move left' },
      { label: '[right]', tooltip: 'move right' },
      { label: '[backspace]', tooltip: 'backspace', class: 'action hide-shift calc-backspace' },
      { label: '[return]', tooltip: 'new line' },
    ],
  ],
};

/**
 * Naming things: the letters a name can be made of, and the two operators that
 * introduce one.
 *
 * Uppercase is a long press rather than a row of its own — `A` on `a`, `Γ` on
 * `γ` — which is what keeps the whole alphabet, the Greek alphabet and the
 * digits on one tab instead of three.
 *
 * `-` and `_` insert the bare characters, so they mean what the channel they
 * are typed into means: a hyphen and an underscore inside a serif name, a
 * minus sign and a subscript outside one. That is why the serif toggle sits
 * here too — `\text{max-speed}` is a name, `max-speed` is a subtraction.
 */
const LATIN_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'].map((row) => row.split(''));

/**
 * Greek on the QWERTY positions a Greek keyboard actually uses, so `a` is α
 * and `p` is π. `q` has no Greek counterpart and takes the variant theta.
 *
 * An entry may carry alternates, which appear on a long press. That is where
 * the six `var` letters live — ε, ϑ, ϖ, ϱ, ς and φ — because all twenty-six
 * QWERTY positions are already spoken for, and because a var form is the same
 * letter written differently rather than a letter of its own. They are
 * distinct names to this app, so each one is worth being able to type.
 */
const GREEK_ROWS = [
  ['vartheta', 'varsigma', ['epsilon', 'varepsilon'], ['rho', 'varrho'], 'tau',
    'upsilon', ['theta', 'vartheta'], 'iota', 'omicron', ['pi', 'varpi']],
  ['alpha', ['sigma', 'varsigma'], 'delta', ['phi', 'varphi'], 'gamma', 'eta',
    'xi', 'kappa', 'lambda'],
  ['zeta', 'chi', 'psi', 'omega', 'beta', 'nu', 'mu'],
];

/**
 * Only eleven Greek letters have a capital of their own; the rest are written
 * with the Latin capital and have no command. Those positions are left blank
 * rather than filled with a Latin letter that would be a different name.
 */
const GREEK_CAPITAL_ROWS = [
  [null, null, null, null, null, 'Upsilon', 'Theta', null, null, 'Pi'],
  [null, 'Sigma', 'Delta', 'Phi', 'Gamma', null, 'Xi', null, 'Lambda'],
  [null, null, 'Psi', 'Omega', null, null, null],
];

const DEFN_LOWER = 'defn-lower';
const DEFN_UPPER = 'defn-upper';
const DEFN_GREEK = 'defn-greek';
const DEFN_GREEK_UPPER = 'defn-greek-upper';

const letterRows = (rows, transform) => rows.map((row) => row.map((entry) => (
  entry === null ? { class: 'separator' } : transform(entry)
)));

/**
 * One layer of the naming keyboard.
 *
 * Two shifts rather than one: `⇧` changes case and `α` changes alphabet, so
 * the four combinations are four layers and each shift only ever toggles its
 * own axis. Everything that is not a letter — the digits, `:=`, subscript,
 * hyphen, underscore, the serif toggle and the navigation keys — is identical
 * on all four, so switching layer never moves anything under the finger.
 */
function defnLayer({ id, rows, shiftTo, greekTo, shiftActive, greekActive }) {
  return {
    id,
    rows: [
      [
        key('1'), key('2'), key('3'), key('4'), key('5'),
        key('6'), key('7'), key('8'), key('9'), key('0'),
      ],
      rows[0],
      [{ class: 'separator w5' }, ...rows[1], { class: 'separator w5' }],
      [
        // `switchKeyboardLayer` rather than the `layer` keycap property: the
        // property is in MathLive's types but nothing consumes it, so the key
        // fell through to its own label and typed a `⇧` into the field.
        {
          label: '⇧',
          command: ['switchKeyboardLayer', shiftTo],
          tooltip: 'uppercase',
          class: `action w15${shiftActive ? ' defn-active' : ''}`,
        },
        ...rows[2],
        {
          label: 'α',
          command: ['switchKeyboardLayer', greekTo],
          tooltip: 'greek letters',
          class: `action w15${greekActive ? ' defn-active' : ''}`,
        },
      ],
      [
        {
          label: '<span style="font-family:Georgia,serif;font-size:0.9em">abc</span>',
          command: ['switchMode', 'text'],
          tooltip: 'serif text, for names longer than one letter (Ctrl+T)',
          class: 'w15',
        },
        { label: '-', key: '-', tooltip: 'hyphen in a serif name, minus outside one' },
        { label: '_', key: '_', tooltip: 'underscore in a serif name, subscript outside one' },
        { latex: '#?_{#?}', insert: '_{#?}', tooltip: 'subscript', class: 'small' },
        { ...defineKey, width: 1.5 },
        { label: '[left]', tooltip: 'move left' },
        { label: '[right]', tooltip: 'move right' },
        { label: '[backspace]', tooltip: 'backspace', class: 'action hide-shift calc-backspace' },
        { label: '[return]', tooltip: 'new line' },
      ],
    ],
  };
}

export const DEFN_LAYOUT = {
  label: 'defn',
  tooltip: 'Names and definitions',
  layers: [
    defnLayer({
      id: DEFN_LOWER,
      rows: letterRows(LATIN_ROWS, (letter) => key(letter)),
      shiftTo: DEFN_UPPER,
      greekTo: DEFN_GREEK,
    }),
    defnLayer({
      id: DEFN_UPPER,
      rows: letterRows(LATIN_ROWS, (letter) => key(letter.toUpperCase())),
      shiftTo: DEFN_LOWER,
      greekTo: DEFN_GREEK_UPPER,
      shiftActive: true,
    }),
    defnLayer({
      id: DEFN_GREEK,
      rows: letterRows(GREEK_ROWS, (entry) => {
        const [name, ...alternates] = Array.isArray(entry) ? entry : [entry];
        return key(`\\${name}`, alternates.length
          ? { variants: alternates.map((alternate) => `\\${alternate}`) }
          : {});
      }),
      shiftTo: DEFN_GREEK_UPPER,
      greekTo: DEFN_LOWER,
      greekActive: true,
    }),
    defnLayer({
      id: DEFN_GREEK_UPPER,
      rows: letterRows(GREEK_CAPITAL_ROWS, (name) => key(`\\${name}`)),
      shiftTo: DEFN_GREEK,
      greekTo: DEFN_UPPER,
      shiftActive: true,
      greekActive: true,
    }),
  ],
};

/** Everything that turns expressions into a claim: relations and connectives. */
export const REL_LAYOUT = {
  label: 'rel',
  tooltip: 'Relations and logic',
  rows: [
    [
      key('='), key('\\ne'), key('<'),
    ],
    [
      key('>'), key('\\le'), key('\\ge'),
    ],
    [
      { latex: '\\neg', tooltip: 'logical not' },
      { latex: '\\land', tooltip: 'logical and' },
      { latex: '\\lor', tooltip: 'logical or' },
    ],
    [
      { latex: '\\implies', tooltip: 'implies' },
      { latex: '\\impliedby', tooltip: 'is implied by' },
      { latex: '\\iff', tooltip: 'is equivalent to' },
    ],
    [
      key('('), key(')'),
      { label: '[left]', tooltip: 'move left' },
      { label: '[right]', tooltip: 'move right' },
      { label: '[backspace]', tooltip: 'backspace', class: 'action hide-shift calc-backspace' },
      { label: '[return]', tooltip: 'new line' },
    ],
  ],
};

/** Set notation kept focused enough to be useful on a narrow calculator. */
export const SET_LAYOUT = {
  label: '{∈}',
  tooltip: 'Sets',
  rows: [
    [
      key('\\in'), key('\\notin'), key('\\subset'), key('\\subseteq'),
      key('\\supset'), key('\\supseteq'),
    ],
    [
      key('\\cup'), key('\\cap'), key('\\setminus'), key('\\varnothing'),
      key('\\times', { insert: '#?\\times#?', tooltip: 'Cartesian product' }),
    ],
    [
      key('\\mathcal{P}\\left(#?\\right)', { class: 'small', tooltip: 'power set' }),
      key('\\left\\{#?\\right\\}', { class: 'small', tooltip: 'finite set' }),
      key('\\left\\{#?\\mid #?\\right\\}', { class: 'small', tooltip: 'set builder' }),
      // Bars, not a word: `|A|` is how a reader writes the size of a set, and
      // the engine decides which reading applies from what sits between them.
      key('\\left|#?\\right|', {
        class: 'small',
        tooltip: 'how many members (absolute value off a set)',
      }),
    ],
    [
      key('\\mathbb{N}'),
      key('\\mathbb{Z}'),
      key('\\mathbb{Q}'),
      key('\\mathbb{R}'),
      key('\\mathbb{C}'),
      // Not one of Compute Engine's sets, and not a notation every reader
      // knows, so it earns a tooltip where the other four do not.
      key('\\mathbb{P}', { tooltip: 'the primes' }),
      key(','),
    ],
    [
      key('('), key(')'),
      { label: '[left]', tooltip: 'move left' },
      { label: '[right]', tooltip: 'move right' },
      { label: '[backspace]', tooltip: 'backspace', class: 'action hide-shift calc-backspace' },
      { label: '[return]', tooltip: 'new line' },
    ],
  ],
};

/** Proof-oriented notation for elementary analysis, induction, and topology. */
export const ANALYSIS_LAYOUT = {
  label: 'ε–δ',
  tooltip: 'Analysis, induction, and topology',
  rows: [
    [
      key('\\forall'), key('\\exists'),
      // The arrow used to sit here on its own, which told nobody that a limit
      // subscript is the only place it means anything.
      key('\\lim_{#?\\to#?}#?', {
        class: 'small', tooltip: 'limit as the variable approaches a value',
      }),
      key('\\left|#?\\right|', { class: 'small', tooltip: 'absolute value' }),
    ],
    [
      fn('ball', '\\operatorname{ball}(#?,#?)', 'open ball'),
      fn('cball', '\\operatorname{closedball}(#?,#?)', 'closed ball'),
      fn('cont', '\\operatorname{cont}(#?,#?,#?,#?)', 'continuity witness'),
      fn('limit', '\\operatorname{limitw}(#?,#?,#?,#?,#?)', 'limit witness'),
    ],
    // The differentiation variable is a placeholder of its own: `d` has to
    // stay literal for the operator to be read as one, and only the variable
    // beside it is a name.
    [
      key('\\frac{d}{d#?}#?', { class: 'small', tooltip: 'derivative' }),
      key('\\frac{d^{2}}{d#?^{2}}#?', { class: 'small', tooltip: 'second derivative' }),
      fn('∂ at', '\\operatorname{partial}(#?,#?,#?)', 'partial derivative at a point'),
      key("#@'", { latex: "f'", class: 'small', tooltip: 'derivative of a named function' }),
      // Definite only: an indefinite integral is defined up to a constant,
      // and the bounds are what the continuity gate needs to check.
      key('\\int_{#?}^{#?}#?\\,d#?', { class: 'small', tooltip: 'definite integral' }),
    ],
    [
      key('\\mathsf{Induct}', {
        insert: '\\mathsf{Induct}(#?,#?)', class: 'small', tooltip: 'induction certificate',
      }),
      key('\\mathsf{Base}', {
        insert: '\\mathsf{Base}(#?,#?)', class: 'small', tooltip: 'base case only',
      }),
      key('\\mathsf{Step}', {
        insert: '\\mathsf{Step}(#?,#?)', class: 'small', tooltip: 'inductive step only',
      }),
      key('\\mathcal{O}_{\\mathbb{R}}', {
        insert: '\\mathcal{O}_{\\mathbb{R}}(#?)', tooltip: 'open in the real metric',
      }),
      key('\\mathcal{C}_{\\mathbb{R}}', {
        insert: '\\mathcal{C}_{\\mathbb{R}}(#?)', tooltip: 'closed in the real metric',
      }),
    ],
    [
      key('('), key(')'), key(','),
      { label: '[left]', tooltip: 'move left' },
      { label: '[right]', tooltip: 'move right' },
      { label: '[backspace]', tooltip: 'backspace', class: 'action hide-shift calc-backspace' },
      { label: '[return]', tooltip: 'new line' },
    ],
  ],
};

/** Infinite topology constructors and their independently checkable axioms. */
export const TOPOLOGY_LAYOUT = {
  label: 'τ',
  tooltip: 'Topology proofs',
  rows: [
    [
      key('\\mathsf{Disc}', { insert: '\\mathsf{Disc}(#?)', tooltip: 'discrete topology' }),
      key('\\mathsf{Ind}', { insert: '\\mathsf{Ind}(#?)', tooltip: 'indiscrete topology' }),
      key('\\mathsf{Cof}', { insert: '\\mathsf{Cof}(#?)', tooltip: 'cofinite topology' }),
      key('\\mathsf{Met}', { insert: '\\mathsf{Met}(#?)', tooltip: 'real metric topology' }),
      key('\\mathsf{Sub}', {
        insert: '\\mathsf{Sub}(#?,#?,#?)', tooltip: 'subspace topology',
      }),
      key('\\mathsf{Prod}', {
        insert: '\\mathsf{Prod}(#?,#?,#?,#?)', tooltip: 'product topology',
      }),
    ],
    [
      key('\\mathsf{Ax}_{\\varnothing}', {
        insert: '\\mathsf{Ax}_{\\varnothing}(#?,#?)', tooltip: 'empty-set axiom',
      }),
      key('\\mathsf{Ax}_{X}', {
        insert: '\\mathsf{Ax}_{X}(#?,#?)', tooltip: 'carrier axiom',
      }),
      key('\\mathsf{Ax}_{\\bigcup}', {
        insert: '\\mathsf{Ax}_{\\bigcup}(#?,#?)', tooltip: 'arbitrary-union axiom',
      }),
      key('\\mathsf{Ax}_{\\cap}', {
        insert: '\\mathsf{Ax}_{\\cap}(#?,#?)', tooltip: 'finite-intersection axiom',
      }),
      key('\\mathsf{Top}', { insert: '\\mathsf{Top}(#?,#?)', tooltip: 'topology certificate' }),
      key('\\mathsf{Meet}', {
        insert: '\\mathsf{Meet}(#?,#?,\\min(#?,#?))',
        tooltip: 'metric intersection witness',
      }),
      key('\\vdash', { tooltip: 'prove from assumptions' }),
    ],
    [
      key('\\mathcal{O}', { insert: '\\mathcal{O}(#?,#?)', tooltip: 'open in topology' }),
      key('\\mathcal{C}', { insert: '\\mathcal{C}(#?,#?,#?)', tooltip: 'closed in topology' }),
      key('\\mathcal{N}', { insert: '\\mathcal{N}(#?,#?,#?)', tooltip: 'neighborhood' }),
      key('\\mathsf{Cts}', {
        insert: '\\mathsf{Cts}(#?,#?,#?,#?,#?)', tooltip: 'finite continuous map',
      }),
    ],
    [
      key('\\bigcup_{i\\in I}', {
        insert: '\\mathop{\\bigcup}(#?,#?)',
        tooltip: 'indexed union: family, index set', class: 'small',
      }),
      key('\\bigcap_{i\\in I}', {
        insert: '\\mathop{\\bigcap}(#?,#?)',
        tooltip: 'indexed intersection: family, index set', class: 'small',
      }),
    ],
    [
      key('('), key(')'), key(','),
      { label: '[left]', tooltip: 'move left' },
      { label: '[right]', tooltip: 'move right' },
      { label: '[backspace]', tooltip: 'backspace', class: 'action hide-shift calc-backspace' },
      { label: '[return]', tooltip: 'new line' },
    ],
  ],
};

/**
 * A matrix template. `#?` becomes a placeholder cell, so the whole grid
 * arrives at once and the reader tabs between entries instead of writing
 * `\begin{pmatrix}` by hand.
 */
const matrixTemplate = (rows, columns) => {
  const row = Array.from({ length: columns }, () => '#?').join(' & ');
  return `\\begin{pmatrix}${Array.from({ length: rows }, () => row).join(' \\\\ ')}\\end{pmatrix}`;
};

/**
 * A keycap that runs a MathLive editing command rather than inserting LaTeX.
 * `matrix-resize` is the hook the sheet greys out once a grid has entries.
 */
const editKey = (label, command, tooltip) => ({
  label, command: [command], tooltip, class: 'small matrix-resize',
});

/**
 * May the row and column keys act on what is currently written?
 *
 * Resizing changes the shape of a grid, which is harmless while it is still a
 * blank template and destructive once entries have been typed into it — a
 * removed column takes real values with it. So it is offered only while every
 * cell of every grid on the line is still empty.
 */
const MATRIX_ENVIRONMENT = /\\begin\{([a-zA-Z]*matrix)\}([\s\S]*?)\\end\{\1\}/g;

/**
 * Give every empty cell of a grid a placeholder to type into.
 *
 * MathLive's `addRowAfter` fills the new row with `\placeholder{}`, but
 * `addColumnAfter` leaves the new cells genuinely empty — `1 &  & 2` — and an
 * empty cell draws no box, so the column the reader just asked for is
 * invisible and cannot be tabbed to. Normalising afterwards is what makes the
 * two commands behave alike.
 */
export function fillEmptyMatrixCells(latex) {
  if (typeof latex !== 'string') return latex;
  return latex.replace(MATRIX_ENVIRONMENT, (whole, environment, body) => {
    const rows = body.split(/\\\\/).map((row) => row
      .split('&')
      .map((cell) => (cell.trim() === '' ? '\\placeholder{}' : cell))
      .join('&'));
    return `\\begin{${environment}}${rows.join('\\\\')}\\end{${environment}}`;
  });
}

export function matrixResizeAllowed(latex) {
  if (typeof latex !== 'string') return false;
  const environments = [
    ...latex.matchAll(/\\begin\{([a-zA-Z]*matrix)\}([\s\S]*?)\\end\{\1\}/g),
  ];
  if (environments.length === 0) return false;
  const isBlank = (cell) => cell
    .replace(/\\placeholder(\[[^\]]*\])?\{[^{}]*\}/g, '')
    .replace(/\\placeholder(\[[^\]]*\])?/g, '')
    .trim() === '';
  return environments.every(([, , body]) => body
    .split(/\\\\/)
    .every((row) => row.split('&').every(isBlank)));
}

/**
 * Matrices and vectors.
 *
 * Entry is the point of this tab. A matrix is the one construction here that
 * is genuinely painful to type — `\begin{pmatrix}1&2\\3&4\end{pmatrix}` is a
 * lot of punctuation to get right — so the templates come first, and the row
 * and column keys mean a grid that starts 2x2 does not have to stay 2x2.
 */
export const LINEAR_ALGEBRA_LAYOUT = {
  label: 'mat',
  tooltip: 'Matrices and vectors',
  rows: [
    // Two shapes to start from. Everything else is reached by resizing the
    // blank template, which is why the row and column keys sit beside them.
    [
      key(matrixTemplate(2, 1), { class: 'small', tooltip: 'column vector, 2 entries' }),
      key(matrixTemplate(2, 2), { class: 'small', tooltip: '2x2 matrix' }),
    ],
    [
      editKey('row +', 'addRowAfter', 'add a row (empty grids only)'),
      editKey('row -', 'removeRow', 'remove a row (empty grids only)'),
      editKey('col +', 'addColumnAfter', 'add a column (empty grids only)'),
      editKey('col -', 'removeColumn', 'remove a column (empty grids only)'),
    ],
    [
      key('#@^{T}', { latex: 'M^{T}', class: 'small', tooltip: 'transpose' }),
      key('#@^{-1}', { latex: 'M^{-1}', class: 'small', tooltip: 'inverse' }),
      fn('det', '\\det(#?)', 'determinant'),
      key('\\left\\|#?\\right\\|', { class: 'small', tooltip: 'norm (length) of a vector' }),
      key('#@_{#?,#?}', {
        latex: 'M_{i,j}', insert: '_{#?,#?}', class: 'small',
        tooltip: 'matrix entry (row, column)',
      }),
    ],
    [
      key('\\cdot', { tooltip: 'dot product between vectors, otherwise multiply' }),
      key('\\times', {
        insert: '#?\\times#?',
        tooltip: 'cross product between 3-vectors, otherwise multiply',
      }),
      key(','),
    ],
    [
      key('('), key(')'),
      { label: '[left]', tooltip: 'move left' },
      { label: '[right]', tooltip: 'move right' },
      { label: '[backspace]', tooltip: 'backspace', class: 'action hide-shift calc-backspace' },
      { label: '[return]', tooltip: 'new line' },
    ],
  ],
};

/** Finite algebraic structures: the group axioms, each separately checkable. */
export const ALGEBRA_LAYOUT = {
  label: 'alg',
  tooltip: 'Algebra',
  rows: [
    [
      key('\\mathsf{Grp}', {
        insert: '\\mathsf{Grp}(#?,#?,#?)', class: 'small', tooltip: 'is a group',
      }),
      key('\\mathsf{Abl}', {
        insert: '\\mathsf{Abl}(#?,#?)', class: 'small', tooltip: 'is abelian',
      }),
      key('\\mathsf{Sbg}', {
        insert: '\\mathsf{Sbg}(#?,#?,#?,#?)', class: 'small', tooltip: 'is a subgroup',
      }),
      key('\\mathsf{Cat}', {
        insert: '\\mathsf{Cat}(#?,#?,#?,#?,#?,#?)',
        class: 'small',
        tooltip: 'is a category: objects, morphisms, source, target, composition, identities',
      }),
      key('\\mathsf{Fun}', {
        insert: '\\mathsf{Fun}(#?,#?,#?,#?)',
        class: 'small',
        tooltip: 'is a functor: two named categories, then the morphism and object maps',
      }),
    ],
    [
      key('\\mathsf{Rng}', {
        insert: '\\mathsf{Rng}(#?,#?,#?,#?)', class: 'small', tooltip: 'is a ring',
      }),
      key('\\mathsf{Fld}', {
        insert: '\\mathsf{Fld}(#?,#?,#?,#?,#?)', class: 'small', tooltip: 'is a field',
      }),
      key('\\mathsf{Dst}', {
        insert: '\\mathsf{Dst}(#?,#?,#?)', class: 'small', tooltip: 'distributivity axiom',
      }),
      key('\\mathsf{Uni}', {
        insert: '\\mathsf{Uni}(#?,#?,#?)', class: 'small', tooltip: 'multiplicative identity',
      }),
      key('\\mathsf{Mdl}', {
        insert: '\\mathsf{Mdl}(#?,#?,#?,#?,#?,#?,#?)',
        class: 'small',
        tooltip: 'is a module over a ring',
      }),
      key('\\mathsf{Vec}', {
        insert: '\\mathsf{Vec}(#?,#?,#?,#?,#?,#?,#?,#?,#?)',
        class: 'small',
        tooltip: 'is a vector space: vectors, +, 0, scalars, +, ·, 0, 1, action',
      }),
    ],
    [
      key('\\mathsf{Clo}', {
        insert: '\\mathsf{Clo}(#?,#?)', class: 'small', tooltip: 'closure axiom',
      }),
      key('\\mathsf{Asc}', {
        insert: '\\mathsf{Asc}(#?,#?)', class: 'small', tooltip: 'associativity axiom',
      }),
      key('\\mathsf{Idn}', {
        insert: '\\mathsf{Idn}(#?,#?,#?)', class: 'small', tooltip: 'identity axiom',
      }),
      key('\\mathsf{Inv}', {
        insert: '\\mathsf{Inv}(#?,#?,#?)', class: 'small', tooltip: 'inverses axiom',
      }),
      // The category axioms sit with the group axioms rather than in a row of
      // their own: the tab is five rows everywhere and the grouping is by what
      // a key *is*, not by which structure it came from.
      key('\\mathsf{Cmp}', {
        insert: '\\mathsf{Cmp}(#?,#?,#?,#?,#?)', class: 'small', tooltip: 'composition is well-typed',
      }),
      key('\\mathsf{Idt}', {
        insert: '\\mathsf{Idt}(#?,#?,#?,#?,#?,#?)', class: 'small', tooltip: 'identity and unit laws',
      }),
      key('\\mathsf{Aso}', {
        insert: '\\mathsf{Aso}(#?,#?,#?,#?)', class: 'small', tooltip: 'composition is associative',
      }),
    ],
    [
      key('\\mathsf{Grp}\\vdash', {
        insert: '\\mathsf{Grp}\\vdash #?=#?',
        class: 'small',
        tooltip: 'prove an identity in every group',
      }),
      key('\\mathsf{Abl}\\vdash', {
        insert: '\\mathsf{Abl}\\vdash #?=#?',
        class: 'small',
        tooltip: 'prove an identity in every abelian group',
      }),
      key('^{-1}', { insert: '#@^{-1}', tooltip: 'inverse' }),
      key('1', { tooltip: 'identity' }),
      fn('mod', '\\operatorname{mod}(#?,#?)', 'modulo'),
    ],
    [
      key('('), key(')'), key(','),
      { label: '[left]', tooltip: 'move left' },
      { label: '[right]', tooltip: 'move right' },
      { label: '[backspace]', tooltip: 'backspace', class: 'action hide-shift calc-backspace' },
      { label: '[return]', tooltip: 'new line' },
    ],
  ],
};

/** The custom layers subsume MathLive's stock numeric and symbol tabs. */
export const KEYBOARD_LAYOUTS = [
  EXPR_LAYOUT, REL_LAYOUT,
  SET_LAYOUT, ANALYSIS_LAYOUT, TOPOLOGY_LAYOUT, ALGEBRA_LAYOUT,
  LINEAR_ALGEBRA_LAYOUT, DEFN_LAYOUT,
];

/**
 * Dock the shared virtual keyboard inside `container` and keep it there.
 * MathLive exposes a single keyboard instance for the whole page.
 */
export function setupVirtualKeyboard(container, options = {}) {
  const keyboard = globalThis.mathVirtualKeyboard;
  if (!keyboard) return null;

  keyboard.container = container;
  keyboard.layouts = KEYBOARD_LAYOUTS;
  keyboard.show();

  // MathLive's root is exactly as tall as its container and clips overflow,
  // while its plate has an intrinsic height determined by the active layout.
  // Keep the dock at least as tall as the plate (including its top inset), so a
  // short viewport cannot crop the toolbar or first row from the top.
  let observedPlate = null;
  let resizeObserver = null;
  let renderAttempts = 0;
  let collapsed = options.collapsed === true;
  const syncDockHeight = () => {
    if (collapsed) return;
    const root = container.querySelector('.ML__keyboard');
    const plate = root?.querySelector('.MLK__plate');
    if (!root || !plate) {
      if (renderAttempts++ < 120) requestAnimationFrame(syncDockHeight);
      return;
    }
    renderAttempts = 0;

    // The backdrop is bottom-anchored, and our CSS removes MathLive's duplicate
    // plate inset. Preserve the backdrop's intended top padding while sizing
    // the root exactly to the visible plate, without a feedback loop through
    // viewport coordinates.
    const backdrop = plate.parentElement;
    const topInset = Number.parseFloat(getComputedStyle(backdrop).paddingTop) || 0;
    const required = Math.ceil(topInset + plate.offsetHeight);
    if (required > 0) container.style.height = `${required}px`;

    if (plate !== observedPlate && globalThis.ResizeObserver) {
      resizeObserver?.disconnect();
      observedPlate = plate;
      resizeObserver = new globalThis.ResizeObserver(syncDockHeight);
      resizeObserver.observe(plate);
    }
  };

  const setCollapsed = (value) => {
    collapsed = value === true;
    container.classList.toggle('is-collapsed', collapsed);
    if (collapsed) {
      keyboard.hide();
      container.style.height = '0px';
    } else {
      // Give the keyboard room before it measures itself, then replace this
      // fallback with the active layout's exact intrinsic height.
      container.style.height = '390px';
      keyboard.show();
      requestAnimationFrame(syncDockHeight);
    }
  };

  // MathLive replaces the active plate when a layout tab is selected. The
  // ResizeObserver is still attached to the old plate at that instant, so a
  // shorter layout can inherit the previous layout's height and leave a blank
  // band above its keys. Reacquire and measure the new plate after the click
  // has been rendered.
  container.addEventListener('click', () => {
    requestAnimationFrame(() => requestAnimationFrame(syncDockHeight));
  });

  setCollapsed(collapsed);
  return { keyboard, setCollapsed };
}

/** Apply the shared configuration to one `<math-field>`. */
export function configureMathfield(mf) {
  mf.mathVirtualKeyboardPolicy = 'manual';
  mf.smartMode = false;
  mf.smartFence = true;
  mf.removeExtraneousParentheses = false;
  mf.menuItems = [];
  mf.inlineShortcuts = { ...mf.inlineShortcuts, ...INLINE_SHORTCUTS };
  mf.keybindings = [...releaseBrowserKeys(mf.keybindings), ...KEYBINDINGS];
  return mf;
}
