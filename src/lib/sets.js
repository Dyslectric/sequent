/**
 * Set values and set-theoretic propositions.
 *
 * Compute Engine already evaluates concrete finite sets very well. This module
 * supplies the missing symbolic bridge: membership in a set-builder becomes
 * predicate substitution, while subset and set equality become pointwise
 * implication and equivalence. The resulting propositions can then use the
 * application's existing arithmetic proof machinery.
 */

export const SET_RELATIONS = new Set([
  'Element', 'NotElement',
  'Subset', 'SubsetEqual', 'NotSubsetNotEqual',
  'Superset', 'SupersetEqual', 'NotSupersetNotEqual',
]);

export const QUANTIFIERS = new Set(['ForAll', 'Exists']);

const SET_OPERATORS = new Set([
  'Set', 'Union', 'Intersection', 'SetMinus', 'SymmetricDifference',
  'PowerSet', 'CartesianProduct',
]);

const STANDARD_SETS = new Set([
  'EmptySet', 'NonNegativeIntegers', 'PositiveIntegers', 'Integers',
  'RationalNumbers', 'RealNumbers', 'ExtendedRealNumbers', 'ComplexNumbers',
  'AlgebraicNumbers', 'TranscendentalNumbers', 'ImaginaryNumbers',
]);

const NUMBER_SET_RANK = new Map([
  ['NonNegativeIntegers', 0],
  ['Integers', 1],
  ['RationalNumbers', 2],
  ['RealNumbers', 3],
  ['ComplexNumbers', 4],
]);

const LOGICAL = new Set(['And', 'Or', 'Not', 'Implies', 'Equivalent']);

function setType(expr) {
  try {
    return String(expr?.type ?? '').startsWith('set');
  } catch {
    return false;
  }
}

/** The binder/domain/predicate encoded by `\{x \in D \mid P(x)\}`. */
export function setBuilderParts(expr) {
  if (expr?.operator !== 'Set' || expr.nops !== 2) return null;
  const [subject, condition] = expr.ops;
  if (condition?.operator !== 'Condition' || condition.nops !== 1) return null;

  if (subject?.symbol) {
    return { binder: subject.symbol, domain: null, predicate: condition.ops[0] };
  }
  if (subject?.operator === 'Element' && subject.nops === 2 && subject.ops[0]?.symbol) {
    return {
      binder: subject.ops[0].symbol,
      domain: subject.ops[1],
      predicate: condition.ops[0],
    };
  }
  return null;
}

/** True when an expression is known to denote a set. */
export function isSetExpression(expr, definitions = new Map(), seen = new Set()) {
  if (!expr) return false;
  if (expr.symbol) {
    if (STANDARD_SETS.has(expr.symbol)) return true;
    const definition = definitions.get(expr.symbol);
    if (definition?.kind !== 'set' || seen.has(expr.symbol)) return setType(expr);
    return true;
  }
  return SET_OPERATORS.has(expr.operator) || setType(expr);
}

/** Metadata stored alongside a set-valued constant definition. */
export function describeSetDefinition(expr, definitions = new Map()) {
  if (!isSetExpression(expr, definitions)) return null;
  return { builder: setBuilderParts(expr), valueExpr: expr };
}

/** Does a proposition contain set syntax or a reference to a defined set? */
export function containsSetConstruct(expr, definitions = new Map()) {
  if (!expr) return false;
  if (SET_RELATIONS.has(expr.operator) || SET_OPERATORS.has(expr.operator)) return true;
  if (expr.symbol && (STANDARD_SETS.has(expr.symbol) || definitions.get(expr.symbol)?.kind === 'set')) {
    return true;
  }
  return expr.ops?.some((operand) => containsSetConstruct(operand, definitions)) ?? false;
}

function truth(ce, value) {
  return ce.box(value ? 'True' : 'False');
}

function connective(ce, operator, operands) {
  if (operator === 'And') {
    if (operands.some((operand) => operand?.symbol === 'False')) return truth(ce, false);
    const remaining = operands.filter((operand) => operand?.symbol !== 'True');
    if (remaining.length === 0) return truth(ce, true);
    if (remaining.length === 1) return remaining[0];
    return ce.box(['And', ...remaining]);
  }
  if (operator === 'Or') {
    if (operands.some((operand) => operand?.symbol === 'True')) return truth(ce, true);
    const remaining = operands.filter((operand) => operand?.symbol !== 'False');
    if (remaining.length === 0) return truth(ce, false);
    if (remaining.length === 1) return remaining[0];
    return ce.box(['Or', ...remaining]);
  }
  return ce.box([operator, ...operands]);
}

function resolveDefinedSet(expr, definitions, seen) {
  if (!expr?.symbol) return expr;
  const definition = definitions.get(expr.symbol);
  if (definition?.kind !== 'set' || seen.has(expr.symbol)) return expr;
  seen.add(expr.symbol);
  return definition.valueExpr;
}

function standardSubset(left, right) {
  if (left?.symbol === 'EmptySet') return true;
  if (left?.symbol === right?.symbol && STANDARD_SETS.has(left.symbol)) return true;
  const a = NUMBER_SET_RANK.get(left?.symbol);
  const b = NUMBER_SET_RANK.get(right?.symbol);
  if (a === undefined || b === undefined) return null;
  return a <= b;
}

function concreteFiniteSet(expr, definitions) {
  const resolved = resolveDefinedSet(expr, definitions, new Set());
  if (!resolved || setBuilderParts(resolved)) return null;
  let value = resolved;
  try { value = resolved.evaluate(); } catch { return null; }
  if (value.unknowns.length > 0 || setBuilderParts(value)) return null;
  return value.operator === 'Set' || value.symbol === 'EmptySet' ? value : null;
}

function concreteSetRelationTruth(ce, expr, definitions) {
  if (!SET_RELATIONS.has(expr?.operator) || expr.nops !== 2) return null;
  const left = expr.operator === 'Element' || expr.operator === 'NotElement'
    ? expr.ops[0] : concreteFiniteSet(expr.ops[0], definitions);
  const right = concreteFiniteSet(expr.ops[1], definitions);
  if (!left || !right) return null;
  try {
    const evaluated = ce.box([expr.operator, left, right]).evaluate();
    if (evaluated.symbol === 'True') return true;
    if (evaluated.symbol === 'False') return false;
  } catch { /* not a closed finite relation */ }
  return null;
}

/** Build the proposition `element \in set`, expanding supported set values. */
function membership(ce, element, originalSet, definitions, seen = new Set()) {
  const setExpr = resolveDefinedSet(originalSet, definitions, seen);
  const builder = setBuilderParts(setExpr);
  if (builder) {
    const substitution = { [builder.binder]: element };
    let predicate;
    try {
      predicate = builder.predicate.subs(substitution);
    } catch {
      return { expr: ce.box(['Element', element, originalSet]), unresolvedSets: true };
    }
    const loweredPredicate = lowerNode(ce, predicate, definitions, seen);
    if (!builder.domain) return loweredPredicate;
    const domain = membership(ce, element, builder.domain, definitions, seen);
    return {
      expr: connective(ce, 'And', [domain.expr, loweredPredicate.expr]),
      unresolvedSets: domain.unresolvedSets || loweredPredicate.unresolvedSets,
    };
  }

  if (setExpr?.symbol === 'EmptySet') return { expr: truth(ce, false), unresolvedSets: false };

  if (setExpr?.operator === 'Set') {
    const operands = setExpr.ops ?? [];
    return {
      expr: connective(ce, 'Or', operands.map((item) => ce.box(['Equal', element, item]))),
      unresolvedSets: false,
    };
  }

  if (setExpr?.operator === 'Union' || setExpr?.operator === 'Intersection') {
    const parts = setExpr.ops.map((operand) => membership(ce, element, operand, definitions, new Set(seen)));
    return {
      expr: connective(ce, setExpr.operator === 'Union' ? 'Or' : 'And', parts.map((part) => part.expr)),
      unresolvedSets: parts.some((part) => part.unresolvedSets),
    };
  }

  if (setExpr?.operator === 'SetMinus' && setExpr.nops === 2) {
    const left = membership(ce, element, setExpr.ops[0], definitions, new Set(seen));
    const right = membership(ce, element, setExpr.ops[1], definitions, new Set(seen));
    return {
      expr: connective(ce, 'And', [left.expr, ce.box(['Not', right.expr])]),
      unresolvedSets: left.unresolvedSets || right.unresolvedSets,
    };
  }

  // Standard numeric domains are safe to leave as membership atoms: once a
  // numeric witness is substituted Compute Engine decides them exactly.
  const standard = setExpr?.symbol && STANDARD_SETS.has(setExpr.symbol);
  const atom = ce.box(['Element', element, setExpr]);
  if (standard) {
    const hasUnknowns = (element.unknowns?.length ?? 0) > 0;
    if (!hasUnknowns) {
      try {
        const evaluated = atom.evaluate();
        if (evaluated.symbol === 'True' || evaluated.symbol === 'False') {
          return { expr: evaluated, unresolvedSets: false };
        }
      } catch { /* retain the symbolic domain test */ }
    }

    // The arithmetic proof engine's free variables range over the reals. A
    // symbolic real expression therefore satisfies this guard by construction.
    if (setExpr.symbol === 'RealNumbers' && hasUnknowns) {
      return { expr: truth(ce, true), unresolvedSets: false };
    }

    // Compute Engine currently evaluates a symbolic `x in N` as false. That is
    // not a proof. Preserve it as an opaque atom and disable both direct
    // evaluation and numeric sampling at the caller.
    if (hasUnknowns) return { expr: atom, unresolvedSets: true };
  }
  return {
    expr: atom,
    unresolvedSets: !standard,
  };
}

function freshWitness(ce, makeWitness) {
  const symbol = makeWitness?.();
  return symbol ? ce.box(symbol) : ce.box('SetWitness');
}

function extensionalRelation(ce, leftSet, rightSet, operator, definitions, makeWitness, seen) {
  const witness = freshWitness(ce, makeWitness);
  const left = membership(ce, witness, leftSet, definitions, new Set(seen));
  const right = membership(ce, witness, rightSet, definitions, new Set(seen));
  return {
    expr: ce.box([operator, left.expr, right.expr]),
    unresolvedSets: left.unresolvedSets || right.unresolvedSets,
  };
}

function lowerNode(ce, expr, definitions, seen = new Set(), makeWitness) {
  if (!expr) return { expr, unresolvedSets: false };
  const op = expr.operator;

  if (op === 'Element' && expr.nops === 2) {
    return membership(ce, expr.ops[0], expr.ops[1], definitions, seen);
  }
  if (op === 'NotElement' && expr.nops === 2) {
    const inner = membership(ce, expr.ops[0], expr.ops[1], definitions, seen);
    return { expr: ce.box(['Not', inner.expr]), unresolvedSets: inner.unresolvedSets };
  }

  if ((op === 'SubsetEqual' || op === 'SupersetEqual') && expr.nops === 2) {
    const [left, right] = op === 'SubsetEqual' ? expr.ops : [expr.ops[1], expr.ops[0]];
    const resolvedLeft = resolveDefinedSet(left, definitions, new Set());
    const resolvedRight = resolveDefinedSet(right, definitions, new Set());
    const standard = standardSubset(resolvedLeft, resolvedRight);
    if (standard !== null) return { expr: truth(ce, standard), unresolvedSets: false };

    // A finite subset is just the conjunction of its concrete membership
    // checks. This supplies exact witnesses without introducing a universal
    // element that the numeric prover would otherwise have to discover.
    if (resolvedLeft?.operator === 'Set' && !setBuilderParts(resolvedLeft)) {
      const checks = resolvedLeft.ops.map((item) => membership(
        ce, item, resolvedRight, definitions, new Set(seen)
      ));
      return {
        expr: connective(ce, 'And', checks.map((check) => check.expr)),
        unresolvedSets: checks.some((check) => check.unresolvedSets),
      };
    }
    return extensionalRelation(ce, left, right, 'Implies', definitions, makeWitness, seen);
  }

  if ((op === 'Equal' || op === 'IdenticallyEqual') && expr.nops === 2
    && isSetExpression(expr.ops[0], definitions)
    && isSetExpression(expr.ops[1], definitions)) {
    const left = concreteFiniteSet(expr.ops[0], definitions);
    const right = concreteFiniteSet(expr.ops[1], definitions);
    if (left && right) {
      try {
        const evaluated = ce.box(['Equal', left, right]).evaluate();
        if (evaluated.symbol === 'True' || evaluated.symbol === 'False') {
          return { expr: evaluated, unresolvedSets: false };
        }
      } catch { /* use extensional equality below */ }
    }
    return extensionalRelation(
      ce, expr.ops[0], expr.ops[1], 'Equivalent', definitions, makeWitness, seen
    );
  }

  // Universal quantification over a set is exactly a pointwise implication.
  // This is also how the rest of the app interprets free numeric variables.
  if (op === 'ForAll' && expr.nops === 2) {
    const [binding, body] = expr.ops;
    if (binding?.operator === 'Element' && binding.nops === 2 && binding.ops[0]?.symbol) {
      const domain = membership(ce, binding.ops[0], binding.ops[1], definitions, seen);
      const loweredBody = lowerNode(ce, body, definitions, seen, makeWitness);
      return {
        expr: ce.box(['Implies', domain.expr, loweredBody.expr]),
        unresolvedSets: domain.unresolvedSets || loweredBody.unresolvedSets,
      };
    }
    if (binding?.symbol) return lowerNode(ce, body, definitions, seen, makeWitness);
  }

  if (op === 'Exists' && expr.nops === 2) {
    const [binding, body] = expr.ops;
    if (binding?.operator === 'Element' && binding.nops === 2 && binding.ops[0]?.symbol) {
      const domain = concreteFiniteSet(binding.ops[1], definitions);
      if (domain) {
        const loweredBody = lowerNode(ce, body, definitions, seen, makeWitness);
        return {
          expr: ce.box(['Exists', ce.box(['Element', binding.ops[0], domain]), loweredBody.expr]),
          unresolvedSets: loweredBody.unresolvedSets,
          unsafeEvaluation: loweredBody.unsafeEvaluation,
        };
      }
    }
  }

  if (LOGICAL.has(op)) {
    const operands = expr.ops.map((operand) => lowerNode(
      ce, operand, definitions, new Set(seen), makeWitness
    ));
    return {
      expr: ce.box([op, ...operands.map((operand) => operand.expr)]),
      unresolvedSets: operands.some((operand) => operand.unresolvedSets),
      unsafeEvaluation: operands.some((operand) => operand.unsafeEvaluation),
    };
  }

  // Strict subset, negated subset and non-finite existential statements need
  // an existential witness. Compute Engine handles their finite closed forms;
  // unsupported symbolic forms remain honest unknowns rather than being fed to
  // the numeric sampler.
  if (SET_RELATIONS.has(op) || op === 'Exists') {
    const concrete = concreteSetRelationTruth(ce, expr, definitions);
    if (concrete !== null) return { expr: truth(ce, concrete), unresolvedSets: false };
    return { expr, unresolvedSets: true, unsafeEvaluation: true };
  }

  return { expr, unresolvedSets: false };
}

function markSetSymbols(expr, definitions, out) {
  if (!expr) return;
  if (expr.symbol) {
    if (!STANDARD_SETS.has(expr.symbol)) out.add(expr.symbol);
    return;
  }
  if (expr.operator === 'Set') return;
  if (SET_OPERATORS.has(expr.operator) || definitions.get(expr.symbol)?.kind === 'set') {
    expr.ops?.forEach((operand) => markSetSymbols(operand, definitions, out));
  }
}

function inferSetSymbols(expr, definitions, out = new Set()) {
  if (!expr) return out;
  const op = expr.operator;
  if (op === 'Element' || op === 'NotElement') {
    markSetSymbols(expr.ops[1], definitions, out);
  } else if (SET_RELATIONS.has(op)) {
    expr.ops.forEach((operand) => markSetSymbols(operand, definitions, out));
  } else if ((op === 'Equal' || op === 'IdenticallyEqual') && expr.nops === 2) {
    const leftSet = isSetExpression(expr.ops[0], definitions);
    const rightSet = isSetExpression(expr.ops[1], definitions);
    if (leftSet || rightSet) {
      markSetSymbols(expr.ops[0], definitions, out);
      markSetSymbols(expr.ops[1], definitions, out);
    }
  }
  expr.ops?.forEach((operand) => inferSetSymbols(operand, definitions, out));
  return out;
}

/**
 * Lower the supported set fragment to ordinary logical/arithmetic formulas.
 * `unresolvedSets` tells the caller not to assign numeric samples to set-valued
 * unknowns that remain after lowering.
 */
export function lowerSetProposition(ce, expr, definitions, makeWitness) {
  const typedDefinitions = new Map(definitions);
  for (const symbol of inferSetSymbols(expr, definitions)) {
    if (!typedDefinitions.has(symbol)) {
      typedDefinitions.set(symbol, { kind: 'set', valueExpr: ce.box(symbol), builder: null });
    }
  }
  let witness = null;
  const sharedWitness = () => {
    if (witness === null) witness = makeWitness?.() ?? 'SetWitness';
    return witness;
  };
  return lowerNode(ce, expr, typedDefinitions, new Set(), sharedWitness);
}
