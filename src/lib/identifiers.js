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
// `P` is here for the opposite reason to the rest: Compute Engine has no
// `\mathbb{P}`, and the application decides primality itself in `sets.js`. It
// still has to survive the scanner intact, or it arrives as a user name.
const STANDARD_BLACKBOARD_SETS = new Set(['N', 'Z', 'Q', 'R', 'C', 'P']);

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
  rnd: 'round', Rnd: 'round', round: 'round', Round: 'round',
  abs: 'abs', Abs: 'abs',
  sgn: 'sgn', sign: 'sgn',
  gcd: 'gcd', GCD: 'gcd', lcm: 'lcm', LCM: 'lcm',
  min: 'min', max: 'max', mod: 'mod',
  exp: 'exp', ln: 'ln', log: 'log', lg: 'lg',
  sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', csc: 'csc', cot: 'cot',
  arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
  PowerSet: 'PowerSet', powerset: 'PowerSet',
  CartesianProduct: 'CartesianProduct', cartesian: 'CartesianProduct', cart: 'CartesianProduct',
  OpenBall: 'OpenBall', ball: 'OpenBall',
  ClosedBall: 'ClosedBall', closedball: 'ClosedBall',
  ContinuousAt: 'ContinuousAt', continuous: 'ContinuousAt', cont: 'ContinuousAt',
  LimitAt: 'LimitAt', limitat: 'LimitAt', limitw: 'LimitAt',
  Topology: 'Topology', topology: 'Topology',
  OpenIn: 'OpenIn', openin: 'OpenIn',
  ClosedIn: 'ClosedIn', closedin: 'ClosedIn',
  NeighborhoodOf: 'NeighborhoodOf', neighborhood: 'NeighborhoodOf', nbrhd: 'NeighborhoodOf',
  MetricOpen: 'MetricOpen', metricopen: 'MetricOpen',
  MetricClosed: 'MetricClosed', metricclosed: 'MetricClosed',
  ContinuousMap: 'ContinuousMap', continuousmap: 'ContinuousMap',
  DiscreteTopology: 'DiscreteTopology', discrete: 'DiscreteTopology', disc: 'DiscreteTopology',
  IndiscreteTopology: 'IndiscreteTopology', indiscrete: 'IndiscreteTopology', indisc: 'IndiscreteTopology',
  CofiniteTopology: 'CofiniteTopology', cofinite: 'CofiniteTopology', cof: 'CofiniteTopology',
  MetricTopology: 'MetricTopology', metrictopology: 'MetricTopology', metrictop: 'MetricTopology',
  SubspaceTopology: 'SubspaceTopology', subspace: 'SubspaceTopology', subtop: 'SubspaceTopology',
  ProductTopology: 'ProductTopology', producttopology: 'ProductTopology', prodtop: 'ProductTopology',
  IndexedUnion: 'IndexedUnion', indexedunion: 'IndexedUnion', iunion: 'IndexedUnion',
  IndexedIntersection: 'IndexedIntersection', indexedintersection: 'IndexedIntersection', iintersection: 'IndexedIntersection',
  TopologyEmptyAxiom: 'TopologyEmptyAxiom', axempty: 'TopologyEmptyAxiom',
  TopologyCarrierAxiom: 'TopologyCarrierAxiom', axcarrier: 'TopologyCarrierAxiom',
  TopologyUnionAxiom: 'TopologyUnionAxiom', axunions: 'TopologyUnionAxiom',
  TopologyIntersectionAxiom: 'TopologyIntersectionAxiom', axintersections: 'TopologyIntersectionAxiom',
  MetricIntersectionWitness: 'MetricIntersectionWitness', meetw: 'MetricIntersectionWitness',
  SetCardinality: 'SetCardinality', cardinality: 'SetCardinality', card: 'SetCardinality',
  CompactSpace: 'CompactSpace', compact: 'CompactSpace',
  GroupStructure: 'GroupStructure', group: 'GroupStructure',
  GroupClosure: 'GroupClosure', closure: 'GroupClosure',
  GroupAssociative: 'GroupAssociative', assoc: 'GroupAssociative',
  GroupIdentity: 'GroupIdentity', identity: 'GroupIdentity',
  GroupInverses: 'GroupInverses', inverses: 'GroupInverses',
  AbelianGroup: 'AbelianGroup', abelian: 'AbelianGroup',
  Subgroup: 'Subgroup', subgroup: 'Subgroup',
  RingStructure: 'RingStructure', ring: 'RingStructure',
  RingDistributive: 'RingDistributive', distributive: 'RingDistributive',
  RingUnity: 'RingUnity', unity: 'RingUnity',
  FieldStructure: 'FieldStructure', field: 'FieldStructure',
  ModuleStructure: 'ModuleStructure', module: 'ModuleStructure',
  VectorSpace: 'VectorSpace', vectorspace: 'VectorSpace',
  Induction: 'Induction', induction: 'Induction', induct: 'Induction',
  InductionBase: 'InductionBase', indbase: 'InductionBase',
  InductionStep: 'InductionStep', indstep: 'InductionStep',
  PartialDerivativeAt: 'PartialDerivativeAt',
  partial: 'PartialDerivativeAt', partialat: 'PartialDerivativeAt',
}));

/**
 * Compact, presentation-first spellings used by the topology keyboard.
 *
 * These are deliberately recognized only when the styled letter is applied as
 * a function. A standalone `\mathcal{O}` or `\mathcal{N}` remains an ordinary
 * user identifier, so conventional names for an open set or a neighborhood
 * system are still available.
 */
const STYLED_BUILTIN_FUNCTIONS = new Map([
  ['mathsf:Top:', 'Topology'],
  ['mathsf:Cts:', 'ContinuousMap'],
  ['mathsf:Disc:', 'DiscreteTopology'],
  ['mathsf:Ind:', 'IndiscreteTopology'],
  ['mathsf:Cof:', 'CofiniteTopology'],
  ['mathsf:Met:', 'MetricTopology'],
  ['mathsf:Sub:', 'SubspaceTopology'],
  ['mathsf:Prod:', 'ProductTopology'],
  ['mathsf:Ax:\\varnothing', 'TopologyEmptyAxiom'],
  ['mathsf:Ax:X', 'TopologyCarrierAxiom'],
  ['mathsf:Ax:\\bigcup', 'TopologyUnionAxiom'],
  ['mathsf:Ax:\\cap', 'TopologyIntersectionAxiom'],
  ['mathsf:Meet:', 'MetricIntersectionWitness'],
  ['mathsf:Cpt:', 'CompactSpace'],
  ['mathsf:Grp:', 'GroupStructure'],
  ['mathsf:Clo:', 'GroupClosure'],
  ['mathsf:Asc:', 'GroupAssociative'],
  ['mathsf:Idn:', 'GroupIdentity'],
  ['mathsf:Inv:', 'GroupInverses'],
  ['mathsf:Abl:', 'AbelianGroup'],
  ['mathsf:Sbg:', 'Subgroup'],
  ['mathsf:Rng:', 'RingStructure'],
  ['mathsf:Dst:', 'RingDistributive'],
  ['mathsf:Uni:', 'RingUnity'],
  ['mathsf:Fld:', 'FieldStructure'],
  ['mathsf:Mdl:', 'ModuleStructure'],
  ['mathsf:Vec:', 'VectorSpace'],
  ['mathsf:Cat:', 'CategoryStructure'],
  ['mathsf:Cmp:', 'CategoryComposition'],
  ['mathsf:Idt:', 'CategoryIdentities'],
  // `Asc` is already the group's associativity, whose arity and arguments are
  // different, so the category's spells itself differently.
  ['mathsf:Aso:', 'CategoryAssociative'],
  ['mathsf:Fun:', 'FunctorStructure'],
  // `Ind` is already the indiscrete topology, so induction spells it out.
  ['mathsf:Induct:', 'Induction'],
  ['mathsf:Base:', 'InductionBase'],
  ['mathsf:Step:', 'InductionStep'],
  ['mathcal:O:', 'OpenIn'],
  ['mathscr:O:', 'OpenIn'],
  ['mathcal:C:', 'ClosedIn'],
  ['mathscr:C:', 'ClosedIn'],
  ['mathcal:N:', 'NeighborhoodOf'],
  ['mathscr:N:', 'NeighborhoodOf'],
  ['mathcal:O:\\mathbb{R}', 'MetricOpen'],
  ['mathscr:O:\\mathbb{R}', 'MetricOpen'],
  ['mathcal:C:\\mathbb{R}', 'MetricClosed'],
  ['mathscr:C:\\mathbb{R}', 'MetricClosed'],
]);

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

  /** Return an already-interned written identifier without creating it. */
  lookup(ident) {
    return this.byKey.get(identifierKey(ident));
  }

  /** A proof-only symbol with a readable name that cannot alias user input. */
  createInternal(latex = '\\text{element}', name = 'element') {
    const id = `Id${this.counter++}`;
    const entry = { id, key: `internal:${id}`, latex, name, kind: 'internal' };
    this.byId.set(id, entry);
    return entry;
  }

  /**
   * A proof-only symbol chosen from readable candidates that do not duplicate
   * a name in the sheet. Internal names from earlier, independent rows do not
   * reserve a candidate: each proof has its own scope and may conventionally
   * call its arbitrary point `t`.
   */
  createFreshInternal(candidates, fallback = { latex: '\\text{element}', name: 'element' }) {
    const written = new Set([...this.byId.values()]
      .filter((entry) => entry.kind !== 'internal')
      .map((entry) => entry.latex));
    const available = candidates.find(({ latex }) => !written.has(latex));
    if (available) return this.createInternal(available.latex, available.name);

    let suffix = 0;
    let latex = fallback.latex;
    let name = fallback.name;
    while (written.has(latex)) {
      suffix += 1;
      latex = `${fallback.latex}_{${suffix}}`;
      name = `${fallback.name}_${suffix}`;
    }
    return this.createInternal(latex, name);
  }

  /** Rewrite engine output back into the names the user actually typed. */
  toDisplayLatex(latex) {
    if (!latex) return latex;
    return latex
      // A name substituted straight after a command runs into it: `\lt` before
      // `d` would read as `\ltd`. Keep the separating space in that case.
      .replace(/\\(?:mathrm|operatorname)\s*\{\s*(Id\d+)\s*\}/g, (m, id, at, whole) => {
        const replacement = this.get(id)?.latex;
        if (replacement === undefined) return m;
        return /[a-zA-Z]/.test(whole[at - 1] ?? '') ? ` ${replacement}` : replacement;
      })
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
    // A sequent with explicit assumptions is checked as the corresponding
    // implication. This gives `Gamma \\vdash P` the app's existing universal
    // validity semantics without treating assumptions as persistent facts.
    .replace(/\\vdash\b/g, '\\implies ')
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
    // Indexed families use their conventional large operators in the editor;
    // the evaluator receives an explicit two-argument head.
    .replace(/\\mathop\s*\{\s*\\bigcup\s*\}/g, '\\operatorname{IndexedUnion}')
    .replace(/\\mathop\s*\{\s*\\bigcap\s*\}/g, '\\operatorname{IndexedIntersection}')
    // `𝒫(A)` is the conventional compact notation; Compute Engine exposes
    // the operation under its word-form `PowerSet` builtin.
    .replace(/\\(?:mathcal|mathscr)\s*\{\s*P\s*\}/g, '\\operatorname{PowerSet}')
    .replace(/\\wp\b/g, '\\operatorname{PowerSet}')
    .replace(/\\(?:left|right|middle)\s*\./g, '')
    .replace(/\\displaystyle\b|\\limits\b|\\!/g, '');
}

/** True if the next thing after `i` opens an argument list. */
function opensCall(src, i) {
  let j = skipSpace(src, i);
  if (src.startsWith('\\left', j)) j = skipSpace(src, j + 5);
  return src[j] === '(';
}

/** Locate where an implicit final argument belongs in a parenthesized call. */
function callArgumentEndIndex(src, i) {
  let open = skipSpace(src, i);
  if (src.startsWith('\\left', open)) open = skipSpace(src, open + 5);
  if (src[open] !== '(') return -1;

  let depth = 0;
  let braceDepth = 0;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') {
      const command = readCommand(src, j);
      j = command.end - 1;
      continue;
    }
    if (c === '{') braceDepth++;
    else if (c === '}') braceDepth--;
    else if (braceDepth === 0 && c === '(') depth++;
    else if (braceDepth === 0 && c === ')' && --depth === 0) {
      // With sized delimiters, the argument must precede `\\right`, not merely
      // the literal closing parenthesis that follows it.
      const right = /\\right\s*$/.exec(src.slice(open, j));
      return right ? open + right.index : j;
    }
  }
  return -1;
}

/**
 * Rewrite user LaTeX into something Compute Engine parses unambiguously.
 * Returns the rewritten LaTeX plus the identifiers it mentions.
 */
/**
 * Does the text just emitted end with something that is certainly a matrix?
 *
 * `M^T` means transpose, but `x^T` is an ordinary power of a variable named
 * `T`, and the scanner cannot tell them apart from the exponent alone. It can
 * tell them apart from the *base*: an environment that just closed, or a
 * parenthesised group containing one. Anything else keeps its usual reading.
 */
function closesMatrix(text) {
  const trimmed = text.trimEnd();
  if (/\\end\s*\{[^{}]*\}$/.test(trimmed)) return true;
  if (!trimmed.endsWith(')')) return false;
  let depth = 0;
  for (let k = trimmed.length - 1; k >= 0; k -= 1) {
    if (trimmed[k] === ')') depth += 1;
    else if (trimmed[k] === '(') {
      depth -= 1;
      if (depth === 0) return trimmed.slice(k).includes('\\end{');
    }
  }
  return false;
}

const TRANSPOSE_EXPONENT = /^\^\s*(?:\{\s*T\s*\}|T)/;

/** The integral signs whose differential this scanner knows to preserve. */
const INTEGRAL_COMMANDS = new Set(['int', 'iint', 'iiint', 'oint', 'intop']);

/** `d`, `\mathrm{d}` or `\partial`, optionally raised to an order. */
const DERIVATIVE_NUMERATOR = /^(?:(\\partial)|\\mathrm\s*\{\s*d\s*\}|d)\s*(?:\^\s*\{?\s*(\d+)\s*\}?)?$/;

/**
 * `\frac{d}{dx}` is an operator, not a fraction.
 *
 * Left to the ordinary scanner the `d` becomes a user identifier and the whole
 * thing reads as `d / (d·x)`, which is why this notation was refused outright.
 * The differentiation variable still has to be interned — the body it applies
 * to will be — so the operator is rebuilt here with `d` kept literal and the
 * variable renamed, which is the one form Compute Engine reads as `D`.
 *
 * Returns null for `\frac{dy}{dx}`: a numerator naming a dependent variable is
 * a ratio this app has no procedure for, and it stays refused.
 */
function readDerivativeOperator(src, at, registry, used) {
  let index = skipSpace(src, at);
  if (src[index] !== '{') return null;
  const numerator = readBalanced(src, index);
  const shape = DERIVATIVE_NUMERATOR.exec(numerator.content.trim());
  if (!shape) return null;
  const partial = Boolean(shape[1]);
  const order = shape[2] ?? null;

  index = skipSpace(src, numerator.end);
  if (src[index] !== '{') return null;
  const denominator = readBalanced(src, index);
  let rest = denominator.content.trim();

  const lead = partial
    ? /^\\partial\s*/
    : /^(?:\\mathrm\s*\{\s*d\s*\}|d)\s*/;
  const leading = lead.exec(rest);
  if (!leading) return null;
  rest = rest.slice(leading[0].length).trim();

  const power = /\^\s*\{?\s*(\d+)\s*\}?$/.exec(rest);
  if (power) rest = rest.slice(0, power.index).trim();
  // `\frac{d^2}{dx}` is not a second derivative of anything.
  if ((power?.[1] ?? null) !== order) return null;

  const ident = scanIdentifier(rest, 0);
  if (!ident || ident.end !== rest.length) return null;
  const entry = registry.intern(ident);
  used.set(entry.id, entry);

  const head = partial ? '\\partial' : 'd';
  const exponent = order ? `^{${order}}` : '';
  return {
    latex: `\\frac{${head}${exponent}}{${head} \\mathrm{${entry.id}}${exponent}}`,
    end: denominator.end,
  };
}

const BOUNDED_OPERATOR_COMMANDS = new Set(['sum', 'prod']);
const BOUNDED_SCOPE_COMMANDS = new Set([
  'le', 'leq', 'ge', 'geq', 'lt', 'gt', 'ne', 'neq', 'in', 'notin',
  'land', 'wedge', 'lor', 'vee', 'implies', 'iff', 'vdash',
]);

/** Read one braced or single-token limit following `_` or `^`. */
function readLimitAtom(src, at) {
  const start = skipSpace(src, at);
  if (src[start] === '{') {
    const group = readBalanced(src, start);
    return { content: group.content, contentStart: start + 1, end: group.end };
  }
  if (src[start] === '\\') {
    const command = readCommand(src, start);
    return { content: src.slice(start, command.end), contentStart: start, end: command.end };
  }
  return start < src.length
    ? { content: src[start], contentStart: start, end: start + 1 }
    : null;
}

/** End of the product that a bounded sum or product binds. */
function boundedOperatorBodyEnd(src, start) {
  const first = skipSpace(src, start);
  let parentheses = 0;
  let brackets = 0;
  for (let at = start; at < src.length;) {
    const c = src[at];
    if (c === '{') {
      at = readBalanced(src, at).end;
      continue;
    }
    if (c === '\\') {
      const command = readCommand(src, at);
      if (parentheses === 0 && brackets === 0 && BOUNDED_SCOPE_COMMANDS.has(command.name)) {
        return at;
      }
      at = command.end;
      continue;
    }
    if (c === '(') parentheses += 1;
    else if (c === ')') {
      if (parentheses === 0) return at;
      parentheses -= 1;
    } else if (c === '[') brackets += 1;
    else if (c === ']') {
      if (brackets === 0) return at;
      brackets -= 1;
    } else if (parentheses === 0 && brackets === 0
      && ((c === '+' || c === '-') ? at !== first
        : c === '=' || c === '<' || c === '>' || c === ',')) {
      return at;
    }
    at += 1;
  }
  return src.length;
}

/** Mark bare occurrences of a reserved letter inside one bounded body. */
function markBoundOccurrences(src, start, end, name, marked) {
  for (let at = start; at < end;) {
    if (src[at] === '\\') {
      const command = readCommand(src, at);
      if (TEXT_WRAPPERS.has(command.name) || command.name === 'operatorname') {
        const groupAt = skipSpace(src, command.end);
        if (src[groupAt] === '{') {
          at = readBalanced(src, groupAt).end;
          continue;
        }
      }
      at = command.end;
      continue;
    }
    const ident = scanIdentifier(src, at);
    if (ident) {
      if (ident.base.kind === 'letter' && ident.base.value === name && ident.sub === null) {
        marked.add(at);
      }
      at = ident.end;
      continue;
    }
    at += 1;
  }
}

/**
 * Bare `i` and `e` are constants except when a bounded operator binds them.
 * Compute Engine initially scopes `i` correctly, but rebuilding a nested sum
 * containing its special imaginary-unit symbol can change the result. Marking
 * the binder and its body lets the ordinary identifier pass give them a safe,
 * lexical symbol while leaving constants outside the body untouched.
 */
function boundedReservedIdentifierPositions(src) {
  const marked = new Set();
  for (let at = 0; at < src.length;) {
    if (src[at] !== '\\') { at += 1; continue; }
    const command = readCommand(src, at);
    if (!BOUNDED_OPERATOR_COMMANDS.has(command.name)) {
      at = command.end;
      continue;
    }

    let cursor = skipSpace(src, command.end);
    let lower = null;
    let upper = null;
    while (lower === null || upper === null) {
      const marker = src[cursor];
      if ((marker !== '_' && marker !== '^')
        || (marker === '_' && lower !== null) || (marker === '^' && upper !== null)) break;
      const atom = readLimitAtom(src, cursor + 1);
      if (!atom) break;
      if (marker === '_') lower = atom;
      else upper = atom;
      cursor = skipSpace(src, atom.end);
    }

    const binding = lower && /^\s*([ie])\s*=/.exec(lower.content);
    if (binding && upper) {
      const offset = lower.content.indexOf(binding[1]);
      marked.add(lower.contentStart + offset);
      const end = boundedOperatorBodyEnd(src, cursor);
      markBoundOccurrences(src, cursor, end, binding[1], marked);
    }
    at = command.end;
  }
  return marked;
}

export function sanitize(rawLatex, registry, options = {}) {
  const src = normalizeOperators(rawLatex);
  const boundedReserved = boundedReservedIdentifierPositions(src);
  const used = new Map();
  const implicitArguments = new Map();
  let out = '';
  let i = 0;
  // Set by an integral sign, cleared by the differential that closes it. `dx`
  // is the variable of integration there and an ordinary product anywhere
  // else — the sheet's own demo defines a function called `d`.
  let awaitingDifferential = false;

  /**
   * A subscript normally belongs to a variable's name. The sheet can opt out
   * when the base is already known to hold a matrix or vector, making `A_2`
   * and `A_{1,2}` collection access without taking ordinary names such as
   * `x_1` away from the rest of the language.
   */
  const expressionIdentifier = (at) => {
    const ident = scanIdentifier(src, at);
    if (!ident?.sub || !options.isCollectionSubscript?.(
      { base: ident.base, sub: null, end: ident.base.end }, ident.sub
    )) return ident;
    return { base: ident.base, sub: null, end: ident.base.end };
  };

  while (i < src.length) {
    // Unary O_R(U) and C_R(F) are presentation shorthands. Compute Engine
    // needs the explicit second argument to distinguish a unary unknown
    // function from multiplication, so add the real domain at parse time.
    if (implicitArguments.has(i)) out += implicitArguments.get(i);
    const c = src[i];

    // A `T` exponent on a matrix is a transpose. Normalised to `\top`, which
    // Compute Engine reads as `Transpose` — left alone, the `T` would be
    // interned as a variable and the statement would become a power, which
    // the sampler then cheerfully finds a counterexample to.
    if (c === '^' && closesMatrix(out)) {
      const transpose = TRANSPOSE_EXPONENT.exec(src.slice(i));
      if (transpose) {
        out += '^{\\top}';
        i += transpose[0].length;
        continue;
      }
    }

    if (c === '\\') {
      const cmd = readCommand(src, i);

      // The topology layer uses compact mathematical symbols instead of long
      // `operatorname` words: Top, O, C, N, and Cts. Recognize those styled
      // symbols only in call position and lower them to the same internal
      // predicates as the backwards-compatible textual aliases.
      if (['mathsf', 'mathcal', 'mathscr'].includes(cmd.name)) {
        const j = skipSpace(src, cmd.end);
        if (src[j] === '{') {
          const { content, end } = readBalanced(src, j);
          const sub = scanSubscript(src, end);
          const after = sub ? sub.end : end;
          const subscript = sub?.raw.replace(/\s+/g, '') ?? '';
          const builtin = STYLED_BUILTIN_FUNCTIONS.get(
            `${cmd.name}:${content.trim()}:${subscript}`
          );
          if (builtin && opensCall(src, after)) {
            out += `\\operatorname{${builtin}}`;
            const implicit = (builtin === 'MetricOpen' || builtin === 'MetricClosed')
              ? ',\\mathbb{R}'
              : ['DiscreteTopology', 'IndiscreteTopology', 'CofiniteTopology', 'MetricTopology']
                  .includes(builtin) ? ',\\varnothing' : null;
            if (implicit) {
              const close = callArgumentEndIndex(src, after);
              if (close >= 0) implicitArguments.set(close, implicit);
            }
            i = after;
            continue;
          }
        }
      }

      // Keep the standard number sets intact. Without this special case the
      // identifier scanner sees the `R` inside `\\mathbb{R}` as a user name and
      // rewrites it, destroying Compute Engine's built-in `RealNumbers` token.
      if (cmd.name === 'mathbb') {
        const j = skipSpace(src, cmd.end);
        if (src[j] === '{') {
          const { content, end } = readBalanced(src, j);
          const name = content.trim();
          if (STANDARD_BLACKBOARD_SETS.has(name)) {
            out += `\\mathbb{${name}}`;
            i = end;
            continue;
          }
        }
      }

      // `\begin{pmatrix}` names an environment, not a value. Without this the
      // identifier scanner interns p, m, a, t, r and x as user names and reads
      // the `i` as the imaginary unit, so the matrix never reaches Compute
      // Engine at all — it arrives as `\begin{\mathrm{Id0}…}` and comes back
      // `unknown-environment`.
      if (cmd.name === 'frac') {
        const derivative = readDerivativeOperator(src, cmd.end, registry, used);
        if (derivative) {
          out += derivative.latex;
          i = derivative.end;
          continue;
        }
      }

      if (cmd.name === 'begin' || cmd.name === 'end') {
        const j = skipSpace(src, cmd.end);
        if (src[j] === '{') {
          const { content, end } = readBalanced(src, j);
          out += `\\${cmd.name}{${content.trim()}}`;
          i = end;
          continue;
        }
      }

      // `\operatorname{...}` is either an engine builtin or a user function name.
      if (cmd.name === 'operatorname') {
        const j = skipSpace(src, cmd.end);
        if (src[j] === '{') {
          const { content, end } = readBalanced(src, j);
          const name = content.trim();
          // MathLive serializes word-labelled virtual-keyboard functions as
          // `\operatorname{\mathrm{name}}`. Unwrap that presentation layer so
          // rnd, floor, ceil, Re, Im, and the other builtins keep their meaning.
          const romanName = /^\\mathrm\s*\{\s*([^{}]+)\s*\}$/.exec(name)?.[1]?.trim() ?? name;
          const builtin = BUILTIN_FUNCTIONS.get(romanName);
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

      const ident = expressionIdentifier(i);
      if (ident && !(ident.base.kind === 'greek' && ident.sub === null && RESERVED_COMMANDS.has(ident.base.value))) {
        const entry = registry.intern(ident);
        used.set(entry.id, entry);
        out += opensCall(src, ident.end) ? `\\operatorname{${entry.id}}` : `\\mathrm{${entry.id}}`;
        i = ident.end;
        continue;
      }

      // Any other command passes through whole, so its letters are not
      // mistaken for one-letter variables.
      if (INTEGRAL_COMMANDS.has(cmd.name)) awaitingDifferential = true;
      out += src.slice(i, cmd.end);
      i = cmd.end;
      continue;
    }

    if (isLetter(c)) {
      // `\int … dx`: the `d` is notation and the letter beside it is the
      // variable of integration. Interning the `d` would turn the whole
      // differential into a product and lose the variable entirely.
      if (awaitingDifferential && c === 'd' && src[i + 1] !== '(') {
        const variable = scanIdentifier(src, i + 1);
        if (variable) {
          const entry = registry.intern(variable);
          used.set(entry.id, entry);
          out += `d\\mathrm{${entry.id}}`;
          i = variable.end;
          awaitingDifferential = false;
          continue;
        }
      }

      const ident = expressionIdentifier(i);
      // Bare `i` and `e` keep their built-in meaning; `i_1` and `e_k` do not.
      if (ident.sub === null && RESERVED_LETTERS.has(ident.base.value)
        && !boundedReserved.has(i)) {
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
