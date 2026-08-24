# Vectors, matrices, vector spaces, derivatives and integrals

Status: phases A–D implemented, phase E mostly; nothing outstanding is large

Phase A landed in `identifiers.js`, `engine.js` and `test/linear-algebra.test.mjs`.
Matrices, determinants, transposes and column vectors now decide exactly, and
matrix values render as matrices. Three things were needed beyond the
sanitizer fix, all of them soundness rather than capability:

- **`M^T` was disproving true statements.** `T` was interned as a variable, so
  the claim became a power, and the sampler duly reported a counterexample to
  a correct transpose identity. `^T` now normalises to `\top` — but only when
  the base is certainly a matrix (an environment that just closed, or a
  parenthesised group containing one), so `x^T` keeps its ordinary reading as
  a power. `closesMatrix()` in `identifiers.js` is that test, and it is what
  makes `(M^T)^T = M` work too.
- **Matrix statements no longer sample.** `hasMatrix()` joins the
  `refuseSampling` guard. Substituting numbers for free variables is
  meaningless against a matrix, and an undecided row is the honest outcome.
- **Shape mismatches are refused with a message.** Compute Engine reports them
  as `\error{1x2vs2x1}` markup at evaluation rather than as an `Error` node,
  so `findError` never sees them and the marker was reaching the display.

A `mat` keyboard tab followed, because entry was the real barrier — nobody is
going to type `\begin{pmatrix}1&2\\3&4\end{pmatrix}` by hand. Two starting
shapes only, a 2-entry column vector and a 2x2; every other size is reached by
resizing the blank grid with `row +/-` and `col +/-`. Then transpose, inverse,
determinant, norm and the two products. `mat`, `vec` and `norm` are inline
shortcuts for the same shapes.

MathLive's two resize commands do not behave alike: `addRowAfter` fills the new
row with `\placeholder{}`, while `addColumnAfter` leaves its cells genuinely
empty — `1 &  & 2`. An empty cell draws no box, so the new column showed up as
a gap that could not be clicked or tabbed into. `fillEmptyMatrixCells()` runs
after a resize keypress and gives every empty cell a placeholder, then moves
the caret into the first one.

**Resizing is offered only while a grid is still blank.** Removing a column
from a filled matrix silently destroys entries, so `matrixResizeAllowed()` in
`mathfield.js` decides — every cell of every grid on the line must be empty or
a placeholder — and `main.js` toggles `matrix-locked` on the dock from the
field's `input` and `focusin`. The keys grey out rather than disappear: a key
that vanishes is harder to find again than one that is plainly unavailable.
The state is a single class toggle, not a rebuild of the keyboard.

Templates arrive half-typed, which needed one more fix: `stripDecorations`
removes `\placeholder{}`, so an untouched grid became rows of unequal length
and was displayed back as `[[1], [3, 4]]`. Every other template in the app
reports "missing" until it is complete, and matrices now say the same —
"this matrix still has empty cells".

The vector-product rewrite closes phase A. Compute Engine computes `Dot` and
`Cross`, but its LaTeX parser turns both infix tokens into multiplication.
`rewriteVectorProducts()` recognizes tuple, row-matrix, and column-matrix
vectors before parsing. Thus `(1,2,3)·(4,5,6) = 32`, the same inner product
between columns, and the symbolic `(a,b)·(c,d) = ac+bd` all work.

Between two three-component vectors, `\times` is a cross product. The result
keeps the left operand's tuple, row, or column presentation. The rewrite fires
only when both immediate operands are vectors, so numeric and matrix
multiplication remain multiplication, while the set layer still interprets
`\times` between sets as Cartesian product.

This document describes extending Sequent with linear algebra and calculus. It
is written as an implementation handoff, in the same shape as
`docs/proof-traces.md`.

Everything below rests on probing the engine rather than reading it. Every
claim about what Compute Engine does was produced by parsing and evaluating the
statement, and the surprises are the point: two of these domains are nearly
free, and one of them cannot be enabled as it stands without making Sequent
assert false things.

## What the engine already does

Compute Engine, underneath the app, handles far more than the app exposes.
Parsed and evaluated directly:

| Statement | Compute Engine | The app today |
| --- | --- | --- |
| `\begin{pmatrix}1&2\\3&4\end{pmatrix}` | `["Matrix", …]` | `error: unknown-environment` |
| matrix `+`, matrix `×`, `^T` | evaluates | blocked |
| `\det\begin{pmatrix}1&2\\3&4\end{pmatrix}=-2` | `True` | blocked |
| `\|(3,4)\|=5` | `True` | **already proved** |
| `f(x):=x^3`, then `f'(x)=3x^2` | `True` | **already proved** |
| `\frac{d}{dx}x^3=3x^2` | `True` | refused |
| `\frac{\partial}{\partial x}(xy)=y` | `True` | refused |
| `\int_{0}^{1}x^2\,dx=\frac{1}{3}` | `True` | refused |
| `\int_{0}^{\infty}e^{-x}\,dx=1` | `True` | refused |
| `(1,2,3)\cdot(4,5,6)=32` | parse error | blocked |

Two conclusions. Differentiation by `'` and vector norms already work.
Matrices, `d/dx`, partials and integrals are blocked by the app, not missing
from the engine.

### Matrices are blocked by one bug

`sanitize()` interns the *environment name* as identifiers:

```text
\begin{pmatrix}1&2\\3&4\end{pmatrix}
  -> \begin{\mathrm{Id0}\mathrm{Id1}\mathrm{Id2}\mathrm{Id3}\mathrm{Id4}i\mathrm{Id5}}…
```

`p`, `m`, `a`, `t`, `r`, `x` become identifiers and `i` becomes the imaginary
unit. The app's own `ce.parse` handles the raw form perfectly —
`["Equal",["Determinant",["Matrix",…]],-2]` — so the fix is to make `sanitize`
skip `\begin{…}` and `\end{…}` names, exactly as it already skips other
non-identifier positions.

## The soundness problem

This is the part that governs the plan. `\int` and `d/dx` are not refused out
of caution about scope; the engine is **wrong** about them, and the refusal is
load-bearing.

Probed directly against Compute Engine:

| Statement | Compute Engine | The truth |
| --- | --- | --- |
| `\int_{-1}^{1}\frac{1}{x}\,dx=0` | `True` | The integral does not exist. Zero is only its Cauchy principal value. |
| `\int_{-1}^{1}\frac{1}{x^2}\,dx=-2` | `True` | The integrand is positive everywhere, so no value can be negative. It diverges to `+∞`. |
| `\frac{dy}{dx}=0` | `True` | Only when `y` does not depend on `x`. |
| `\frac{d}{dx}f(x)=0` | `["Equal","f",0]` | Undefined `f` degrades to a symbol rather than an error. |

It also gets the easy ones right — `\int_{0}^{1}\frac{1}{x}\,dx=1` and
`\int_{1}^{\infty}\frac{1}{x}\,dx=1` both come back `False`, correctly — which
makes the failures worse rather than better: they are not a uniform "does not
support improper integrals", they are scattered.

A sheet that answers `true` to `\int_{-1}^{1}\frac{1}{x^2}\,dx=-2` is worse
than one that refuses the line. Under the project's standing rule — a proof is
never claimed unsoundly — integration may only be enabled behind a gate that
independently establishes the integrand is well behaved on the closed interval.

## Non-negotiable invariants

These extend the ones in `docs/proof-traces.md`.

- Compute Engine is an oracle to be checked, not trusted. Where a domain has
  known-wrong answers, the app must establish the precondition itself before
  accepting any verdict.
- Refusing a line stays better than answering it wrongly. An honest
  "not supported" is a feature.
- No new domain may weaken an existing verdict. `npm test`, the fixed-seed
  fuzz, and `probe-soundness.mjs` all pass unchanged.
- Every new decision path is either exact or refused. Nothing here may be
  settled by sampling alone.
- Each phase adds its proof-trace rules at the same time as the decision
  procedure, not afterwards — the trace must come from the branch that decided.

## Phases

### Phase A: Matrices and vectors as values — implemented

See the status note at the top for the implemented matrix and vector value
operations, including dot and cross products in every vector orientation.


The cheapest real capability, and it unblocks everything else in linear
algebra.

1. Teach `sanitize` to skip `\begin{…}` / `\end{…}` environment names.
2. Display matrix values in `evaluateExpression` — matrices arrive as
   `["List", ["List", …]]` after evaluation and need a `pmatrix` renderer, in
   the same spirit as `displaySetValueLatex`.
3. Decide matrix equality, addition, multiplication, transpose and
   determinant. These are exact on rational entries.
4. Vector operations: `\|v\|`, and a dot product. `(1,2,3)\cdot(4,5,6)` is a
   parse error in Compute Engine — decide whether to rewrite tuple-dot into
   `Dot`, or to require column vectors.
5. Refuse what is not decided rather than sampling it. A matrix with symbolic
   entries should not be handed to the numeric sampler.

Trace rules: `matrix.exact-arithmetic` for the computed cases, reusing
`relation.normalize` where the decision really is normalization.

### Phase B: Differentiation — implemented

The plan blamed Compute Engine for reading `\frac{d}{dx}` as `d / (d·x)`.
Probing showed otherwise: raw Compute Engine parses it correctly as
`D(x^3, x)`. It was **`sanitize` that broke it**, interning the `d` as a user
name — the same class of bug as the matrix environment. `readDerivativeOperator()`
in `identifiers.js` now rewrites the operator with `d` kept literal and only
the differentiation variable renamed, which is the one form Compute Engine
reads as `D`.

What that unlocked, all proved rather than sampled: the power rule, second
derivatives, the `\mathrm{d}` spelling, the chain and product rules, any
variable including greek ones, partials, and differentiating a defined
function. A bare `\frac{d}{dx}x^2` now displays `2x` — `simplify()` leaves a
derivative alone, so `evaluate()` is used where one is present.

Three things stay refused, each because the engine is wrong rather than silent:

- `\frac{dy}{dx}` evaluates to 0, since nothing records that `y` varies with
  `x`. Only the ratio form is refused; the operator forms are understood.
- Mixed partials and a lone `\partial`. `sanitize` rewrites a derivative
  operator into exactly one canonical shape, so setting those aside leaves
  only the forms with no procedure here.
- Differentiating an undefined function. `f(x)` is read as `f · x`, whose
  derivative is `f`, so the line would be answered wrongly. Names in call
  position are written `\operatorname{...}`, which is what makes this visible
  before Compute Engine flattens it.

The analysis tab carries derivative, second-derivative, partial-at-a-point and
prime keys. `deriv` remains the ordinary derivative shortcut; `partial` inserts
`partial(variable, expression, point)`, which differentiates first and then
substitutes the point. A test fills each key's placeholders and checks the app
does not refuse its own keyboard.


Compute Engine is reliable for explicit expressions and unreliable for bare
Leibniz forms, so the split is along that line.

1. Allow `\frac{d}{dx}(expr)` and `\frac{\partial}{\partial x}(expr)` where
   `expr` is explicit. Both already evaluate correctly, including the chain
   rule.
2. Keep `\frac{dy}{dx}` refused. It evaluates to `0`, which would disprove
   true statements about a dependent variable. The current error message
   already points at `f'(x)`, which works; keep that.
3. Refuse a derivative of an undefined name rather than accepting
   `["Equal","f",0]`. `findError` will not catch this one — it is a silent
   degradation, and needs its own check alongside `hasDegradedBuiltin`.

Trace rules: `calculus.derivative` — the differentiation rule applied, with
the derivative in `data`.

### Phase C: Integration — implemented

`src/lib/integral.js` is the gate, and it is the feature. It answers "may I
trust this answer?", never "what is it?", and when it cannot tell it says so
and the line is refused.

`integralObstruction()` returns the reason an integral may not be trusted, or
null. It requires, in order: a single `Integrate` with definite limits; bounds
that are actual finite points; and an integrand with no singularity anywhere
on the closed interval. Division — and a negative power, which is a division
in disguise — is the only construction that can introduce one, so it is the
only one that consults the root test. Anything the walk does not recognise is
refused, because a function this code cannot classify may do anything.

The pole test is `vanishesOnClosedInterval()`, added to
`rational-polynomial.js`: Sturm's theorem counts roots in the half-open
`(lo, hi]`, so the lower endpoint is tested on its own. It returns null when
the question cannot be settled exactly, which callers read as "it might",
never as "no".

`sanitize` needed the same treatment as `d/dx` — `dx` was being interned as
the product `d · x`, which lost the variable of integration entirely and left
`["Limits", "Nothing", …]`. An integral sign now arms the scanner to expect a
differential, and the letter beside the `d` is interned while the `d` stays
literal.

Admitted and checked against known values, in both directions: polynomials,
constants, `sin` and `cos` over `[0, π]`, `|x|`, `e^x`, rational integrands
whose pole lies outside the interval, and denominators with no real root.
Refused: both cases Compute Engine gets wrong, poles at either limit or
inside, infinite limits (including the convergent `\int_0^\infty e^{-x}`),
indefinite integrals, `\ln`, `\tan`, `\sqrt`, multiple integrals, and symbolic
limits.

Ten divergent integrals were added to `probe-soundness.mjs`, where a refusal
is the pass condition and any truth value at all is a failure.


Do not lift the refusal on its own. The gate is the feature.

1. Accept `\int_a^b f\,dx` only when the app can establish, exactly:
   - `a` and `b` are finite, or the improper case is handled explicitly;
   - `f` has no pole in `[a, b]` — for a rational integrand this is a root
     check on the denominator over the interval, which the existing
     `rational-polynomial.js` sign machinery can already do.
2. When the gate cannot be established, return undecided with a message
   naming the obstruction, not a verdict.
3. Only then compare Compute Engine's value against the claim.
4. Add every case from the table above to the test suite as a
   *must-not-be-true* assertion, and add divergent integrals to
   `probe-soundness.mjs`.

Trace rule: `calculus.integral` with the antiderivative and the interval in
`data`, and the continuity obligation recorded as its own premise step — that
obligation is the interesting half of the proof.

### Phase D: Vector spaces — implemented

`Vec(V, ⊕, 0ᵥ, F, +, ·, 0, 1, ⊙)` — nine arguments, because every identity the
axioms mention has to be named. It reuses what was already there rather than
re-deriving it: `isAbelianGroup` on the vectors, `FieldStructure` on the
scalars, and `moduleTruth` for the four compatibility axioms.

The important asymmetry is with `Mdl`, which checks only the compatibility
axioms and takes the rest on trust — a deliberate choice recorded in its own
tests, so that a failing module says which axiom failed. `Vec` is the whole
claim, so it checks the two suppositions as well, and the one that does the
work is the field requirement:

    Mdl(V, p, F, q, t, 1, s)  over ℤ/4     true   — a perfectly good module
    Vec(V, p, 0, F, q, t, 0, 1, s) over ℤ/4  false  — 2 has no inverse

`F₂`, `F₃` and `F₅` over themselves certify; ℤ/4 and ℤ/6 are refused for not
being fields; ℤ/4 over ℤ/2 is refused because `(1+1)·x` is `0` while `x + x`
is `2x`. Infinite carriers, missing actions and the wrong arity stay honest
unknowns. The trace rule is `algebra.finite-exhaustion`, already registered,
and the carrier count comes with it.

Beyond finite carriers — proving `ℝⁿ` is a vector space — still needs symbolic
axiom checking, which is a separate and much larger question.


This is the large one, and it is the finite-algebra machinery again rather
than anything Compute Engine provides.

`algebra.js` already checks the group, ring, field and module axioms over a
finite carrier by exhaustion. A vector space is a module over a field, so the
existing `Mod` checking is most of it: add a `Vec(V, +, ·, F)` predicate that
verifies the field axioms on `F`, the abelian group axioms on `V`, and the
four compatibility axioms.

Beyond finite carriers — proving `ℝ^n` is a vector space — needs symbolic
axiom checking, which is a separate and much larger question. Recommend
finite carriers first, matching what `finite-group` already demonstrates.

Trace rule: `algebra.finite-exhaustion`, already registered.

### Phase E: Finish the proof traces — mostly implemented

Induction, the epsilon-delta predicates and carrier counts landed; see
`docs/proof-traces.md` for the detail. Coverage went from 32 traced demo rows
to 37 of 43.

The calculus paths added in phases A to C already traced, as
`engine.exact-evaluation` — pass 1a decides them, and saying so is accurate.
Integrals gained one thing more: the continuity gate is recorded as a
`calculus.continuity` premise of the evaluation, because "exact evaluation"
alone hides the half of the proof that is actually interesting.

What remains is the four set-lemmas rows and two rows whose top-level operator
is a connective over separately-rewritten predicates. Both need the `rewrites`
threading through `lowerNode` that this plan originally proposed, rather than
another recognizer.


Independent of the above, and carried over from `docs/proof-traces.md`:

- set lowering evidence (4 demo rows) — membership, power sets, extensionality;
- induction (4 rows) — `Induct(P,0)` lowers to `Base ∧ Step`, a genuine
  rewrite, so it fits the existing `wrap` mechanism directly;
- the epsilon-delta `cont` / `limitw` predicates (2 rows);
- counts on the finite certificates, which needs `algebraTruth` and the
  topology checkers to report what they checked rather than only a verdict.

## Test strategy

Each phase adds, alongside its feature:

- exact-verdict tests in the style of `test/core.test.mjs`;
- must-not-be-true tests for every unsound case listed above;
- trace-shape tests asserting the rule IDs, per `docs/proof-traces.md`;
- new fuzz generators for the domain, so the fixed-seed run covers it.

The three gates stay as they are: `npm test`, `npm run build`,
`npm run fuzz -- --seed 12345 --iterations 5000 --engine-iterations 500`, and
`node probe-soundness.mjs` by hand after touching a prover.

## A notation trap worth knowing

`\det` without parentheses takes everything after it as its argument:

    \det M \cdot \det N   parses as   Determinant(Determinant(N) · M)

which evaluates to a number that is not what anyone meant, so
`\det M \cdot \det N = \det(MN)` comes back **false** with a proof. Written
`\det(M) \cdot \det(N)` it is true, also with a proof. This is Compute Engine's
precedence rather than anything in the sheet, and it is not unsound — the app
answers the expression it was given — but it is a confident wrong-looking
answer, and a candidate for either a parser fix or a warning.

## What is left

Everything in this plan is implemented except two pieces, both small enough to
pick up cold:

1. **The four set-lemmas rows and two connective rows** still trace as opaque.
   They need the `rewrites` threading through `lowerNode` that
   `docs/proof-traces.md` describes, rather than another recognizer — there is
   no comparison that could verify a membership expanded pointwise.
2. **Phase 6 of `docs/proof-traces.md`** — named lemmas as genuine theorem
   references rather than macros — remains untouched and is the larger of the
   two by a wide margin.

One smaller thing worth knowing: finite certificates report the carrier size
but not an assignment count (a count re-derived here would not be the one the
checker used).
