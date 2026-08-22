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
