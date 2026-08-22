/**
 * The identifier layer.
 *
 * Compute Engine's LaTeX parser splits bare letter runs into implicit products
 * (`maxSpeed` parses as m*a*x*S*p*e*e*d), and some display commands collide with
 * builtins (`\Gamma` is the gamma function, not a variable). So user-facing names
 * never reach the parser verbatim.
 *
 * Instead every identifier the user writes is interned into a registry and
 * rewritten to an opaque, parser-safe symbol: `\mathrm{Id7}`, or
 * `\operatorname{Id7}` when it is being applied to arguments. Results coming back
 * out of the engine are rewritten in the other direction for display.
 *
 * An identifier is a *base* with an optional subscript:
 *   base     := single roman letter | greek command | \text{...}-style blob
 *   subscript:= _x | _{anything}
 * The subscript is part of the name (`v_max` is one variable, not v times max)
 * but is formatted independently of the base.
 */

export const GREEK_UNICODE = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ',
  rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
  phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

const GREEK = new Set(Object.keys(GREEK_UNICODE));

/** Commands whose braced argument is a *name*, not an expression. */
const TEXT_WRAPPERS = new Set([
  'text', 'textrm', 'textit', 'textbf', 'textsf', 'texttt', 'textnormal',
  'mathrm', 'mathit', 'mathbf', 'mathsf', 'mathtt', 'mathfrak', 'mathcal', 'mathscr',
]);

/** Never renamed: these carry meaning the engine already understands. */
const RESERVED_COMMANDS = new Set(['pi', 'infty', 'imaginaryI', 'exponentialE']);
const RESERVED_LETTERS = new Set(['i', 'e']);

/**
 * Names inside `\operatorname{...}` that are engine builtins rather than
 * user identifiers. Values are the Compute Engine spelling.
 */
const BUILTIN_FUNCTIONS = new Map(Object.entries({
  Re: 'Real', re: 'Real', Real: 'Real',
  Im: 'Imaginary', im: 'Imaginary', Imaginary: 'Imaginary',
  conj: 'Conjugate', Conjugate: 'Conjugate',
  arg: 'Arg', Arg: 'Arg',
  floor: 'floor', Floor: 'floor',
  ceil: 'ceil', ceiling: 'ceil', Ceil: 'ceil',
  round: 'round', Round: 'round',
  abs: 'abs', Abs: 'abs',
  sgn: 'sgn', sign: 'sgn',
  gcd: 'gcd', GCD: 'gcd', lcm: 'lcm', LCM: 'lcm',
  min: 'min', max: 'max', mod: 'mod',
  exp: 'exp', ln: 'ln', log: 'log', lg: 'lg',
  sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', csc: 'csc', cot: 'cot',
  arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
}));

const isLetter = (c) => c !== undefined && /[A-Za-z]/.test(c);

function skipSpace(src, i) {
  while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i++;
  return i;
}

/** Read a `\command` (or a single escaped character) starting at a backslash. */
function readCommand(src, i) {
  let j = i + 1;
  if (isLetter(src[j])) {
    while (isLetter(src[j])) j++;
    return { name: src.slice(i + 1, j), end: j };
  }
  return { name: src[j] ?? '', end: Math.min(j + 1, src.length) };
}

/** Read a `{...}` group, respecting nesting and escapes. Assumes src[i] === '{'. */
function readBalanced(src, i) {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { content: src.slice(i + 1, j), end: j + 1 };
    }
  }
  return { content: src.slice(i + 1), end: src.length };
}

/**
 * Text-mode content keeps literal underscores and hyphens, which is what makes
 * `snake_case` and `hyphen-concatenated` names possible at all — outside text
 * mode `_` means "subscript".
 */
function normalizeTextContent(raw) {
  return raw
    .replace(/\\[_&%#$]/g, (m) => m[1])
    .replace(/\\(?:,|;|:|!|quad|qquad)\s*/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Try to read an identifier *base* at position i. */
function scanBase(src, i) {
  const c = src[i];
  if (c === '\\') {
    const cmd = readCommand(src, i);
    if (TEXT_WRAPPERS.has(cmd.name)) {
      const j = skipSpace(src, cmd.end);
      if (src[j] !== '{') return null;
      const { content, end } = readBalanced(src, j);
      const value = normalizeTextContent(content);
      return value ? { kind: 'text', value, end } : null;
    }
    if (GREEK.has(cmd.name) && !RESERVED_COMMANDS.has(cmd.name)) {
      return { kind: 'greek', value: cmd.name, end: cmd.end };
    }
    return null;
  }
  if (isLetter(c)) return { kind: 'letter', value: c, end: i + 1 };
  return null;
}

/** Try to read a `_...` subscript at position i. */
function scanSubscript(src, i) {
  let j = skipSpace(src, i);
  if (src[j] !== '_') return null;
  j = skipSpace(src, j + 1);
  if (j >= src.length) return null;
  if (src[j] === '{') {
    const { content, end } = readBalanced(src, j);
    return { raw: content.trim(), end };
  }
  if (src[j] === '\\') {
    const cmd = readCommand(src, j);
    return { raw: '\\' + cmd.name, end: cmd.end };
  }
  return { raw: src[j], end: j + 1 };
}

function scanIdentifier(src, i) {
  const base = scanBase(src, i);
  if (!base) return null;
  const sub = scanSubscript(src, base.end);
  return { base, sub: sub ? sub.raw : null, end: sub ? sub.end : base.end };
}

/** Stable key so the same written name interns to the same symbol everywhere. */
function identifierKey(ident) {
  const base = `${ident.base.kind}:${ident.base.value}`;
  return ident.sub === null ? base : `${base}|sub:${ident.sub.replace(/\s+/g, '')}`;
}

/** LaTeX to redisplay this identifier (used for echoing names back to the user). */
function identifierLatex(ident) {
  let out;
  if (ident.base.kind === 'letter') out = ident.base.value;
  else if (ident.base.kind === 'greek') out = '\\' + ident.base.value;
  else out = `\\text{${ident.base.value}}`;
  if (ident.sub !== null) out += `_{${ident.sub}}`;
  return out;
}

/** Plain-text rendering, for counterexample messages and error text. */
function identifierName(ident) {
  let out;
  if (ident.base.kind === 'greek') out = GREEK_UNICODE[ident.base.value];
  else out = ident.base.value;
  if (ident.sub !== null) {
    const sub = ident.sub
      .replace(/\\text\{([^}]*)\}/g, '$1')
      .replace(/\\([a-zA-Z]+)/g, (m, n) => GREEK_UNICODE[n] ?? n)
      .replace(/[{}\s]/g, '');
    out += '_' + sub;
  }
  return out;
}

/**
 * Holds the identifier <-> opaque-symbol mapping for one sheet evaluation.
 */
export class IdentifierRegistry {
  constructor() {
    this.byKey = new Map();
    this.byId = new Map();
    this.counter = 0;
  }

  intern(ident) {
    const key = identifierKey(ident);
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const entry = {
      id: `Id${this.counter++}`,
      key,
      latex: identifierLatex(ident),
      name: identifierName(ident),
      kind: ident.base.kind,
    };
    this.byKey.set(key, entry);
    this.byId.set(entry.id, entry);
    return entry;
  }

  get(id) {
    return this.byId.get(id);
  }

  /** Rewrite engine output back into the names the user actually typed. */
  toDisplayLatex(latex) {
    if (!latex) return latex;
    return latex
      .replace(/\\(?:mathrm|operatorname)\s*\{\s*(Id\d+)\s*\}/g, (m, id) => this.get(id)?.latex ?? m)
      .replace(/\bId\d+\b/g, (m) => this.get(m)?.latex ?? m);
  }

  toDisplayName(text) {
    if (!text) return text;
    return String(text).replace(/\bId\d+\b/g, (m) => this.get(m)?.name ?? m);
  }
}

/** Normalisations applied before scanning, so the engine sees one spelling. */
function normalizeOperators(latex) {
  return latex
    // The editor inserts `:=` wrapped in `\mathrel` so it is spaced like the
    // relation it is. That wrapper is presentation only — unwrap it before the
    // parser, which wants the bare operator.
    // The trailing space matters: without it `\coloneq` followed by a letter
    // reads as one longer control word (`\coloneqx`).
    .replace(/\\mathrel\s*\{\s*(\\[Cc]oloneqq?)\s*\}/g, '$1 ')
    .replace(/\\coloneqq|\\Coloneqq|\\Coloneq|\\coloneq/g, '\\coloneq')
    .replace(/:\s*=/g, '\\coloneq ')
    .replace(/\\(?:Longrightarrow|Rightarrow|implies)\b/g, '\\implies ')
    .replace(/\\(?:Longleftarrow|Leftarrow|impliedby)\b/g, '\\impliedby ')
    // `\equiv` parses as a chainable relation, which is not what it means
    // between two statements; treat it as the biconditional throughout.
    .replace(/\\(?:Longleftrightarrow|Leftrightarrow|Lrarr|lrArr|equiv|iff)\b/g, '\\iff ')
    // MathLive serializes `\\operatorname{Re}` and `\\operatorname{Im}`
    // shortcuts as roman function names. Restore their builtin meaning before
    // the identifier pass can mistake them for user-defined names.
    .replace(/\\operatorname\s*\{\s*\\mathrm\s*\{\s*Re\s*\}\s*\}/g, '\\operatorname{Real}')
    .replace(/\\operatorname\s*\{\s*\\mathrm\s*\{\s*Im\s*\}\s*\}/g, '\\operatorname{Imaginary}')
    .replace(/\\mathrm\s*\{\s*Re\s*\}/g, '\\operatorname{Real}')
    .replace(/\\mathrm\s*\{\s*Im\s*\}/g, '\\operatorname{Imaginary}')
    .replace(/\\Re\b/g, '\\operatorname{Real}')
    .replace(/\\Im\b/g, '\\operatorname{Imaginary}')
    .replace(/\\(?:left|right|middle)\s*\./g, '')
    .replace(/\\displaystyle\b|\\limits\b|\\!/g, '');
}

/** True if the next thing after `i` opens an argument list. */
function opensCall(src, i) {
  let j = skipSpace(src, i);
  if (src.startsWith('\\left', j)) j = skipSpace(src, j + 5);
  return src[j] === '(';
}

/**
 * Rewrite user LaTeX into something Compute Engine parses unambiguously.
 * Returns the rewritten LaTeX plus the identifiers it mentions.
 */
export function sanitize(rawLatex, registry) {
  const src = normalizeOperators(rawLatex);
  const used = new Map();
  let out = '';
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    if (c === '\\') {
      const cmd = readCommand(src, i);

      // `\operatorname{...}` is either an engine builtin or a user function name.
      if (cmd.name === 'operatorname') {
        const j = skipSpace(src, cmd.end);
        if (src[j] === '{') {
          const { content, end } = readBalanced(src, j);
          const name = content.trim();
          const builtin = BUILTIN_FUNCTIONS.get(name);
          if (builtin) {
            out += `\\operatorname{${builtin}}`;
            i = end;
            continue;
          }
          // Not a builtin: fall through and treat as a user identifier.
          const ident = { base: { kind: 'text', value: normalizeTextContent(name) }, sub: null };
          const sub = scanSubscript(src, end);
          if (sub) ident.sub = sub.raw;
          const entry = registry.intern(ident);
          used.set(entry.id, entry);
          const after = sub ? sub.end : end;
          out += opensCall(src, after) ? `\\operatorname{${entry.id}}` : `\\mathrm{${entry.id}}`;
          i = after;
          continue;
        }
      }

      const ident = scanIdentifier(src, i);
      if (ident && !(ident.base.kind === 'greek' && ident.sub === null && RESERVED_COMMANDS.has(ident.base.value))) {
        const entry = registry.intern(ident);
        used.set(entry.id, entry);
        out += opensCall(src, ident.end) ? `\\operatorname{${entry.id}}` : `\\mathrm{${entry.id}}`;
        i = ident.end;
        continue;
      }

      // Any other command passes through whole, so its letters are not
      // mistaken for one-letter variables.
      out += src.slice(i, cmd.end);
      i = cmd.end;
      continue;
    }

    if (isLetter(c)) {
      const ident = scanIdentifier(src, i);
      // Bare `i` and `e` keep their built-in meaning; `i_1` and `e_k` do not.
      if (ident.sub === null && RESERVED_LETTERS.has(ident.base.value)) {
        out += ident.base.value;
        i = ident.end;
        continue;
      }
      const entry = registry.intern(ident);
      used.set(entry.id, entry);
      out += opensCall(src, ident.end) ? `\\operatorname{${entry.id}}` : `\\mathrm{${entry.id}}`;
      i = ident.end;
      continue;
    }

    out += c;
    i++;
  }

  return { latex: out, used };
}
