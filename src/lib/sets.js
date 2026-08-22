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
  'PowerSet', 'CartesianProduct', 'OpenBall', 'ClosedBall',
  'IndexedUnion', 'IndexedIntersection',
  'DiscreteTopology', 'IndiscreteTopology', 'CofiniteTopology', 'MetricTopology',
  'SubspaceTopology', 'ProductTopology',
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

/**
 * The sampling domain each standard numeric set stands for. A universal over
 * one of these is not a pointwise implication over an opaque membership atom —
 * it is the app's ordinary universal reading of a free variable, narrowed to a
 * domain. Enumerating the set is hopeless; restricting the candidates is not.
 */
const NUMERIC_DOMAINS = new Map([
  ['NonNegativeIntegers', 'natural'],
  ['PositiveIntegers', 'positive-integer'],
  ['Integers', 'integer'],
  ['RationalNumbers', 'rational'],
  ['RealNumbers', 'real'],
  ['ComplexNumbers', 'complex'],
]);

/** The sampling domain a standard numeric set denotes, or null if it is not one. */
export function standardNumericDomain(expr) {
  return NUMERIC_DOMAINS.get(expr?.symbol) ?? null;
}

const LOGICAL = new Set(['And', 'Or', 'Not', 'Implies', 'Equivalent']);
const MAX_POWER_SET_BASE_SIZE = 8;
const MAX_CARTESIAN_PRODUCT_SIZE = 256;

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

function multiplyHasKnownSetFactor(expr, definitions) {
  return expr?.operator === 'Multiply'
    && expr.ops.some((operand) => isSetExpression(operand, definitions));
}

/**
 * Compute Engine parses `A \times B` as numeric multiplication. Reinterpret it
 * only when its operands are already known sets or when the surrounding syntax
 * requires a set, preserving ordinary arithmetic multiplication everywhere
 * else.
 */
export function reinterpretCartesianProducts(ce, expr, definitions, expectSet = false) {
  if (!expr?.ops?.length) return expr;
  const op = expr.operator;
  let expectations = expr.ops.map(() => false);

  if (op === 'Element' || op === 'NotElement') {
    expectations[1] = true;
  } else if (SET_RELATIONS.has(op)) {
    expectations = expectations.map(() => true);
  } else if (SET_OPERATORS.has(op) && op !== 'Set') {
    expectations = expectations.map(() => true);
  } else if ((op === 'Equal' || op === 'IdenticallyEqual') && expr.ops.some(
    (operand) => isSetExpression(operand, definitions)
      || multiplyHasKnownSetFactor(operand, definitions)
  )) {
    expectations = expectations.map(() => true);
  }

  const operands = expr.ops.map((operand, index) => reinterpretCartesianProducts(
    ce, operand, definitions, expectations[index]
  ));

  if (op === 'Multiply') {
    const allSetFactors = operands.every((operand) => (
      isSetExpression(operand, definitions) || (expectSet && Boolean(operand?.symbol))
    ));
    if (allSetFactors && (expectSet || operands.some(
      (operand) => isSetExpression(operand, definitions)
    ))) {
      return ce.box(['CartesianProduct', ...operands]);
    }
  }

  return operands.some((operand, index) => operand !== expr.ops[index])
    ? ce.box([op, ...operands])
    : expr;
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
  // `card(S)` is a set construct even when S is not yet a known set. Without
  // this the statement misses the set path entirely and reaches the sampler,
  // which treats `card(S)` as an ordinary unknown and disproves claims about
  // it with values no cardinality could take.
  if (expr.operator === 'SetCardinality') return true;
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

function unaryFunctionDefinition(expr, definitions) {
  if (!expr?.symbol) return null;
  const definition = definitions.get(expr.symbol);
  return definition?.kind === 'function' && definition.arity === 1
    && definition.bodyExpr && definition.paramIds?.length === 1
    ? definition
    : null;
}

function applyUnaryFunction(definition, argument) {
  try {
    return definition.bodyExpr.subs({ [definition.paramIds[0]]: argument });
  } catch {
    return null;
  }
}

function standardSubset(left, right) {
  if (left?.symbol === 'EmptySet') return true;
  if (left?.symbol === right?.symbol && STANDARD_SETS.has(left.symbol)) return true;
  const a = NUMBER_SET_RANK.get(left?.symbol);
  const b = NUMBER_SET_RANK.get(right?.symbol);
  if (a === undefined || b === undefined) return null;
  return a <= b;
}

/**
 * Materialize a finite set value, including nested power sets. The explicit
 * bound prevents a harmless-looking value line from trying to render millions
 * of subsets; proposition lowering below does not need enumeration.
 */
export function materializeFiniteSet(ce, expr, definitions, seen = new Set()) {
  const resolved = resolveDefinedSet(expr, definitions, seen);
  if (!resolved || setBuilderParts(resolved)) return null;

  if (resolved.symbol === 'EmptySet') return resolved;

  if (resolved.operator === 'PowerSet' && resolved.nops === 1) {
    const base = materializeFiniteSet(ce, resolved.ops[0], definitions, new Set(seen));
    if (!base) return null;
    const items = base.symbol === 'EmptySet' ? [] : base.ops;
    if (items.length > MAX_POWER_SET_BASE_SIZE) return null;

    const subsets = [];
    for (let mask = 0; mask < 2 ** items.length; mask++) {
      const subset = items.filter((_, bit) => mask & (1 << bit));
      subsets.push(subset.length ? ce.box(['Set', ...subset]) : ce.box('EmptySet'));
    }
    try { return ce.box(['Set', ...subsets]).evaluate(); } catch { return null; }
  }

  if ((resolved.operator === 'IndexedUnion' || resolved.operator === 'IndexedIntersection')
    && resolved.nops === 2) {
    const definition = unaryFunctionDefinition(resolved.ops[0], definitions);
    const indices = materializeFiniteSet(
      ce, resolved.ops[1], definitions, new Set(seen)
    );
    if (!definition || !indices) return null;
    const indexItems = indices.symbol === 'EmptySet' ? [] : indices.ops;
    if (indexItems.length === 0) {
      return resolved.operator === 'IndexedUnion' ? ce.box('EmptySet') : null;
    }
    const family = indexItems.map((index) => {
      const member = applyUnaryFunction(definition, index);
      return member
        ? materializeFiniteSet(ce, member, definitions, new Set(seen))
        : null;
    });
    if (family.some((member) => !member)) return null;
    if (family.length === 1) return family[0];
    try {
      const value = ce.box([
        resolved.operator === 'IndexedUnion' ? 'Union' : 'Intersection', ...family,
      ]).evaluate();
      return value.operator === 'Set' || value.symbol === 'EmptySet' ? value : null;
    } catch {
      return null;
    }
  }

  if (resolved.operator === 'CartesianProduct' && resolved.nops >= 2) {
    const factors = resolved.ops.map((operand) => (
      materializeFiniteSet(ce, operand, definitions, new Set(seen))
    ));
    if (factors.some((factor) => !factor)) return null;
    const itemLists = factors.map((factor) => (
      factor.symbol === 'EmptySet' ? [] : factor.ops
    ));
    const size = itemLists.reduce((total, items) => total * items.length, 1);
    if (size > MAX_CARTESIAN_PRODUCT_SIZE) return null;
    if (size === 0) return ce.box('EmptySet');

    let tuples = [[]];
    for (const items of itemLists) {
      tuples = tuples.flatMap((tuple) => items.map((item) => [...tuple, item]));
    }
    try {
      return ce.box(['Set', ...tuples.map((tuple) => ce.box(['Tuple', ...tuple]))]).evaluate();
    } catch {
      return null;
    }
  }

  if (['Union', 'Intersection', 'SetMinus', 'SymmetricDifference'].includes(resolved.operator)) {
    const operands = resolved.ops.map((operand) => (
      materializeFiniteSet(ce, operand, definitions, new Set(seen))
    ));
    if (operands.some((operand) => !operand)) return null;
    try {
      const value = ce.box([resolved.operator, ...operands]).evaluate();
      return value.operator === 'Set' || value.symbol === 'EmptySet' ? value : null;
    } catch {
      return null;
    }
  }

  let value = resolved;
  try { value = resolved.evaluate(); } catch { return null; }
  if (value.unknowns.length > 0 || setBuilderParts(value)) return null;
  return value.operator === 'Set' || value.symbol === 'EmptySet' ? value : null;
}

function concreteSetRelationTruth(ce, expr, definitions) {
  if (!SET_RELATIONS.has(expr?.operator) || expr.nops !== 2) return null;
  const left = expr.operator === 'Element' || expr.operator === 'NotElement'
    ? expr.ops[0] : materializeFiniteSet(ce, expr.ops[0], definitions);
  const right = materializeFiniteSet(ce, expr.ops[1], definitions);
  if (!left || !right) return null;
  try {
    const evaluated = ce.box([expr.operator, left, right]).evaluate();
    if (evaluated.symbol === 'True') return true;
    if (evaluated.symbol === 'False') return false;
  } catch { /* not a closed finite relation */ }
  return null;
}

/** Build the proposition `element \in set`, expanding supported set values. */
function membership(
  ce, element, originalSet, definitions, seen = new Set(), realSymbols = new Set(), makeWitness
) {
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
    const loweredPredicate = lowerNode(
      ce, predicate, definitions, seen, makeWitness, realSymbols
    );
    if (!builder.domain) return loweredPredicate;
    const domain = membership(
      ce, element, builder.domain, definitions, seen, realSymbols, makeWitness
    );
    return {
      expr: connective(ce, 'And', [domain.expr, loweredPredicate.expr]),
      unresolvedSets: domain.unresolvedSets || loweredPredicate.unresolvedSets,
    };
  }

  if (setExpr?.symbol === 'EmptySet') return { expr: truth(ce, false), unresolvedSets: false };

  // A set is an element of the power set exactly when it is a subset of the
  // base. This is exact for finite, symbolic, builder, and standard-set bases.
  if (setExpr?.operator === 'PowerSet' && setExpr.nops === 1) {
    return lowerNode(
      ce,
      ce.box(['SubsetEqual', element, setExpr.ops[0]]),
      definitions,
      new Set(seen),
      makeWitness,
      realSymbols,
    );
  }

  if (setExpr?.operator === 'CartesianProduct' && setExpr.nops >= 2) {
    if (setExpr.ops.some((factor) => factor?.symbol === 'EmptySet')) {
      return { expr: truth(ce, false), unresolvedSets: false };
    }

    let components;
    let tupleGuard = null;
    if (element?.operator === 'Tuple') {
      if (element.nops !== setExpr.nops) {
        return { expr: truth(ce, false), unresolvedSets: false };
      }
      components = element.ops;
    } else if ((element?.unknowns?.length ?? 0) === 0) {
      return { expr: truth(ce, false), unresolvedSets: false };
    } else {
      tupleGuard = ce.box(['TupleOfArity', element, setExpr.nops]);
      components = setExpr.ops.map((_, index) => (
        ce.box(['TupleComponent', element, index + 1])
      ));
    }

    const checks = setExpr.ops.map((factor, index) => membership(
      ce, components[index], factor, definitions, new Set(seen), realSymbols, makeWitness
    ));
    return {
      expr: connective(ce, 'And', [
        ...(tupleGuard ? [tupleGuard] : []),
        ...checks.map((check) => check.expr),
      ]),
      unresolvedSets: Boolean(tupleGuard) || checks.some((check) => check.unresolvedSets),
    };
  }

  if ((setExpr?.operator === 'IndexedUnion' || setExpr?.operator === 'IndexedIntersection')
    && setExpr.nops === 2) {
    const concrete = materializeFiniteSet(ce, setExpr, definitions, new Set(seen));
    if (concrete) {
      return membership(
        ce, element, concrete, definitions, new Set(seen), realSymbols, makeWitness
      );
    }

    const definition = unaryFunctionDefinition(setExpr.ops[0], definitions);
    if (!definition) {
      return { expr: ce.box(['Element', element, originalSet]), unresolvedSets: true };
    }
    const index = freshWitness(ce, makeWitness);
    const memberSet = applyUnaryFunction(definition, index);
    if (!memberSet) {
      return { expr: ce.box(['Element', element, originalSet]), unresolvedSets: true };
    }
    const inDomain = membership(
      ce, index, setExpr.ops[1], definitions, new Set(seen), realSymbols, makeWitness
    );
    const inMember = membership(
      ce, element, memberSet, definitions, new Set(seen), realSymbols, makeWitness
    );
    if (setExpr.operator === 'IndexedIntersection') {
      return {
        expr: ce.box(['Implies', inDomain.expr, inMember.expr]),
        unresolvedSets: inDomain.unresolvedSets || inMember.unresolvedSets,
      };
    }
    return {
      expr: ce.box([
        'Exists', ce.box(['Element', index, setExpr.ops[1]]), inMember.expr,
      ]),
      unresolvedSets: true,
      unsafeEvaluation: true,
    };
  }

  if ((setExpr?.operator === 'OpenBall' || setExpr?.operator === 'ClosedBall')
    && setExpr.nops === 2) {
    const [center, radius] = setExpr.ops;
    [element, center, radius].forEach((part) => (
      part?.unknowns?.forEach((symbol) => realSymbols.add(symbol))
    ));
    const real = membership(
      ce, element, ce.box('RealNumbers'), definitions, new Set(seen), realSymbols, makeWitness
    );
    const distance = ce.box(['Abs', ce.box(['Subtract', element, center])]);
    const inside = ce.box([
      setExpr.operator === 'OpenBall' ? 'Less' : 'LessEqual', distance, radius,
    ]);
    return {
      expr: connective(ce, 'And', [real.expr, inside]),
      unresolvedSets: real.unresolvedSets,
    };
  }

  if (setExpr?.operator === 'Set') {
    const operands = setExpr.ops ?? [];
    return {
      expr: connective(ce, 'Or', operands.map((item) => ce.box(['Equal', element, item]))),
      unresolvedSets: false,
    };
  }

  if (setExpr?.operator === 'Union' || setExpr?.operator === 'Intersection') {
    const parts = setExpr.ops.map((operand) => membership(
      ce, element, operand, definitions, new Set(seen), realSymbols, makeWitness
    ));
    return {
      expr: connective(ce, setExpr.operator === 'Union' ? 'Or' : 'And', parts.map((part) => part.expr)),
      unresolvedSets: parts.some((part) => part.unresolvedSets),
    };
  }

  if (setExpr?.operator === 'SetMinus' && setExpr.nops === 2) {
    const left = membership(
      ce, element, setExpr.ops[0], definitions, new Set(seen), realSymbols, makeWitness
    );
    const right = membership(
      ce, element, setExpr.ops[1], definitions, new Set(seen), realSymbols, makeWitness
    );
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
      element.unknowns.forEach((symbol) => realSymbols.add(symbol));
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

function expressionKey(expr) {
  try { return JSON.stringify(expr?.json); } catch { return null; }
}

function subsetPair(expr) {
  if (!expr || expr.nops !== 2) return null;
  if (expr.operator === 'SubsetEqual' || expr.operator === 'Subset') return expr.ops;
  if (expr.operator === 'SupersetEqual' || expr.operator === 'Superset') {
    return [expr.ops[1], expr.ops[0]];
  }
  return null;
}

function collectSubsetFacts(expr, out = new Set()) {
  if (expr?.operator === 'And') {
    expr.ops.forEach((operand) => collectSubsetFacts(operand, out));
    return out;
  }
  const pair = subsetPair(expr);
  if (pair) out.add(`${expressionKey(pair[0])}\u0000${expressionKey(pair[1])}`);
  return out;
}

/**
 * Product monotonicity is a safe structural proof even though replacing a
 * product subset with all factor subsets would not be an equivalence when a
 * factor is empty. Recognise only the implication direction here and leave all
 * other cases to extensional membership lowering.
 */
function structurallyImpliesProductSubset(antecedent, consequent, definitions) {
  const pair = subsetPair(consequent);
  if (!pair) return false;
  const left = resolveDefinedSet(pair[0], definitions, new Set());
  const right = resolveDefinedSet(pair[1], definitions, new Set());
  if (left?.operator !== 'CartesianProduct' || right?.operator !== 'CartesianProduct'
    || left.nops !== right.nops) return false;

  const facts = collectSubsetFacts(antecedent);
  return left.ops.every((factor, index) => {
    const target = right.ops[index];
    if (expressionKey(factor) === expressionKey(target)) return true;
    if (standardSubset(factor, target) === true) return true;
    return facts.has(`${expressionKey(factor)}\u0000${expressionKey(target)}`);
  });
}

function extensionalRelation(
  ce, leftSet, rightSet, operator, definitions, makeWitness, seen, realSymbols
) {
  const witness = freshWitness(ce, makeWitness);
  const left = membership(
    ce, witness, leftSet, definitions, new Set(seen), realSymbols, makeWitness
  );
  const right = membership(
    ce, witness, rightSet, definitions, new Set(seen), realSymbols, makeWitness
  );
  return {
    expr: ce.box([operator, left.expr, right.expr]),
    unresolvedSets: left.unresolvedSets || right.unresolvedSets,
  };
}

function lowerFiniteQuantifier(
  ce, operator, binding, body, definitions, seen, makeWitness, realSymbols
) {
  if (binding?.operator !== 'Element' || binding.nops !== 2 || !binding.ops[0]?.symbol) {
    return null;
  }
  const domain = materializeFiniteSet(ce, binding.ops[1], definitions);
  if (!domain) return null;
  const items = domain.symbol === 'EmptySet' ? [] : domain.ops;
  const operands = [];
  for (const item of items) {
    let specialized;
    try {
      specialized = body.subs({ [binding.ops[0].symbol]: item });
    } catch {
      return null;
    }
    operands.push(lowerNode(
      ce, specialized, definitions, new Set(seen), makeWitness, realSymbols
    ));
  }
  return {
    expr: connective(ce, operator === 'ForAll' ? 'And' : 'Or', operands.map(({ expr }) => expr)),
    unresolvedSets: operands.some((operand) => operand.unresolvedSets),
    unsafeEvaluation: operands.some((operand) => operand.unsafeEvaluation),
  };
}

function lowerNode(ce, expr, definitions, seen = new Set(), makeWitness, realSymbols = new Set()) {
  if (!expr) return { expr, unresolvedSets: false };
  const op = expr.operator;

  if (op === 'Implies' && expr.nops === 2
    && structurallyImpliesProductSubset(expr.ops[0], expr.ops[1], definitions)) {
    return { expr: truth(ce, true), unresolvedSets: false };
  }

  if (op === 'Element' && expr.nops === 2) {
    return membership(
      ce, expr.ops[0], expr.ops[1], definitions, seen, realSymbols, makeWitness
    );
  }
  if (op === 'NotElement' && expr.nops === 2) {
    const inner = membership(
      ce, expr.ops[0], expr.ops[1], definitions, seen, realSymbols, makeWitness
    );
    return { expr: ce.box(['Not', inner.expr]), unresolvedSets: inner.unresolvedSets };
  }

  if ((op === 'SubsetEqual' || op === 'SupersetEqual') && expr.nops === 2) {
    const [left, right] = op === 'SubsetEqual' ? expr.ops : [expr.ops[1], expr.ops[0]];
    const resolvedLeft = resolveDefinedSet(left, definitions, new Set());
    const resolvedRight = resolveDefinedSet(right, definitions, new Set());
    if (resolvedLeft?.operator === 'PowerSet' && resolvedLeft.nops === 1
      && resolvedRight?.operator === 'PowerSet' && resolvedRight.nops === 1) {
      return lowerNode(
        ce,
        ce.box(['SubsetEqual', resolvedLeft.ops[0], resolvedRight.ops[0]]),
        definitions,
        seen,
        makeWitness,
        realSymbols,
      );
    }
    const standard = standardSubset(resolvedLeft, resolvedRight);
    if (standard !== null) return { expr: truth(ce, standard), unresolvedSets: false };

    // A finite subset is just the conjunction of its concrete membership
    // checks. This supplies exact witnesses without introducing a universal
    // element that the numeric prover would otherwise have to discover.
    const finiteLeft = materializeFiniteSet(ce, resolvedLeft, definitions);
    if (finiteLeft) {
      const items = finiteLeft.symbol === 'EmptySet' ? [] : finiteLeft.ops;
      const checks = items.map((item) => membership(
        ce, item, resolvedRight, definitions, new Set(seen), realSymbols, makeWitness
      ));
      return {
        expr: connective(ce, 'And', checks.map((check) => check.expr)),
        unresolvedSets: checks.some((check) => check.unresolvedSets),
      };
    }
    return extensionalRelation(
      ce, left, right, 'Implies', definitions, makeWitness, seen, realSymbols
    );
  }

  if ((op === 'Equal' || op === 'IdenticallyEqual') && expr.nops === 2
    && isSetExpression(expr.ops[0], definitions)
    && isSetExpression(expr.ops[1], definitions)) {
    const resolvedLeft = resolveDefinedSet(expr.ops[0], definitions, new Set());
    const resolvedRight = resolveDefinedSet(expr.ops[1], definitions, new Set());
    if (resolvedLeft?.operator === 'PowerSet' && resolvedLeft.nops === 1
      && resolvedRight?.operator === 'PowerSet' && resolvedRight.nops === 1) {
      return lowerNode(
        ce,
        ce.box([op, resolvedLeft.ops[0], resolvedRight.ops[0]]),
        definitions,
        seen,
        makeWitness,
        realSymbols,
      );
    }
    const left = materializeFiniteSet(ce, resolvedLeft, definitions);
    const right = materializeFiniteSet(ce, resolvedRight, definitions);
    if (left && right) {
      try {
        const evaluated = ce.box(['Equal', left, right]).evaluate();
        if (evaluated.symbol === 'True' || evaluated.symbol === 'False') {
          return { expr: evaluated, unresolvedSets: false };
        }
      } catch { /* use extensional equality below */ }
    }
    return extensionalRelation(
      ce, expr.ops[0], expr.ops[1], 'Equivalent', definitions, makeWitness, seen, realSymbols
    );
  }

  // Universal quantification over a set is exactly a pointwise implication.
  // This is also how the rest of the app interprets free numeric variables.
  if (op === 'ForAll' && expr.nops === 2) {
    const [binding, body] = expr.ops;
    const finite = lowerFiniteQuantifier(
      ce, op, binding, body, definitions, seen, makeWitness, realSymbols
    );
    if (finite) return finite;
    // A standard numeric domain never materialises, so the generic path below
    // would build an implication over an opaque `n ∈ ℕ` atom and leave the
    // whole statement unresolved — which is why every ℕ- and ℤ-quantified line
    // used to come back undecided, true and false alike. Strip the quantifier
    // instead: free variables are already read universally, and the domain
    // itself travels separately, to the sampler.
    if (binding?.operator === 'Element' && binding.nops === 2 && binding.ops[0]?.symbol) {
      const numeric = standardNumericDomain(
        resolveDefinedSet(binding.ops[1], definitions, new Set())
      );
      if (numeric) {
        if (numeric !== 'complex') realSymbols.add(binding.ops[0].symbol);
        return lowerNode(ce, body, definitions, seen, makeWitness, realSymbols);
      }
    }
    if (binding?.operator === 'Element' && binding.nops === 2 && binding.ops[0]?.symbol) {
      const domain = membership(
        ce, binding.ops[0], binding.ops[1], definitions, seen, realSymbols, makeWitness
      );
      const loweredBody = lowerNode(ce, body, definitions, seen, makeWitness, realSymbols);
      return {
        expr: ce.box(['Implies', domain.expr, loweredBody.expr]),
        unresolvedSets: domain.unresolvedSets || loweredBody.unresolvedSets,
      };
    }
    if (binding?.symbol) {
      return lowerNode(ce, body, definitions, seen, makeWitness, realSymbols);
    }
  }

  if (op === 'Exists' && expr.nops === 2) {
    const [binding, body] = expr.ops;
    const finite = lowerFiniteQuantifier(
      ce, op, binding, body, definitions, seen, makeWitness, realSymbols
    );
    if (finite) return finite;
  }

  if (LOGICAL.has(op)) {
    const operands = expr.ops.map((operand) => lowerNode(
      ce, operand, definitions, new Set(seen), makeWitness, realSymbols
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
    if (expr.ops[1]?.operator === 'PowerSet') markSetSymbols(expr.ops[0], definitions, out);
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
/**
 * Replace every `card(A)` by the size of A before anything else looks at the
 * statement.
 *
 * Cardinality is the one construct here that takes a set and returns a number,
 * so it does not belong in the relation lowering: `card(A) = 3` is an ordinary
 * arithmetic equation, and the set lowering never recurses into one. Left in
 * place it also reaches the sampler, which treats `card(S)` as an ordinary free
 * variable and will happily disprove a statement with a value cardinality
 * could never take.
 *
 * Only finite sets have a count here. `card(ℝ)` stays put and marks the
 * statement unresolved, because this app has no cardinal arithmetic and
 * guessing is worse than saying so.
 */
function resolveCardinalities(ce, expr, definitions, state) {
  if (!expr) return expr;
  if (expr.operator === 'SetCardinality' && expr.nops === 1) {
    const inner = resolveCardinalities(ce, expr.ops[0], definitions, state);
    const finite = materializeFiniteSet(ce, inner, definitions);
    if (!finite) {
      state.unresolved = true;
      return expr;
    }
    return ce.number(finite.symbol === 'EmptySet' ? 0 : finite.nops);
  }
  if (!expr.ops?.length) return expr;
  const parts = expr.ops.map((operand) => resolveCardinalities(ce, operand, definitions, state));
  if (parts.every((part, index) => part === expr.ops[index])) return expr;
  try {
    return ce.box([expr.operator, ...parts]);
  } catch {
    return expr;
  }
}

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
  const realSymbols = new Set();
  const cardinality = { unresolved: false };
  const counted = resolveCardinalities(ce, expr, typedDefinitions, cardinality);
  const lowered = lowerNode(
    ce, counted, typedDefinitions, new Set(), sharedWitness, realSymbols
  );
  return {
    ...lowered,
    realSymbols,
    unresolvedSets: lowered.unresolvedSets || cardinality.unresolved,
    unsafeEvaluation: lowered.unsafeEvaluation || cardinality.unresolved,
  };
}
