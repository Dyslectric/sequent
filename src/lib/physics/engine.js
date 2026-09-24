/**
 * The physics sheet: every line is a number with a dimension.
 *
 * Compute Engine reads the LaTeX, and nothing else. Before it does, every unit
 * group — `\mathrm{km/h}`, `\text{kg}`, `20^{\circ}C` — is parsed by
 * `units.js` and replaced by an opaque placeholder symbol, so that a sheet
 * variable called `m` can never be mistaken for the metre in `\mathrm{m/s}`.
 * The expression is then evaluated here, over pairs of (value in coherent SI,
 * dimension vector), which is what lets a line be refused for adding a length
 * to a time rather than quietly left unevaluated.
 *
 * Values are IEEE doubles. This sheet measures; the exact one next door
 * proves.
 */
import { ComputeEngine } from '@cortex-js/compute-engine';

import {
  DIMENSIONLESS,
  dimensionLatex,
  divideDimensions,
  isDimensionless,
  multiplyDimensions,
  parseUnitLatex,
  powerDimension,
  sameDimension,
  siUnitLatex,
} from './units.js';
import { CONSTANTS, constantBySymbol } from './constants.js';

const PLACEHOLDER = 'PHYSUNIT';
const PLACEHOLDER_PATTERN = new RegExp(`^${PLACEHOLDER}(\\d+)$`);

export class PhysicsError extends Error {}

/* ---------------------------- unit extraction ---------------------------- */

/** Index of the brace that closes the one opening at `open`, or -1. */
function matchingBrace(latex, open) {
  let depth = 0;
  for (let index = open; index < latex.length; index++) {
    const char = latex[index];
    if (char === '\\') {
      index++;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return index;
  }
  return -1;
}

const UNIT_GROUP = /^\\(?:mathrm|text|textrm)\s*\{/;

/**
 * An upright `d` is a differential, not a day: `\frac{\mathrm{d}}{\mathrm{d}t}`
 * and `\,\mathrm{d}x` would otherwise evaluate — as a ratio of days — and
 * come back with a confident, meaningless number.
 */
const UPRIGHT_DIFFERENTIAL = /\\frac\s*\{\s*\\mathrm\s*\{\s*d\s*\}|\\int/;

/**
 * The unit groups starting at `start`, as successively longer candidates.
 *
 * MathLive does not always keep upright text in one group: `µm` can come back
 * as `\mathrm{\mu}\mathrm{m}`, and a unit typed a piece at a time as
 * `\mathrm{m}/\mathrm{s}^{2}`. A group joins the run when it follows directly,
 * or after `/` or `\cdot`; an exponent right after a group belongs to it.
 * Returned longest first, each with the index just past it.
 */
function unitRun(source, start, isDefined) {
  const candidates = [];
  let content = '';
  let at = start;
  let joiner = '';
  for (;;) {
    const group = UNIT_GROUP.exec(source.slice(at));
    if (!group) break;
    const open = at + group[0].length - 1;
    const close = matchingBrace(source, open);
    if (close < 0) break;
    content += `${joiner}${source.slice(open + 1, close)}`;
    at = close + 1;
    const exponent = /^\^\s*(?:\{[^{}]*\}|-?\d)/.exec(source.slice(at));
    if (exponent) {
      content += exponent[0];
      at += exponent[0].length;
    }
    candidates.push({ content, end: at });
    const separator = /^(?:\s|\\,)*(\/|\\cdot\b)?(?:\s|\\,)*(?=\\(?:mathrm|text|textrm)\s*\{)/.exec(source.slice(at));
    if (!separator) {
      // MathLive leaves upright mode at `/`, so `km/h` typed after the km key
      // arrives as `\mathrm{km}/h`. A bare unit spelling after the slash
      // belongs to the unit — unless the sheet has a name spelled that way,
      // in which case `\mathrm{m}/t` is metres over a time.
      const bare = /^(?:\s|\\,)*\/(?:\s|\\,)*([A-Za-z]+)(\^\s*(?:\{[^{}]*\}|-?\d))?(?![A-Za-z_({])/.exec(source.slice(at));
      if (bare && !isDefined(bare[1]) && parseUnitLatex(bare[1])) {
        candidates.push({ content: `${content}/${bare[1]}${bare[2] ?? ''}`, end: at + bare[0].length });
      }
      break;
    }
    // Side by side is a product, `kg m`; `\mu m` is the one place a space
    // joins, and the unit parser already knows it.
    joiner = separator[1] === '/' ? '/' : separator[1] ? '\\cdot ' : ' ';
    at += separator[0].length;
  }
  return candidates.reverse();
}

/**
 * Replace each unit group in `latex` with a placeholder symbol.
 *
 * A group inside a subscript is a name, not a unit — `v_{\mathrm{max}}`,
 * `F_{\text{net}}` — and so is a group whose contents do not parse as a unit.
 * Both are copied through untouched for Compute Engine to read as it would.
 */
export function extractUnits(latex, isDefined = () => false) {
  const units = [];
  const placeholder = (unit) => {
    units.push(unit);
    return `\\operatorname{${PLACEHOLDER}${units.length - 1}}`;
  };

  // A degree sign outside any group: `30^{\circ}` is an angle, and
  // `20^{\circ}C` / `20^\circ\mathrm{F}` an absolute temperature.
  const source = latex.replace(
    /\^\s*(?:\{\s*\\circ\s*\}|\\circ)(?:\s*(?:\\(?:mathrm|text)\s*\{\s*([CF])\s*\}|([CF])(?![A-Za-z])))?/g,
    (_, braced, bare) => placeholder(parseUnitLatex(`°${braced ?? bare ?? ''}`)),
  );

  let out = '';
  // One entry per open brace: whether that group is a subscript.
  const subscript = [];
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const rest = source.slice(index);
    const inSubscript = subscript.at(-1) === true;

    if (char === '\\') {
      const group = UNIT_GROUP.exec(rest);
      const afterUnderscore = source[index - 1] === '_';
      if (group && !inSubscript && !afterUnderscore) {
        // The longest run of groups that reads as one unit wins, so
        // `\mathrm{m}/\mathrm{s}^{2}` is one unit (and is shown as one) rather
        // than a quotient of two.
        const run = unitRun(source, index, isDefined);
        const found = run.find((candidate) => parseUnitLatex(candidate.content));
        if (found) {
          out += placeholder(parseUnitLatex(found.content));
          index = found.end - 1;
          continue;
        }
      }
      // Copy the command, or the escaped character, whole.
      const command = /^\\(?:[a-zA-Z]+|.)/.exec(rest)[0];
      out += command;
      index += command.length - 1;
      continue;
    }
    if (char === '{') {
      const opensSubscript = source[index - 1] === '_' || (source[index - 1] === ' ' && /_\s*$/.test(source.slice(0, index)));
      subscript.push(opensSubscript || inSubscript);
    } else if (char === '}') {
      subscript.pop();
    }
    out += char;
  }
  return { latex: out, units };
}

/**
 * Split `expr \to unit` at its top-level arrow. The target is never evaluated;
 * it is a unit or nothing, so it is parsed as one directly — which lets it be
 * written `\to km/h` without the `\mathrm` an expression would need.
 */
export function splitConversion(latex) {
  let depth = 0;
  for (let index = 0; index < latex.length; index++) {
    const char = latex[index];
    if (char === '{') depth++;
    else if (char === '}') depth--;
    else if (char === '\\' && depth === 0) {
      const command = /^\\([a-zA-Z]+)/.exec(latex.slice(index))?.[1];
      if (command === 'to' || command === 'rightarrow' || command === 'longrightarrow') {
        return {
          expression: latex.slice(0, index).trim(),
          target: latex.slice(index + command.length + 1).trim(),
        };
      }
      if (command === 'left') depth++;
      if (command === 'right') depth--;
      if (command) index += command.length;
    }
  }
  return { expression: latex, target: null };
}

/* ------------------------------- quantities ------------------------------ */

/**
 * A value on the sheet: `value` in coherent SI, its dimension, and — when it
 * came from a unit the reader wrote — that unit, so `36\,\mathrm{km/h}` can be
 * shown as it was entered rather than as 10 m/s.
 */
function quantity(value, dim = DIMENSIONLESS, hint = null) {
  return { value, dim: [...dim], hint };
}

const number = (value) => quantity(value);

/** The value expressed in `unit`: undoes an offset scale where there is one. */
export function inUnit(q, unit) {
  return (q.value - (unit.offset ?? 0)) / unit.scale;
}

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', rho: 'ρ',
  sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

/** A MathJSON symbol as a reader would write it: `lambda_0` → `λ_0`. */
export function displayName(symbol) {
  return String(symbol).replace(/^([A-Za-z]+)(?=_|$)/, (name) => GREEK[name] ?? name)
    .replace(/_upright$/, '');
}

/** A MathJSON symbol as LaTeX, for a definition's badge and its tooltip. */
export function symbolLatex(symbol) {
  const [head, ...subscript] = String(symbol).replace(/_upright$/, '').split('_');
  const base = /^Δ/.test(head)
    ? `\\Delta ${symbolLatex(head.slice(1))}`
    : GREEK[head] ? `\\${head}` : head;
  return subscript.length ? `${base}_{${subscript.join('_')}}` : base;
}

/**
 * Tidy what Compute Engine hands back before evaluating it.
 *
 * `\Delta x` arrives as the product `Delta · x`, which is not what anyone
 * writing it means. Merge a `Delta` (or `delta`) with the symbol after it into
 * one name, wherever a product has them side by side.
 */
function normalize(json) {
  if (!Array.isArray(json)) return json;
  const [head, ...args] = json;
  // `\,` between two factors — `\frac{1}{3}\,\mathrm{km}` — is layout, and
  // arrives as a factor of its own.
  const normalized = args
    .filter((arg) => !(Array.isArray(arg) && arg[0] === 'HorizontalSpacing'))
    .map(normalize);
  if (head === 'InvisibleOperator' || head === 'Multiply') {
    const merged = [];
    for (let index = 0; index < normalized.length; index++) {
      const arg = normalized[index];
      const next = normalized[index + 1];
      if ((arg === 'Delta' || arg === 'delta') && typeof next === 'string' && !PLACEHOLDER_PATTERN.test(next)) {
        merged.push(`${arg === 'Delta' ? 'Δ' : 'δ'}${next}`);
        index++;
      } else {
        merged.push(arg);
      }
    }
    if (merged.length === 1) return merged[0];
    return [head, ...merged];
  }
  return [head, ...normalized];
}

/** Mathematical constants, as Compute Engine spells them non-canonically. */
const MATH_CONSTANTS = { Pi: Math.PI, pi: Math.PI, ExponentialE: Math.E, e: Math.E };

/** Functions of a pure number. Angles are pure numbers, radians by default. */
const DIMENSIONLESS_FUNCTIONS = {
  Sin: Math.sin, Cos: Math.cos, Tan: Math.tan,
  Sec: (x) => 1 / Math.cos(x), Csc: (x) => 1 / Math.sin(x), Cot: (x) => 1 / Math.tan(x),
  Arcsin: Math.asin, Arccos: Math.acos, Arctan: Math.atan,
  Sinh: Math.sinh, Cosh: Math.cosh, Tanh: Math.tanh,
  Arsinh: Math.asinh, Arcosh: Math.acosh, Artanh: Math.atanh,
  Exp: Math.exp, Ln: Math.log, Lb: Math.log2,
};

/** What a reader calls the heads the evaluator turns away. */
const UNSUPPORTED = {
  D: 'Derivatives', Derivative: 'Derivatives', Integrate: 'Integrals', Limit: 'Limits', Sum: 'Sums',
  Product: 'Products', Matrix: 'Matrices', Tuple: 'Tuples', List: 'Lists', Sequence: 'Lists',
};

/** Where one line's evaluation finds its symbols, and what it borrowed. */
class Scope {
  constructor(sheet, units) {
    this.sheet = sheet;
    this.units = units;
    this.undefinedNames = new Set();
    this.constantsUsed = new Set();
  }

  resolve(symbol) {
    const unitIndex = PLACEHOLDER_PATTERN.exec(symbol)?.[1];
    if (unitIndex !== undefined) {
      const unit = this.units[Number(unitIndex)];
      return quantity(unit.offset ? unit.scale + unit.offset : unit.scale, unit.dim, unit);
    }
    const defined = this.sheet.definitions.get(symbol);
    if (defined) return defined;
    const constant = constantBySymbol(symbol);
    if (constant) {
      this.constantsUsed.add(constant.id);
      return quantity(constant.value, constant.dim);
    }
    if (symbol in MATH_CONSTANTS) return number(MATH_CONSTANTS[symbol]);
    this.undefinedNames.add(displayName(symbol));
    return null;
  }
}

/** A unit placeholder on an offset scale, as `20` in `20^{\circ}C` needs it. */
function offsetUnitOf(json, scope) {
  const index = typeof json === 'string' ? PLACEHOLDER_PATTERN.exec(json)?.[1] : undefined;
  const unit = index === undefined ? null : scope.units[Number(index)];
  return unit?.offset ? unit : null;
}

function requireNumber(q, what) {
  if (!isDimensionless(q.dim)) {
    throw new PhysicsError(`${what} needs a pure number, not ${plainDimension(q.dim)}`);
  }
  return q.value;
}

/** A dimension in words-and-symbols, for an error message in plain text. */
function plainDimension(dim) {
  const unit = siUnitLatex(dim)
    .replace(/\\cdot\s*/g, '·')
    .replace(/\\Omega/g, 'Ω')
    .replace(/\^\{([^}]*)\}/g, '^$1');
  return unit ? `a quantity in ${unit}` : 'a pure number';
}

function evaluate(json, scope) {
  if (typeof json === 'number') return number(json);
  if (typeof json === 'string') {
    if (/^'.*'$/.test(json)) throw new PhysicsError('Text is only allowed as a unit or in a name');
    return scope.resolve(json);
  }
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    if ('num' in json) return number(Number(json.num));
    if ('sym' in json) return scope.resolve(json.sym);
    throw new PhysicsError('Unreadable expression');
  }
  if (!Array.isArray(json)) throw new PhysicsError('Unreadable expression');

  const [head, ...args] = json;
  const all = () => args.map((arg) => evaluate(arg, scope));
  const pending = (values) => values.some((value) => value === null);

  switch (head) {
    case 'Error':
      throw new PhysicsError('Could not read this line');
    case 'Delimiter': {
      if (args.length !== 1 || (Array.isArray(args[0]) && args[0][0] === 'Sequence')) {
        throw new PhysicsError('A list is not a quantity');
      }
      return evaluate(args[0], scope);
    }
    case 'Rational': {
      const [p, q] = all();
      if (pending([p, q])) return null;
      return number(p.value / q.value);
    }
    case 'Negate': {
      const [value] = all();
      if (!value) return null;
      if (value.hint?.offset) throw new PhysicsError('An absolute temperature cannot be negated; write a difference in K');
      return quantity(-value.value, value.dim, value.hint);
    }
    case 'Add':
    case 'Subtract': {
      const values = all();
      if (pending(values)) return null;
      const [first] = values;
      for (const value of values.slice(1)) {
        if (!sameDimension(first.dim, value.dim)) {
          throw new PhysicsError(`Cannot ${head === 'Add' ? 'add' : 'subtract'} ${plainDimension(value.dim)} ${head === 'Add' ? 'to' : 'from'} ${plainDimension(first.dim)}`);
        }
      }
      const absolute = values.filter((value) => value.hint?.offset);
      let total = first.value;
      for (const [index, value] of values.slice(1).entries()) {
        // The Subtract head has exactly two operands; Add holds its negated
        // terms as `Negate`, which is where a sign enters.
        total = head === 'Subtract' && index === 0 ? total - value.value : total + value.value;
      }
      if (absolute.length === 2 && head === 'Subtract' && values.every((value) => value.hint?.offset)) {
        // The difference of two readings is a temperature interval, in kelvin.
        return quantity(total, first.dim);
      }
      if (absolute.length > 1) throw new PhysicsError('Two absolute temperatures do not add; subtract them, or add an interval in K');
      if (absolute.length === 1) {
        // Reading + interval is a reading on the same scale.
        return quantity(total, first.dim, absolute[0].hint);
      }
      const hint = values.every((value) => value.hint && value.hint.latex === first.hint?.latex) ? first.hint : null;
      return quantity(total, first.dim, hint);
    }
    case 'Multiply':
    case 'InvisibleOperator': {
      // `20^{\circ}C` is a number times an offset unit, and means a reading on
      // that scale rather than twenty times one.
      const offsetAt = args.findIndex((arg) => offsetUnitOf(arg, scope));
      if (offsetAt >= 0) {
        const unit = offsetUnitOf(args[offsetAt], scope);
        const rest = args.filter((_, index) => index !== offsetAt);
        const factor = rest.length ? evaluate(rest.length === 1 ? rest[0] : ['Multiply', ...rest], scope) : number(1);
        if (!factor) return null;
        if (!isDimensionless(factor.dim) || factor.hint) {
          throw new PhysicsError('An absolute temperature cannot be one factor of a product; convert it to K first');
        }
        return quantity(factor.value * unit.scale + unit.offset, unit.dim, unit);
      }
      const values = all();
      if (pending(values)) return null;
      return values.reduce(multiply);
    }
    case 'Divide': {
      const [top, bottom] = all();
      if (pending([top, bottom])) return null;
      if (top.hint?.offset || bottom.hint?.offset) {
        // Dividing by a number keeps the reading on its own scale only when it
        // is a plain rescaling, which for an offset scale it never is.
        return quantity(top.value / bottom.value, divideDimensions(top.dim, bottom.dim));
      }
      const hint = top.hint && isDimensionless(bottom.dim) && !bottom.hint ? top.hint : null;
      return quantity(top.value / bottom.value, divideDimensions(top.dim, bottom.dim), hint);
    }
    case 'Power': {
      const [baseJson, exponentJson] = args;
      if (baseJson === 'e' || baseJson === 'ExponentialE') {
        if (!scope.sheet.definitions.has('e')) {
          const exponent = evaluate(exponentJson, scope);
          if (!exponent) return null;
          return number(Math.exp(requireNumber(exponent, 'An exponential')));
        }
      }
      const [base, exponent] = all();
      if (pending([base, exponent])) return null;
      return power(base, requireNumber(exponent, 'An exponent'));
    }
    case 'Square': {
      const [base] = all();
      return base && power(base, 2);
    }
    case 'Sqrt': {
      const [base] = all();
      return base && power(base, 1 / 2);
    }
    case 'Root': {
      const [base, index] = all();
      if (pending([base, index])) return null;
      return power(base, 1 / requireNumber(index, 'A root index'));
    }
    case 'Abs': {
      const [value] = all();
      if (!value) return null;
      return quantity(Math.abs(value.value), value.dim, value.hint);
    }
    case 'Log': {
      const [value, base] = all();
      if (pending([value, base ?? number(10)])) return null;
      const x = requireNumber(value, 'A logarithm');
      return number(base ? Math.log(x) / Math.log(requireNumber(base, 'A logarithm base')) : Math.log10(x));
    }
    case 'Floor':
    case 'Ceil':
    case 'Round': {
      const [value] = all();
      if (!value) return null;
      const fn = { Floor: Math.floor, Ceil: Math.ceil, Round: Math.round }[head];
      return number(fn(requireNumber(value, head === 'Floor' ? 'Floor' : head === 'Ceil' ? 'Ceiling' : 'Rounding')));
    }
    case 'Max':
    case 'Min': {
      const values = all();
      if (pending(values)) return null;
      for (const value of values) {
        if (!sameDimension(value.dim, values[0].dim)) throw new PhysicsError(`Cannot compare ${plainDimension(value.dim)} with ${plainDimension(values[0].dim)}`);
      }
      const pick = values.reduce((best, value) => ((head === 'Max' ? value.value > best.value : value.value < best.value) ? value : best));
      return pick;
    }
    case 'Arctan2': {
      const [y, x] = all();
      if (pending([y, x])) return null;
      if (!sameDimension(y.dim, x.dim)) throw new PhysicsError('The two sides of an angle need the same dimension');
      return number(Math.atan2(y.value, x.value));
    }
    default: {
      const fn = DIMENSIONLESS_FUNCTIONS[head];
      if (fn && args.length === 1) {
        const [value] = all();
        if (!value) return null;
        return number(fn(requireNumber(value, `${head.toLowerCase()}`)));
      }
      throw new PhysicsError(`${UNSUPPORTED[head] ?? head} ${UNSUPPORTED[head] ? 'are' : 'is'} not something the physics sheet evaluates`);
    }
  }
}

function multiply(a, b) {
  if (a.hint?.offset || b.hint?.offset) {
    // An absolute temperature used as a factor — `nRT` — is its kelvin value,
    // which is what every such law wants.
    return quantity(a.value * b.value, multiplyDimensions(a.dim, b.dim));
  }
  const aPlain = isDimensionless(a.dim) && !a.hint;
  const bPlain = isDimensionless(b.dim) && !b.hint;
  const hint = (aPlain && b.hint) || (bPlain && a.hint) || null;
  return quantity(a.value * b.value, multiplyDimensions(a.dim, b.dim), hint);
}

function power(base, exponent) {
  if (base.hint?.offset && exponent !== 1) {
    return quantity(base.value ** exponent, powerDimension(base.dim, exponent));
  }
  return quantity(base.value ** exponent, powerDimension(base.dim, exponent), exponent === 1 ? base.hint : null);
}

/* -------------------------------- display -------------------------------- */

/**
 * A double to `digits` significant figures, as LaTeX: plain between 10⁻³ and
 * 10⁶, and `a\times10^{b}` outside that. Trailing zeros are dropped — they
 * would claim a precision the inputs never had.
 */
export function formatNumber(x, digits) {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? '\\mathrm{NaN}' : (x > 0 ? '\\infty' : '-\\infty');
  if (x === 0) return '0';
  const sign = x < 0 ? '-' : '';
  const rounded = Number(Math.abs(x).toPrecision(digits));
  const exponent = Math.floor(Math.log10(rounded));
  const trim = (text) => (text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text);
  if (exponent >= -3 && exponent < 6) {
    const text = exponent >= digits ? String(rounded) : trim(rounded.toPrecision(digits));
    return `${sign}${text}`;
  }
  const mantissa = trim((rounded / 10 ** exponent).toPrecision(digits));
  return `${sign}${mantissa}\\times10^{${exponent}}`;
}

/** Number and unit as LaTeX; a degree sign sits tight against its number. */
function quantityLatex(value, unitLatex, digits) {
  const numberLatex = formatNumber(value, digits);
  if (!unitLatex) return numberLatex;
  if (unitLatex.startsWith('{}^{\\circ}')) return `${numberLatex}\\mathrm{${unitLatex}}`;
  return `${numberLatex}\\,\\mathrm{${unitLatex}}`;
}

/**
 * The primary and secondary LaTeX of a quantity: in the unit it was entered
 * in (or asked for) when there is one, with coherent SI beside it; in SI alone
 * otherwise.
 */
export function describeQuantity(q, digits, target = null) {
  const si = quantityLatex(q.value, siUnitLatex(q.dim), digits);
  const unit = target ?? (q.hint && sameDimension(q.hint.dim, q.dim) ? q.hint : null);
  if (!unit) return { latex: si, secondaryLatex: null };
  const shown = quantityLatex(inUnit(q, unit), unit.latex === '1' ? '' : unit.latex, digits);
  return { latex: shown, secondaryLatex: shown === si ? null : si };
}

/* ------------------------------ statements ------------------------------- */

const RELATIONS = {
  Equal: '=', NotEqual: '\\ne', Less: '<', LessEqual: '\\le', Greater: '>', GreaterEqual: '\\ge', Approx: '\\approx',
};

/** How far apart two values may be and still be called one number. */
const EXACT_TOLERANCE = 1e-12;
const APPROX_TOLERANCE = 0.01;

function relativeDifference(a, b) {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale === 0 ? 0 : Math.abs(a - b) / scale;
}

/** A symbol a definition could bind: a plain name, not a unit or a constant spelled as a command. */
function bindableName(json) {
  if (typeof json !== 'string') return null;
  if (PLACEHOLDER_PATTERN.test(json) || /^'.*'$/.test(json)) return null;
  if (json in MATH_CONSTANTS) return null;
  return json;
}

export class PhysicsSheet {
  constructor(options = {}) {
    this.ce = new ComputeEngine();
    this.digits = options.digits ?? 4;
    this.reset();
  }

  reset() {
    /** Names defined so far, each to a quantity. */
    this.definitions = new Map();
  }

  evaluateAll(lines) {
    this.reset();
    return lines.map((line) => {
      try {
        return this.evaluateLine(line);
      } catch (error) {
        return { kind: 'error', message: error instanceof PhysicsError ? error.message : `Could not evaluate: ${error?.message ?? error}` };
      }
    });
  }

  parse(latex, units) {
    const json = normalize(this.ce.parse(latex, { canonical: false }).json);
    if (JSON.stringify(json).includes('"Error"')) throw new PhysicsError('Could not read this line');
    return { json, units };
  }

  evaluateLine(rawLatex) {
    const latex = String(rawLatex ?? '')
      .replace(/\\mathrel\{\\coloneq\}|\\coloneq/g, ':=')
      .trim();
    if (!latex) return { kind: 'empty' };

    const { expression, target: targetLatex } = splitConversion(latex);
    let target = null;
    if (targetLatex !== null) {
      target = parseUnitLatex(targetLatex);
      if (!target) throw new PhysicsError(`${targetLatex || 'Nothing'} is not a unit this sheet knows`);
    }
    if (!expression) throw new PhysicsError('Nothing to convert');
    if (UPRIGHT_DIFFERENTIAL.test(expression)) {
      throw new PhysicsError('Derivatives and integrals are not something the physics sheet evaluates');
    }

    const { latex: prepared, units } = extractUnits(expression, (name) => this.definitions.has(name));
    const { json } = this.parse(prepared, units);
    const scope = new Scope(this, units);

    const head = Array.isArray(json) ? json[0] : null;
    const forced = head === 'Assign';
    if (forced || (head === 'Equal' && json.length === 3 && bindableName(json[1]) && !this.definitions.has(json[1]))) {
      return this.define(json, scope, target, forced);
    }
    if (head in RELATIONS) return this.claim(json, scope);

    const value = evaluate(json, scope);
    if (!value) return this.symbolic(scope);
    if (target && !sameDimension(target.dim, value.dim)) {
      throw new PhysicsError(`Cannot convert ${plainDimension(value.dim)} to ${plainDimension(target.dim)}`);
    }
    const shown = describeQuantity(value, this.digits, target);
    return {
      kind: 'value',
      ...shown,
      dimensionLatex: dimensionLatex(value.dim),
      constantsUsed: [...scope.constantsUsed],
    };
  }

  symbolic(scope) {
    const names = [...scope.undefinedNames];
    return {
      kind: 'symbolic',
      undefinedNames: names,
      constantsUsed: [...scope.constantsUsed],
    };
  }

  define(json, scope, target, forced) {
    const name = bindableName(json[1]);
    if (!name) throw new PhysicsError(forced ? 'Only a name can be defined' : 'Could not read this line');
    let value = evaluate(json[2], scope);
    if (!value) return this.symbolic(scope);
    if (target) {
      if (!sameDimension(target.dim, value.dim)) {
        throw new PhysicsError(`Cannot convert ${plainDimension(value.dim)} to ${plainDimension(target.dim)}`);
      }
      value = { ...value, hint: target };
    }
    // `\Delta T = 10^{\circ}C` names a change, and a change of 10 °C is 10 K.
    // Anywhere else an offset scale is a reading.
    if (value.hint?.offset && /^[Δδ]/.test(name)) {
      value = quantity(value.value - value.hint.offset, value.dim, { ...value.hint, offset: 0 });
    }
    this.definitions.set(name, value);
    const shown = describeQuantity(value, this.digits);
    const constant = constantBySymbol(name);
    return {
      kind: 'definition',
      name: displayName(name),
      nameLatex: symbolLatex(name),
      valueLatex: shown.latex,
      secondaryLatex: shown.secondaryLatex,
      dimensionLatex: dimensionLatex(value.dim),
      overrides: constant ? constant.id : null,
      constantsUsed: [...scope.constantsUsed],
    };
  }

  claim(json, scope) {
    const [head, ...sides] = json;
    const values = sides.map((side) => evaluate(side, scope));
    const base = { kind: 'truth', constantsUsed: [...scope.constantsUsed] };
    if (values.some((value) => value === null)) {
      return { ...base, value: null, note: `undecided for ${[...scope.undefinedNames].join(', ')}`, undefinedNames: [...scope.undefinedNames] };
    }
    for (const value of values.slice(1)) {
      if (!sameDimension(value.dim, values[0].dim)) {
        return {
          ...base,
          value: false,
          note: 'dimensions differ',
          detailLatex: `${dimensionLatex(values[0].dim)}\\ \\text{vs}\\ ${dimensionLatex(value.dim)}`,
        };
      }
    }

    const verdicts = [];
    for (let index = 1; index < values.length; index++) {
      verdicts.push(this.compare(head, values[index - 1], values[index]));
    }
    const failed = verdicts.find((verdict) => !verdict.value);
    const verdict = failed ?? verdicts.at(-1);
    return { ...base, ...verdict };
  }

  compare(head, left, right) {
    const a = left.value;
    const b = right.value;
    const difference = relativeDifference(a, b);
    const exact = difference <= EXACT_TOLERANCE;
    // Within the precision the sheet is showing — the same thing as the two
    // sides printing identically.
    const shownEqual = formatNumber(a, this.digits) === formatNumber(b, this.digits);
    const pair = () => `${describeQuantity(left, this.digits).latex}\\ \\text{vs}\\ ${describeQuantity(right, this.digits).latex}`;

    switch (head) {
      case 'Equal':
        if (exact) return { value: true, note: 'equal' };
        if (shownEqual) return { value: true, note: `equal to ${this.digits} significant figures` };
        return { value: false, note: 'not equal', detailLatex: pair() };
      case 'NotEqual':
        return exact ? { value: false, note: 'equal' } : { value: true, note: 'not equal' };
      case 'Approx': {
        const percent = formatNumber(difference * 100, 2);
        return difference <= APPROX_TOLERANCE
          ? { value: true, note: exact ? 'equal' : `within ${percent}%` }
          : { value: false, note: `differ by ${percent}%`, detailLatex: pair() };
      }
      case 'Less': return { value: a < b && !exact, note: exact ? 'equal' : a < b ? 'less' : 'not less', detailLatex: a < b ? null : pair() };
      case 'LessEqual': return { value: a <= b || exact, note: exact ? 'equal' : a < b ? 'less' : 'greater', detailLatex: a <= b || exact ? null : pair() };
      case 'Greater': return { value: a > b && !exact, note: exact ? 'equal' : a > b ? 'greater' : 'not greater', detailLatex: a > b ? null : pair() };
      case 'GreaterEqual': return { value: a >= b || exact, note: exact ? 'equal' : a > b ? 'greater' : 'less', detailLatex: a >= b || exact ? null : pair() };
      default: return { value: null, note: 'undecided' };
    }
  }
}

export { CONSTANTS };
