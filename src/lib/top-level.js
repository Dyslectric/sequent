/** Utilities for LaTeX operators that only count outside braces/parentheses. */

const LOGICAL_CHAIN_TOKENS = ['\\iff', '\\implies'];
const LOGICAL_BLOCKERS = [...LOGICAL_CHAIN_TOKENS, '\\impliedby', '\\land', '\\lor'];
const EQUALITY_TOKENS = ['='];
const INEQUALITY_TOKENS = ['\\leq', '\\geq', '\\le', '\\ge', '\\lt', '\\gt', '<', '>'];
const NON_ORDER_RELATION_TOKENS = ['\\neq', '\\ne'];
const QUANTIFIER_TOKENS = ['\\forall', '\\exists'];
const OPEN_VISUAL_DELIMITERS = [
  '\\lbrace', '\\lbrack', '\\lparen', '\\lvert', '\\lVert', '\\lfloor', '\\lceil', '\\{',
];
const CLOSE_VISUAL_DELIMITERS = [
  '\\rbrace', '\\rbrack', '\\rparen', '\\rvert', '\\rVert', '\\rfloor', '\\rceil', '\\}',
];
// MathLive's `aligned` environment looks right but is non-root and therefore
// serializes as an empty mathfield. `align` has the same columns while keeping
// the complete editable value in the field model.
const ALIGNED_START = '\\begin{align}';
const ALIGNED_END = '\\end{align}';

export function indexOfTopLevel(latex, token) {
  let braceDepth = 0;
  let groupDepth = 0;
  let visualDepth = 0;
  for (let i = 0; i < latex.length; i++) {
    const c = latex[i];
    if (c === '\\') {
      const delimiter = visualDelimiterAt(latex, i);
      if (delimiter) {
        visualDepth += delimiter.delta;
        i += delimiter.length - 1;
        continue;
      }
      if (latex.startsWith(token, i)
        && braceDepth === 0 && groupDepth === 0 && visualDepth === 0) return i;
      i++;
      continue;
    }
    if (c === '{') braceDepth++;
    else if (c === '}') braceDepth--;
    else if ((c === '(' || c === '[') && braceDepth === 0) groupDepth++;
    else if ((c === ')' || c === ']') && braceDepth === 0) groupDepth--;
  }
  return -1;
}

export function splitTopLevel(latex, token, options = {}) {
  const parts = [];
  let braceDepth = 0;
  let groupDepth = 0;
  let visualDepth = 0;
  let start = 0;
  for (let i = 0; i < latex.length; i++) {
    const c = latex[i];
    if (c === '\\') {
      const delimiter = visualDelimiterAt(latex, i);
      if (delimiter) {
        visualDepth += delimiter.delta;
        i += delimiter.length - 1;
        continue;
      }
      if (braceDepth === 0 && groupDepth === 0 && visualDepth === 0
        && latex.startsWith(token, i)) {
        parts.push(latex.slice(start, i));
        i += token.length - 1;
        start = i + 1;
        continue;
      }
      i++;
      continue;
    }
    if (c === '{') braceDepth++;
    else if (c === '}') braceDepth--;
    else if ((c === '(' || c === '[') && braceDepth === 0) groupDepth++;
    else if ((c === ')' || c === ']') && braceDepth === 0) groupDepth--;
  }
  parts.push(latex.slice(start));
  const trimmed = parts.map((part) => part.trim());
  return options.keepEmpty ? trimmed : trimmed.filter((part) => part.length > 0);
}

function isTokenAt(latex, token, index) {
  if (!latex.startsWith(token, index)) return false;
  // A control word ends before the next non-letter. Without this boundary,
  // `\\le` would be mistaken for the start of `\\left`.
  if (/^\\[A-Za-z]+$/.test(token) && /[A-Za-z]/.test(latex[index + token.length] ?? '')) {
    return false;
  }
  return true;
}

function sizedFenceAt(latex, index, command, delta) {
  if (!isTokenAt(latex, command, index)) return null;
  let end = index + command.length;
  while (/\s/.test(latex[end] ?? '')) end++;
  if (latex[end] === '\\') {
    const delimiter = /^(?:\\[A-Za-z]+|\\.)/.exec(latex.slice(end))?.[0];
    if (delimiter) end += delimiter.length;
  } else if (end < latex.length) {
    end++;
  }
  return { delta, length: end - index };
}

function visualDelimiterAt(latex, index) {
  const left = sizedFenceAt(latex, index, '\\left', 1);
  if (left) return left;
  const right = sizedFenceAt(latex, index, '\\right', -1);
  if (right) return right;
  const open = OPEN_VISUAL_DELIMITERS.find((token) => isTokenAt(latex, token, index));
  if (open) return { delta: 1, length: open.length };
  const close = CLOSE_VISUAL_DELIMITERS.find((token) => isTokenAt(latex, token, index));
  return close ? { delta: -1, length: close.length } : null;
}

/** Split on any listed operator while respecting braces and visual fences. */
export function splitTopLevelOperators(latex, tokens) {
  const ordered = [...tokens].sort((a, b) => b.length - a.length);
  const parts = [];
  const operators = [];
  let braceDepth = 0;
  let groupDepth = 0;
  let visualDepth = 0;
  let start = 0;

  for (let i = 0; i < latex.length; i++) {
    const c = latex[i];
    if (braceDepth === 0 && groupDepth === 0 && visualDepth === 0) {
      const token = ordered.find((candidate) => isTokenAt(latex, candidate, i));
      if (token) {
        parts.push(latex.slice(start, i).trim());
        operators.push(token);
        i += token.length - 1;
        start = i + 1;
        continue;
      }
    }
    if (c === '\\') {
      const delimiter = visualDelimiterAt(latex, i);
      if (delimiter) {
        visualDepth += delimiter.delta;
        i += delimiter.length - 1;
        continue;
      }
      i++;
      continue;
    }
    if (c === '{') braceDepth++;
    else if (c === '}') braceDepth--;
    else if ((c === '(' || c === '[') && braceDepth === 0) groupDepth++;
    else if ((c === ')' || c === ']') && braceDepth === 0) groupDepth--;
  }
  parts.push(latex.slice(start).trim());
  return { parts, operators };
}

function hasTopLevelOperator(latex, tokens) {
  return splitTopLevelOperators(latex, tokens).operators.length > 0;
}

/**
 * Split an argument list on its top-level commas.
 *
 * `splitTopLevel` cannot do this. It only tests for its token inside the
 * backslash branch of the scanner, so a token that does not begin with a
 * backslash never matches and the whole string comes back as one part —
 * silently, which is how a Cartesian product inside a call's arguments went
 * unrewritten for so long.
 */
export function splitTopLevelCommas(latex) {
  const parts = [];
  let rest = latex;
  for (;;) {
    const at = firstTopLevelComma(rest);
    if (at < 0) {
      parts.push(rest);
      return parts;
    }
    parts.push(rest.slice(0, at));
    rest = rest.slice(at + 1);
  }
}

function firstTopLevelComma(latex) {
  let braceDepth = 0;
  let groupDepth = 0;
  let visualDepth = 0;
  for (let i = 0; i < latex.length; i++) {
    const c = latex[i];
    if (c === '\\') {
      const delimiter = visualDelimiterAt(latex, i);
      if (delimiter) {
        visualDepth += delimiter.delta;
        i += delimiter.length - 1;
        continue;
      }
      i++;
      continue;
    }
    if (c === '{') braceDepth++;
    else if (c === '}') braceDepth--;
    else if ((c === '(' || c === '[') && braceDepth === 0) groupDepth++;
    else if ((c === ')' || c === ']') && braceDepth === 0) groupDepth--;
    else if (c === ',' && braceDepth === 0 && groupDepth === 0 && visualDepth === 0) return i;
  }
  return -1;
}

/**
 * Keep leading quantifiers outside the expression that is split into visual
 * chain links. This makes the scope deliberate: every cumulative checkpoint
 * receives the same declared domain instead of merely inheriting it as part
 * of the first equality operand.
 */
export function splitTopLevelQuantifierScope(latex) {
  let body = latex.trim();
  let scope = '';
  const clauses = [];

  while (QUANTIFIER_TOKENS.some((token) => isTokenAt(body, token, 0))) {
    const comma = firstTopLevelComma(body);
    if (comma < 0) break;
    const clause = body.slice(0, comma + 1);
    scope += clause;
    clauses.push(clause);
    body = body.slice(comma + 1).trim();
  }
  return { scope, clauses, body };
}

function makeChain(logical, kind, parts, operators, scope = '') {
  if (operators.length < 2 || parts.slice(0, -1).some((part) => part.length === 0)) return null;

  let prefix = parts[0];
  const checkpoints = operators.map((operator, index) => {
    const separator = operator.startsWith('\\') ? `${operator} ` : operator;
    prefix += `${separator}${parts[index + 1]}`;
    return parts[index + 1] ? `${scope}${prefix}` : null;
  });
  return {
    logical,
    scope,
    kind,
    token: operators.every((operator) => operator === operators[0]) ? operators[0] : null,
    operators,
    parts,
    checkpoints,
    links: operators.length,
    trailing: parts.at(-1) === '',
  };
}

function splitAlignedRows(body) {
  const rows = [];
  let braceDepth = 0;
  let groupDepth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') {
      if (body.startsWith('\\\\', i) && braceDepth === 0 && groupDepth === 0) {
        rows.push(body.slice(start, i));
        i++;
        start = i + 1;
        continue;
      }
      i++;
      continue;
    }
    if (c === '{') braceDepth++;
    else if (c === '}') braceDepth--;
    else if ((c === '(' || c === '[') && braceDepth === 0) groupDepth++;
    else if ((c === ')' || c === ']') && braceDepth === 0) groupDepth--;
  }
  rows.push(body.slice(start));
  return rows;
}

function splitAlignedCells(row) {
  let braceDepth = 0;
  let groupDepth = 0;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') braceDepth++;
    else if (c === '}') braceDepth--;
    else if ((c === '(' || c === '[') && braceDepth === 0) groupDepth++;
    else if ((c === ')' || c === ']') && braceDepth === 0) groupDepth--;
    else if (c === '&' && braceDepth === 0 && groupDepth === 0) {
      return [row.slice(0, i).trim(), row.slice(i + 1).trim()];
    }
  }
  return null;
}

/** True when the value is one of the visual chain environments we generate. */
export function isFormattedTopLevelChain(latex) {
  const trimmed = String(latex ?? '').trim();
  return trimmed.startsWith(ALIGNED_START) && trimmed.endsWith(ALIGNED_END);
}

/**
 * Turn the editable aligned presentation back into the ordinary one-line
 * logical expression used for persistence and evaluation.
 */
export function flattenTopLevelChain(latex) {
  const source = String(latex ?? '');
  const trimmed = source.trim();
  if (!isFormattedTopLevelChain(trimmed)) return source;

  const body = trimmed.slice(ALIGNED_START.length, -ALIGNED_END.length);
  const rows = splitAlignedRows(body);
  if (rows.length < 2) return source;

  let logical = '';
  for (let i = 0; i < rows.length; i++) {
    const cells = splitAlignedCells(rows[i]);
    if (!cells || (i > 0 && cells[0] !== '')) return source;
    logical += `${cells[0]}${cells[1]}`;
  }
  return logical.replace(/\\placeholder\{\}/g, '').trim();
}

/**
 * Return the cumulative expression represented through each visual row.
 * Incomplete trailing rows have a null checkpoint, while earlier completed
 * rows remain evaluable.
 */
export function getTopLevelChainCheckpoints(latex) {
  const logical = flattenTopLevelChain(latex).trim();
  const { scope, body } = splitTopLevelQuantifierScope(logical);
  for (const token of LOGICAL_CHAIN_TOKENS) {
    const other = LOGICAL_CHAIN_TOKENS.find((candidate) => candidate !== token);
    const parts = splitTopLevel(body, token, { keepEmpty: true });
    if (parts.length < 3) continue;
    if (splitTopLevel(body, other, { keepEmpty: true }).length > 1) return null;
    return makeChain(
      logical, 'logical', parts, Array(parts.length - 1).fill(token), scope
    );
  }

  // Relations inside implication/conjunction operands belong to those logical
  // statements; they must not be mistaken for one relation chain.
  if (hasTopLevelOperator(body, LOGICAL_BLOCKERS)) return null;

  const equalities = splitTopLevelOperators(body, EQUALITY_TOKENS);
  const inequalities = splitTopLevelOperators(body, INEQUALITY_TOKENS);
  const hasNonOrderRelation = hasTopLevelOperator(body, NON_ORDER_RELATION_TOKENS);

  if (equalities.operators.length >= 2) {
    if (inequalities.operators.length || hasNonOrderRelation) return null;
    // Avoid treating pasted `:=` text as a chain before MathLive has a chance
    // to turn it into `\\coloneq`.
    if (equalities.parts.slice(0, -1).some((part) => part.endsWith(':'))) return null;
    return makeChain(logical, 'equality', equalities.parts, equalities.operators, scope);
  }

  if (inequalities.operators.length >= 2) {
    if (equalities.operators.length || hasNonOrderRelation) return null;
    return makeChain(logical, 'inequality', inequalities.parts, inequalities.operators, scope);
  }
  return null;
}

/**
 * Format a homogeneous top-level chain in one MathLive field. The first link
 * remains on the first visual row; later operators start rows in the same
 * aligned column:
 *
 *   A => B
 *     => C
 */
export function formatTopLevelChain(latex) {
  const chain = getTopLevelChainCheckpoints(latex);
  if (!chain) return null;

  const right = (part) => part || '\\placeholder{}';
  const rows = [
    `${chain.scope}${chain.parts[0]} & ${chain.operators[0]} ${right(chain.parts[1])}`,
    ...chain.parts.slice(2).map((part, index) => (
      ` & ${chain.operators[index + 1]} ${right(part)}`
    )),
  ];
  return {
    ...chain,
    latex: `${ALIGNED_START}${rows.join('\\\\ ')}${ALIGNED_END}`,
  };
}
