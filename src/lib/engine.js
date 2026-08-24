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
import { decideGroupEquation } from './group-word.js';
import {
  NO_PROOF, OPAQUE_PROOF, provedBy, restoreIdentifiers, singleStep,
} from './proof-trace.js';
import { certify } from './kernel.js';
import {
  ANALYSIS_PREDICATES,
  containsAnalysisConstruct,
  lowerAnalysisProposition,
} from './analysis.js';
import { ALGEBRA_PREDICATES, algebraCarrierSize } from './algebra.js';
import { collectIntegrals, integralObstruction } from './integral.js';
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
  PRIME_SETS,
  primeMembershipCertificate,
  QUANTIFIERS,
  radicalMembershipCertificate,
  reinterpretCartesianProducts,
  resolveCardinalities,
  SET_RELATIONS,
  setBuilderParts,
  standardNumericDomain,
} from './sets.js';

const ID_RE = /^Id\d+$/;

/** The one shape `sanitize` rewrites a `d/dx` or `∂/∂x` operator into. */
const DERIVATIVE_OPERATOR = /\\frac\{(?:d|\\partial)(?:\^\{\d+\})?\}\{(?:d|\\partial) \\mathrm\{Id\d+\}(?:\^\{\d+\})?\}/g;

const RELATIONS = new Set([
  'Equal', 'NotEqual', 'Less', 'LessEqual', 'Greater', 'GreaterEqual', 'IdenticallyEqual',
]);
const CONNECTIVES = new Set(['Implies', 'Equivalent', 'And', 'Or', 'Not']);
const isStatementOperator = (operator) => (
  RELATIONS.has(operator) || CONNECTIVES.has(operator)
  || SET_RELATIONS.has(operator) || QUANTIFIERS.has(operator)
  || ANALYSIS_PREDICATES.has(operator)
);

function isPropositionExpression(expr, definitions) {
  if (!expr) return false;
  if (isStatementOperator(expr.operator)
    || expr.symbol === 'True' || expr.symbol === 'False') return true;
  const definition = definitions.get(expr.symbol ?? expr.operator);
  return definition?.proposition === true;
}

/**
 * Inline user-defined propositions and predicates before proof dispatch.
 *
 * Compute Engine expands a predicate call when it is evaluated on its own, but
 * deliberately leaves it opaque inside `Implies`, `And`, and the other logical
 * heads. That made `L(x) := x > 1` reusable as a value but not as the named
 * premise in `L(x) \vdash x > 0`: the exact prover saw an unknown function and
 * fell through to sampling. Lemmas are definitions, not trusted declarations,
 * so expand their checked bodies and let the ordinary proof machinery decide
 * the resulting proposition from scratch.
 */
function expandNamedPropositions(ce, expr, definitions, expanding = new Set()) {
  if (!expr) return expr;

  if (expr.symbol) {
    const definition = definitions.get(expr.symbol);
    if (definition?.proposition && definition.valueExpr && !expanding.has(expr.symbol)) {
      const next = new Set(expanding).add(expr.symbol);
      return expandNamedPropositions(ce, definition.valueExpr, definitions, next);
    }
    return expr;
  }

  const definition = definitions.get(expr.operator);
  if (definition?.proposition && definition.bodyExpr
    && definition.paramIds?.length === expr.nops && !expanding.has(expr.operator)) {
    const substitution = Object.fromEntries(
      definition.paramIds.map((parameter, index) => [parameter, expr.ops[index]])
    );
    try {
      const next = new Set(expanding).add(expr.operator);
      return expandNamedPropositions(
        ce, definition.bodyExpr.subs(substitution), definitions, next
      );
    } catch { /* retain the call and let the ordinary evaluator report it */ }
  }

  if (!expr.ops?.length) return expr;
  const operands = expr.ops.map((operand) => (
    expandNamedPropositions(ce, operand, definitions, expanding)
  ));
  return ce.box([expr.operator, ...operands]);
}

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
/** The index just past the `(...)` starting at `start`, or -1. */
function groupEndsAt(latex, start) {
  if (latex[start] !== '(') return -1;
  let depth = 0;
  for (let index = start; index < latex.length; index += 1) {
    if (latex[index] === '(') depth += 1;
    else if (latex[index] === ')') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

/** The index of the `(` opening the `(...)` that ends at `end`, or -1. */
function groupStartsAt(latex, end) {
  if (latex[end - 1] !== ')') return -1;
  let depth = 0;
  for (let index = end - 1; index >= 0; index -= 1) {
    if (latex[index] === ')') depth += 1;
    else if (latex[index] === '(') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** An immediate operand ending at an infix vector operator. */
function leftVectorOperand(latex, operatorAt) {
  const before = latex.slice(0, operatorAt).trimEnd();
  const end = before.length;

  const matrixEnd = /\\end\{([a-zA-Z]*matrix)\}$/.exec(before);
  if (matrixEnd) {
    const begin = `\\begin{${matrixEnd[1]}}`;
    const start = before.lastIndexOf(begin);
    if (start >= 0) return { start, end, latex: before.slice(start) };
  }

  if (before.endsWith(')')) {
    const open = groupStartsAt(before, end);
    if (open >= 0) {
      const prefix = before.slice(0, open);
      const head = /\\operatorname\{Id\d+\}\s*(?:\\left\s*)?$/.exec(prefix)
        ?? /\\left\s*$/.exec(prefix);
      const start = head?.index ?? open;
      return { start, end, latex: before.slice(start) };
    }
  }

  const symbol = /\\mathrm\s*\{\s*Id\d+\s*\}$/.exec(before);
  return symbol
    ? { start: symbol.index, end, latex: symbol[0] }
    : null;
}

/** An immediate operand starting just after an infix vector operator. */
function rightVectorOperand(latex, operatorEnd) {
  const rest = latex.slice(operatorEnd);
  const padding = rest.length - rest.trimStart().length;
  const start = operatorEnd + padding;
  const source = latex.slice(start);

  const matrix = /^\\begin\{([a-zA-Z]*matrix)\}/.exec(source);
  if (matrix) {
    const close = `\\end{${matrix[1]}}`;
    const at = source.indexOf(close, matrix[0].length);
    if (at >= 0) {
      const end = start + at + close.length;
      return { start, end, latex: latex.slice(start, end) };
    }
  }

  const call = /^\\operatorname\{Id\d+\}\s*(?:\\left\s*)?\(/.exec(source);
  if (call) {
    const open = start + call[0].lastIndexOf('(');
    const end = groupEndsAt(latex, open);
    if (end >= 0) return { start, end, latex: latex.slice(start, end) };
  }

  const sized = /^\\left\s*\(/.exec(source);
  if (sized) {
    const open = start + sized[0].lastIndexOf('(');
    const end = groupEndsAt(latex, open);
    if (end >= 0) return { start, end, latex: latex.slice(start, end) };
  }
  if (source.startsWith('(')) {
    const end = groupEndsAt(latex, start);
    if (end >= 0) return { start, end, latex: latex.slice(start, end) };
  }

  const symbol = /^\\mathrm\s*\{\s*Id\d+\s*\}/.exec(source);
  return symbol
    ? { start, end: start + symbol[0].length, latex: symbol[0] }
    : null;
}

/** Components and written orientation of a tuple, row vector, or column vector. */
function vectorData(expr, definitions) {
  const value = collectionExpression(expr, definitions);
  if (value?.operator === 'Tuple') return { entries: value.ops, orientation: 'tuple' };
  const rows = matrixRows(value, definitions);
  if (!rows?.length) return null;
  if (rows.length === 1 && rows[0].nops >= 1) {
    return { entries: rows[0].ops, orientation: 'row' };
  }
  if (rows.every((row) => row.nops === 1)) {
    return { entries: rows.map((row) => row.ops[0]), orientation: 'column' };
  }
  return null;
}

function parseVectorOperand(ce, operand, definitions) {
  try {
    return vectorData(ce.parse(operand), definitions);
  } catch {
    return null;
  }
}

const tupleArgument = (entries) => `(${entries.map((entry) => entry.latex).join(',')})`;

function crossProductLatex(left, right) {
  if (left.entries.length !== 3 || right.entries.length !== 3) {
    return `\\operatorname{Cross}(${tupleArgument(left.entries)},${tupleArgument(right.entries)})`;
  }
  const product = (a, b) => `\\left(${a.latex}\\right)\\left(${b.latex}\\right)`;
  const components = [
    `${product(left.entries[1], right.entries[2])}-${product(left.entries[2], right.entries[1])}`,
    `${product(left.entries[2], right.entries[0])}-${product(left.entries[0], right.entries[2])}`,
    `${product(left.entries[0], right.entries[1])}-${product(left.entries[1], right.entries[0])}`,
  ];
  if (left.orientation === 'tuple') return `(${components.join(',')})`;
  const separator = left.orientation === 'row' ? '&' : '\\\\';
  return `\\begin{pmatrix}${components.join(separator)}\\end{pmatrix}`;
}

/**
 * Disambiguate vector `\cdot` and `\times` before the parser turns both into
 * ordinary multiplication. Matrices that are not one-dimensional, numbers,
 * and sets are untouched for their respective multiplication/product paths.
 */
function rewriteVectorProducts(ce, latex, definitions) {
  let out = latex;
  for (let guard = 0; guard < 32; guard += 1) {
    let rewritten = null;
    for (const token of ['\\cdot', '\\times']) {
      for (let at = out.indexOf(token); at >= 0; at = out.indexOf(token, at + 1)) {
        const leftOperand = leftVectorOperand(out, at);
        const rightOperand = rightVectorOperand(out, at + token.length);
        if (!leftOperand || !rightOperand) continue;
        const left = parseVectorOperand(ce, leftOperand.latex, definitions);
        const right = parseVectorOperand(ce, rightOperand.latex, definitions);
        if (!left || !right) continue;

        const replacement = token === '\\cdot'
          ? `\\operatorname{Dot}(${tupleArgument(left.entries)},${tupleArgument(right.entries)})`
          : crossProductLatex(left, right);
        rewritten = `${out.slice(0, leftOperand.start)}${replacement}${out.slice(rightOperand.end)}`;
        break;
      }
      if (rewritten !== null) break;
    }
    if (rewritten === null) return out;
    out = rewritten;
  }
  return out;
}

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
  // A single definite integral is admitted by `integralObstruction`, which
  // checks the bounds and hunts for poles before any value is believed. The
  // rest have no such gate and stay refused.
  [/\\(?:iiint|iint|intop|oint)(?![a-zA-Z])/, 'only a single definite integral is supported'],
  [
    // `\frac{dy}{dx}`: a numerator naming a dependent variable. Compute Engine
    // evaluates this to 0 — it has no record that `y` varies with `x` — which
    // would disprove true statements rather than decline them. The operator
    // forms `\frac{d}{dx}` and `\frac{d^2}{dx^2}` are understood and are
    // rewritten by `sanitize`; only the ratio is refused.
    new RegExp(
      '\\\\frac\\s*\\{\\s*(?:\\\\mathrm\\s*\\{\\s*d\\s*\\}|d)'
      + '(?:\\s*\\^\\s*\\{?\\s*\\d+\\s*\\}?)?\\s*[a-zA-Z]\\s*\\}'
      + '\\s*\\{\\s*(?:\\\\mathrm\\s*\\{\\s*d\\s*\\}|d)\\s*[a-zA-Z]'
    ),
    // Prime notation is real differentiation — `f(x) := x^3` then `f'(x) = 3x^2`
    // is proved, and `f'(x) = 2x^2` is disproved — so the reader is one step
    // from the answer rather than out of luck. Say which step.
    "dy/dx needs to know how y depends on x — define f, then write f'(x)",
  ],
];

/**
 * `𝖦𝗋𝗉 ⊢ L = R` and `𝖠𝖻𝗅 ⊢ L = R`: an equation to decide for every group, or
 * for every abelian group. The turnstile keeps its usual reading — prove the
 * right side from the assumptions on the left — with the group axioms as Γ.
 */
const EQUATIONAL_GOAL = /^\\mathsf\{(Grp|Abl)\}\s*\\vdash/;

function equationalGoal(latex) {
  const match = EQUATIONAL_GOAL.exec(latex.trim());
  if (!match) return null;
  const equation = latex.trim().slice(match[0].length).trim();
  return equation ? { abelian: match[1] === 'Abl', equation } : null;
}

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
/**
 * Any matrix anywhere in the statement.
 *
 * Sampling substitutes numbers for free variables, which is meaningless
 * against a matrix: `M^{T}` with `T` read as a variable becomes a power, and
 * the sampler will happily report a counterexample to a true transpose
 * identity. Matrix statements are decided exactly or not at all.
 */
/** Compute Engine renders an evaluation failure as `\error{...}` markup. */
const ERROR_MARKUP = /\\error\s*\{/;

/**
 * A matrix template with cells still unfilled.
 *
 * `stripDecorations` removes `\placeholder{}`, so a half-typed grid arrives as
 * rows of unequal length — `[[1], [3, 4]]` — which would otherwise be shown
 * back as that list. Every other template reports "missing" until it is
 * complete, and a matrix should say the same.
 */
function incompleteMatrix(value) {
  if (value?.operator !== 'List') return false;
  const rows = value.ops ?? [];
  if (!rows.length || !rows.every((row) => row?.operator === 'List')) return false;
  const widths = rows.map((row) => row.nops);
  return widths.some((width) => width === 0) || new Set(widths).size > 1;
}

/**
 * Any derivative in the expression.
 *
 * `simplify()` leaves `D(x^2, x)` alone, so a bare derivative would be echoed
 * back at the reader rather than carried out. `evaluate()` differentiates it.
 */
function hasDerivative(expr) {
  const walk = (node) => {
    if (!Array.isArray(node)) return false;
    if (node[0] === 'D') return true;
    return node.some(walk);
  };
  try {
    return walk(expr.json);
  } catch {
    return false;
  }
}

/**
 * Evaluate `partial(variable, expression, point)` in the order its notation
 * promises: differentiate the expression symbolically, then substitute the
 * point for that one variable. Other free variables remain symbolic, as in
 * `partial(x, x^2 y, 3) = 6y`.
 */
function lowerPartialDerivativesAt(ce, expr) {
  if (!expr) return { expr, error: null };

  const operands = [];
  for (const operand of expr.ops ?? []) {
    const lowered = lowerPartialDerivativesAt(ce, operand);
    if (lowered.error) return lowered;
    operands.push(lowered.expr);
  }

  if (expr.operator === 'PartialDerivativeAt') {
    if (operands.length !== 3) {
      return { expr, error: 'partial needs a variable, an expression, and a point' };
    }
    const [variable, body, point] = operands;
    if (!variable?.symbol || !ID_RE.test(variable.symbol)) {
      return { expr, error: 'the first partial input must be a variable' };
    }
    try {
      const derivative = ce.box(['D', body, variable]).evaluate();
      return {
        expr: derivative.subs({ [variable.symbol]: point }).evaluate(),
        error: null,
      };
    } catch {
      return { expr, error: 'could not calculate that partial derivative' };
    }
  }

  if (!operands.length || operands.every((operand, index) => operand === expr.ops[index])) {
    return { expr, error: null };
  }
  try {
    return { expr: ce.box([expr.operator, ...operands]), error: null };
  } catch {
    return { expr, error: 'could not calculate that partial derivative' };
  }
}

function hasCollectionAccess(expr) {
  try {
    return /"At"/.test(JSON.stringify(expr.json));
  } catch {
    return false;
  }
}

function hasMatrix(expr) {
  const walk = (node) => {
    if (!Array.isArray(node)) return false;
    if (node[0] === 'Matrix') return true;
    return node.some(walk);
  };
  try {
    return walk(expr.json);
  } catch {
    return false;
  }
}

/** Resolve a constant far enough to tell whether it is a matrix or vector. */
function collectionExpression(expr, definitions, seen = new Set()) {
  if (!expr) return null;
  if (expr.operator === 'Matrix' || expr.operator === 'Tuple' || expr.operator === 'List') {
    return expr;
  }

  if (expr.symbol && !seen.has(expr.symbol)) {
    const value = definitions.get(expr.symbol)?.valueExpr;
    if (value) {
      return collectionExpression(value, definitions, new Set(seen).add(expr.symbol));
    }
  }

  const definition = definitions.get(expr.operator);
  if (definition?.kind !== 'function' || seen.has(expr.operator)
    || definition.paramIds?.length !== expr.nops) return null;
  try {
    const substitution = Object.fromEntries(
      definition.paramIds.map((parameter, index) => [parameter, expr.ops[index]])
    );
    const value = definition.bodyExpr.subs(substitution);
    return collectionExpression(value, definitions, new Set(seen).add(expr.operator));
  } catch {
    return null;
  }
}

function collectionKind(expr, definitions) {
  const value = collectionExpression(expr, definitions);
  if (!value) return null;
  if (value.operator === 'Tuple') return 'vector';
  if (value.operator === 'Matrix') return 'matrix';
  if (value.operator !== 'List') return null;
  return value.ops?.every((row) => row?.operator === 'List') ? 'matrix' : 'vector';
}

/** The rows of a literal/defined matrix, or null when its shape is unknown. */
function matrixRows(expr, definitions) {
  const value = collectionExpression(expr, definitions);
  if (value?.operator === 'Matrix') {
    const data = value.ops?.[0];
    return data?.operator === 'List' ? data.ops : null;
  }
  if (value?.operator === 'List'
    && value.ops?.every((row) => row?.operator === 'List')) return value.ops;
  return null;
}

const numericIndex = (expr) => expr?.isNumberLiteral === true;

/**
 * Give collection subscripts their conventional one-based meaning.
 */
function lowerLinearAlgebra(ce, expr, definitions) {
  if (!expr?.operator || !expr.ops?.length) return expr;

  const operands = expr.ops.map((operand) => lowerLinearAlgebra(ce, operand, definitions));
  let node = operands.every((operand, index) => operand === expr.ops[index])
    ? expr
    : ce.box([expr.operator, ...operands]);

  if (node.operator === 'Subscript' && node.nops === 2
    && collectionKind(node.ops[0], definitions)) {
    const [, rawIndex] = node.ops;
    const base = collectionExpression(node.ops[0], definitions) ?? node.ops[0];
    const indices = rawIndex.operator === 'Sequence' ? rawIndex.ops : [rawIndex];
    if (indices.length === 2 && indices.every(numericIndex)) {
      return ce.box(['At', ['At', base, indices[0]], indices[1]]);
    }
    if (indices.length === 1 && numericIndex(indices[0])) {
      const rows = matrixRows(base, definitions);
      if (rows?.length === 1) return ce.box(['At', ['At', base, 1], indices[0]]);
      if (rows?.every((row) => row.nops === 1)) {
        return ce.box(['At', ['At', base, indices[0]], 1]);
      }
      return ce.box(['At', base, indices[0]]);
    }
  }

  // The parser already lowers a one-index subscript to `At`. A matrix-backed
  // row or column vector still needs its singleton dimension removed.
  if (node.operator === 'At' && node.nops === 2 && numericIndex(node.ops[1])) {
    const base = collectionExpression(node.ops[0], definitions) ?? node.ops[0];
    if (base.operator === 'Tuple' || (base.operator === 'List'
      && !base.ops?.every((entry) => entry?.operator === 'List'))) {
      return ce.box(['At', base, node.ops[1]]);
    }
    const rows = matrixRows(base, definitions);
    if (rows?.length === 1) return ce.box(['At', ['At', base, 1], node.ops[1]]);
    if (rows?.every((row) => row.nops === 1)) {
      return ce.box(['At', ['At', base, node.ops[1]], 1]);
    }
  }

  return node;
}

/**
 * Compute Engine canonicalizes products of named constants before consulting
 * their assigned matrix values, which can reverse a non-commutative product.
 * Inline only known matrix constants before parsing so `BA` stays `B A`.
 */
function expandMatrixConstants(latex, definitions) {
  let out = latex;
  for (let guard = 0; guard < 16; guard += 1) {
    let changed = false;
    out = out.replace(/\\mathrm\s*\{\s*(Id\d+)\s*\}/g, (whole, id) => {
      const value = definitions.get(id)?.valueExpr;
      if (collectionKind(value, definitions) !== 'matrix') return whole;
      changed = true;
      return `\\left(${value.latex}\\right)`;
    });
    if (!changed) break;
  }
  return out;
}

function hasDegradedBuiltin(expr) {
  try {
    // `\mathbb{P}` is unknown to Compute Engine and known to this application,
    // so it is the one symbol that reaches here degraded and still means
    // something. Without the exemption every primality row is refused before
    // any pass runs.
    return expr.unknowns.some((name) => !ID_RE.test(name) && !PRIME_SETS.has(name));
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
    // Withholding Compute Engine's verdict is the one permission the sheet
    // has today: everything it settles by authority alone becomes undecided,
    // and everything the symbolic passes can prove stays proved. It is how the
    // kernel's central invariant — that refusing a theorem may only ever move
    // a verdict toward undecided — is put under test.
    this.allowDirectEvaluation = options.allowDirectEvaluation !== false;
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

    // `sanitize` rewrites `\vdash` into `\implies` below, and internalizes
    // every name. Keep the line as it was written, so a proof can be presented
    // as the sequent the reader typed rather than as its normalized form.
    const source = {
      kind: indexOfTopLevel(trimmed, '\\vdash') >= 0 ? 'sequent' : 'statement',
      latex: trimmed,
    };

    // `𝖦𝗋𝗉 ⊢ …` is a claim about every group, not about a carrier on this
    // sheet, so it is decided before the ordinary machinery sees it — and
    // deliberately before `sanitize`, which rewrites `\vdash` into `\implies`.
    const equational = equationalGoal(trimmed);
    if (equational) {
      const { latex: equation } = sanitize(equational.equation, this.registry);
      const reduction = decideGroupEquation(
        equation,
        equational.abelian,
        (name) => this.registry.get(name)?.latex ?? name,
      );
      const verdict = reduction?.value ?? null;
      if (verdict === null) {
        return {
          kind: 'truth', value: null, method: 'undecided', samples: 0, counterexample: null,
          ...NO_PROOF,
        };
      }
      // The whole argument is the normal form: both sides reduce to one word.
      const reductionProof = verdict === true
        ? singleStep('group.free-reduction', trimmed, {
          normalFormLatex: reduction.normalFormLatex,
          abelian: equational.abelian,
        })
        : null;
      return {
        kind: 'truth',
        value: verdict,
        // False here means the identity already fails in the free group, so a
        // group refuting it exists. That is exact, but the witness is a group
        // rather than an assignment, and there is no variable to display.
        method: verdict ? 'proved' : 'disproved',
        samples: 0,
        counterexample: null,
        ...(reductionProof ? provedBy(certify(reductionProof)) : OPAQUE_PROOF),
      };
    }

    const sanitized = sanitize(trimmed, this.registry, {
      isCollectionSubscript: (base, rawIndex) => {
        if (!/^\s*-?\d+\s*(?:,\s*-?\d+\s*)?$/.test(rawIndex)) return false;
        const entry = this.registry.lookup(base);
        return Boolean(entry
          && collectionKind(this.definitions.get(entry.id)?.valueExpr, this.definitions));
      },
    });
    const { used } = sanitized;
    const latex = expandMatrixConstants(sanitized.latex, this.definitions);

    // `sanitize` rewrites a derivative operator into exactly one canonical
    // form, so setting those aside leaves only the shapes this app has no
    // procedure for — a mixed partial, or a lone `\partial` in an expression.
    const withoutOperators = latex.replace(DERIVATIVE_OPERATOR, '');
    if (withoutOperators.includes('\\partial')) {
      return { kind: 'error', message: 'only \\partial f / \\partial x is supported' };
    }

    // `f(x)` for an undefined `f` is read as the product `f · x`, so its
    // derivative comes back as `f` — an answer to a question nobody asked.
    // Every name in call position is written `\operatorname{...}`, which is
    // what makes this visible before Compute Engine flattens it.
    const hasWrittenDerivative = withoutOperators !== latex
      || latex.includes('\\operatorname{PartialDerivativeAt}');
    if (hasWrittenDerivative) {
      const applied = [...latex.matchAll(/\\operatorname\{(Id\d+)\}\s*\(/g)];
      const unknown = applied.find(([, id]) => this.definitions.get(id)?.kind !== 'function');
      if (unknown) {
        const name = this.registry.get(unknown[1])?.name ?? 'that function';
        return { kind: 'error', message: `define ${name} before differentiating it` };
      }
    }

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

    const partial = lowerPartialDerivativesAt(this.ce, expr);
    if (partial.error) return { kind: 'error', message: partial.error };
    expr = this.readCardinalityBars(partial.expr);

    // Compute Engine answers an integral whether or not the answer exists, and
    // is wrong about some divergent ones. Its value is used only where this
    // sheet has established for itself that the integral is proper.
    for (const integral of collectIntegrals(expr)) {
      const obstruction = integralObstruction(this.ce, integral);
      if (obstruction) return { kind: 'error', message: obstruction };
      // Establishing this is the interesting half of the proof, so it is
      // recorded rather than left implicit behind "exact evaluation".
      source.obligations = [
        ...(source.obligations ?? []),
        {
          rule: 'calculus.continuity',
          conclusionLatex: tidyLatex(this.registry.toDisplayLatex(integral.latex)),
        },
      ];
    }

    if (options.allowDefinitions !== false) {
      const definition = this.tryDefine(expr);
      if (definition) return definition;
    }

    if (isStatementOperator(expr.operator)) {
      return this.evaluateStatement(expr, used, source);
    }

    // A named proposition must be expanded before Compute Engine gets a chance
    // to evaluate its body. In particular, eager evaluation treats symbolic
    // set membership as false, which can corrupt an otherwise exact set lemma.
    if (isPropositionExpression(expr, this.definitions)) {
      return this.evaluateStatement(expr, used, source);
    }

    // A proposition-valued function call or propositional constant may be a
    // plain symbol/call syntactically, then resolve to a relation, connective,
    // True, or False through its definition. Route that resolved proposition
    // through the statement evaluator rather than displaying symbolic ⊤/⊥.
    try {
      const resolved = expr.evaluate();
      if (isStatementOperator(resolved.operator)
        || resolved.symbol === 'True' || resolved.symbol === 'False') {
        return this.evaluateStatement(resolved, used, source);
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
          return lowerLinearAlgebra(
            this.ce, this.ce.parse(latex), this.definitions
          );
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
    const rewritten = rewriteCartesianProductSyntax(
      rewriteVectorProducts(this.ce, latex, this.definitions),
      this.definitions,
    );
    return lowerLinearAlgebra(
      this.ce,
      reinterpretCartesianProducts(
        this.ce, this.ce.parse(rewritten), this.definitions
      ),
      this.definitions,
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
    const proposition = !setDefinition && isPropositionExpression(valueExpr, this.definitions);
    this.ce.assign(id, valueExpr);
    this.definitions.set(id, setDefinition
      ? { kind: 'set', valueExpr, builder: setDefinition.builder }
      : { kind: 'constant', valueExpr, proposition });
    const entry = this.registry.get(id);
    return {
      kind: 'definition',
      what: setDefinition ? 'set' : 'constant',
      proposition,
      nameLatex: entry?.latex ?? id,
      name: entry?.name ?? id,
      valueLatex: setDefinition
        ? displaySetValueLatex(valueExpr, this.registry)
        : tidyLatex(this.registry.toDisplayLatex(valueExpr.latex)),
    };
  }

  defineFunction(id, paramIds, bodyExpr) {
    const body = unwrapBlock(bodyExpr);
    const proposition = isPropositionExpression(body, this.definitions);
    this.ce.assign(id, ['Function', body.json, ...paramIds]);
    this.definitions.set(id, {
      kind: 'function', arity: paramIds.length, paramIds: [...paramIds], bodyExpr: body,
      proposition,
    });
    const entry = this.registry.get(id);
    return {
      kind: 'definition',
      what: 'function',
      proposition,
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

    // `|A|` should read back as a number, not as the internal predicate name.
    if (hasCardinality(expr)) {
      const state = { unresolved: false };
      const counted = resolveCardinalities(this.ce, expr, this.definitions, state);
      if (!state.unresolved) {
        expr = counted;
      } else if (expr.operator === 'SetCardinality' && expr.nops === 1) {
        // Nothing countable — an infinite or still-symbolic set. Show the
        // question back rather than an answer.
        return {
          kind: 'symbolic',
          latex: `\\left|${displaySetValueLatex(expr.ops[0], this.registry)}\\right|`,
          undefinedNames: expr.unknowns
            .filter((id) => this.registry.get(id)?.kind !== 'internal')
            .map((id) => this.registry.get(id)?.name ?? id),
        };
      }
    }

    if (hasMatrix(expr)) {
      let value = expr;
      try { value = expr.evaluate(); } catch { /* show what was written */ }
      // Shape mismatches surface only at evaluation, as `\error{1x2vs2x1}`
      // markup rather than an `Error` node, so `findError` never sees them.
      // Say the shapes do not fit instead of rendering the engine's marker.
      if (ERROR_MARKUP.test(value?.latex ?? '')) {
        return { kind: 'error', message: 'these matrices do not have matching shapes' };
      }
      if (incompleteMatrix(value)) {
        return { kind: 'error', message: 'this matrix still has empty cells' };
      }
      const latex = matrixLatex(value, this.registry);
      const names = expr.unknowns;
      if (latex && names.length === 0) {
        return { kind: 'value', exactLatex: latex, approxLatex: null, isExact: true };
      }
      if (latex) {
        return {
          kind: 'symbolic',
          latex,
          undefinedNames: names.map((id) => this.registry.get(id)?.name ?? id),
        };
      }
    }

    const unknowns = expr.unknowns;
    if (unknowns.length > 0) {
      let simplified = expr;
      try {
        simplified = hasDerivative(expr) || hasCollectionAccess(expr)
          ? expr.evaluate()
          : expr.simplify();
      } catch { /* keep original */ }
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

    const evaluatedMatrix = matrixLatex(exact, this.registry);
    if (evaluatedMatrix) {
      return {
        kind: 'value', exactLatex: evaluatedMatrix, approxLatex: null, isExact: true,
      };
    }
    const evaluatedTuple = tupleLatex(exact, this.registry);
    if (evaluatedTuple) {
      return {
        kind: 'value', exactLatex: evaluatedTuple, approxLatex: null, isExact: true,
      };
    }

    const source = pickDisplayForm(exact, numeric);
    if (!source) return { kind: 'error', message: 'could not evaluate' };
    if (source.symbol === 'Missing') {
      return { kind: 'error', message: 'that matrix or vector index is out of range' };
    }
    if (source.isNaN) return { kind: 'error', message: 'undefined' };

    // Operations that cannot be carried out at all — a dot product between
    // vectors of different lengths — fail at evaluation as `\error{...}`
    // markup rather than as an `Error` node, so `findError` never sees them.
    // Say that it does not work instead of rendering the engine's marker.
    if (ERROR_MARKUP.test(source.latex ?? '')) {
      return { kind: 'error', message: 'these do not have matching shapes' };
    }

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

  /**
   * The definition expansions a statement depends on, in the one place where
   * both the call and the definition are still visible.
   *
   * `d(\epsilon) > 0` is decided with `d` already resolved to `\epsilon/2`, and
   * nothing downstream remembers that `d` was ever written. A reader who named
   * a function deserves to be told what it stood for, so the expansion is
   * recorded here, before any exact pass can normalize it away.
   */
  collectDefinitionExpansions(expr) {
    const found = new Map();
    const record = (id, definition, args) => {
      const described = this.describeExpansion(id, definition, args);
      if (described && !found.has(described.conclusionLatex)) {
        found.set(described.conclusionLatex, described);
      }
    };
    const walk = (node) => {
      // A named proposition cited on its own — `	ext{lemma}` — is a bare
      // symbol, not a call, so it reaches here as a string. Only propositions
      // are recorded: `a := 3` stands for a value, and unfolding it is not a
      // step of anybody's proof.
      if (typeof node === 'string') {
        const definition = this.definitions.get(node);
        if (definition?.kind === 'constant' && definition.proposition) {
          record(node, definition, []);
        }
        return;
      }
      if (!Array.isArray(node) || node.length === 0) return;
      const [head, ...args] = node;
      if (typeof head === 'string') {
        const definition = this.definitions.get(head);
        if (definition?.kind === 'function' && definition.paramIds.length === args.length) {
          record(head, definition, args);
        }
      }
      for (const arg of args) walk(arg);
    };
    walk(expr.json);
    return [...found.values()];
  }

  /** `d(2x) = x`, with the argument actually written at the call site. */
  describeExpansion(id, definition, argsJson) {
    const entry = this.registry.get(id);
    if (!entry) return null;
    let args;
    let body;
    try {
      if (definition.kind === 'constant') {
        args = [];
        body = definition.valueExpr;
      } else {
        args = argsJson.map((arg) => this.ce.box(arg));
        const substitution = {};
        definition.paramIds.forEach((param, index) => { substitution[param] = args[index]; });
        body = definition.bodyExpr.subs(substitution);
      }
    } catch {
      return null;
    }
    if (!body) return null;
    const display = (latex) => tidyLatex(this.registry.toDisplayLatex(latex));
    // A constant carries no argument list, so it is cited by its bare name.
    const call = definition.kind === 'constant'
      ? entry.latex
      : `${entry.latex}(${args.map((arg) => display(arg.latex)).join(', ')})`;
    // A named proposition stands for a claim, not a value, so it is unfolded
    // with an equivalence — `P(x) = x > 0` would read as an equation.
    const connector = definition.proposition ? '\\iff' : '=';
    return {
      name: entry.name ?? id,
      conclusionLatex: `${call} ${connector} ${display(body.latex)}`,
    };
  }

  /**
   * `|S|` is the size of a set; `|x|` is an absolute value.
   *
   * Compute Engine reads both as `Abs`, because the bars are the same
   * characters and only the operand tells them apart. The reading is settled
   * here, at the one point where the definitions that say which names denote
   * sets are in scope — so `|A|` counts a set, `|-5|` is still 5, and `|x|`
   * for an undefined `x` stays an absolute value rather than guessing.
   */
  readCardinalityBars(expr) {
    if (!expr?.ops?.length) return expr;
    const operands = expr.ops.map((operand) => this.readCardinalityBars(operand));
    const changed = operands.some((operand, index) => operand !== expr.ops[index]);
    let node = expr;
    if (changed) {
      try {
        node = this.ce.box([expr.operator, ...operands]);
      } catch {
        node = expr;
      }
    }
    if (node.operator === 'Abs' && node.nops === 1
      && isSetExpression(node.ops[0], this.definitions)) {
      try {
        return this.ce.box(['SetCardinality', node.ops[0]]);
      } catch {
        return node;
      }
    }
    return node;
  }

  /**
   * The proof context for a line the set pass touched.
   *
   * Only two situations earn one, and both are established by comparing what
   * came out against what went in rather than by trusting the pass to report
   * itself: a leading quantifier chain removed and nothing else, or nothing
   * changed at all. Every other set rewrite — a membership expanded pointwise,
   * a subset relation collapsing to a truth value — is a transformation this
   * code cannot yet describe, so the row stays opaque.
   */
  setProofContext(proofBase, source, latexOf, { certificate, generalized, untouched }) {
    if (!proofBase) return null;
    if (certificate) {
      return { ...proofBase, statementLatex: source.latex, decidedBy: certificate };
    }
    if (generalized) {
      return {
        ...proofBase,
        // The prover works on the body; generalization closes it back up.
        statementLatex: latexOf(generalized.body),
        wrap: {
          rule: 'logic.universal-generalization',
          latex: source.latex,
          data: { bindingsLatex: generalized.bindings.map(latexOf) },
        },
      };
    }
    return untouched ? { ...proofBase, statementLatex: source.latex } : null;
  }

  /**
   * The proof context for a line the analysis pass touched.
   *
   * Two shapes, and nothing else earns one. A *certificate* means the pass
   * settled the statement itself, so the trivial re-evaluation downstream must
   * not take the credit. A *rewrite* means it produced obligations that still
   * have to be proved, so the trace concludes about those and one wrapping
   * step carries them back to the line as written.
   */
  loweredProofContext(proofBase, source, loweredExpr, { certificate, rewrite }) {
    if (!proofBase) return null;
    if (certificate) {
      return { ...proofBase, statementLatex: source.latex, decidedBy: certificate };
    }
    if (rewrite) {
      return {
        ...proofBase,
        statementLatex: proofBase.latexOf(loweredExpr),
        wrap: { rule: rewrite.rule, latex: source.latex },
      };
    }
    return null;
  }

  evaluateStatement(expr, used, source = null) {
    // Collect before expanding, so a named proposition is recorded as the
    // definition the reader wrote, and again after, for the calls that
    // expansion brings into view.
    const expansions = this.collectDefinitionExpansions(expr);
    expr = expandNamedPropositions(this.ce, expr, this.definitions);
    for (const record of this.collectDefinitionExpansions(expr)) {
      if (!expansions.some(({ conclusionLatex }) => conclusionLatex === record.conclusionLatex)) {
        expansions.push(record);
      }
    }
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
        ...NO_PROOF,
      };
    }
    const refuseSampling = hasOpenSummation(expr) || hasCardinality(expr) || hasMatrix(expr);
    // Sub-proofs conclude about parts of the statement, which only the engine
    // can render back into the reader's own names.
    const latexOf = (part) => tidyLatex(this.registry.toDisplayLatex(part?.latex ?? ''));
    const proofBase = source?.latex
      ? {
        sourceKind: source.kind ?? 'statement',
        latexOf,
        premises: [
          ...expansions.map((expansion) => ({
            rule: 'definition.unfold',
            conclusionLatex: expansion.conclusionLatex,
            data: { name: expansion.name },
          })),
          ...(source.obligations ?? []),
        ],
      }
      : null;
    // A trace may only describe the line the reader actually wrote, so the
    // unlowered path concludes with the source line itself.
    const proofContext = proofBase ? { ...proofBase, statementLatex: source.latex } : null;
    const universal = peelUniversalQuantifiers(expr);
    let decidedExpr = expr;
    let verdict;
    let analysis = null;

    // Set when the analysis pass did not merely rewrite the statement but
    // settled it, by a procedure this code can name.
    let analysisCertificate = null;
    let analysisRewrite = null;

    if (containsAnalysisConstruct(decidedExpr)) {
      analysis = lowerAnalysisProposition(
        this.ce,
        decidedExpr,
        this.definitions,
        (role) => {
          if (role === 'point') {
            return this.registry.createFreshInternal([
              { latex: 't', name: 't' },
              { latex: 'x', name: 'x' },
              { latex: 'y', name: 'y' },
              { latex: 'u', name: 'u' },
            ], { latex: '\\text{point}', name: 'point' }).id;
          }
          if (role === 'index') {
            return this.registry.createFreshInternal([
              { latex: 'k', name: 'k' },
              { latex: 'n', name: 'n' },
              { latex: 'j', name: 'j' },
              { latex: 'm', name: 'm' },
            ], { latex: '\\text{index}', name: 'index' }).id;
          }
          return this.registry.createInternal().id;
        },
      );
      const isAlgebra = ALGEBRA_PREDICATES.has(decidedExpr.operator);
      const rule = isAlgebra
        ? 'algebra.finite-exhaustion'
        : ANALYSIS_CERTIFICATES.get(decidedExpr.operator);
      if (rule && isTruthLiteral(analysis.expr)) {
        const carrier = isAlgebra
          ? algebraCarrierSize(this.ce, decidedExpr, this.definitions)
          : null;
        analysisCertificate = { rule, data: carrier ? { carrier } : null };
      }

      // A rewrite rather than a decision: the obligations still have to be
      // proved, and the rule below records what carries them back to the line
      // the reader wrote. Guarded on the expression actually changing, so a
      // predicate left untouched claims nothing.
      const rewrite = ANALYSIS_REWRITES.get(decidedExpr.operator);
      if (rewrite && !isTruthLiteral(analysis.expr)
        && !sameExpression(analysis.expr, decidedExpr)) {
        analysisRewrite = { rule: rewrite };
      }
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
      // The lowerers do not yet narrate what they rewrote, so a trace is only
      // honest here when the whole rewrite is one this code can name. Stripping
      // universal quantifiers is such a case, and comparing the lowered form
      // against the peeled body proves that is all that happened — anything
      // else (a set collapsing to `True`, a membership expanded pointwise)
      // fails the comparison and keeps the row opaque.
      const generalized = !analysis && universal
        && sameExpression(lowered.expr, universal.body)
        ? universal
        : null;
      // A statement can contain a set construct and still come through the
      // pass untouched — `A \subseteq B` for two names with no definitions
      // yet. Nothing was rewritten, so the line as written is still an honest
      // description of what was proved.
      const untouched = !analysis && !generalized
        && sameExpression(lowered.expr, expr);
      // The one set rewrite that does narrate itself. The lowering decided
      // the line rather than restating it, so the re-evaluation below must
      // cite the test that settled it and not take the credit for it.
      const radicalCertificate = radicalMembershipCertificate(expr)
        ?? primeMembershipCertificate(expr);
      verdict = decideStatement(this.ce, decidedExpr, {
        complex,
        // An unresolved set variable must never receive a numeric test value.
        allowSampling: !analysis && !lowered.unresolvedSets && !refuseSampling,
        domains,
        // Nor may an opaque set/domain atom be accepted from Compute Engine's
        // eager evaluation; the symbolic tautology prover still runs below it.
        allowDirectEvaluation: this.allowDirectEvaluation
          && !analysis?.unsafeEvaluation
          && !analysis?.unresolvedAnalysis
          && !lowered.unsafeEvaluation && !lowered.unresolvedSets,
        realSymbols,
        proofContext: this.setProofContext(proofBase, source, latexOf, {
          certificate: radicalCertificate,
          generalized,
          untouched,
        }),
      });
    } else {
      verdict = decideStatement(this.ce, decidedExpr, {
        complex,
        allowSampling: !analysis && !refuseSampling,
        allowDirectEvaluation: this.allowDirectEvaluation
          && !analysis?.unsafeEvaluation && !analysis?.unresolvedAnalysis,
        realSymbols: analysis?.realSymbols,
        domains,
        proofContext: analysis
          ? this.loweredProofContext(proofBase, source, decidedExpr, {
            certificate: analysisCertificate,
            rewrite: analysisRewrite,
          })
          : proofContext,
      });
    }

    return {
      kind: 'truth',
      value: verdict.value,
      method: verdict.method,
      samples: verdict.samples,
      // Lowering introduces internal symbols for bound elements; this is the
      // boundary where every name becomes one the reader actually typed, and
      // so the last point at which the kernel can check a step against the
      // names it will be shown under.
      proof: certify(restoreIdentifiers(verdict.proof, this.registry)),
      proofStatus: verdict.proofStatus,
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

/**
 * Peel a leading run of universal quantifiers.
 *
 * `∀x∈ℝ, ∀y∈ℝ, P` is decided by proving `P` with `x` and `y` left free over
 * their domains, which is exactly universal generalization. Returning the
 * bindings lets the trace say so, and returning the body lets the caller check
 * that removing them was *all* the lowering did.
 */
function peelUniversalQuantifiers(expr) {
  const bindings = [];
  let body = expr;
  while (body?.operator === 'ForAll' && body.nops === 2) {
    const [binding, inner] = body.ops;
    if (binding?.operator !== 'Element' || binding.nops !== 2) break;
    bindings.push(binding);
    body = inner;
  }
  return bindings.length ? { body, bindings } : null;
}

/**
 * The certificate a predicate is decided by, when the analysis pass decides it
 * outright.
 *
 * `lowerNode` dispatches on the top-level operator, so when the whole statement
 * collapses to `True` or `False` it was that operator's branch that settled it
 * — no other branch could have produced the literal. Recording the rule here
 * therefore names the procedure that actually ran, and the truth-literal check
 * below is what makes that inference safe: a predicate lowered to anything
 * else (`OpenIn` over a discrete topology becomes a subset relation) fails it
 * and keeps the row opaque.
 */
const ANALYSIS_CERTIFICATES = new Map([
  ['CompactSpace', 'topology.constructor-certificate'],
  ['Topology', 'topology.constructor-certificate'],
  ['TopologyEmptyAxiom', 'topology.constructor-certificate'],
  ['TopologyCarrierAxiom', 'topology.constructor-certificate'],
  ['TopologyUnionAxiom', 'topology.constructor-certificate'],
  ['TopologyIntersectionAxiom', 'topology.constructor-certificate'],
  ['OpenIn', 'topology.constructor-certificate'],
  ['ClosedIn', 'topology.constructor-certificate'],
  ['NeighborhoodOf', 'topology.constructor-certificate'],
  ['ContinuousMap', 'topology.constructor-certificate'],
  ['MetricOpen', 'topology.constructor-certificate'],
  ['MetricClosed', 'topology.constructor-certificate'],
  ['ContinuousAt', 'analysis.epsilon-delta-witness'],
  ['LimitAt', 'analysis.epsilon-delta-witness'],
  ['MetricIntersectionWitness', 'analysis.epsilon-delta-witness'],
]);

const isTruthLiteral = (expr) => expr?.symbol === 'True' || expr?.symbol === 'False';

/**
 * Predicates the analysis pass *rewrites* into obligations rather than
 * deciding outright, and the rule that carries the obligations back to the
 * line as written.
 *
 * `Induct(P, 0)` becomes `Base ∧ Step`, and proving those two is the induction
 * principle — so `analysis.induction` is the honest root. `Base` and `Step` on
 * their own are not induction at all; each simply stands for the obligation it
 * names, which is an unfolding.
 */
const ANALYSIS_REWRITES = new Map([
  ['Induction', 'analysis.induction'],
  ['InductionBase', 'definition.unfold'],
  ['InductionStep', 'definition.unfold'],
  // `cont` and `limitw` expand into the obligations the supplied delta has to
  // meet — delta positive, and the implication between the two distances.
  // Proving those, for that witness, is what the definition asks for.
  ['ContinuousAt', 'analysis.epsilon-delta-witness'],
  ['LimitAt', 'analysis.epsilon-delta-witness'],
]);

/** Structural identity, used to confirm a lowering pass changed nothing else. */
function sameExpression(a, b) {
  try {
    return JSON.stringify(a?.json) === JSON.stringify(b?.json);
  } catch {
    return false;
  }
}

/**
 * Render an evaluated matrix back as a matrix.
 *
 * Compute Engine reduces `Matrix` to a list of rows, so without this a matrix
 * value comes back as `[[1, 2], [3, 4]]` — correct, and unreadable to anyone
 * who typed a `pmatrix`. Returns null for anything that is not a rectangular
 * list of lists, so an ordinary list keeps its own display.
 */
function matrixLatex(value, registry) {
  if (value?.operator !== 'List') return null;
  const rows = value.ops ?? [];
  if (!rows.length || !rows.every((row) => row?.operator === 'List')) return null;
  const width = rows[0].nops;
  if (!width || !rows.every((row) => row.nops === width)) return null;
  const body = rows
    .map((row) => row.ops
      .map((cell) => tidyLatex(registry.toDisplayLatex(cell.latex)))
      .join(' & '))
    .join(' \\\\ ');
  return `\\begin{pmatrix}${body}\\end{pmatrix}`;
}

/** Render a concrete flat tuple/list as vector tuple notation. */
function tupleLatex(value, registry) {
  if (value?.operator !== 'Tuple' && value?.operator !== 'List') return null;
  const entries = value.ops ?? [];
  if (!entries.length || entries.some((entry) => entry?.operator === 'List')) return null;
  return `(${entries.map((entry) => (
    tidyLatex(registry.toDisplayLatex(entry.latex))
  )).join(',')})`;
}

/** `x |-> x^2` parses with the body wrapped in a `Block`. */
function unwrapBlock(expr) {
  if (expr?.operator === 'Block' && expr.nops === 1) return expr.ops[0];
  return expr;
}
