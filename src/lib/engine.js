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
import { indexOfTopLevel, splitTopLevel } from './top-level.js';
import {
  containsSetConstruct,
  describeSetDefinition,
  isSetExpression,
  lowerSetProposition,
  QUANTIFIERS,
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
    .trim();
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
    return this.ce.parse(latex);
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
      valueLatex: tidyLatex(this.registry.toDisplayLatex(valueExpr.latex)),
    };
  }

  defineFunction(id, paramIds, bodyExpr) {
    this.ce.assign(id, ['Function', unwrapBlock(bodyExpr).json, ...paramIds]);
    this.definitions.set(id, { kind: 'function', arity: paramIds.length });
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
        try { value = expr.evaluate(); } catch { /* display the original set expression */ }
      }
      const bound = builder?.binder;
      const unknowns = expr.unknowns.filter((id) => id !== bound);
      return {
        kind: 'set',
        latex: tidyLatex(this.registry.toDisplayLatex(value.latex)),
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

    if (containsSetConstruct(expr, this.definitions)) {
      // Lower before evaluating so Compute Engine cannot mistake two symbolic
      // set-builders for unequal opaque values. Closed strict-subset and finite
      // existential forms remain unchanged and are still decided directly.
      const lowered = lowerSetProposition(
        this.ce,
        expr,
        this.definitions,
        () => this.registry.createInternal().id
      );
      decidedExpr = lowered.expr;
      verdict = decideStatement(this.ce, decidedExpr, {
        complex,
        // An unresolved set variable must never receive a numeric test value.
        allowSampling: !lowered.unresolvedSets,
        // Nor may an opaque set/domain atom be accepted from Compute Engine's
        // eager evaluation; the symbolic tautology prover still runs below it.
        allowDirectEvaluation: !lowered.unsafeEvaluation && !lowered.unresolvedSets,
      });
    } else {
      verdict = decideStatement(this.ce, expr, { complex });
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
