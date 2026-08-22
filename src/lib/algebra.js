/**
 * Exact verification of finite algebraic structures.
 *
 * The same bargain the finite-topology code makes: a structure on a finite
 * carrier has finitely many obligations, so they are checked rather than
 * argued. The operation is an ordinary two-argument function definition, which
 * means the sheet needs no new notion of "operation" —
 *
 *     G := {0, 1, 2, 3}
 *     m(a, b) := mod(a + b, 4)
 *     Grp(G, m, 0)
 *
 * and each axiom is separately nameable, so a group is walked one obligation
 * at a time the way a topology is walked through its four.
 *
 * What this is not: a theory of groups. Lagrange's theorem quantifies over all
 * finite groups and is not something a carrier-by-carrier check can establish.
 * What it can do is witness Lagrange on any concrete instance — certify the
 * subgroup, then count — which is a different and more modest claim.
 */

import { materializeFiniteSet } from './sets.js';

export const ALGEBRA_PREDICATES = new Set([
  'GroupStructure', 'GroupClosure', 'GroupAssociative',
  'GroupIdentity', 'GroupInverses', 'AbelianGroup', 'Subgroup',
  'RingStructure', 'RingDistributive', 'RingUnity', 'FieldStructure',
  'ModuleStructure',
]);

/**
 * Carriers larger than this are refused rather than checked. Associativity is
 * the binding constraint at n³ obligations; 16 keeps the worst case near four
 * thousand evaluations, which is still an instant.
 */
const MAX_CARRIER = 16;

export function containsAlgebraConstruct(expr) {
  if (!expr) return false;
  if (ALGEBRA_PREDICATES.has(expr.operator)) return true;
  return expr.ops?.some((operand) => containsAlgebraConstruct(operand)) ?? false;
}

/** An exact identity for a value, so table lookups compare values not syntax. */
function valueKey(expr) {
  try {
    return JSON.stringify(expr.evaluate().json);
  } catch {
    return null;
  }
}

function binaryDefinition(expr, definitions) {
  const definition = definitions.get(expr?.symbol);
  return definition?.kind === 'function' && definition.arity === 2
    && definition.bodyExpr && definition.paramIds?.length === 2
    ? definition
    : null;
}

function applyBinary(definition, left, right) {
  try {
    return definition.bodyExpr.subs({
      [definition.paramIds[0]]: left,
      [definition.paramIds[1]]: right,
    });
  } catch {
    return null;
  }
}

function carrierElements(ce, setExpr, definitions) {
  const finite = materializeFiniteSet(ce, setExpr, definitions);
  if (!finite) return null;
  const items = finite.symbol === 'EmptySet' ? [] : finite.ops;
  return items.length > MAX_CARRIER ? null : items;
}

/**
 * The multiplication table, as indices into the carrier.
 *
 * `-1` marks a product that left the carrier, which is exactly what closure
 * fails on. A product that cannot be evaluated at all aborts the whole
 * structure instead, because a table with a hole in it can neither confirm nor
 * refute anything.
 */
function structure(ce, setExpr, operationExpr, definitions) {
  const items = carrierElements(ce, setExpr, definitions);
  const operation = binaryDefinition(operationExpr, definitions);
  if (!items || !operation || items.length === 0) return null;

  const keys = items.map(valueKey);
  if (keys.some((key) => key === null)) return null;
  const index = new Map(keys.map((key, position) => [key, position]));

  const products = [];
  for (const left of items) {
    const row = [];
    for (const right of items) {
      const value = applyBinary(operation, left, right);
      const key = value === null ? null : valueKey(value);
      if (key === null) return null;
      row.push(index.has(key) ? index.get(key) : -1);
    }
    products.push(row);
  }
  return { items, index, products, operation };
}

const closed = ({ products }) => products.every((row) => row.every((cell) => cell >= 0));

/**
 * Associativity is checked through the operation rather than through the
 * table, so it stays meaningful on a carrier that is not closed: `(a·b)·c` is
 * a perfectly good question even when `a·b` fell outside.
 */
function associative({ items, operation }) {
  for (const a of items) {
    for (const b of items) {
      const ab = applyBinary(operation, a, b);
      if (ab === null) return null;
      for (const c of items) {
        const bc = applyBinary(operation, b, c);
        const left = ab === null ? null : applyBinary(operation, ab, c);
        const right = bc === null ? null : applyBinary(operation, a, bc);
        if (left === null || right === null) return null;
        if (valueKey(left) !== valueKey(right)) return false;
      }
    }
  }
  return true;
}

function identityAt(data, identityExpr) {
  const key = valueKey(identityExpr);
  if (key === null || !data.index.has(key)) return null;
  return data.index.get(key);
}

function hasIdentity(data, identityExpr) {
  const at = identityAt(data, identityExpr);
  if (at === null) return false;
  return data.items.every((_, position) => (
    data.products[at][position] === position && data.products[position][at] === position
  ));
}

function hasInverses(data, identityExpr) {
  const at = identityAt(data, identityExpr);
  if (at === null) return false;
  if (!closed(data)) return false;
  return data.items.every((_, a) => data.items.some((__, b) => (
    data.products[a][b] === at && data.products[b][a] === at
  )));
}

const commutative = ({ items, products }) => items.every((_, a) => items.every((__, b) => (
  products[a][b] === products[b][a]
)));

/** An abelian group, which is what a ring's addition has to be. */
function isAbelianGroup(data, zeroExpr) {
  return closed(data) && associative(data) === true && commutative(data)
    && hasIdentity(data, zeroExpr) && hasInverses(data, zeroExpr);
}

/**
 * Both distributive laws, checked through the operations.
 *
 * Left and right are checked separately rather than assuming commutativity —
 * a ring whose multiplication does not commute still has to satisfy both, and
 * checking only one would certify structures that are not rings.
 */
function distributive(items, add, multiply) {
  for (const a of items) {
    for (const b of items) {
      for (const c of items) {
        const sum = applyBinary(add, b, c);
        if (sum === null) return null;
        const left = applyBinary(multiply, a, sum);
        const leftExpanded = (() => {
          const first = applyBinary(multiply, a, b);
          const second = applyBinary(multiply, a, c);
          return first === null || second === null ? null : applyBinary(add, first, second);
        })();
        const right = applyBinary(multiply, sum, a);
        const rightExpanded = (() => {
          const first = applyBinary(multiply, b, a);
          const second = applyBinary(multiply, c, a);
          return first === null || second === null ? null : applyBinary(add, first, second);
        })();
        if (left === null || leftExpanded === null
          || right === null || rightExpanded === null) return null;
        if (valueKey(left) !== valueKey(leftExpanded)) return false;
        if (valueKey(right) !== valueKey(rightExpanded)) return false;
      }
    }
  }
  return true;
}

/** Every element other than zero has a multiplicative inverse. */
function invertibleAwayFromZero(data, zeroExpr, oneExpr) {
  const zero = identityAt(data, zeroExpr);
  const one = identityAt(data, oneExpr);
  if (zero === null || one === null || zero === one) return false;
  return data.items.every((_, a) => (
    a === zero || data.items.some((__, b) => (
      data.products[a][b] === one && data.products[b][a] === one
    ))
  ));
}

/**
 * The four module axioms, plus the closure of the action.
 *
 * `Mdl(M, p, R, rp, rm, 1, s)` deliberately does not re-check that `(M, p)` is
 * an abelian group or that `(R, rp, rm)` is a ring. Those are separate
 * obligations with their own names, and making them separate is the same
 * choice the topology axioms and the group axioms already make: a structure is
 * walked one line at a time, and a line that silently re-checked its
 * neighbours would hide which obligation actually failed.
 *
 * What it does check is that the action lands in M — without that the axioms
 * are comparing values that are not in the module at all.
 */
function moduleTruth(ce, expr, definitions) {
  if (expr.nops !== 7) return null;
  const [
    moduleExpr, addExpr, ringExpr, ringAddExpr, ringMultiplyExpr, oneExpr, actionExpr,
  ] = expr.ops;

  const vectors = structure(ce, moduleExpr, addExpr, definitions);
  const scalarsAdditive = structure(ce, ringExpr, ringAddExpr, definitions);
  const scalarsMultiplicative = structure(ce, ringExpr, ringMultiplyExpr, definitions);
  const action = binaryDefinition(actionExpr, definitions);
  if (!vectors || !scalarsAdditive || !scalarsMultiplicative || !action) return null;

  const scalars = scalarsAdditive.items;
  const act = (r, x) => applyBinary(action, r, x);
  const inModule = (value) => {
    const key = value === null ? null : valueKey(value);
    return key !== null && vectors.index.has(key);
  };

  for (const r of scalars) {
    for (const x of vectors.items) {
      const scaled = act(r, x);
      if (scaled === null) return null;
      if (!inModule(scaled)) return false;
    }
  }

  const one = identityAt(scalarsMultiplicative, oneExpr);
  if (one === null) return false;
  const oneValue = scalarsMultiplicative.items[one];

  for (const x of vectors.items) {
    // 1·x = x
    const unital = act(oneValue, x);
    if (unital === null) return null;
    if (valueKey(unital) !== valueKey(x)) return false;

    for (const r of scalars) {
      for (const y of vectors.items) {
        // r·(x + y) = r·x + r·y
        const sum = applyBinary(vectors.operation, x, y);
        if (sum === null) return null;
        const scaledSum = act(r, sum);
        const first = act(r, x);
        const second = act(r, y);
        if (scaledSum === null || first === null || second === null) return null;
        const expanded = applyBinary(vectors.operation, first, second);
        if (expanded === null) return null;
        if (valueKey(scaledSum) !== valueKey(expanded)) return false;
      }

      for (const s of scalars) {
        // (r + s)·x = r·x + s·x
        const scalarSum = applyBinary(scalarsAdditive.operation, r, s);
        const product = applyBinary(scalarsMultiplicative.operation, r, s);
        if (scalarSum === null || product === null) return null;
        const bySum = act(scalarSum, x);
        const left = act(r, x);
        const right = act(s, x);
        if (bySum === null || left === null || right === null) return null;
        const added = applyBinary(vectors.operation, left, right);
        if (added === null) return null;
        if (valueKey(bySum) !== valueKey(added)) return false;

        // (r·s)·x = r·(s·x)
        const byProduct = act(product, x);
        const nested = act(r, right);
        if (byProduct === null || nested === null) return null;
        if (valueKey(byProduct) !== valueKey(nested)) return false;
      }
    }
  }
  return true;
}

/**
 * Truth of one algebra predicate, or null when this prover cannot say.
 *
 * Null covers a carrier that is not finite, an operation that is not a
 * two-argument definition, a carrier past the size cap, and any product the
 * arithmetic could not evaluate. None of those are evidence either way, and
 * none of them are ever handed to the sampler.
 */
export function algebraTruth(ce, expr, definitions) {
  const op = expr.operator;

  if (op === 'Subgroup') {
    if (expr.nops !== 4) return null;
    const [subsetExpr, groupExpr, operationExpr, identityExpr] = expr.ops;
    const whole = structure(ce, groupExpr, operationExpr, definitions);
    const part = structure(ce, subsetExpr, operationExpr, definitions);
    if (!whole || !part) return null;
    const isGroup = closed(whole) && associative(whole) === true
      && hasIdentity(whole, identityExpr) && hasInverses(whole, identityExpr);
    if (!isGroup) return null;
    // Every element of H must sit in G, and H must be a group in its own
    // right under the same operation.
    const inside = part.items.every((item) => {
      const key = valueKey(item);
      return key !== null && whole.index.has(key);
    });
    if (!inside) return false;
    return closed(part) && hasIdentity(part, identityExpr)
      && hasInverses(part, identityExpr);
  }

  if (op === 'ModuleStructure') return moduleTruth(ce, expr, definitions);

  // Two operations on one carrier: rings and fields.
  if (op === 'RingDistributive' || op === 'RingStructure' || op === 'FieldStructure') {
    const wanted = { RingDistributive: 3, RingStructure: 4, FieldStructure: 5 }[op];
    if (expr.nops !== wanted) return null;
    const [setExpr, addExpr, multiplyExpr, zeroExpr, oneExpr] = expr.ops;
    const additive = structure(ce, setExpr, addExpr, definitions);
    const multiplicative = structure(ce, setExpr, multiplyExpr, definitions);
    if (!additive || !multiplicative) return null;

    const laws = distributive(additive.items, additive.operation, multiplicative.operation);
    if (laws === null) return null;
    if (op === 'RingDistributive') return laws;

    const associativity = associative(multiplicative);
    if (associativity === null) return null;
    const isRing = isAbelianGroup(additive, zeroExpr)
      && closed(multiplicative) && associativity && laws;
    if (op === 'RingStructure') return isRing;

    // A field is a commutative ring with unity in which everything but zero
    // is invertible — and in which zero and one are actually distinct, which
    // is what rules out the one-element ring.
    return isRing && commutative(multiplicative)
      && hasIdentity(multiplicative, oneExpr)
      && invertibleAwayFromZero(multiplicative, zeroExpr, oneExpr);
  }

  if (op === 'RingUnity') {
    if (expr.nops !== 3) return null;
    const data = structure(ce, expr.ops[0], expr.ops[1], definitions);
    return data ? hasIdentity(data, expr.ops[2]) : null;
  }

  const arity = op === 'GroupClosure' || op === 'GroupAssociative' || op === 'AbelianGroup'
    ? 2
    : 3;
  if (expr.nops !== arity) return null;
  const [setExpr, operationExpr, identityExpr] = expr.ops;
  const data = structure(ce, setExpr, operationExpr, definitions);
  if (!data) return null;

  if (op === 'GroupClosure') return closed(data);
  if (op === 'GroupAssociative') return associative(data);
  if (op === 'AbelianGroup') return closed(data) ? commutative(data) : null;
  if (op === 'GroupIdentity') return hasIdentity(data, identityExpr);
  if (op === 'GroupInverses') return hasInverses(data, identityExpr);
  if (op === 'GroupStructure') {
    const associativity = associative(data);
    if (associativity === null) return null;
    return closed(data) && associativity
      && hasIdentity(data, identityExpr) && hasInverses(data, identityExpr);
  }
  return null;
}
