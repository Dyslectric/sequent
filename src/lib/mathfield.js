/**
 * MathLive configuration: typing shortcuts, the text-mode keybindings, and the
 * permanently docked virtual keyboard.
 */

/** Typing these letter runs in math mode inserts the real command. */
export const INLINE_SHORTCUTS = {
  floor: '\\lfloor#?\\rfloor',
  ceil: '\\lceil#?\\rceil',
  ceiling: '\\lceil#?\\rceil',
  round: '\\operatorname{round}\\left(#?\\right)',
  Re: '\\operatorname{Re}\\left(#?\\right)',
  Im: '\\operatorname{Im}\\left(#?\\right)',
  conj: '\\operatorname{conj}\\left(#?\\right)',
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
      { class: 'separator w5' },
      { latex: '\\implies', tooltip: 'implies' },
      { latex: '\\impliedby', tooltip: 'is implied by' },
      { latex: '\\iff', tooltip: 'is equivalent to' },
      { class: 'separator w5' },
      key('4'), key('5'), key('6'), key('\\times'),
    ],
    [
      { latex: '\\lfloor#?\\rfloor', tooltip: 'floor' },
      { latex: '\\lceil#?\\rceil', tooltip: 'ceiling' },
      fn('round', '\\operatorname{round}(#?)', 'round to nearest'),
      fn('Re', '\\operatorname{Re}(#?)', 'real part'),
      fn('Im', '\\operatorname{Im}(#?)', 'imaginary part'),
      key('i', { tooltip: 'imaginary unit' }), key('\\pi'),
      { class: 'separator w5' },
      key('1'), key('2'), key('3'), key('-'),
    ],
    [
      { latex: '\\frac{#?}{#?}' },
      { latex: '#?^{#?}', insert: '^{#?}', tooltip: 'power' },
      { latex: '#?_{#?}', insert: '_{#?}', tooltip: 'subscript' },
      { latex: '\\sqrt{#?}' },
      fn('|x|', '\\left|#?\\right|', 'absolute value'),
      key('e', { tooltip: "Euler's number" }),
      { class: 'separator w5' },
      key('0'), key('.'), key('+'),
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
      { label: '[backspace]', tooltip: 'backspace' },
    ],
  ],
};

/**
 * Dock the shared virtual keyboard inside `container` and keep it there.
 * MathLive exposes a single keyboard instance for the whole page.
 */
export function setupVirtualKeyboard(container, options = {}) {
  const keyboard = globalThis.mathVirtualKeyboard;
  if (!keyboard) return null;

  keyboard.container = container;
  keyboard.layouts = [CALCULATOR_LAYOUT, 'numeric', 'symbols', 'alphabetic', 'greek'];
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

    // `offsetTop + offsetHeight` is independent of the backdrop's bottom
    // anchoring. Using viewport coordinates here would include the dock height
    // itself and cause the dock to grow on every observation.
    const required = Math.ceil(plate.offsetTop + plate.offsetHeight);
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
  mf.keybindings = [...mf.keybindings, ...KEYBINDINGS];
  return mf;
}
