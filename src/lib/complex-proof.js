/**
 * Exact rewrite proofs for a small complex-analysis fragment.
 *
 * Every transformation here is an identity, with the sole conditional rule
 * being conjugate(x) = x for symbols already certified real by the set/domain
 * layer. The normalizer never evaluates numerically: two sides count as equal
 * only when their exact normalized forms coincide or simplify to zero.
 */

const REWRITE_HEADS = new Set(['Real', 'Conjugate', 'OverBar', 'Cos']);

function hasRewriteHead(expr) {
  if (!expr) return false;
  if (REWRITE_HEADS.has(expr.operator)) return true;
  return expr.ops?.some(hasRewriteHead) ?? false;
}

function isImaginaryUnit(expr) {
  const json = expr?.json;
  return Array.isArray(json)
    && json[0] === 'Complex' && json[1] === 0 && json[2] === 1;
}

function isRealExpression(expr, realSymbols) {
  if (!expr) return false;
  if (expr.symbol) {
    return realSymbols.has(expr.symbol)
      || expr.symbol === 'Pi' || expr.symbol === 'ExponentialE';
  }
  if (expr.isNumberLiteral) return !expr.im;
  if (['Real', 'Abs', 'Floor', 'Ceil'].includes(expr.operator)) return true;
  if (expr.operator === 'Negate') return isRealExpression(expr.ops[0], realSymbols);
  if (['Add', 'Multiply'].includes(expr.operator)) {
    return expr.ops.every((operand) => isRealExpression(operand, realSymbols));
  }
  if (expr.operator === 'Divide') {
    return expr.ops.every((operand) => isRealExpression(operand, realSymbols));
  }
  if (expr.operator === 'Cos' || expr.operator === 'Sin') {
    return isRealExpression(expr.ops[0], realSymbols);
  }
  return false;
}

function normalize(ce, expr, realSymbols) {
  if (!expr?.operator || expr.symbol || expr.isNumberLiteral) return expr;

  if (expr.operator === 'Real' && expr.nops === 1) {
    const argument = normalize(ce, expr.ops[0], realSymbols);
    return ce.box(['Divide', ['Add', argument, conjugate(ce, argument, realSymbols)], 2]);
  }

  if ((expr.operator === 'Conjugate' || expr.operator === 'OverBar') && expr.nops === 1) {
    return conjugate(ce, expr.ops[0], realSymbols);
  }

  // This exponential form is an identity for complex arguments, not merely a
  // numerical approximation or a rule restricted to the real axis.
  if (expr.operator === 'Cos' && expr.nops === 1) {
    const argument = normalize(ce, expr.ops[0], realSymbols);
    const imaginary = ce.box(['Complex', 0, 1]);
    const exponent = ce.box(['Multiply', imaginary, argument]);
    const negativeExponent = ce.box(['Multiply', ['Negate', imaginary], argument]);
    return ce.box(['Divide', [
      'Add',
      ['Power', 'ExponentialE', exponent],
      ['Power', 'ExponentialE', negativeExponent],
    ], 2]);
  }

  // Use one exact representation for a negated product so `-(it)` and
  // `(-i)t` meet in the same normal form.
  if (expr.operator === 'Negate' && expr.nops === 1) {
    const argument = normalize(ce, expr.ops[0], realSymbols);
    if (argument.operator === 'Multiply' && argument.nops >= 1) {
      return ce.box(['Multiply', ['Negate', argument.ops[0]], ...argument.ops.slice(1)]);
    }
    return ce.box(['Negate', argument]);
  }

  return ce.box([expr.operator, ...(expr.ops ?? []).map((operand) => (
    normalize(ce, operand, realSymbols)
  ))]);
}

function conjugate(ce, original, realSymbols) {
  const expr = normalize(ce, original, realSymbols);
  if (isRealExpression(expr, realSymbols)) return expr;
  if (isImaginaryUnit(expr)) return ce.box(['Negate', expr]);

  if (expr.operator === 'Conjugate' && expr.nops === 1) return expr.ops[0];
  if (expr.operator === 'Negate' && expr.nops === 1) {
    return ce.box(['Negate', conjugate(ce, expr.ops[0], realSymbols)]);
  }
  if (expr.operator === 'Add' || expr.operator === 'Multiply') {
    return ce.box([expr.operator, ...expr.ops.map((operand) => (
      conjugate(ce, operand, realSymbols)
    ))]);
  }
  if (expr.operator === 'Divide' && expr.nops === 2) {
    return ce.box(['Divide',
      conjugate(ce, expr.ops[0], realSymbols),
      conjugate(ce, expr.ops[1], realSymbols),
    ]);
  }

  // exp is entire, so conjugation commutes with it without a branch
  // qualification. Do not apply this rule to arbitrary symbolic powers.
  if (expr.operator === 'Power' && expr.nops === 2
    && expr.ops[0]?.symbol === 'ExponentialE') {
    return ce.box(['Power', 'ExponentialE', conjugate(ce, expr.ops[1], realSymbols)]);
  }

  return ce.box(['Conjugate', expr]);
}

function canonical(ce, expr, realSymbols) {
  let result = normalize(ce, expr, realSymbols);
  try { result = result.simplify(); } catch { /* the exact normalized form is still usable */ }
  return result;
}

/** Exact normal form used both for proof checking and proof-step inspection. */
export function complexNormalForm(ce, expr, realSymbols = new Set()) {
  return canonical(ce, expr, realSymbols);
}

function exactKey(expr) {
  if (!expr?.operator || expr.symbol || expr.isNumberLiteral) return JSON.stringify(expr?.json);
  const operands = (expr.ops ?? []).map(exactKey);
  if (expr.operator === 'Add' || expr.operator === 'Multiply') operands.sort();
  return `${expr.operator}(${operands.join(',')})`;
}

function sameExpression(ce, left, right, realSymbols) {
  const a = canonical(ce, left, realSymbols);
  const b = canonical(ce, right, realSymbols);
  if (exactKey(a) === exactKey(b)) return true;
  try {
    return ce.box(['Subtract', a, b]).simplify().is(0) === true;
  } catch {
    return false;
  }
}

/** Prove a supported equality (or conjunction of equalities) by exact rewrites. */
export function proveComplexStatement(ce, expr, realSymbols = new Set()) {
  if (!expr) return null;
  if (expr.operator === 'Implies' && expr.nops === 2 && expr.ops[0]?.symbol === 'True') {
    return proveComplexStatement(ce, expr.ops[1], realSymbols);
  }
  if (expr.operator === 'And') {
    const proofs = expr.ops.map((operand) => proveComplexStatement(ce, operand, realSymbols));
    return proofs.every((proof) => proof === true) ? true : null;
  }
  if (!['Equal', 'IdenticallyEqual'].includes(expr.operator) || expr.nops < 2) return null;
  if (!hasRewriteHead(expr)) return null;

  for (let index = 0; index + 1 < expr.nops; index++) {
    if (!sameExpression(ce, expr.ops[index], expr.ops[index + 1], realSymbols)) return null;
  }
  return true;
}
