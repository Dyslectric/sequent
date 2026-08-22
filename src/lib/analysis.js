/** Exact proof certificates for elementary real analysis and finite topology. */

import { materializeFiniteSet } from './sets.js';

export const ANALYSIS_PREDICATES = new Set([
  'ContinuousAt', 'LimitAt',
  'Induction', 'InductionBase', 'InductionStep',
  'CompactSpace',
  'Topology', 'OpenIn', 'ClosedIn', 'NeighborhoodOf',
  'MetricOpen', 'MetricClosed', 'ContinuousMap',
  'TopologyEmptyAxiom', 'TopologyCarrierAxiom',
  'TopologyUnionAxiom', 'TopologyIntersectionAxiom',
  'MetricIntersectionWitness',
]);

const LOGICAL = new Set(['And', 'Or', 'Not', 'Implies', 'Equivalent']);

const truth = (ce, value) => ce.box(value ? 'True' : 'False');

export function containsAnalysisConstruct(expr) {
  if (!expr) return false;
  if (ANALYSIS_PREDICATES.has(expr.operator)) return true;
  return expr.ops?.some((operand) => containsAnalysisConstruct(operand)) ?? false;
}

function items(setExpr) {
  if (!setExpr) return null;
  if (setExpr.symbol === 'EmptySet') return [];
  return setExpr.operator === 'Set' ? setExpr.ops : null;
}

function valueKey(expr) {
  try { return JSON.stringify(expr?.json); } catch { return null; }
}

function setKey(setExpr) {
  const members = items(setExpr);
  if (!members) return null;
  return JSON.stringify(members.map(valueKey).sort());
}

function makeSet(ce, members) {
  if (members.length === 0) return ce.box('EmptySet');
  try { return ce.box(['Set', ...members]).evaluate(); } catch { return ce.box(['Set', ...members]); }
}

function uniqueMembers(members) {
  return [...new Map(members.map((member) => [valueKey(member), member])).values()];
}

function subsetOf(left, right) {
  const rightKeys = new Set((items(right) ?? []).map(valueKey));
  return (items(left) ?? []).every((member) => rightKeys.has(valueKey(member)));
}

function unionSets(ce, left, right) {
  return makeSet(ce, uniqueMembers([...(items(left) ?? []), ...(items(right) ?? [])]));
}

function intersectSets(ce, left, right) {
  const rightKeys = new Set((items(right) ?? []).map(valueKey));
  return makeSet(ce, (items(left) ?? []).filter((member) => rightKeys.has(valueKey(member))));
}

function complementSet(ce, subset, universe) {
  const excluded = new Set((items(subset) ?? []).map(valueKey));
  return makeSet(ce, (items(universe) ?? []).filter((member) => !excluded.has(valueKey(member))));
}

function familyContains(family, candidate) {
  const candidateKey = setKey(candidate);
  return (items(family) ?? []).some((member) => setKey(member) === candidateKey);
}

function topologyTruth(ce, family, universe) {
  const openSets = items(family);
  const universeItems = items(universe);
  if (!openSets || !universeItems) return null;
  if (openSets.some((set) => items(set) === null)) return false;
  if (openSets.some((set) => !subsetOf(set, universe))) return false;
  if (!familyContains(family, ce.box('EmptySet')) || !familyContains(family, universe)) return false;

  for (const left of openSets) {
    for (const right of openSets) {
      if (!familyContains(family, unionSets(ce, left, right))) return false;
      if (!familyContains(family, intersectSets(ce, left, right))) return false;
    }
  }
  // A topology on a finite carrier is itself finite, so pairwise-union closure
  // implies closure under every subfamily union.
  return true;
}

function finiteTopologyAxiomTruth(ce, family, universe, axiom) {
  const openSets = items(family);
  const universeItems = items(universe);
  if (!openSets || !universeItems) return null;
  if (axiom === 'empty') return familyContains(family, ce.box('EmptySet'));
  if (axiom === 'carrier') return familyContains(family, universe);
  if (openSets.some((set) => items(set) === null)) return false;

  for (const left of openSets) {
    for (const right of openSets) {
      const combined = axiom === 'unions'
        ? unionSets(ce, left, right) : intersectSets(ce, left, right);
      if (!familyContains(family, combined)) return false;
    }
  }
  return true;
}

function finiteSet(ce, expr, definitions) {
  return materializeFiniteSet(ce, expr, definitions);
}

function resolveDefined(expr, definitions, seen = new Set()) {
  if (!expr?.symbol || seen.has(expr.symbol)) return expr;
  const definition = definitions.get(expr.symbol);
  if (definition?.kind !== 'set' || !definition.valueExpr) return expr;
  seen.add(expr.symbol);
  return resolveDefined(definition.valueExpr, definitions, seen);
}

function sameExpression(left, right, definitions) {
  return valueKey(resolveDefined(left, definitions)) === valueKey(resolveDefined(right, definitions));
}

const STANDARD_SET_RANK = new Map([
  ['NonNegativeIntegers', 0], ['Integers', 1], ['RationalNumbers', 2],
  ['RealNumbers', 3], ['ComplexNumbers', 4],
]);

/** Exact subset facts needed to validate subspace carriers. */
function knownSubsetTruth(ce, leftExpr, rightExpr, definitions) {
  const left = resolveDefined(leftExpr, definitions);
  const right = resolveDefined(rightExpr, definitions);
  if (!left || !right) return null;
  if (valueKey(left) === valueKey(right) || left.symbol === 'EmptySet') return true;

  const leftRank = STANDARD_SET_RANK.get(left.symbol);
  const rightRank = STANDARD_SET_RANK.get(right.symbol);
  if (leftRank !== undefined && rightRank !== undefined) return leftRank <= rightRank;
  if (right.symbol === 'RealNumbers'
    && (left.operator === 'OpenBall' || left.operator === 'ClosedBall')) return true;
  if (left.operator === 'Intersection') {
    const facts = left.ops.map((operand) => knownSubsetTruth(ce, operand, right, definitions));
    if (facts.some((fact) => fact === true)) return true;
  }
  if (left.operator === 'SetMinus') {
    return knownSubsetTruth(ce, left.ops[0], right, definitions);
  }
  if (left.operator === 'CartesianProduct' && right.operator === 'CartesianProduct'
    && left.nops === right.nops) {
    const facts = left.ops.map((operand, index) => (
      knownSubsetTruth(ce, operand, right.ops[index], definitions)
    ));
    return facts.every((fact) => fact === true) ? true : null;
  }

  const finiteLeft = finiteSet(ce, left, definitions);
  const finiteRight = finiteSet(ce, right, definitions);
  if (finiteLeft && finiteRight) return subsetOf(finiteLeft, finiteRight);
  if (finiteLeft && right.symbol === 'RealNumbers') {
    return (items(finiteLeft) ?? []).every((member) => {
      try { return ce.box(['Element', member, right]).evaluate().symbol === 'True'; }
      catch { return false; }
    }) ? true : null;
  }
  return null;
}

/**
 * Recognize theorem-backed topology constructors without enumerating their
 * members. A true result is a finite certificate for an infinite family.
 */
function topologySchemaTruth(ce, topologyExpr, carrierExpr, definitions, seen = new Set()) {
  const topology = resolveDefined(topologyExpr, definitions);
  const carrier = resolveDefined(carrierExpr, definitions);
  if (!topology || !carrier) return null;
  const key = valueKey(topology);
  if (key && seen.has(key)) return null;
  if (key) seen.add(key);

  if (topology.operator === 'PowerSet' && topology.nops === 1) {
    return sameExpression(topology.ops[0], carrier, definitions) ? true : null;
  }
  if (topology.operator === 'DiscreteTopology' && topology.nops === 2) {
    return sameExpression(topology.ops[0], carrier, definitions) ? true : null;
  }
  if ((topology.operator === 'IndiscreteTopology'
      || topology.operator === 'CofiniteTopology') && topology.nops === 2) {
    return sameExpression(topology.ops[0], carrier, definitions) ? true : null;
  }
  if (topology.operator === 'MetricTopology' && topology.nops === 2) {
    const metricCarrier = resolveDefined(topology.ops[0], definitions);
    return metricCarrier?.symbol === 'RealNumbers'
      && sameExpression(metricCarrier, carrier, definitions) ? true : null;
  }
  if (topology.operator === 'SubspaceTopology' && topology.nops === 3) {
    const [parentTopology, parentCarrier, subset] = topology.ops;
    if (!sameExpression(subset, carrier, definitions)
      || knownSubsetTruth(ce, subset, parentCarrier, definitions) !== true) return null;
    return topologyCertificateTruth(
      ce, parentTopology, parentCarrier, definitions, new Set(seen)
    );
  }
  if (topology.operator === 'ProductTopology' && topology.nops === 4) {
    const [leftTopology, leftCarrier, rightTopology, rightCarrier] = topology.ops;
    if (carrier.operator !== 'CartesianProduct' || carrier.nops !== 2
      || !sameExpression(carrier.ops[0], leftCarrier, definitions)
      || !sameExpression(carrier.ops[1], rightCarrier, definitions)) return null;
    const left = topologyCertificateTruth(
      ce, leftTopology, leftCarrier, definitions, new Set(seen)
    );
    const right = topologyCertificateTruth(
      ce, rightTopology, rightCarrier, definitions, new Set(seen)
    );
    return left === true && right === true ? true : null;
  }

  // `{empty, X}` is the conventional direct definition of the indiscrete
  // topology and remains valid for symbolic or infinite X.
  const direct = items(topology);
  if (direct?.length === 2
    && direct.some((member) => member.symbol === 'EmptySet')
    && direct.some((member) => sameExpression(member, carrier, definitions))) return true;
  return null;
}

function topologyCertificateTruth(ce, topologyExpr, carrierExpr, definitions, seen = new Set()) {
  const schema = topologySchemaTruth(ce, topologyExpr, carrierExpr, definitions, seen);
  if (schema === true) return true;
  const family = finiteSet(ce, topologyExpr, definitions);
  const universe = finiteSet(ce, carrierExpr, definitions);
  return family && universe ? topologyTruth(ce, family, universe) : null;
}

function topologyAxiomTruth(ce, topologyExpr, carrierExpr, definitions, axiom) {
  if (topologySchemaTruth(ce, topologyExpr, carrierExpr, definitions) === true) return true;
  const family = finiteSet(ce, topologyExpr, definitions);
  const universe = finiteSet(ce, carrierExpr, definitions);
  return family && universe
    ? finiteTopologyAxiomTruth(ce, family, universe, axiom)
    : null;
}

function metricOpenTruth(expr, definitions, seen = new Set()) {
  const resolved = resolveDefined(expr, definitions, seen);
  if (!resolved) return null;
  if (resolved.symbol === 'EmptySet' || resolved.operator === 'OpenBall') return true;
  if (resolved.operator === 'Set') return resolved.nops === 0;
  if (resolved.operator === 'Union' || resolved.operator === 'Intersection') {
    const parts = resolved.ops.map((operand) => metricOpenTruth(operand, definitions, new Set(seen)));
    return parts.every((part) => part === true) ? true : null;
  }
  return null;
}

function metricClosedTruth(expr, definitions, seen = new Set()) {
  const resolved = resolveDefined(expr, definitions, seen);
  if (!resolved) return null;
  if (resolved.symbol === 'EmptySet' || resolved.operator === 'ClosedBall') return true;
  // Every finite subset of R is closed.
  if (resolved.operator === 'Set') return true;
  if (resolved.operator === 'Intersection' || resolved.operator === 'Union') {
    const parts = resolved.ops.map((operand) => metricClosedTruth(
      operand, definitions, new Set(seen)
    ));
    return parts.every((part) => part === true) ? true : null;
  }
  return null;
}

function topologyOpenTruth(ce, candidateExpr, topologyExpr, definitions) {
  const candidate = resolveDefined(candidateExpr, definitions);
  const topology = resolveDefined(topologyExpr, definitions);
  if (!candidate || !topology) return null;

  const finiteCandidate = finiteSet(ce, candidate, definitions);
  const finiteTopology = finiteSet(ce, topology, definitions);
  if (finiteCandidate && finiteTopology) return familyContains(finiteTopology, finiteCandidate);

  if ((topology.operator === 'PowerSet' && topology.nops === 1)
    || (topology.operator === 'DiscreteTopology' && topology.nops === 2)) {
    return knownSubsetTruth(ce, candidate, topology.ops[0], definitions);
  }
  if (topology.operator === 'IndiscreteTopology' && topology.nops === 2) {
    return candidate.symbol === 'EmptySet'
      || sameExpression(candidate, topology.ops[0], definitions) ? true : null;
  }
  if (topology.operator === 'CofiniteTopology' && topology.nops === 2) {
    if (candidate.symbol === 'EmptySet') return true;
    const carrier = topology.ops[0];
    if (knownSubsetTruth(ce, candidate, carrier, definitions) !== true) return null;
    const finiteCarrier = finiteSet(ce, carrier, definitions);
    if (finiteCarrier) return true;
    if (candidate.operator === 'SetMinus'
      && sameExpression(candidate.ops[0], carrier, definitions)
      && finiteSet(ce, candidate.ops[1], definitions)) return true;
    return null;
  }
  if (topology.operator === 'MetricTopology' && topology.nops === 2) {
    return metricOpenTruth(candidate, definitions);
  }
  if (topology.operator === 'SubspaceTopology' && topology.nops === 3) {
    const [parentTopology, , subset] = topology.ops;
    if (candidate.symbol === 'EmptySet' || sameExpression(candidate, subset, definitions)) return true;
    if (candidate.operator === 'Intersection' && candidate.nops === 2) {
      const [left, right] = candidate.ops;
      if (sameExpression(left, subset, definitions)) {
        return topologyOpenTruth(ce, right, parentTopology, definitions);
      }
      if (sameExpression(right, subset, definitions)) {
        return topologyOpenTruth(ce, left, parentTopology, definitions);
      }
    }
    return null;
  }
  if (topology.operator === 'ProductTopology' && topology.nops === 4) {
    const [leftTopology, , rightTopology] = topology.ops;
    if (candidate.symbol === 'EmptySet') return true;
    if (candidate.operator === 'CartesianProduct' && candidate.nops === 2) {
      const left = topologyOpenTruth(ce, candidate.ops[0], leftTopology, definitions);
      const right = topologyOpenTruth(ce, candidate.ops[1], rightTopology, definitions);
      return left === true && right === true ? true : null;
    }
  }
  return null;
}

function functionDefinition(functionExpr, definitions) {
  if (!functionExpr?.symbol) return null;
  const definition = definitions.get(functionExpr.symbol);
  return definition?.kind === 'function' && definition.arity === 1
    && definition.bodyExpr && definition.paramIds?.length === 1
    ? definition
    : null;
}

function applyFunction(definition, argument) {
  try {
    return definition.bodyExpr.subs({ [definition.paramIds[0]]: argument });
  } catch {
    return null;
  }
}

function evaluated(expr) {
  try { return expr.evaluate(); } catch { return expr; }
}

function equalValues(ce, left, right) {
  try {
    const result = ce.box(['Equal', left, right]).evaluate();
    if (result.symbol === 'True') return true;
    if (result.symbol === 'False') return false;
  } catch { /* unresolved equality */ }
  return valueKey(evaluated(left)) === valueKey(evaluated(right));
}

function finiteContinuousTruth(ce, expr, definitions) {
  if (expr.nops !== 5) return null;
  const [functionExpr, domainExpr, domainTopologyExpr, codomainExpr, codomainTopologyExpr] = expr.ops;
  const definition = functionDefinition(functionExpr, definitions);
  const domain = finiteSet(ce, domainExpr, definitions);
  const domainTopology = finiteSet(ce, domainTopologyExpr, definitions);
  const codomain = finiteSet(ce, codomainExpr, definitions);
  const codomainTopology = finiteSet(ce, codomainTopologyExpr, definitions);
  if (!definition || !domain || !domainTopology || !codomain || !codomainTopology) return null;
  if (topologyTruth(ce, domainTopology, domain) !== true
    || topologyTruth(ce, codomainTopology, codomain) !== true) return false;

  const domainPoints = items(domain);
  const codomainPoints = items(codomain);
  const values = domainPoints.map((point) => applyFunction(definition, point));
  if (values.some((value) => !value)) return null;
  if (values.some((value) => !codomainPoints.some((point) => equalValues(ce, value, point)))) {
    return false;
  }

  for (const openSet of items(codomainTopology)) {
    const openPoints = items(openSet);
    const preimage = makeSet(ce, domainPoints.filter((_, index) => (
      openPoints.some((point) => equalValues(ce, values[index], point))
    )));
    if (!familyContains(domainTopology, preimage)) return false;
  }
  return true;
}

function addRealSymbols(expr, out) {
  expr?.unknowns?.forEach((symbol) => out.add(symbol));
}

function absoluteLessThan(ce, value, bound) {
  return ce.box(['And',
    ce.box(['Greater', value, ce.box(['Negate', bound])]),
    ce.box(['Less', value, bound]),
  ]);
}

function witnessFormula(ce, expr, definitions, makeWitness, realSymbols) {
  const isContinuity = expr.operator === 'ContinuousAt';
  if ((isContinuity && expr.nops !== 4) || (!isContinuity && expr.nops !== 5)) return null;
  const [functionExpr, point, limitOrEpsilon, epsilonOrDelta, maybeDelta] = expr.ops;
  const epsilon = isContinuity ? limitOrEpsilon : epsilonOrDelta;
  const deltaInput = isContinuity ? epsilonOrDelta : maybeDelta;
  const limit = isContinuity ? null : limitOrEpsilon;
  const definition = functionDefinition(functionExpr, definitions);
  if (!definition || !epsilon?.symbol || definitions.has(epsilon.symbol)) return null;

  const variable = ce.box(makeWitness?.() ?? 'AnalysisWitness');
  const delta = evaluated(deltaInput);
  const atVariable = applyFunction(definition, variable);
  const atPoint = applyFunction(definition, point);
  if (!atVariable || (!isContinuity && !limit) || (isContinuity && !atPoint)) return null;

  const epsilonPositive = ce.box(['Greater', epsilon, 0]);
  const deltaPositive = ce.box(['Greater', delta, 0]);
  const inputDifference = ce.box(['Subtract', variable, point]);
  const close = absoluteLessThan(ce, inputDifference, delta);
  const outputTarget = isContinuity ? atPoint : limit;
  const outputClose = absoluteLessThan(
    ce, ce.box(['Subtract', atVariable, outputTarget]), epsilon
  );
  const antecedents = [epsilonPositive, close];
  if (!isContinuity) antecedents.push(ce.box(['NotEqual', variable, point]));

  [point, epsilon, delta, atVariable, outputTarget, variable].forEach((part) => (
    addRealSymbols(part, realSymbols)
  ));
  return ce.box(['And',
    ce.box(['Implies', epsilonPositive, deltaPositive]),
    ce.box(['Implies', ce.box(['And', ...antecedents]), outputClose]),
  ]);
}

/** Standard sets known to be infinite, which is what rules out compactness. */
const KNOWN_INFINITE = new Set([
  'NonNegativeIntegers', 'PositiveIntegers', 'Integers',
  'RationalNumbers', 'RealNumbers', 'ExtendedRealNumbers', 'ComplexNumbers',
]);

/**
 * Compactness, from finite theorem schemas rather than from open covers.
 *
 * Enumerating covers is hopeless for any space worth asking about, so each
 * constructor carries its own answer, exactly as the topology axioms do:
 *
 *   - a finite carrier is compact under any topology at all;
 *   - the indiscrete and cofinite topologies are compact on any carrier;
 *   - a discrete topology is compact only on a finite carrier, so on a carrier
 *     known to be infinite it is not;
 *   - ℝ under its metric is not compact;
 *   - a product is compact exactly when both factors are;
 *   - and a subspace of the real line is compact exactly when it is closed and
 *     bounded, which is Heine–Borel and is where `closedball` and `ball` part
 *     company.
 *
 * "Not known to be finite" is not the same as infinite: `Disc(S)` for a
 * symbolic S is undecided rather than non-compact, because S may well be
 * finite. Only a carrier that is *known* infinite earns a false.
 */
function compactTruth(ce, topologyExpr, carrierExpr, definitions, seen = new Set()) {
  // Compactness is a property of a space, so it has to be one first.
  if (topologyCertificateTruth(
    ce, topologyExpr, carrierExpr, definitions, new Set(seen)
  ) !== true) return null;

  if (finiteSet(ce, carrierExpr, definitions)) return true;

  const topology = resolveDefined(topologyExpr, definitions);
  const carrier = resolveDefined(carrierExpr, definitions);
  if (!topology || !carrier) return null;
  const key = valueKey(topology);
  if (key && seen.has(key)) return null;
  if (key) seen.add(key);

  if (topology.operator === 'IndiscreteTopology' || topology.operator === 'CofiniteTopology') {
    return true;
  }
  if (topology.operator === 'DiscreteTopology' || topology.operator === 'PowerSet') {
    return KNOWN_INFINITE.has(carrier.symbol) ? false : null;
  }
  if (topology.operator === 'MetricTopology') {
    return KNOWN_INFINITE.has(carrier.symbol) ? false : null;
  }
  if (topology.operator === 'ProductTopology' && topology.nops === 4) {
    const [leftTopology, leftCarrier, rightTopology, rightCarrier] = topology.ops;
    const left = compactTruth(ce, leftTopology, leftCarrier, definitions, new Set(seen));
    const right = compactTruth(ce, rightTopology, rightCarrier, definitions, new Set(seen));
    if (left === false || right === false) return false;
    return left === true && right === true ? true : null;
  }
  if (topology.operator === 'SubspaceTopology' && topology.nops === 3) {
    const [parentTopology, , subset] = topology.ops;
    const parent = resolveDefined(parentTopology, definitions);
    if (parent?.operator !== 'MetricTopology') return null;
    const region = resolveDefined(subset, definitions);
    // Heine–Borel, in the two shapes the app can actually name: a closed ball
    // is closed and bounded, an open ball is bounded and not closed.
    if (region?.operator === 'ClosedBall') return true;
    if (region?.operator === 'OpenBall') return false;
    return KNOWN_INFINITE.has(region?.symbol) ? false : null;
  }
  return null;
}

/**
 * Induction, as two obligations rather than an appeal to a rule.
 *
 * `Induct(P, b)` opens the base case `P(b)` and the step
 * `k ≥ b ∧ P(k) ⟹ P(k+1)` for a fresh `k`, and hands both to the ordinary
 * exact machinery. `Base` and `Step` name the same obligations separately, so
 * an induction can be walked one line at a time the way a topology is walked
 * through its four axioms.
 *
 * The step is discharged over the reals, which is stronger than it needs to
 * be: a step that holds for every real `k ≥ b` certainly holds for every
 * integer one. That costs completeness — a step true only at the integers goes
 * undecided — and buys soundness, which is the trade this app makes everywhere
 * else. Certificates are never sampled, so an induction is proved exactly or
 * not at all.
 */
function inductionObligations(ce, expr, definitions, makeWitness) {
  if (expr.nops !== 2) return null;
  const [predicateExpr, baseExpr] = expr.ops;
  const definition = functionDefinition(predicateExpr, definitions);
  if (!definition || !baseExpr) return null;

  const base = applyFunction(definition, baseExpr);
  const variable = ce.box(makeWitness?.() ?? 'InductionWitness');
  const atVariable = applyFunction(definition, variable);
  const atSuccessor = applyFunction(definition, ce.box(['Add', variable, 1]));
  if (!base || !atVariable || !atSuccessor) return null;

  return {
    base,
    step: ce.box(['Implies',
      ce.box(['And', ce.box(['GreaterEqual', variable, baseExpr]), atVariable]),
      atSuccessor,
    ]),
  };
}

function lowerNode(ce, expr, definitions, makeWitness, realSymbols) {
  if (!expr) return { expr, unresolvedAnalysis: false };
  const op = expr.operator;

  if (op === 'CompactSpace' && expr.nops === 2) {
    const verdict = compactTruth(ce, expr.ops[0], expr.ops[1], definitions);
    return verdict === null
      ? { expr, unresolvedAnalysis: true, unsafeEvaluation: true }
      : { expr: truth(ce, verdict), unresolvedAnalysis: false };
  }

  if (op === 'Induction' || op === 'InductionBase' || op === 'InductionStep') {
    const obligations = inductionObligations(ce, expr, definitions, makeWitness);
    if (!obligations) return { expr, unresolvedAnalysis: true, unsafeEvaluation: true };
    if (op === 'InductionBase') return { expr: obligations.base, unresolvedAnalysis: false };
    if (op === 'InductionStep') return { expr: obligations.step, unresolvedAnalysis: false };
    return {
      expr: ce.box(['And', obligations.base, obligations.step]),
      unresolvedAnalysis: false,
    };
  }

  if (op === 'ContinuousAt' || op === 'LimitAt') {
    const formula = witnessFormula(ce, expr, definitions, makeWitness, realSymbols);
    return formula
      ? { expr: formula, unresolvedAnalysis: false }
      : { expr, unresolvedAnalysis: true, unsafeEvaluation: true };
  }

  if (op === 'MetricIntersectionWitness' && expr.nops === 3) {
    const [leftRadius, rightRadius, witness] = expr.ops;
    const witnessOperands = witness?.operator === 'Min' ? witness.ops : [];
    const matches = witnessOperands.length === 2 && (
      (valueKey(witnessOperands[0]) === valueKey(leftRadius)
        && valueKey(witnessOperands[1]) === valueKey(rightRadius))
      || (valueKey(witnessOperands[1]) === valueKey(leftRadius)
        && valueKey(witnessOperands[0]) === valueKey(rightRadius))
    );
    [leftRadius, rightRadius, witness].forEach((part) => addRealSymbols(part, realSymbols));
    return matches
      ? { expr: truth(ce, true), unresolvedAnalysis: false }
      : { expr, unresolvedAnalysis: true, unsafeEvaluation: true };
  }

  if (op === 'Topology' && expr.nops === 2) {
    const result = topologyCertificateTruth(ce, expr.ops[0], expr.ops[1], definitions);
    return result === null
      ? { expr, unresolvedAnalysis: true, unsafeEvaluation: true }
      : { expr: truth(ce, result), unresolvedAnalysis: false };
  }

  const topologyAxioms = new Map([
    ['TopologyEmptyAxiom', 'empty'],
    ['TopologyCarrierAxiom', 'carrier'],
    ['TopologyUnionAxiom', 'unions'],
    ['TopologyIntersectionAxiom', 'intersections'],
  ]);
  if (topologyAxioms.has(op) && expr.nops === 2) {
    const result = topologyAxiomTruth(
      ce, expr.ops[0], expr.ops[1], definitions, topologyAxioms.get(op)
    );
    return result === null
      ? { expr, unresolvedAnalysis: true, unsafeEvaluation: true }
      : { expr: truth(ce, result), unresolvedAnalysis: false };
  }

  if (op === 'OpenIn' && expr.nops === 2) {
    const topology = resolveDefined(expr.ops[1], definitions);
    if ((topology?.operator === 'PowerSet' && topology.nops === 1)
      || (topology?.operator === 'DiscreteTopology' && topology.nops === 2)) {
      return {
        expr: ce.box(['SubsetEqual', expr.ops[0], topology.ops[0]]),
        unresolvedAnalysis: false,
      };
    }
    if (topology?.operator === 'IndiscreteTopology' && topology.nops === 2) {
      return {
        expr: ce.box(['Or',
          ce.box(['Equal', expr.ops[0], ce.box('EmptySet')]),
          ce.box(['Equal', expr.ops[0], topology.ops[0]]),
        ]),
        unresolvedAnalysis: false,
      };
    }
    const result = topologyOpenTruth(ce, expr.ops[0], expr.ops[1], definitions);
    return result === null
      ? { expr, unresolvedAnalysis: true, unsafeEvaluation: true }
      : { expr: truth(ce, result), unresolvedAnalysis: false };
  }

  if (op === 'ClosedIn' && expr.nops === 3) {
    const candidate = finiteSet(ce, expr.ops[0], definitions);
    const family = finiteSet(ce, expr.ops[1], definitions);
    const universe = finiteSet(ce, expr.ops[2], definitions);
    let result = null;
    if (candidate && family && universe) {
      result = subsetOf(candidate, universe)
        && topologyTruth(ce, family, universe) === true
        && familyContains(family, complementSet(ce, candidate, universe));
    }
    return result === null
      ? { expr, unresolvedAnalysis: true, unsafeEvaluation: true }
      : { expr: truth(ce, result), unresolvedAnalysis: false };
  }

  if (op === 'NeighborhoodOf' && expr.nops === 3) {
    const neighborhood = finiteSet(ce, expr.ops[0], definitions);
    const family = finiteSet(ce, expr.ops[2], definitions);
    let result = null;
    if (neighborhood && family && items(family)?.every((set) => items(set) !== null)) {
      const universe = items(family).reduce(
        (current, openSet) => unionSets(ce, current, openSet), ce.box('EmptySet')
      );
      if (topologyTruth(ce, family, universe) === true) {
        result = items(family).some((openSet) => (
          (items(openSet) ?? []).some((point) => equalValues(ce, point, expr.ops[1]))
          && subsetOf(openSet, neighborhood)
        ));
      } else result = false;
    }
    return result === null
      ? { expr, unresolvedAnalysis: true, unsafeEvaluation: true }
      : { expr: truth(ce, result), unresolvedAnalysis: false };
  }

  if (op === 'MetricOpen' && (expr.nops === 1 || expr.nops === 2)) {
    const realMetric = expr.nops === 1 || expr.ops[1]?.symbol === 'RealNumbers';
    const result = realMetric ? metricOpenTruth(expr.ops[0], definitions) : null;
    return result === null
      ? { expr, unresolvedAnalysis: true, unsafeEvaluation: true }
      : { expr: truth(ce, result), unresolvedAnalysis: false };
  }

  if (op === 'MetricClosed' && (expr.nops === 1 || expr.nops === 2)) {
    const realMetric = expr.nops === 1 || expr.ops[1]?.symbol === 'RealNumbers';
    const result = realMetric ? metricClosedTruth(expr.ops[0], definitions) : null;
    return result === null
      ? { expr, unresolvedAnalysis: true, unsafeEvaluation: true }
      : { expr: truth(ce, result), unresolvedAnalysis: false };
  }

  if (op === 'ContinuousMap') {
    const result = finiteContinuousTruth(ce, expr, definitions);
    return result === null
      ? { expr, unresolvedAnalysis: true, unsafeEvaluation: true }
      : { expr: truth(ce, result), unresolvedAnalysis: false };
  }

  if (LOGICAL.has(op)) {
    const operands = expr.ops.map((operand) => lowerNode(
      ce, operand, definitions, makeWitness, realSymbols
    ));
    return {
      expr: ce.box([op, ...operands.map((operand) => operand.expr)]),
      unresolvedAnalysis: operands.some((operand) => operand.unresolvedAnalysis),
      unsafeEvaluation: operands.some((operand) => operand.unsafeEvaluation),
    };
  }

  return { expr, unresolvedAnalysis: false };
}

/** Lower proof-oriented analysis/topology predicates to exact propositions. */
export function lowerAnalysisProposition(ce, expr, definitions, makeWitness) {
  const realSymbols = new Set();
  const lowered = lowerNode(ce, expr, definitions, makeWitness, realSymbols);
  return { ...lowered, realSymbols };
}
