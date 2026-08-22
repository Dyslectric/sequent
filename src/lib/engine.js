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
  const head = /^\\operatorname\{PowerSet\}\s*/.exec(source)?.[0];
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
        allowSampling: !analysis && !lowered.unresolvedSets,
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
        allowSampling: !analysis,
        allowDirectEvaluation: !analysis?.unsafeEvaluation && !analysis?.unresolvedAnalysis,
        realSymbols: analysis?.realSymbols,
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
