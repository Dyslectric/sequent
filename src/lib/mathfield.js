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
export const CALCULATOR_LAYOUT = {
  label: 'calc',
  tooltip: 'Calculator operators',
  rows: [
    [
      key('='), key('\\ne'), key('<'), key('>'), key('\\le'), key('\\ge'),
      // Bare on the keycap, spaced when inserted.
      { latex: '\\coloneq', insert: '\\mathrel{\\coloneq}', tooltip: 'define (:=)' },
      { class: 'separator w5' },
      key('7'), key('8'), key('9'), key('\\div'),
    ],
    [
      { latex: '\\neg', tooltip: 'logical not' },
      { latex: '\\land', tooltip: 'logical and' },
      { latex: '\\lor', tooltip: 'logical or' },
      { class: 'separator' },
      { latex: '\\implies', tooltip: 'implies' },
      { latex: '\\impliedby', tooltip: 'is implied by' },
      { latex: '\\iff', tooltip: 'is equivalent to' },
      { class: 'separator w5' },
      key('4'), key('5'), key('6'), key('\\times'),
    ],
    [
      { latex: '\\lfloor#?\\rfloor', tooltip: 'floor', class: 'small' },
      { latex: '\\lceil#?\\rceil', tooltip: 'ceiling', class: 'small' },
      fn('rnd', '\\operatorname{rnd}(#?)', 'round to nearest'),
      fn('Re', '\\operatorname{Re}(#?)', 'real part'),
      fn('Im', '\\operatorname{Im}(#?)', 'imaginary part'),
      key('i', { tooltip: 'imaginary unit' }), key('\\pi'),
      { class: 'separator w5' },
      key('1'), key('2'), key('3'), key('-'),
    ],
    [
      { latex: '\\frac{#?}{#?}', class: 'small' },
      { latex: '#?^{#?}', insert: '^{#?}', tooltip: 'power', class: 'small' },
      { latex: '#?_{#?}', insert: '_{#?}', tooltip: 'subscript', class: 'small' },
      { latex: '\\sqrt{#?}', class: 'small' },
      fn('|x|', '\\left|#?\\right|', 'absolute value'),
      key('e', { tooltip: "Euler's number" }),
      { class: 'separator w15' },
      key('0', { width: 2 }), key('.'), key('+'),
    ],
    [
      fn('sin', '\\sin(#?)', 'sine'),
      fn('cos', '\\cos(#?)', 'cosine'),
      fn('tan', '\\tan(#?)', 'tangent'),
      fn('ln', '\\ln(#?)', 'natural logarithm'),
      fn('log', '\\log(#?)', 'logarithm'),
      fn('conj', '\\overline{#?}', 'complex conjugate'),
      { class: 'separator w40' },
      { class: 'separator w15' },
    ],
    [
      key('('), key(')'), key(','),
      {
        label: '<span style="font-family:Georgia,serif;font-size:0.9em">abc</span>',
        command: ['switchMode', 'text'],
        tooltip: 'serif text (Ctrl+T)',
      },
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
      key('\\mathcal{P}\\left(#?\\right)', { class: 'small', tooltip: 'power set' }),
      key('\\left\\{#?\\right\\}', { class: 'small', tooltip: 'finite set' }),
      key('\\left\\{#?\\mid #?\\right\\}', { class: 'small', tooltip: 'set builder' }),
    ],
    [
      key('\\mathbb{N}'),
      key('\\mathbb{Z}'),
      key('\\mathbb{Q}'),
      key('\\mathbb{R}'),
      key('\\mathbb{C}'),
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

/** Proof-oriented notation for elementary analysis, induction, and topology. */
export const ANALYSIS_LAYOUT = {
  label: 'ε–δ',
  tooltip: 'Analysis, induction, and topology',
  rows: [
    [
      key('\\epsilon'), key('\\delta'), key('\\forall'), key('\\exists'), key('\\to'),
      key('\\left|#?\\right|', { class: 'small', tooltip: 'absolute value' }),
    ],
    [
      fn('ball', '\\operatorname{ball}(#?,#?)', 'open ball'),
      fn('cball', '\\operatorname{closedball}(#?,#?)', 'closed ball'),
      fn('cont', '\\operatorname{cont}(#?,#?,#?,#?)', 'continuity witness'),
      fn('limit', '\\operatorname{limitw}(#?,#?,#?,#?,#?)', 'limit witness'),
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
    ],
    [
      key('\\mathcal{O}_{\\mathbb{R}}', {
        insert: '\\mathcal{O}_{\\mathbb{R}}(#?)', tooltip: 'open in the real metric',
      }),
      key('\\mathcal{C}_{\\mathbb{R}}', {
        insert: '\\mathcal{C}_{\\mathbb{R}}(#?)', tooltip: 'closed in the real metric',
      }),
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
      key('('), key(')'), key(','),
      { label: '[left]', tooltip: 'move left' },
      { label: '[right]', tooltip: 'move right' },
      { label: '[backspace]', tooltip: 'backspace', class: 'action hide-shift calc-backspace' },
      { label: '[return]', tooltip: 'new line' },
    ],
  ],
};

/** The custom calculator and set layers subsume MathLive's stock symbol tabs. */
export const KEYBOARD_LAYOUTS = [
  CALCULATOR_LAYOUT, SET_LAYOUT, ANALYSIS_LAYOUT, TOPOLOGY_LAYOUT, 'alphabetic', 'greek',
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
