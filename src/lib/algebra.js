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
  'ModuleStructure', 'VectorSpace',
  'CategoryStructure', 'CategoryComposition', 'CategoryIdentities',
  'CategoryAssociative', 'FunctorStructure',
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

/* ------------------------------- categories ------------------------------- */

/**
 * Small categories, on the same bargain as the rest of this file.
 *
 * A category differs from every structure above it in one way that shapes all
 * of the code below: **composition is partial**. `c(f, g)` is a question only
 * when `f` and `g` meet, and an axiom quantified over "all pairs" would be
 * asking about pairs that do not compose. So the tables here carry three
 * outcomes rather than two — not composable, composable and inside, composable
 * and outside — and every axiom says which of the three it tolerates.
 *
 *     O := {0, 1, 2}
 *     M := {0, 1, 2, 4, 5, 8}          the poset 0 <= 1 <= 2, with i -> j as 3i + j
 *     s(m) := floor(m/3)
 *     t(m) := mod(m, 3)
 *     c(f, g) := 3s(f) + t(g)
 *     i(x) := 4x
 *     Cat(O, M, s, t, c, i)
 *
 * **`c(f, g)` is `f` then `g`** — diagrammatic order, so the composable
 * condition reads `t(f) = s(g)` with the arguments in the order they are
 * written. This is the opposite of the `g . f` convention, and it is the one
 * choice here a reader has to be told rather than shown.
 *
 * What this is not: a theory of categories. Yoneda quantifies over all small
 * categories and is not something a carrier-by-carrier check can reach. What
 * it can do is witness a property on a concrete one.
 */

/** The four that share the `(O, M, s, t, c, ...)` shape; `Fun` does not. */
const CATEGORY_PREDICATES = new Set([
  'CategoryStructure', 'CategoryComposition', 'CategoryIdentities', 'CategoryAssociative',
]);

function unaryDefinition(expr, definitions) {
  const definition = definitions.get(expr?.symbol);
  return definition?.kind === 'function' && definition.arity === 1
    && definition.bodyExpr && definition.paramIds?.length === 1
    ? definition
    : null;
}

function applyUnary(definition, argument) {
  try {
    return definition.bodyExpr.subs({ [definition.paramIds[0]]: argument });
  } catch {
    return null;
  }
}

/**
 * Morphisms, their endpoints, and the composition table.
 *
 * Endpoints are kept as value *keys* rather than as indices into an object
 * list, because associativity is askable without an object set at all — it is
 * a question about which pairs meet, not about what they meet at. `Cat` and
 * the identity axiom supply objects and check membership separately.
 */
function categoryData(ce, morphismsExpr, sourceExpr, targetExpr, composeExpr, definitions) {
  const morphisms = carrierElements(ce, morphismsExpr, definitions);
  const source = unaryDefinition(sourceExpr, definitions);
  const target = unaryDefinition(targetExpr, definitions);
  const compose = binaryDefinition(composeExpr, definitions);
  if (!morphisms || !morphisms.length || !source || !target || !compose) return null;

  const keys = morphisms.map(valueKey);
  if (keys.some((key) => key === null)) return null;
  const index = new Map(keys.map((key, position) => [key, position]));

  const sourceKeys = [];
  const targetKeys = [];
  const sourceValues = [];
  const targetValues = [];
  for (const morphism of morphisms) {
    const from = applyUnary(source, morphism);
    const to = applyUnary(target, morphism);
    const fromKey = from === null ? null : valueKey(from);
    const toKey = to === null ? null : valueKey(to);
    if (fromKey === null || toKey === null) return null;
    sourceKeys.push(fromKey);
    targetKeys.push(toKey);
    sourceValues.push(from);
    targetValues.push(to);
  }

  // `null` where the pair does not compose, `-1` where the composite left the
  // morphism set, otherwise its position. The three outcomes are the point.
  const composites = [];
  for (let f = 0; f < morphisms.length; f += 1) {
    const row = [];
    for (let g = 0; g < morphisms.length; g += 1) {
      if (targetKeys[f] !== sourceKeys[g]) { row.push(null); continue; }
      const value = applyBinary(compose, morphisms[f], morphisms[g]);
      const key = value === null ? null : valueKey(value);
      if (key === null) return null;
      row.push(index.has(key) ? index.get(key) : -1);
    }
    composites.push(row);
  }

  return {
    morphisms, index, keys, sourceKeys, targetKeys, sourceValues, targetValues,
    composites, compose,
  };
}

/**
 * Composition is well-typed: it lands in the morphisms, and its endpoints are
 * the outer ones.
 *
 * Endpoint membership in the object set is checked here too when objects are
 * supplied, because a source that is not an object makes every axiom below a
 * statement about nothing.
 */
function composesWell(data, objects) {
  if (objects) {
    const objectKeys = new Set(objects.map(valueKey));
    if (objectKeys.has(null)) return null;
    for (let f = 0; f < data.morphisms.length; f += 1) {
      if (!objectKeys.has(data.sourceKeys[f])) return false;
      if (!objectKeys.has(data.targetKeys[f])) return false;
    }
  }
  for (let f = 0; f < data.morphisms.length; f += 1) {
    for (let g = 0; g < data.morphisms.length; g += 1) {
      const at = data.composites[f][g];
      if (at === null) continue;
      if (at < 0) return false;
      if (data.sourceKeys[at] !== data.sourceKeys[f]) return false;
      if (data.targetKeys[at] !== data.targetKeys[g]) return false;
    }
  }
  return true;
}

/**
 * Every object has an identity, and it is a unit on both sides.
 *
 * The unit laws are checked through the operation rather than through the
 * table, for the same reason the group's associativity is: `c(i(s(f)), f)` is
 * a perfectly good question even when some other composite left the carrier.
 */
function hasIdentities(data, objects, identity) {
  const objectKeys = objects.map(valueKey);
  if (objectKeys.some((key) => key === null)) return null;

  const identityOf = new Map();
  for (let x = 0; x < objects.length; x += 1) {
    const unit = applyUnary(identity, objects[x]);
    const key = unit === null ? null : valueKey(unit);
    if (key === null) return null;
    if (!data.index.has(key)) return false;
    const at = data.index.get(key);
    // An identity of `x` has to start and end at `x`, or it is some other
    // morphism that happens to have been named.
    if (data.sourceKeys[at] !== objectKeys[x]) return false;
    if (data.targetKeys[at] !== objectKeys[x]) return false;
    identityOf.set(objectKeys[x], unit);
  }

  for (let f = 0; f < data.morphisms.length; f += 1) {
    const before = identityOf.get(data.sourceKeys[f]);
    const after = identityOf.get(data.targetKeys[f]);
    if (before === undefined || after === undefined) return false;
    const left = applyBinary(data.compose, before, data.morphisms[f]);
    const right = applyBinary(data.compose, data.morphisms[f], after);
    if (left === null || right === null) return null;
    if (valueKey(left) !== data.keys[f]) return false;
    if (valueKey(right) !== data.keys[f]) return false;
  }
  return true;
}

/** Associativity, over the triples that actually compose. */
function categoryAssociative(data) {
  const { morphisms, sourceKeys, targetKeys, compose } = data;
  for (let f = 0; f < morphisms.length; f += 1) {
    for (let g = 0; g < morphisms.length; g += 1) {
      if (targetKeys[f] !== sourceKeys[g]) continue;
      const fg = applyBinary(compose, morphisms[f], morphisms[g]);
      if (fg === null) return null;
      for (let h = 0; h < morphisms.length; h += 1) {
        if (targetKeys[g] !== sourceKeys[h]) continue;
        const gh = applyBinary(compose, morphisms[g], morphisms[h]);
        if (gh === null) return null;
        const left = applyBinary(compose, fg, morphisms[h]);
        const right = applyBinary(compose, morphisms[f], gh);
        if (left === null || right === null) return null;
        if (valueKey(left) !== valueKey(right)) return false;
      }
    }
  }
  return true;
}

/** The six arguments of a `Cat(...)`, however it reached us. */
function categoryArguments(expr) {
  return expr?.operator === 'CategoryStructure' && expr.nops === 6 ? expr.ops : null;
}

/**
 * A functor, which is where naming a category earns its keep.
 *
 * Written out positionally a functor takes both categories and both maps —
 * fourteen arguments, which nobody is going to type. So `Fun` takes the two
 * categories by *name*:
 *
 *     C := Cat(O, M, s, t, c, i)
 *     D := Cat(P, N, u, v, d, j)
 *     Fun(C, D, F, G)
 *
 * A named proposition is inlined before dispatch, so both arrive here as the
 * `Cat(...)` they were defined as and their six arguments are read straight
 * off. `F` maps morphisms and `G` maps objects.
 *
 * Like `Mdl`, this does **not** re-check that `C` and `D` are categories.
 * Those are separate obligations with their own names, and a line that
 * silently re-checked its neighbours would hide which one actually failed.
 */
function functorTruth(ce, expr, definitions) {
  if (expr.nops !== 4) return null;
  const [sourceCategoryExpr, targetCategoryExpr, morphismMapExpr, objectMapExpr] = expr.ops;
  const from = categoryArguments(sourceCategoryExpr);
  const to = categoryArguments(targetCategoryExpr);
  if (!from || !to) return null;

  const domain = categoryData(ce, from[1], from[2], from[3], from[4], definitions);
  const codomain = categoryData(ce, to[1], to[2], to[3], to[4], definitions);
  const objects = carrierElements(ce, from[0], definitions);
  const targetObjects = carrierElements(ce, to[0], definitions);
  const sourceIdentity = unaryDefinition(from[5], definitions);
  const targetIdentity = unaryDefinition(to[5], definitions);
  const onMorphisms = unaryDefinition(morphismMapExpr, definitions);
  const onObjects = unaryDefinition(objectMapExpr, definitions);
  if (!domain || !codomain || !objects || !targetObjects
    || !sourceIdentity || !targetIdentity || !onMorphisms || !onObjects) return null;

  const targetObjectKeys = new Set(targetObjects.map(valueKey));
  if (targetObjectKeys.has(null)) return null;

  // The object map lands in the objects, and the image of an object is where
  // the images of its morphisms have to start and end.
  const objectImage = new Map();
  for (const object of objects) {
    const image = applyUnary(onObjects, object);
    const key = image === null ? null : valueKey(image);
    const objectKey = valueKey(object);
    if (key === null || objectKey === null) return null;
    if (!targetObjectKeys.has(key)) return false;
    objectImage.set(objectKey, { value: image, key });
  }

  // Typing: F(f) is a morphism of D running between the images of f's endpoints.
  const morphismImage = [];
  for (let f = 0; f < domain.morphisms.length; f += 1) {
    const image = applyUnary(onMorphisms, domain.morphisms[f]);
    const key = image === null ? null : valueKey(image);
    if (key === null) return null;
    if (!codomain.index.has(key)) return false;
    const at = codomain.index.get(key);
    const start = objectImage.get(domain.sourceKeys[f]);
    const end = objectImage.get(domain.targetKeys[f]);
    if (start === undefined || end === undefined) return false;
    if (codomain.sourceKeys[at] !== start.key) return false;
    if (codomain.targetKeys[at] !== end.key) return false;
    morphismImage.push(image);
  }

  // Identities: F(i_C(x)) = i_D(G(x)).
  for (const object of objects) {
    const unit = applyUnary(sourceIdentity, object);
    if (unit === null) return null;
    const image = applyUnary(onMorphisms, unit);
    const target = applyUnary(targetIdentity, objectImage.get(valueKey(object)).value);
    if (image === null || target === null) return null;
    if (valueKey(image) !== valueKey(target)) return false;
  }

  // Composition: F(c(f, g)) = d(F(f), F(g)), over the pairs that compose.
  for (let f = 0; f < domain.morphisms.length; f += 1) {
    for (let g = 0; g < domain.morphisms.length; g += 1) {
      if (domain.targetKeys[f] !== domain.sourceKeys[g]) continue;
      const composite = applyBinary(domain.compose, domain.morphisms[f], domain.morphisms[g]);
      if (composite === null) return null;
      const image = applyUnary(onMorphisms, composite);
      const composed = applyBinary(codomain.compose, morphismImage[f], morphismImage[g]);
      if (image === null || composed === null) return null;
      if (valueKey(image) !== valueKey(composed)) return false;
    }
  }
  return true;
}

function categoryTruth(ce, expr, definitions) {
  const op = expr.operator;
  const arity = { CategoryStructure: 6, CategoryComposition: 5, CategoryIdentities: 6,
    CategoryAssociative: 4 }[op];
  if (expr.nops !== arity) return null;

  // `Aso(M, s, t, c)` asks about composability alone and takes no objects.
  const withObjects = op !== 'CategoryAssociative';
  const [morphismsExpr, sourceExpr, targetExpr, composeExpr] = withObjects
    ? expr.ops.slice(1, 5)
    : expr.ops;
  const data = categoryData(ce, morphismsExpr, sourceExpr, targetExpr, composeExpr, definitions);
  if (!data) return null;

  if (op === 'CategoryAssociative') return categoryAssociative(data);

  const objects = carrierElements(ce, expr.ops[0], definitions);
  if (!objects || !objects.length) return null;

  if (op === 'CategoryComposition') return composesWell(data, objects);

  const identity = unaryDefinition(expr.ops[5], definitions);
  if (!identity) return null;
  if (op === 'CategoryIdentities') return hasIdentities(data, objects, identity);

  const typed = composesWell(data, objects);
  if (typed === null) return null;
  if (typed === false) return false;
  const units = hasIdentities(data, objects, identity);
  if (units === null) return null;
  if (units === false) return false;
  return categoryAssociative(data);
}

/**
 * Truth of one algebra predicate, or null when this prover cannot say.
 *
 * Null covers a carrier that is not finite, an operation that is not a
 * two-argument definition, a carrier past the size cap, and any product the
 * arithmetic could not evaluate. None of those are evidence either way, and
 * none of them are ever handed to the sampler.
 */
/**
 * A vector space is a module whose scalars form a field.
 *
 * `Mdl` checks only the four compatibility axioms — closure of the action,
 * `1·x = x`, and the two distributive laws — and takes the rest on trust. A
 * vector space is the whole claim, so the two suppositions are checked here
 * as well: the vectors are an abelian group, and the scalars are a field.
 *
 * That last one is the difference that matters. `Z/4` is a perfectly good
 * ring, and `Z/4` acting on itself is a perfectly good module, but it is not
 * a vector space — 2 has no inverse — and this is what says so.
 */
function vectorSpaceTruth(ce, expr, definitions) {
  if (expr.nops !== 9) return null;
  const [
    vectorsExpr, addExpr, zeroExpr,
    scalarsExpr, scalarAddExpr, scalarMultiplyExpr, scalarZeroExpr, oneExpr,
    actionExpr,
  ] = expr.ops;

  const vectors = structure(ce, vectorsExpr, addExpr, definitions);
  if (!vectors) return null;
  if (!isAbelianGroup(vectors, zeroExpr)) return false;

  const field = algebraTruth(
    ce,
    ce.box(['FieldStructure', scalarsExpr, scalarAddExpr, scalarMultiplyExpr,
      scalarZeroExpr, oneExpr]),
    definitions,
  );
  if (field === null) return null;
  if (field === false) return false;

  return moduleTruth(
    ce,
    ce.box(['ModuleStructure', vectorsExpr, addExpr, scalarsExpr,
      scalarAddExpr, scalarMultiplyExpr, oneExpr, actionExpr]),
    definitions,
  );
}

/**
 * How many elements the exhaustive check ran over.
 *
 * This describes the *input* — the carrier the predicate was handed, read the
 * same way the checker reads it — and not the search. Reporting the number of
 * assignments would mean re-deriving what each axiom does, and a count
 * computed differently from the one that actually ran is worse than none.
 */
export function algebraCarrierSize(ce, expr, definitions) {
  if (!ALGEBRA_PREDICATES.has(expr?.operator)) return null;
  // `Sbg(H, G, ...)` checks a subgroup against the group holding it.
  if (expr.operator === 'Subgroup') {
    return carrierElements(ce, expr.ops?.[1], definitions)?.length ?? null;
  }
  // Every category axiom runs over the *morphisms*, which is the second
  // argument everywhere but `Aso`, and is reached through the source category
  // for a functor. The object set is never what the exhaustion enumerates.
  const carrier = categoryCarrier(expr) ?? expr.ops?.[0];
  if (!carrier) return null;
  return carrierElements(ce, carrier, definitions)?.length ?? null;
}

/** The set a category-family predicate actually enumerates, or null. */
function categoryCarrier(expr) {
  const op = expr.operator;
  if (op === 'CategoryAssociative') return expr.ops?.[0];
  if (CATEGORY_PREDICATES.has(op)) return expr.ops?.[1];
  if (op === 'FunctorStructure') return categoryArguments(expr.ops?.[0])?.[1] ?? null;
  return null;
}

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
  if (op === 'VectorSpace') return vectorSpaceTruth(ce, expr, definitions);
  if (op === 'FunctorStructure') return functorTruth(ce, expr, definitions);
  if (CATEGORY_PREDICATES.has(op)) return categoryTruth(ce, expr, definitions);

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
