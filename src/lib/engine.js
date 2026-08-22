/**
 * Sheet evaluation: classify each line, apply definitions in order, and produce
 * a result for the lines that have one.
 *
 * The sheet is recomputed top-to-bottom from a clean engine on every change, so
 * a definition is visible to the lines below it and nothing leaks between edits.
 */

import { ComputeEngine } from '@cortex-js/compute-engine';
import { IdentifierRegistry, sanitize } from './identifiers.js';
import { decideStatement } from './decide.js';
import {
  ANALYSIS_PREDICATES,
  containsAnalysisConstruct,
  lowerAnalysisProposition,
} from './analysis.js';
import {
  indexOfTopLevel,
  splitTopLevel,
  splitTopLevelCommas,
  splitTopLevelOperators,
  splitTopLevelQuantifierScope,
} from './top-level.js';
import {
  containsSetConstruct,
  describeSetDefinition,
  isSetExpression,
  lowerSetProposition,
  materializeFiniteSet,
  QUANTIFIERS,
  reinterpretCartesianProducts,
  SET_RELATIONS,
  setBuilderParts,
  standardNumericDomain,
} from './sets.js';

const ID_RE = /^Id\d+$/;

const RELATIONS = new Set([
  'Equal', 'NotEqual', 'Less', 'LessEqual', 'Greater', 'GreaterEqual', 'IdenticallyEqual',
]);
const CONNECTIVES = new Set(['Implies', 'Equivalent', 'And', 'Or', 'Not']);
const isStatementOperator = (operator) => (
  RELATIONS.has(operator) || CONNECTIVES.has(operator)
  || SET_RELATIONS.has(operator) || QUANTIFIERS.has(operator)
  || ANALYSIS_PREDICATES.has(operator)
);

/**
 * Compute Engine has no `\impliedby`, so `A <== B` is rewritten to `B ==> A`.
 */
function rewriteReverseImplication(latex) {
  let out = latex;
  for (let guard = 0; guard < 8; guard++) {
    const at = indexOfTopLevel(out, '\\impliedby');
    if (at < 0) break;
    const left = out.slice(0, at).trim();
    const right = out.slice(at + '\\impliedby'.length).trim();
    if (!left || !right) break;
    out = `${right} \\implies ${left}`;
  }
  return out;
}

const CARTESIAN_LOGICAL_TOKENS = ['\\iff', '\\implies', '\\land', '\\lor'];
const CARTESIAN_SET_OPERATION_TOKENS = ['\\setminus', '\\cup', '\\cap'];
const CARTESIAN_SET_RELATION_TOKENS = [
  '\\notin', '\\in',
  '\\nsubseteq', '\\nsubset', '\\subseteq', '\\subset',
  '\\nsupseteq', '\\nsupset', '\\supseteq', '\\supset',
  '=',
];

function joinTopLevel({ parts, operators }) {
  return parts.reduce((out, part, index) => (
    index === 0 ? part : `${out}${operators[index - 1]}${part}`
  ), '');
}

/** Return an outer grouping pair only when it encloses the whole expression. */
function outerCartesianGroup(latex) {
  const source = latex.trim();
  const left = /^(\\left\s*)([([])/.exec(source);
  if (left) {
    const close = left[2] === '(' ? ')' : ']';
    const suffix = new RegExp(`\\\\right\\s*\\${close}$`).exec(source);
    if (suffix) {
      return {
        prefix: source.slice(0, left[0].length),
        inner: source.slice(left[0].length, suffix.index),
        suffix: suffix[0],
      };
    }
  }

  if (source[0] !== '(' && source[0] !== '[') return null;
  const close = source[0] === '(' ? ')' : ']';
  let depth = 0;
  for (let index = 0; index < source.length; index++) {
    if (source[index] === source[0]) depth++;
    else if (source[index] === close) {
      depth--;
      if (depth === 0) {
        return index === source.length - 1
          ? { prefix: source[0], inner: source.slice(1, -1), suffix: close }
          : null;
      }
    }
  }
  return null;
}

function latexIsKnownSet(latex, definitions) {
  const source = latex.trim();
  if (/\\(?:varnothing|emptyset|mathbb|cup|cap|setminus|wp)\b/.test(source)
    || /(?:\\left\s*)?\\\{|\\lbrace/.test(source)
    || /\\(?:mathcal|mathscr)\s*\{\s*P\s*\}/.test(source)
    || /\\operatorname\{(?:PowerSet|CartesianProduct|IndexedUnion|IndexedIntersection|DiscreteTopology|IndiscreteTopology|CofiniteTopology|MetricTopology|SubspaceTopology|ProductTopology)\}/.test(source)) return true;

  const internalId = /^(?:\\mathrm\{)?(Id\d+)(?:\})?$/.exec(source)?.[1];
  return Boolean(internalId && definitions.get(internalId)?.kind === 'set');
}

function latexCanDenoteSet(latex, definitions) {
  const source = latex.trim();
  if (latexIsKnownSet(source, definitions)) return true;
  if (/^(?:\\mathrm\{)?Id\d+(?:\})?$/.test(source)) return true;
  const grouped = outerCartesianGroup(source);
  if (grouped) return latexCanDenoteSet(grouped.inner, definitions);
  const factors = splitTopLevel(source, '\\times', { keepEmpty: true });
  return factors.length > 1
    && factors.every((factor) => factor && latexCanDenoteSet(factor, definitions));
}

function wrappedPowerSetCall(latex) {
  const source = latex.trim();
  const head = /^\\operatorname\{(?:PowerSet|SetCardinality)\}\s*/.exec(source)?.[0];
  if (!head) return null;
  const rest = source.slice(head.length);
  const sized = rest.startsWith('\\left(');
  const prefix = sized ? `${head}\\left(` : `${head}(`;
  const suffix = sized ? '\\right)' : ')';
  if (!source.endsWith(suffix)) return null;
  return {
    prefix,
    inner: source.slice(prefix.length, -suffix.length),
    suffix,
  };
}

/**
 * Any `\operatorname{Name}(...)` spanning the whole expression.
 *
 * A Cartesian product inside a call's arguments is not top-level anywhere the
 * splitting looks — `Cpt(τ, K × K)` has no top-level `\times`, because the one
 * it has is inside the parentheses. Without descending into the arguments the
 * product reaches Compute Engine as multiplication and the line dies on a type
 * error. `ℝ × ℝ` escaped this only because Compute Engine understands products
 * of its own standard sets natively.
 */
function wrappedCall(latex) {
  const source = latex.trim();
  const head = /^\\operatorname\{[A-Za-z][A-Za-z0-9]*\}\s*/.exec(source)?.[0];
  if (!head) return null;
  const rest = source.slice(head.length);
  const sized = rest.startsWith('\\left(');
  const prefix = sized ? `${head}\\left(` : `${head}(`;
  const suffix = sized ? '\\right)' : ')';
  if (!source.startsWith(prefix) || !source.endsWith(suffix)) return null;
  const inner = source.slice(prefix.length, -suffix.length);
  return inner.length === 0 ? null : { prefix, inner, suffix };
}

function wrappedSetBuilder(latex) {
  const source = latex.trim();
  for (const [prefix, suffix] of [
    ['\\left\\{', '\\right\\}'],
    ['\\{', '\\}'],
  ]) {
    if (source.startsWith(prefix) && source.endsWith(suffix)) {
      const inner = source.slice(prefix.length, -suffix.length);
      if (splitTopLevel(inner, '\\mid', { keepEmpty: true }).length > 1) {
        return { prefix, inner, suffix };
      }
    }
  }
  return null;
}

function rewriteCartesianProductOperand(latex, definitions, forceSet) {
  const source = latex.trim();
  const grouped = outerCartesianGroup(source);
  if (grouped) {
    const inner = rewriteCartesianProductSyntax(grouped.inner, definitions, forceSet);
    return inner === grouped.inner.trim()
      ? source
      : `${grouped.prefix}${inner}${grouped.suffix}`;
  }

  const factors = splitTopLevel(source, '\\times', { keepEmpty: true });
  if (factors.length < 2 || factors.some((factor) => !factor)) return source;
  if (!factors.every((factor) => latexCanDenoteSet(factor, definitions))) return source;
  if (!forceSet && !factors.some((factor) => latexIsKnownSet(factor, definitions))) {
    return source;
  }
  const rewrittenFactors = factors.map((factor) => (
    rewriteCartesianProductSyntax(factor, definitions, true)
  ));
  return `\\operatorname{CartesianProduct}\\left(${rewrittenFactors.join(',')}\\right)`;
}

/**
 * Disambiguate conventional `A \\times B` before Compute Engine applies its
 * numeric type checker. Only set-valued positions are forced to Cartesian
 * product; an ordinary line such as `2 \\times 3` remains multiplication.
 */
function rewriteCartesianProductSyntax(latex, definitions, forceSet = false) {
  const source = latex.trim();
  if (!source.includes('\\times')) return source;

  const grouped = outerCartesianGroup(source);
  if (grouped) {
    const inner = rewriteCartesianProductSyntax(grouped.inner, definitions, forceSet);
    return inner === grouped.inner.trim()
      ? source
      : `${grouped.prefix}${inner}${grouped.suffix}`;
  }
  if (source.startsWith('\\neg')) {
    return `\\neg ${rewriteCartesianProductSyntax(source.slice(4), definitions, false)}`;
  }

  const logical = splitTopLevelOperators(source, CARTESIAN_LOGICAL_TOKENS);
  if (logical.operators.length > 0) {
    return joinTopLevel({
      operators: logical.operators,
      parts: logical.parts.map((part) => rewriteCartesianProductSyntax(part, definitions, false)),
    });
  }

  const setOperations = splitTopLevelOperators(source, CARTESIAN_SET_OPERATION_TOKENS);
  if (setOperations.operators.length > 0) {
    return joinTopLevel({
      operators: setOperations.operators,
      parts: setOperations.parts.map((part) => (
        rewriteCartesianProductSyntax(part, definitions, true)
      )),
    });
  }

  const relations = splitTopLevelOperators(source, CARTESIAN_SET_RELATION_TOKENS);
  if (relations.operators.length > 0) {
    const force = relations.parts.map(() => false);
    relations.operators.forEach((operator, index) => {
      if (operator === '\\in' || operator === '\\notin') {
        force[index + 1] = true;
      } else if (operator !== '=') {
        force[index] = true;
        force[index + 1] = true;
      }
    });
    if (relations.operators.includes('=')
      && (force.some(Boolean) || relations.parts.some((part) => latexIsKnownSet(part, definitions)))) {
      force.fill(true);
    }
    return joinTopLevel({
      operators: relations.operators,
      parts: relations.parts.map((part, index) => (
        rewriteCartesianProductSyntax(part, definitions, force[index])
      )),
    });
  }

  const powerSet = wrappedPowerSetCall(source);
  if (powerSet) {
    return `${powerSet.prefix}${rewriteCartesianProductSyntax(
      powerSet.inner, definitions, true
    )}${powerSet.suffix}`;
  }

  const builder = wrappedSetBuilder(source);
  if (builder) {
    const pieces = splitTopLevel(builder.inner, '\\mid', { keepEmpty: true });
    return `${builder.prefix}${pieces.map((piece) => (
      rewriteCartesianProductSyntax(piece, definitions, false)
    )).join('\\mid')}${builder.suffix}`;
  }

  // Descend into a call's arguments. Deliberately without forcing set context:
  // an argument is rewritten only when its factors are already known sets, so
  // `Cpt(τ, K × K)` becomes a product while `f(2 × 3)` stays multiplication.
  const call = wrappedCall(source);
  if (call) {
    const args = splitTopLevelCommas(call.inner);
    if (args.length > 1) {
      return `${call.prefix}${args.map((argument) => (
        rewriteCartesianProductSyntax(argument, definitions, false)
      )).join(',')}${call.suffix}`;
    }
  }

  return rewriteCartesianProductOperand(source, definitions, forceSet);
}

/**
 * A function definition is the one line the parser cannot help us with: it only
 * treats `f(x)` as a call once `f` is known to be a function, and the line that
 * makes it known is this one. So the shape is recognised textually instead.
 *
 * Matches `f(x) = body` / `f(x, y) := body` where every argument is a plain
 * identifier — `f(3) = 9` deliberately does not match and stays an equation.
 */
const FUNCTION_DEFINITION_RE = new RegExp(
  '^\\\\operatorname\\{(Id\\d+)\\}\\s*(?:\\\\left)?\\(\\s*' +
  '((?:\\\\mathrm\\{Id\\d+\\}\\s*,\\s*)*\\\\mathrm\\{Id\\d+\\})' +
  '\\s*(?:\\\\right)?\\)\\s*(?:=|\\\\coloneq)\\s*([\\s\\S]+)$'
);

/** Explicit constant definitions are parsed before logical connectives. */
const CONSTANT_DEFINITION_RE = new RegExp(
  '^\\\\mathrm\\{(Id\\d+)\\}\\s*\\\\coloneq\\s*([\\s\\S]+)$'
);

function stripDecorations(latex) {
  return latex
    .replace(/\\placeholder(\[[^\]]*\])?\{[^}]*\}/g, '')
    .replace(/\\placeholder(\[[^\]]*\])?/g, '')
    .replace(/\\(?:,|;|:|!|quad|qquad)/g, ' ')
    .trim();
}

/**
 * Calculus notation the sheet has no procedure for, and must not guess at.
 *
 * Compute Engine reads `\frac{d}{dx}` as the ordinary fraction `d / (d·x)`, so
 * `\frac{d}{dx}x^2` quietly evaluates to `x`, `d` survives as an ordinary free
 * variable, and the sampling pass then disproves the power rule with a witness
 * naming a variable the reader never typed. An integral goes the same way:
 * `\int_0^1 x^2 dx` normalises to `d·x^3` and is disproved just as confidently.
 *
 * Refusing the line is the honest answer. A wrong `undecided` costs a feature;
 * a wrong `false` carrying a witness costs the reader's trust in every other
 * verdict on the sheet.
 */
const UNSUPPORTED_NOTATION = [
  // `\b` is the wrong boundary here: `_` is a word character, so `\int\b`
  // never matches the `\int_{0}^{1}` that every real integral starts with.
  // "not followed by a letter" is the test that means "end of the command",
  // and it still keeps `\intercal` from reading as an integral.
  [/\\(?:iiint|iint|intop|oint|int)(?![a-zA-Z])/, 'integrals are not supported yet'],
  [/\\partial(?![a-zA-Z])/, 'partial derivatives are not supported yet'],
  [
    // `\frac{d}{dx}`, `\frac{d^2}{dx^2}`, `\frac{dy}{dx}`, and the `\mathrm{d}`
    // spelling of each. Requiring the denominator to open `d` against a letter
    // is what separates the operator from an ordinary fraction over `d`.
    new RegExp(
      '\\\\frac\\s*\\{\\s*(?:\\\\mathrm\\s*\\{\\s*d\\s*\\}|d)'
      + '(?:\\s*\\^\\s*\\{?\\s*\\d+\\s*\\}?)?\\s*[a-zA-Z]?\\s*\\}'
      + '\\s*\\{\\s*(?:\\\\mathrm\\s*\\{\\s*d\\s*\\}|d)\\s*[a-zA-Z]'
    ),
    // Prime notation is real differentiation — `f(x) := x^3` then `f'(x) = 3x^2`
    // is proved, and `f'(x) = 2x^2` is disproved — so the reader is one step
    // from the answer rather than out of luck. Say which step.
    "d/dx reads as a fraction here — define f, then write f'(x)",
  ],
];

/** The first unsupported-notation message this line trips, if any. */
function unsupportedNotation(latex) {
  for (const [pattern, message] of UNSUPPORTED_NOTATION) {
    if (pattern.test(latex)) return message;
  }
  return null;
}

/** First `["Error", ...]` node anywhere in the parsed expression. */
function findError(json) {
  if (Array.isArray(json)) {
    if (json[0] === 'Error') {
      const detail = json[1];
      if (typeof detail === 'string') return detail.replace(/^'|'$/g, '');
      if (Array.isArray(detail) && detail[0] === 'ErrorCode') {
        return String(detail[1]).replace(/^'|'$/g, '');
      }
      return 'invalid expression';
    }
    for (const child of json) {
      const found = findError(child);
      if (found) return found;
    }
  } else if (json && typeof json === 'object') {
    for (const value of Object.values(json)) {
      const found = findError(value);
      if (found) return found;
    }
  }
  return null;
}

function mentions(expr, symbol) {
  try {
    return JSON.stringify(expr.json).includes(`"${symbol}"`);
  } catch {
    return false;
  }
}

function collectBoundSymbols(expr, out = new Set()) {
  if (!expr) return out;
  if (expr.operator === 'ContinuousAt' && expr.ops[2]?.symbol) out.add(expr.ops[2].symbol);
  if (expr.operator === 'LimitAt' && expr.ops[3]?.symbol) out.add(expr.ops[3].symbol);
  if (QUANTIFIERS.has(expr.operator) && expr.nops >= 1) {
    const binding = expr.ops[0];
    if (binding?.symbol) out.add(binding.symbol);
    else if (binding?.operator === 'Element' && binding.ops[0]?.symbol) {
      out.add(binding.ops[0].symbol);
    }
  }
  expr.ops?.forEach((operand) => collectBoundSymbols(operand, out));
  return out;
}

/**
 * Per-variable numeric domains, read off the statement's own quantifiers.
 *
 * `∀n ∈ ℕ, P(n)` is lowered by dropping the quantifier — free variables are
 * already read universally — so the domain would otherwise be lost between the
 * parser and the sampler. Collecting it here from the original expression is
 * what keeps `n` out of the fractions.
 */
function collectDomainRestrictions(expr, out = new Map()) {
  if (!expr) return out;
  if (QUANTIFIERS.has(expr.operator) && expr.nops >= 1) {
    const binding = expr.ops[0];
    if (binding?.operator === 'Element' && binding.nops === 2 && binding.ops[0]?.symbol) {
      const domain = standardNumericDomain(binding.ops[1]);
      if (domain) out.set(binding.ops[0].symbol, domain);
    }
  }
  expr.ops?.forEach((operand) => collectDomainRestrictions(operand, out));
  return out;
}

/**
 * A summation or product whose bound is still symbolic. Sampling one is
 * meaningless — `\sum_{k=1}^{n}` says nothing at n = -6 or n = ½ — and the
 * sampler used to report the resulting nonsense as a counterexample, so
 * `\sum_{k=1}^{n+1}k - \sum_{k=1}^{n}k = n+1` came back false at n = -6.
 * The closed forms Compute Engine knows are found before sampling and are
 * unaffected; what changes is that the rest now says so instead of guessing.
 */
function hasOpenSummation(expr) {
  try {
    return /"(?:Sum|Product)"/.test(JSON.stringify(expr.json)) && expr.unknowns.length > 0;
  } catch {
    return false;
  }
}

/**
 * A cardinality anywhere in the statement.
 *
 * Where the set is finite the count is substituted before anything numeric
 * runs, so those lines are decided exactly and never reach the sampler anyway.
 * Where it is not — `card(ℝ)`, or a name that was never defined as a set — the
 * head survives, and sampling it would mean handing `card` a number and
 * reporting whatever came back as a counterexample. Refusing to sample is the
 * only honest option: this app has no cardinal arithmetic.
 */
function hasCardinality(expr) {
  try {
    return /"SetCardinality"/.test(JSON.stringify(expr.json));
  } catch {
    return false;
  }
}

/**
 * An unknown that is not an interned user name.
 *
 * Every name a reader can write is interned as `Id<n>` before parsing, so any
 * other free symbol in a statement is one of our own builtin heads that
 * Compute Engine declined to read as a call and left as a bare symbol —
 * `card(6)` becomes `6 · SetCardinality`, exactly as `\frac{d}{dx}` becomes
 * `d / (d·x)`. Sampling such a symbol produces a counterexample naming a
 * variable nobody typed, which is the one kind of wrong answer this app must
 * not give. The general rule costs nothing and catches the next one too.
 */
function hasDegradedBuiltin(expr) {
  try {
    return expr.unknowns.some((name) => !ID_RE.test(name));
  } catch {
    return false;
  }
}

/** Engine output uses `\imaginaryI` / `\exponentialE`; users expect `i` and `e`. */
function tidyLatex(latex) {
  if (!latex) return latex;
  return latex
    .replace(/\\imaginaryI/g, 'i')
    .replace(/\\exponentialE/g, 'e')
    // Engine output groups digits with thin spaces, on both sides of the
    // decimal point ("1 732.249 8"). Drop them so exact and decimal agree.
    .replace(/(\d)\\,(?=\d)/g, '$1')
    .replace(/\\operatorname\{Real\}/g, '\\operatorname{Re}')
    .replace(/\\operatorname\{Imaginary\}/g, '\\operatorname{Im}')
    .replace(/\\(?:mathrm|operatorname)\{PowerSet\}/g, '\\mathcal{P}')
    .trim();
}

/** Keep symbolic set constructors in the notation users entered. */
function displaySetValueLatex(expr, registry) {
  if (expr?.operator === 'CartesianProduct' && expr.nops >= 2) {
    return expr.ops.map((factor) => {
      const latex = displaySetValueLatex(factor, registry);
      return ['Union', 'Intersection', 'SetMinus', 'SymmetricDifference', 'CartesianProduct']
        .includes(factor.operator)
        ? `\\left(${latex}\\right)`
        : latex;
    }).join('\\times ');
  }
  if (expr?.operator === 'PowerSet' && expr.nops === 1) {
    return `\\mathcal{P}\\left(${displaySetValueLatex(expr.ops[0], registry)}\\right)`;
  }
  if ((expr?.operator === 'IndexedUnion' || expr?.operator === 'IndexedIntersection')
    && expr.nops === 2) {
    const operation = expr.operator === 'IndexedUnion' ? '\\bigcup' : '\\bigcap';
    const family = displaySetValueLatex(expr.ops[0], registry);
    const indices = displaySetValueLatex(expr.ops[1], registry);
    return `${operation}_{i\\in ${indices}}${family}\\left(i\\right)`;
  }
  const unaryTopologies = new Map([
    ['DiscreteTopology', '\\mathsf{Disc}'],
    ['IndiscreteTopology', '\\mathsf{Ind}'],
    ['CofiniteTopology', '\\mathsf{Cof}'],
    ['MetricTopology', '\\mathsf{Met}'],
  ]);
  if (unaryTopologies.has(expr?.operator) && expr.nops === 2) {
    return `${unaryTopologies.get(expr.operator)}\\left(${displaySetValueLatex(
      expr.ops[0], registry
    )}\\right)`;
  }
  if (expr?.operator === 'SubspaceTopology' && expr.nops === 3) {
    return `\\mathsf{Sub}\\left(${expr.ops.map((operand) => (
      displaySetValueLatex(operand, registry)
    )).join(',')}\\right)`;
  }
  if (expr?.operator === 'ProductTopology' && expr.nops === 4) {
    return `\\mathsf{Prod}\\left(${expr.ops.map((operand) => (
      displaySetValueLatex(operand, registry)
    )).join(',')}\\right)`;
  }
  if ((expr?.operator === 'OpenBall' || expr?.operator === 'ClosedBall') && expr.nops === 2) {
    const ball = expr.operator === 'ClosedBall' ? '\\overline{B}' : 'B';
    return `${ball}\\left(${expr.ops.map((operand) => (
      tidyLatex(registry.toDisplayLatex(operand.latex))
    )).join(',')}\\right)`;
  }
  return tidyLatex(registry.toDisplayLatex(expr?.latex ?? ''));
}

/** Heads that yield a plain number but do not fold over symbolic arguments. */
const UNFOLDED_HEAD = /\\lfloor|\\lceil|\\operatorname\{(?:rnd|round|Real|Imaginary|Re|Im)\}/;

/**
 * Which of the two evaluations to show.
 *
 * Exact wins by default, so `sqrt(8)` stays `2*sqrt(2)` and `1/3` stays `1/3`.
 * But `evaluate()` leaves `ceil(pi)` unfolded — the exact form is then just the
 * input echoed back, which is useless — so fall through to the numeric value
 * when it is a whole number, or when a rounding head is visibly still there.
 */
function pickDisplayForm(exact, numeric) {
  if (!exact) return numeric;
  if (exact.isNumberLiteral) return exact;
  if (!numeric?.isNumberLiteral) return exact;

  const { re, im } = numeric;
  const isWholeReal = !im && Number.isFinite(re) && Math.abs(re - Math.round(re)) < 1e-12;
  if (isWholeReal || UNFOLDED_HEAD.test(exact.latex ?? '')) return numeric;
  return exact;
}

function decimalLatex(numeric, digits) {
  if (!numeric || !numeric.isNumberLiteral) return null;
  const { re, im } = numeric;
  if (!Number.isFinite(re) || (im && !Number.isFinite(im))) return null;
  const fmt = (x) => {
    const s = Number(x.toPrecision(digits));
    return Object.is(s, -0) ? '0' : String(s);
  };
  if (!im) return fmt(re);
  const sign = im < 0 ? '-' : '+';
  const mag = Math.abs(im);
  const magStr = mag === 1 ? '' : fmt(mag);
  return re === 0 ? `${im < 0 ? '-' : ''}${magStr}i` : `${fmt(re)}${sign}${magStr}i`;
}

export class Sheet {
  constructor(options = {}) {
    this.digits = options.digits ?? 12;
    this.reset();
  }

  reset() {
    this.ce = new ComputeEngine();
    this.registry = new IdentifierRegistry();
    this.definitions = new Map();
  }

  /** Recompute every line in order. Returns one result per input line. */
  evaluateAll(lines) {
    this.reset();
    return lines.map((line) => {
      try {
        return this.evaluateLine(line);
      } catch (error) {
        return { kind: 'error', message: error?.message ?? String(error) };
      }
    });
  }

  evaluateLine(rawLatex, options = {}) {
    const trimmed = stripDecorations(rawLatex ?? '');
    if (!trimmed) return { kind: 'empty' };

    const unsupported = unsupportedNotation(trimmed);
    if (unsupported) return { kind: 'error', message: unsupported };

    const { latex, used } = sanitize(trimmed, this.registry);
    const prepared = rewriteReverseImplication(latex);

    if (options.allowDefinitions !== false) {
      const functionDefinition = this.tryFunctionDefinition(prepared);
      if (functionDefinition) return functionDefinition;
      const constantDefinition = this.tryExplicitConstantDefinition(prepared);
      if (constantDefinition) return constantDefinition;
    }

    let expr;
    try {
      expr = this.parseStatement(prepared);
    } catch (error) {
      return { kind: 'error', message: 'could not parse this line' };
    }
    if (!expr) return { kind: 'error', message: 'could not parse this line' };

    const parseError = findError(expr.json);
    if (parseError) {
      return { kind: 'error', message: this.registry.toDisplayName(parseError) };
    }

    if (options.allowDefinitions !== false) {
      const definition = this.tryDefine(expr);
      if (definition) return definition;
    }

    if (isStatementOperator(expr.operator)) {
      return this.evaluateStatement(expr, used);
    }

    // A proposition-valued function call or propositional constant may be a
    // plain symbol/call syntactically, then resolve to a relation, connective,
    // True, or False through its definition. Route that resolved proposition
    // through the statement evaluator rather than displaying symbolic ⊤/⊥.
    try {
      const resolved = expr.evaluate();
      if (isStatementOperator(resolved.operator)
        || resolved.symbol === 'True' || resolved.symbol === 'False') {
        return this.evaluateStatement(resolved, used);
      }
    } catch { /* leave ordinary expressions on the expression path */ }

    return this.evaluateExpression(expr);
  }

  /** Parse `name := body` before `body` can be split as a logical statement. */
  tryExplicitConstantDefinition(preparedLatex) {
    const match = CONSTANT_DEFINITION_RE.exec(preparedLatex.trim());
    if (!match) return null;
    const [, id, body] = match;
    if (this.isDefined(id) || new RegExp(`\\b${id}\\b`).test(body)) return null;

    let bodyExpr;
    try {
      bodyExpr = this.parseStatement(body);
    } catch {
      return null;
    }
    if (!bodyExpr || findError(bodyExpr.json)) return null;
    return this.defineConstant(id, bodyExpr);
  }

  isDefined(id) {
    return this.definitions.has(id);
  }

  /**
   * Parse a line, expanding chains of connectives conjunctively.
   *
   * `A <=> B <=> C` has to mean "all three are equivalent", not the pairwise
   * association a parser would otherwise build — under which two false operands
   * make `A <=> B` true and drag the whole chain to the wrong answer. Both
   * connectives expand to `(A op B) and (B op C)`, `<=>` binding loosest.
   */
  parseStatement(latex) {
    // Textual connective splitting must happen inside a leading quantifier,
    // not outside it. Otherwise `forall x, A ==> B ==> C` becomes
    // `(forall x, A) ==> B` and leaves the later occurrences of x free.
    const quantified = splitTopLevelQuantifierScope(latex);
    if (quantified.clauses.length > 0) {
      let body = this.parseStatement(quantified.body);
      for (let index = quantified.clauses.length - 1; index >= 0; index--) {
        const clause = quantified.clauses[index];
        const rewrittenClause = rewriteCartesianProductSyntax(
          clause.slice(0, -1), this.definitions
        );
        const shell = this.ce.parse(`${rewrittenClause},1=1`);
        if (!QUANTIFIERS.has(shell?.operator) || shell.nops !== 2) {
          return this.ce.parse(latex);
        }
        body = this.ce.box([shell.operator, shell.ops[0], body]);
      }
      return reinterpretCartesianProducts(this.ce, body, this.definitions);
    }

    for (const [token, operator] of [['\\iff', 'Equivalent'], ['\\implies', 'Implies']]) {
      const parts = splitTopLevel(latex, token);
      if (parts.length < 2) continue;

      const operands = parts.map((part) => this.parseStatement(part));
      const links = [];
      for (let i = 0; i + 1 < operands.length; i++) {
        links.push(this.ce.box([operator, operands[i], operands[i + 1]]));
      }
      return links.length === 1 ? links[0] : this.ce.box(['And', ...links]);
    }
    const rewritten = rewriteCartesianProductSyntax(latex, this.definitions);
    return reinterpretCartesianProducts(
      this.ce, this.ce.parse(rewritten), this.definitions
    );
  }

  /** See FUNCTION_DEFINITION_RE. Returns null when the line is not one. */
  tryFunctionDefinition(preparedLatex) {
    const match = FUNCTION_DEFINITION_RE.exec(preparedLatex.trim());
    if (!match) return null;

    const [, head, argList, body] = match;
    if (this.isDefined(head)) return null;

    const params = [...argList.matchAll(/Id\d+/g)].map((m) => m[0]);
    if (new Set(params).size !== params.length) return null;
    if (params.some((p) => this.isDefined(p))) return null;
    if (new RegExp(`\\b${head}\\b`).test(body)) return null;

    let bodyExpr;
    try {
      bodyExpr = this.parseStatement(body);
    } catch {
      return null;
    }
    if (!bodyExpr || findError(bodyExpr.json)) return null;

    return this.defineFunction(head, params, bodyExpr);
  }

  /**
   * A line is a definition when it uses `:=`, or when it uses `=` and its
   * left side is a name that is not yet in use — either a bare name (constant)
   * or a name applied to distinct fresh names (function).
   */
  tryDefine(expr) {
    if (expr.operator === 'Assign' && expr.nops === 2) {
      const [target, value] = expr.ops;
      if (target.symbol) return this.applyDefinition(target.symbol, value);
    }

    if (expr.operator !== 'Equal' || expr.nops !== 2) return null;
    const [lhs, rhs] = expr.ops;

    if (lhs.symbol && ID_RE.test(lhs.symbol)) {
      if (this.isDefined(lhs.symbol) || mentions(rhs, lhs.symbol)) return null;
      return this.defineConstant(lhs.symbol, rhs);
    }

    const head = lhs.operator;
    if (head && ID_RE.test(head) && lhs.nops >= 1 && !this.isDefined(head) && !mentions(rhs, head)) {
      const params = lhs.ops.map((op) => op.symbol);
      const allFresh = params.every((p) => p && ID_RE.test(p) && !this.isDefined(p));
      const distinct = new Set(params).size === params.length;
      if (allFresh && distinct) return this.defineFunction(head, params, rhs);
    }

    return null;
  }

  /** Dispatch an explicit `:=` to the constant or function path. */
  applyDefinition(id, value) {
    if (value.operator === 'Function') {
      const ops = value.ops ?? [];
      const body = ops[0];
      const params = ops.slice(1).map((op) => op.symbol).filter(Boolean);
      if (body && params.length) return this.defineFunction(id, params, unwrapBlock(body));
    }
    return this.defineConstant(id, value);
  }

  defineConstant(id, valueExpr) {
    const setDefinition = describeSetDefinition(valueExpr, this.definitions);
    this.ce.assign(id, valueExpr);
    this.definitions.set(id, setDefinition
      ? { kind: 'set', valueExpr, builder: setDefinition.builder }
      : { kind: 'constant' });
    const entry = this.registry.get(id);
    return {
      kind: 'definition',
      what: setDefinition ? 'set' : 'constant',
      nameLatex: entry?.latex ?? id,
      name: entry?.name ?? id,
      valueLatex: setDefinition
        ? displaySetValueLatex(valueExpr, this.registry)
        : tidyLatex(this.registry.toDisplayLatex(valueExpr.latex)),
    };
  }

  defineFunction(id, paramIds, bodyExpr) {
    const body = unwrapBlock(bodyExpr);
    this.ce.assign(id, ['Function', body.json, ...paramIds]);
    this.definitions.set(id, {
      kind: 'function', arity: paramIds.length, paramIds: [...paramIds], bodyExpr: body,
    });
    const entry = this.registry.get(id);
    return {
      kind: 'definition',
      what: 'function',
      nameLatex: entry?.latex ?? id,
      name: entry?.name ?? id,
      arity: paramIds.length,
      paramsLatex: paramIds.map((p) => this.registry.get(p)?.latex ?? p),
      valueLatex: tidyLatex(this.registry.toDisplayLatex(bodyExpr.latex)),
    };
  }

  evaluateExpression(expr) {
    if (isSetExpression(expr, this.definitions)) {
      const builder = setBuilderParts(expr);
      let value = expr;
      if (!builder) {
        value = materializeFiniteSet(this.ce, expr, this.definitions) ?? expr;
        if (value === expr) {
          try { value = expr.evaluate(); } catch { /* display the original set expression */ }
        }
      }
      const bound = builder?.binder;
      const unknowns = expr.unknowns.filter((id) => id !== bound);
      return {
        kind: 'set',
        latex: displaySetValueLatex(value, this.registry),
        undefinedNames: unknowns.map((id) => this.registry.get(id)?.name ?? id),
      };
    }

    const unknowns = expr.unknowns;
    if (unknowns.length > 0) {
      let simplified = expr;
      try { simplified = expr.simplify(); } catch { /* keep original */ }
      return {
        kind: 'symbolic',
        latex: tidyLatex(this.registry.toDisplayLatex(simplified.latex)),
        undefinedNames: unknowns.map((id) => this.registry.get(id)?.name ?? id),
      };
    }

    let exact = null;
    let numeric = null;
    try { exact = expr.evaluate(); } catch { /* ignore */ }
    try { numeric = expr.N(); } catch { /* ignore */ }

    const source = pickDisplayForm(exact, numeric);
    if (!source) return { kind: 'error', message: 'could not evaluate' };
    if (source.isNaN) return { kind: 'error', message: 'undefined' };

    // Every name is defined, yet nothing reduces to a number — e.g. a bare
    // reference to a defined function. Report it as symbolic rather than
    // dressing the input back up as its own "value".
    if (!exact?.isNumberLiteral && !numeric?.isNumberLiteral) {
      return {
        kind: 'symbolic',
        latex: tidyLatex(this.registry.toDisplayLatex(source.latex)),
        undefinedNames: [],
      };
    }

    const exactLatex = tidyLatex(this.registry.toDisplayLatex(source.latex));
    const approx = decimalLatex(numeric, this.digits);
    return {
      kind: 'value',
      exactLatex,
      approxLatex: approx !== null && approx !== exactLatex ? approx : null,
      isExact: exact ? exact.isNumberLiteral === true : false,
    };
  }

  evaluateStatement(expr, used) {
    const complex = JSON.stringify(expr.json).includes('Complex');
    const boundSymbols = collectBoundSymbols(expr);
    const domains = collectDomainRestrictions(expr);
    // A degraded builtin is not a statement this app can answer at all, and
    // every pass below — including the exact sign chart, which happily decides
    // `6·SetCardinality = 1` — would answer it anyway. Refuse the line instead.
    // Undecided rather than an error: `card(S)` for a name that is simply not
    // defined yet is an honest unknown, not a malformed line. What matters is
    // returning before any pass runs, since each of them would answer.
    if (hasDegradedBuiltin(expr)) {
      return {
        kind: 'truth', value: null, method: 'undecided', samples: 0, counterexample: null,
      };
    }
    const refuseSampling = hasOpenSummation(expr) || hasCardinality(expr);
    let decidedExpr = expr;
    let verdict;
    let analysis = null;

    if (containsAnalysisConstruct(decidedExpr)) {
      analysis = lowerAnalysisProposition(
        this.ce,
        decidedExpr,
        this.definitions,
        () => this.registry.createInternal().id,
      );
      decidedExpr = analysis.expr;
    }

    if (containsSetConstruct(decidedExpr, this.definitions)) {
      // Lower before evaluating so Compute Engine cannot mistake two symbolic
      // set-builders for unequal opaque values. Closed strict-subset and finite
      // existential forms remain unchanged and are still decided directly.
      const lowered = lowerSetProposition(
        this.ce,
        decidedExpr,
        this.definitions,
        () => this.registry.createInternal().id
      );
      decidedExpr = lowered.expr;
      const realSymbols = new Set([
        ...(analysis?.realSymbols ?? []),
        ...(lowered.realSymbols ?? []),
      ]);
      verdict = decideStatement(this.ce, decidedExpr, {
        complex,
        // An unresolved set variable must never receive a numeric test value.
        allowSampling: !analysis && !lowered.unresolvedSets && !refuseSampling,
        domains,
        // Nor may an opaque set/domain atom be accepted from Compute Engine's
        // eager evaluation; the symbolic tautology prover still runs below it.
        allowDirectEvaluation: !analysis?.unsafeEvaluation
          && !analysis?.unresolvedAnalysis
          && !lowered.unsafeEvaluation && !lowered.unresolvedSets,
        realSymbols,
      });
    } else {
      verdict = decideStatement(this.ce, decidedExpr, {
        complex,
        allowSampling: !analysis && !refuseSampling,
        allowDirectEvaluation: !analysis?.unsafeEvaluation && !analysis?.unresolvedAnalysis,
        realSymbols: analysis?.realSymbols,
        domains,
      });
    }

    return {
      kind: 'truth',
      value: verdict.value,
      method: verdict.method,
      samples: verdict.samples,
      counterexample: verdict.counterexample
        ? verdict.counterexample.map(({ id, valueLatex }) => ({
          nameLatex: this.registry.get(id)?.latex ?? id,
          valueLatex: tidyLatex(valueLatex),
        }))
        : null,
      undefinedNames: decidedExpr.unknowns
        .filter((id) => this.registry.get(id)?.kind !== 'internal' && !boundSymbols.has(id))
        .map((id) => this.registry.get(id)?.name ?? id),
      usedCount: used.size,
    };
  }
}

/** `x |-> x^2` parses with the body wrapped in a `Block`. */
function unwrapBlock(expr) {
  if (expr?.operator === 'Block' && expr.nops === 1) return expr.ops[0];
  return expr;
}
