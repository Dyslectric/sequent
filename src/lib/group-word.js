/**
 * A decision procedure for the equational theory of groups.
 *
 * `𝖦𝗋𝗉 ⊢ (xy)⁻¹ = y⁻¹x⁻¹` is not a claim about one group. It is a claim about
 * every group, and it is decidable: two group words are equal in all groups
 * exactly when they are equal in the free group, and equality in the free
 * group is equality of freely reduced words. So the whole procedure is to
 * flatten each side into a word, cancel adjacent inverse pairs, and compare.
 *
 * That decides both directions. Same reduced word means the identity holds in
 * every group. Different reduced words means it already fails in the free
 * group, so there is a group where it fails and the universal claim is false —
 * `xy = yx` is disproved rather than left undecided, which is the correct
 * answer for a statement about all groups.
 *
 * The abelian variant adds commutativity, where the normal form is instead the
 * exponent vector: collect generators, sum their exponents, sort.
 *
 * Nothing here goes through Compute Engine, and that is not an accident.
 * `Multiply` is commutative to the CAS, which canonicalises operand order —
 * `yx` and `xy` parse to the identical tree. Every non-commutative theorem
 * would come back trivially true, which is worse than not supporting them.
 */

/** Repeating a word more than this is refused rather than expanded. */
const MAX_EXPONENT = 64;

const skipSpace = (scanner) => {
  while (scanner.at < scanner.src.length && /\s/.test(scanner.src[scanner.at])) scanner.at += 1;
};

const inverseOf = (word) => (
  word.map(({ name, inverse }) => ({ name, inverse: !inverse })).reverse()
);

function repeated(word, exponent) {
  if (exponent === 0) return [];
  const times = Math.abs(exponent);
  if (times > MAX_EXPONENT) return null;
  const unit = exponent > 0 ? word : inverseOf(word);
  const out = [];
  for (let index = 0; index < times; index += 1) out.push(...unit);
  return out;
}

function parseExponent(scanner) {
  skipSpace(scanner);
  if (scanner.src[scanner.at] === '{') {
    const close = scanner.src.indexOf('}', scanner.at);
    if (close < 0) return null;
    const text = scanner.src.slice(scanner.at + 1, close).trim();
    scanner.at = close + 1;
    return /^-?\d+$/.test(text) ? Number(text) : null;
  }
  // An unbraced exponent takes exactly one token in LaTeX, so `x^23` is
  // `x^2` followed by `3` rather than an exponent of twenty-three.
  const digit = /^\d/.exec(scanner.src.slice(scanner.at));
  if (!digit) return null;
  scanner.at += 1;
  return Number(digit[0]);
}

function parseAtom(scanner, depth) {
  if (depth > 32) return null;
  skipSpace(scanner);
  const rest = scanner.src.slice(scanner.at);

  // `\operatorname` as well as `\mathrm`: the identifier layer spells a name
  // that is followed by a parenthesis as an applied function, so `x(yz)` comes
  // through as a call. Inside a group equation there are no functions — every
  // juxtaposition is the group operation — so both spellings are generators.
  const name = /^\\(?:mathrm|operatorname)\{(Id\d+)\}/.exec(rest);
  if (name) {
    scanner.at += name[0].length;
    return [{ name: name[1], inverse: false }];
  }

  for (const [open, close] of [['\\left(', '\\right)'], ['(', ')']]) {
    if (!rest.startsWith(open)) continue;
    scanner.at += open.length;
    const inner = parseTerm(scanner, depth + 1);
    if (inner === null) return null;
    skipSpace(scanner);
    if (!scanner.src.startsWith(close, scanner.at)) return null;
    scanner.at += close.length;
    return inner;
  }

  // `1` is the identity, and the identity is the empty word.
  if (/^1(?!\d)/.test(rest)) {
    scanner.at += 1;
    return [];
  }
  return null;
}

function parseFactor(scanner, depth) {
  const atom = parseAtom(scanner, depth);
  if (atom === null) return null;
  skipSpace(scanner);
  if (scanner.src[scanner.at] !== '^') return atom;
  scanner.at += 1;
  const exponent = parseExponent(scanner);
  if (exponent === null) return null;
  return repeated(atom, exponent);
}

/** Juxtaposition is the group operation, so a term is its factors concatenated. */
function parseTerm(scanner, depth) {
  const word = [];
  for (;;) {
    skipSpace(scanner);
    if (scanner.at >= scanner.src.length) break;
    const rest = scanner.src.slice(scanner.at);
    if (rest.startsWith('\\right)') || rest[0] === ')') break;
    if (rest.startsWith('\\cdot')) { scanner.at += 5; continue; }
    if (rest[0] === '*') { scanner.at += 1; continue; }

    const before = scanner.at;
    const factor = parseFactor(scanner, depth);
    if (factor === null || scanner.at === before) return null;
    word.push(...factor);
  }
  return word;
}

function parseWord(latex) {
  const scanner = { src: latex, at: 0 };
  const word = parseTerm(scanner, 0);
  if (word === null) return null;
  skipSpace(scanner);
  return scanner.at === scanner.src.length ? word : null;
}

/** The `=` that separates the two sides, ignoring any inside a group. */
function splitAtEquals(latex) {
  let braces = 0;
  let groups = 0;
  for (let index = 0; index < latex.length; index += 1) {
    const character = latex[index];
    if (character === '\\') {
      if (latex.startsWith('\\left', index)) groups += 1;
      else if (latex.startsWith('\\right', index)) groups -= 1;
      index += 1;
      continue;
    }
    if (character === '{') braces += 1;
    else if (character === '}') braces -= 1;
    else if (character === '(') groups += 1;
    else if (character === ')') groups -= 1;
    else if (character === '=' && braces === 0 && groups === 0) {
      return { left: latex.slice(0, index), right: latex.slice(index + 1) };
    }
  }
  return null;
}

/** Cancel adjacent inverse pairs until none remain. */
export function freelyReduce(word) {
  const out = [];
  for (const letter of word) {
    const last = out[out.length - 1];
    if (last && last.name === letter.name && last.inverse !== letter.inverse) out.pop();
    else out.push(letter);
  }
  return out;
}

/** With commutativity the normal form is the exponent vector, sorted by name. */
export function abelianNormalForm(word) {
  const exponents = new Map();
  for (const { name, inverse } of word) {
    exponents.set(name, (exponents.get(name) ?? 0) + (inverse ? -1 : 1));
  }
  return [...exponents.entries()]
    .filter(([, exponent]) => exponent !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

const sameWord = (left, right) => (
  left.length === right.length
  && left.every((letter, index) => (
    letter.name === right[index].name && letter.inverse === right[index].inverse
  ))
);

/**
 * Decide an equation between group words.
 *
 * @param {string} latex sanitised LaTeX for `left = right`
 * @param {boolean} abelian whether commutativity may be assumed
 * @returns {true|false|null} null only when the equation is not in the
 *   fragment this module parses — never as a way of avoiding an answer.
 */
export function proveGroupEquation(latex, abelian = false) {
  const sides = splitAtEquals(latex);
  if (!sides) return null;
  const left = parseWord(sides.left);
  const right = parseWord(sides.right);
  if (left === null || right === null) return null;

  if (!abelian) return sameWord(freelyReduce(left), freelyReduce(right));
  return JSON.stringify(abelianNormalForm(left)) === JSON.stringify(abelianNormalForm(right));
}
