/**
 * Units for the physics sheet: a table, a parser for what a reader writes
 * inside `\mathrm{…}`, and the choice of unit a result is shown in.
 *
 * Compute Engine has a units library of its own, and the physics page does not
 * use it. It drops the unit from `\frac{1}{3}\,\mathrm{km}` and
 * `\sqrt{2}\,\mathrm{m}` (both come back as a bare symbol), `\mathrm{m}` in a
 * unit is rewritten by a sheet variable called `m`, `|{-2}\,\mathrm{m}|` is an
 * error, and a comparison between incompatible units is left standing rather
 * than refused. A unit here is a scale and a dimension, nothing more, and the
 * arithmetic on them is a dozen lines — small enough to be sure of.
 *
 * Every value is held in coherent SI. A dimension is the exponent vector over
 * the seven SI base quantities, in this order:
 */
export const BASE_DIMENSIONS = ['L', 'M', 'T', 'I', 'Θ', 'N', 'J'];

/** The base unit of each dimension, in the same order, as it is written. */
const BASE_UNITS = ['m', 'kg', 's', 'A', 'K', 'mol', 'cd'];

const D = (L = 0, M = 0, T = 0, I = 0, Θ = 0, N = 0, J = 0) => [L, M, T, I, Θ, N, J];

export const DIMENSIONLESS = Object.freeze(D());

/**
 * Units by symbol. `prefix` marks the ones that take an SI prefix; it is
 * deliberately off for anything where a prefixed spelling would collide with
 * another unit (`min` is not milli-inch, `Pa` is not peta-year) or would never
 * be written.
 *
 * `latex` is how the symbol is set inside `\mathrm{}` when it is not simply
 * its own name.
 */
const UNIT_TABLE = {
  // SI base. The gram carries the prefixes; the kilogram is kilo + gram.
  m: { dim: D(1), scale: 1, prefix: true },
  g: { dim: D(0, 1), scale: 1e-3, prefix: true },
  s: { dim: D(0, 0, 1), scale: 1, prefix: true },
  A: { dim: D(0, 0, 0, 1), scale: 1, prefix: true },
  K: { dim: D(0, 0, 0, 0, 1), scale: 1, prefix: true },
  mol: { dim: D(0, 0, 0, 0, 0, 1), scale: 1, prefix: true },
  cd: { dim: D(0, 0, 0, 0, 0, 0, 1), scale: 1, prefix: true },

  // Named SI derived units.
  Hz: { dim: D(0, 0, -1), scale: 1, prefix: true },
  N: { dim: D(1, 1, -2), scale: 1, prefix: true },
  Pa: { dim: D(-1, 1, -2), scale: 1, prefix: true },
  J: { dim: D(2, 1, -2), scale: 1, prefix: true },
  W: { dim: D(2, 1, -3), scale: 1, prefix: true },
  C: { dim: D(0, 0, 1, 1), scale: 1, prefix: true },
  V: { dim: D(2, 1, -3, -1), scale: 1, prefix: true },
  F: { dim: D(-2, -1, 4, 2), scale: 1, prefix: true },
  Ω: { dim: D(2, 1, -3, -2), scale: 1, prefix: true, latex: '\\Omega' },
  S: { dim: D(-2, -1, 3, 2), scale: 1, prefix: true },
  Wb: { dim: D(2, 1, -2, -1), scale: 1, prefix: true },
  T: { dim: D(0, 1, -2, -1), scale: 1, prefix: true },
  H: { dim: D(2, 1, -2, -2), scale: 1, prefix: true },
  lm: { dim: D(0, 0, 0, 0, 0, 0, 1), scale: 1, prefix: true },
  lx: { dim: D(-2, 0, 0, 0, 0, 0, 1), scale: 1, prefix: true },
  Bq: { dim: D(0, 0, -1), scale: 1, prefix: true },
  Gy: { dim: D(2, 0, -2), scale: 1, prefix: true },
  Sv: { dim: D(2, 0, -2), scale: 1, prefix: true },
  kat: { dim: D(0, 0, -1, 0, 0, 1), scale: 1, prefix: true },

  // Angles are dimensionless; a degree is simply the number π/180.
  rad: { dim: D(), scale: 1, prefix: true },
  sr: { dim: D(), scale: 1 },
  deg: { dim: D(), scale: Math.PI / 180, latex: '{}^{\\circ}' },
  '°': { dim: D(), scale: Math.PI / 180, latex: '{}^{\\circ}' },
  arcmin: { dim: D(), scale: Math.PI / 10800 },
  arcsec: { dim: D(), scale: Math.PI / 648000 },
  rev: { dim: D(), scale: 2 * Math.PI },
  rpm: { dim: D(0, 0, -1), scale: (2 * Math.PI) / 60 },
  '%': { dim: D(), scale: 0.01, latex: '\\%' },

  // Time.
  min: { dim: D(0, 0, 1), scale: 60 },
  h: { dim: D(0, 0, 1), scale: 3600 },
  d: { dim: D(0, 0, 1), scale: 86400 },
  wk: { dim: D(0, 0, 1), scale: 604800 },
  // The Julian year: the one light-years and astronomy are defined against.
  yr: { dim: D(0, 0, 1), scale: 31557600 },

  // Length, area, volume.
  Å: { dim: D(1), scale: 1e-10, latex: '\\mathring{A}' },
  au: { dim: D(1), scale: 149597870700 },
  ly: { dim: D(1), scale: 9460730472580800 },
  pc: { dim: D(1), scale: 3.0856775814913673e16, prefix: true },
  in: { dim: D(1), scale: 0.0254 },
  ft: { dim: D(1), scale: 0.3048 },
  yd: { dim: D(1), scale: 0.9144 },
  mi: { dim: D(1), scale: 1609.344 },
  nmi: { dim: D(1), scale: 1852 },
  ha: { dim: D(2), scale: 1e4 },
  L: { dim: D(3), scale: 1e-3, prefix: true },
  gal: { dim: D(3), scale: 3.785411784e-3 },

  // Mass.
  t: { dim: D(0, 1), scale: 1000 },
  u: { dim: D(0, 1), scale: 1.66053906660e-27 },
  Da: { dim: D(0, 1), scale: 1.66053906660e-27, prefix: true },
  lb: { dim: D(0, 1), scale: 0.45359237 },
  oz: { dim: D(0, 1), scale: 0.028349523125 },

  // Speed.
  mph: { dim: D(1, 0, -1), scale: 0.44704 },
  kn: { dim: D(1, 0, -1), scale: 1852 / 3600 },

  // Force, pressure, energy, power.
  lbf: { dim: D(1, 1, -2), scale: 4.4482216152605 },
  dyn: { dim: D(1, 1, -2), scale: 1e-5 },
  atm: { dim: D(-1, 1, -2), scale: 101325 },
  bar: { dim: D(-1, 1, -2), scale: 1e5, prefix: true },
  Torr: { dim: D(-1, 1, -2), scale: 101325 / 760 },
  mmHg: { dim: D(-1, 1, -2), scale: 133.322387415 },
  psi: { dim: D(-1, 1, -2), scale: 6894.757293168361 },
  eV: { dim: D(2, 1, -2), scale: 1.602176634e-19, prefix: true },
  cal: { dim: D(2, 1, -2), scale: 4.184, prefix: true },
  Wh: { dim: D(2, 1, -2), scale: 3600, prefix: true },
  erg: { dim: D(2, 1, -2), scale: 1e-7 },
  hp: { dim: D(2, 1, -3), scale: 745.6998715822702 },

  // Magnetism.
  G: { dim: D(0, 1, -2, -1), scale: 1e-4 },

  // Absolute temperatures on offset scales: kelvin = scale × value + offset.
  // They are only meaningful attached to a number or as a conversion target;
  // anywhere else — `\mathrm{°C}` squared, say — the offset is refused.
  '°C': { dim: D(0, 0, 0, 0, 1), scale: 1, offset: 273.15, latex: '{}^{\\circ}C' },
  '°F': { dim: D(0, 0, 0, 0, 1), scale: 5 / 9, offset: 459.67 * (5 / 9), latex: '{}^{\\circ}F' },
};

/** Spellings that mean a unit in the table. */
const ALIASES = {
  ohm: 'Ω', Ohm: 'Ω', degC: '°C', degF: '°F', Angstrom: 'Å', AU: 'au', y: 'yr', a: 'yr',
  sec: 's', hr: 'h', day: 'd', l: 'L', amu: 'u', knot: 'kn', percent: '%',
};

const PREFIXES = {
  Q: 1e30, R: 1e27, Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 1e1,
  d: 1e-1, c: 1e-2, m: 1e-3, µ: 1e-6, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18, z: 1e-21, y: 1e-24,
  r: 1e-27, q: 1e-30,
};

const PREFIX_LATEX = { µ: '\\mu ', u: '\\mu ' };

/** One unit symbol — `km`, `µF`, `°C` — or null when it is not one. */
export function lookupUnitSymbol(symbol) {
  const direct = UNIT_TABLE[symbol] ?? UNIT_TABLE[ALIASES[symbol]];
  if (direct) {
    const name = UNIT_TABLE[symbol] ? symbol : ALIASES[symbol];
    return { ...direct, dim: [...direct.dim], latex: direct.latex ?? name };
  }
  // Longest prefix first, so `da` is tried before `d`.
  for (const prefix of Object.keys(PREFIXES).sort((a, b) => b.length - a.length)) {
    if (!symbol.startsWith(prefix) || symbol.length === prefix.length) continue;
    const baseName = symbol.slice(prefix.length);
    const base = UNIT_TABLE[baseName] ?? UNIT_TABLE[ALIASES[baseName]];
    if (!base?.prefix) continue;
    const canonical = UNIT_TABLE[baseName] ? baseName : ALIASES[baseName];
    return {
      dim: [...base.dim],
      scale: PREFIXES[prefix] * base.scale,
      latex: `${PREFIX_LATEX[prefix] ?? prefix}${base.latex ?? canonical}`,
    };
  }
  return null;
}

/* ------------------------------ dimensions ------------------------------ */

export function sameDimension(a, b) {
  return a.every((exponent, index) => Math.abs(exponent - b[index]) < 1e-9);
}

export function isDimensionless(dim) {
  return sameDimension(dim, DIMENSIONLESS);
}

export function multiplyDimensions(a, b) {
  return a.map((exponent, index) => exponent + b[index]);
}

export function divideDimensions(a, b) {
  return a.map((exponent, index) => exponent - b[index]);
}

export function powerDimension(a, power) {
  return a.map((exponent) => exponent * power);
}

/** An integer exponent, or a fraction for half-integer ones, as LaTeX. */
function exponentLatex(exponent) {
  if (Number.isInteger(exponent)) return String(exponent);
  const twice = exponent * 2;
  if (Number.isInteger(twice)) return `${twice}/2`;
  return String(Number(exponent.toFixed(4)));
}

/** `L T^{-1}` — for telling a reader why two things will not add. */
export function dimensionLatex(dim) {
  const parts = BASE_DIMENSIONS.flatMap((name, index) => {
    const exponent = dim[index];
    if (Math.abs(exponent) < 1e-9) return [];
    const symbol = `\\mathsf{${name}}`;
    return [exponent === 1 ? symbol : `${symbol}^{${exponentLatex(exponent)}}`];
  });
  return parts.length ? parts.join('\\,') : '1';
}

/* -------------------------------- parsing -------------------------------- */

/**
 * The inside of a `\mathrm{…}` group, as a unit — `km/h`, `kg\cdot m^2/s^2`,
 * `\mu F`, `^{\circ}C` — or null when it is not one, which is how
 * `F_{\text{net}}` keeps its name.
 *
 * Grammar: product := factor (('·' | '/' | space) factor)*, where `/` binds
 * only the factor after it (`J/kg K` is J/(kg·K), the usual reading) unless
 * that factor is parenthesised.
 */
export function parseUnitLatex(source) {
  const tokens = tokenizeUnit(source);
  if (!tokens || !tokens.length) return null;
  let at = 0;

  const peek = () => tokens[at];
  const next = () => tokens[at++];

  function parseFactor() {
    const token = next();
    if (!token) return null;
    let unit;
    if (token.type === '(') {
      unit = parseProduct();
      if (!unit || next()?.type !== ')') return null;
      unit = { ...unit, latex: `(${unit.latex})` };
    } else if (token.type === 'name') {
      unit = lookupUnitSymbol(token.value);
      if (!unit) return null;
    } else if (token.type === 'number' && token.value === '1') {
      unit = { dim: [...DIMENSIONLESS], scale: 1, latex: '1' };
    } else {
      return null;
    }
    if (peek()?.type === '^') {
      next();
      const power = next();
      if (power?.type !== 'number') return null;
      const exponent = Number(power.value);
      if (!Number.isFinite(exponent)) return null;
      if (unit.offset) return null;
      unit = {
        dim: powerDimension(unit.dim, exponent),
        scale: unit.scale ** exponent,
        latex: `${unit.latex}^{${power.value}}`,
      };
    }
    return unit;
  }

  function parseProduct() {
    let unit = parseFactor();
    if (!unit) return null;
    while (peek() && peek().type !== ')') {
      const token = peek();
      let dividing = false;
      if (token.type === '/') {
        next();
        dividing = true;
      } else if (token.type === '*') {
        next();
      }
      const factor = parseFactor();
      if (!factor) return null;
      // An offset scale means an absolute temperature, which cannot be one
      // factor of a compound unit.
      if (unit.offset || factor.offset) return null;
      unit = dividing
        ? {
          dim: divideDimensions(unit.dim, factor.dim),
          scale: unit.scale / factor.scale,
          latex: `${unit.latex}/${factor.latex}`,
        }
        : {
          dim: multiplyDimensions(unit.dim, factor.dim),
          scale: unit.scale * factor.scale,
          latex: `${unit.latex}\\cdot ${factor.latex}`,
        };
    }
    return unit;
  }

  const unit = parseProduct();
  if (!unit || at !== tokens.length) return null;
  return unit;
}

/** LaTeX commands a unit may be spelt with, and what each stands for. */
const UNIT_COMMANDS = {
  '\\mu': 'µ', '\\micro': 'µ', '\\Omega': 'Ω', '\\ohm': 'Ω', '\\circ': '°', '\\degree': '°',
  '\\AA': 'Å', '\\angstrom': 'Å', '\\%': '%', '\\cdot': '*', '\\times': '*', '\\,': ' ',
  '\\;': ' ', '\\:': ' ', '\\ ': ' ', '\\!': '',
};

function tokenizeUnit(source) {
  let text = String(source)
    // `\mathring{A}` is how MathLive and most people write Å.
    .replace(/\\mathring\s*\{\s*A\s*\}/g, 'Å')
    .replace(/\\(?:mathrm|text|textrm|operatorname|mathit)\s*\{([^{}]*)\}/g, '$1')
    // `\frac{a}{b}` inside a unit group: rewrite to (a)/(b).
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
    // An empty group is only an anchor, as in `{}^{\circ}C`.
    .replace(/\{\s*\}/g, '')
    .replace(/\\[a-zA-Z]+|\\[,;: !%]/g, (command) => (command in UNIT_COMMANDS ? UNIT_COMMANDS[command] : `\u0000${command}`))
    .replace(/μ/g, 'µ')
    // `\mu m` is written with a space only because `\mum` would be one command.
    .replace(/µ\s+/g, 'µ')
    .replace(/Ω/g, 'Ω')
    .replace(/·|⋅/g, '*');
  if (text.includes('\u0000')) return null;
  // A degree sign written as a superscript: `^{\circ}C`, `^\circ C`.
  text = text.replace(/\^\s*\{\s*°\s*\}|\^\s*°/g, '°');
  // A lone ° followed by C or F is one symbol.
  text = text.replace(/°\s*([CF])(?![A-Za-z])/g, '°$1');

  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s|~/.test(char)) {
      index++;
      // Whitespace between two factors is a product.
      const last = tokens.at(-1);
      if (last && (last.type === 'name' || last.type === ')' || last.type === 'number')) {
        tokens.push({ type: 'space' });
      }
      continue;
    }
    if ('()/*^'.includes(char) || char === '{' || char === '}') {
      if (char === '{' || char === '}') {
        // Braces only group an exponent; the exponent reader consumes them.
        return null;
      }
      tokens.push({ type: char === '*' ? '*' : char });
      index++;
      if (char === '^') {
        // An exponent: `^2`, `^{-2}`, `^{1/2}`.
        const braced = /^\{\s*(-?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s*\}/.exec(text.slice(index));
        const bare = /^(-?\d)/.exec(text.slice(index));
        const match = braced ?? bare;
        if (!match) return null;
        const raw = match[1].replace(/\s+/g, '');
        const [num, den] = raw.split('/');
        tokens.push({ type: 'number', value: den ? String(Number(num) / Number(den)) : raw });
        index += match[0].length;
      }
      continue;
    }
    const name = /^(?:[A-Za-zµΩÅ°%]+)/.exec(text.slice(index));
    if (name) {
      tokens.push({ type: 'name', value: name[0] });
      index += name[0].length;
      continue;
    }
    const number = /^\d+/.exec(text.slice(index));
    if (number) {
      tokens.push({ type: 'number', value: number[0] });
      index += number[0].length;
      continue;
    }
    return null;
  }
  // Collapse the space tokens: a space before an operator or at the end is
  // layout, and a space between two factors is a product.
  const collapsed = [];
  tokens.forEach((token, position) => {
    if (token.type !== 'space') {
      collapsed.push(token);
      return;
    }
    const after = tokens[position + 1];
    if (after && (after.type === 'name' || after.type === '(' || after.type === 'number')) {
      collapsed.push({ type: '*' });
    }
  });
  // A space before `/` or `^` was pushed and then dropped; a `*` directly
  // before `/` would be two operators, so drop the `*`.
  return collapsed.filter((token, position) => !(token.type === '*' && ['/', '^', ')'].includes(collapsed[position + 1]?.type)));
}

/* ------------------------------- display --------------------------------- */

/**
 * Named units a result may be shown in, most preferred first. Hz and Bq are
 * absent on purpose: an angular velocity is s⁻¹ as well, and calling it hertz
 * would be a claim the arithmetic cannot make.
 */
const NAMED_DISPLAY = ['N', 'J', 'W', 'Pa', 'C', 'V', 'Ω', 'F', 'T', 'Wb', 'H', 'S'];

/** A coherent SI unit written as base units, split into numerator and denominator. */
function baseUnitLatex(dim, leading = null) {
  const numerator = leading ? [leading] : [];
  const denominator = [];
  // Mass first: `kg\cdot m/s`, as momentum is written.
  [1, 0, 2, 3, 4, 5, 6].forEach((index) => {
    const symbol = BASE_UNITS[index];
    const exponent = dim[index];
    if (Math.abs(exponent) < 1e-9) return;
    const magnitude = Math.abs(exponent);
    const text = magnitude === 1 ? symbol : `${symbol}^{${exponentLatex(magnitude)}}`;
    (exponent > 0 ? numerator : denominator).push(text);
  });
  if (!numerator.length && !denominator.length) return '';
  const top = numerator.length ? numerator.join('\\cdot ') : '1';
  if (!denominator.length) return top;
  const bottom = denominator.length > 1 ? `(${denominator.join('\\cdot ')})` : denominator[0];
  return `${top}/${bottom}`;
}

/** How many base-unit exponents it takes to write a dimension. */
function spellingCost(dim) {
  return dim.reduce((total, exponent) => total + (Math.abs(exponent) < 1e-9 ? 0 : 1), 0);
}

/**
 * The coherent SI unit a dimension is shown in: a named unit when it fits
 * exactly, a named unit times a little base-unit remainder when that is
 * clearly shorter (`V/m`, `J/K`, `W/m^2`), and plain base units otherwise
 * (`m/s^2`, `kg\cdot m/s`).
 *
 * Returns the LaTeX to sit inside `\mathrm{}`, or '' when dimensionless.
 */
export function siUnitLatex(dim) {
  if (isDimensionless(dim)) return '';
  let best = { latex: baseUnitLatex(dim), cost: spellingCost(dim) };
  for (const name of NAMED_DISPLAY) {
    const named = UNIT_TABLE[name];
    const remainder = divideDimensions(dim, named.dim);
    const cost = 1 + spellingCost(remainder);
    // A named unit has to save at least two exponents to be worth the
    // reader's translation: `kg\cdot m/s` stays, `V/m` does not.
    if (cost <= best.cost - 2 || (isDimensionless(remainder) && cost < best.cost)) {
      best = { latex: baseUnitLatex(remainder, named.latex ?? name), cost };
    }
  }
  return best.latex;
}
