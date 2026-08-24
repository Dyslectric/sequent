# Beyond the oracle

Status: phase 0 and Tier 1 implemented; phases 1-5 proposed

This plan begins where `docs/proof-kernel.md` stops. That plan closes with a
sentence — `engine.exact-evaluation` "never becomes verified" — and the
sentence is true of exactly one statement in the catalogue. Everything else
in that bucket is checkable, several things cheaply, and the bucket is only
one label because nobody has yet had a reason to split it.

Splitting it is most of this document. The rest is what the surface language
can already say, what it cannot, and the two questions that came up while
working out how far this goes: whether the kernel should be compiled to
WebAssembly, and how large the missing mathematics actually is.

## Where we are, measured

Numbers below come from running the demo catalogue through the engine and
reading the trust the kernel assigned, not from reading the code. `npm test`
passes and `probe-kernel.mjs` reports SOUND over 8,000 generated cases.

**25 of the 37 registered rules have checkers**, after phase 0. Across the
eleven demos there are 46 truth rows and 90 proof steps:

| Rows | Trust | Before phase 0 |
| --- | --- | --- |
| 3 | `verified` | 3 |
| 3 | `certified` | 3 |
| 34 | `axiom` | 32 |
| 0 | `oracle` | 2 |
| 6 | untraced (`opaque`) | 6 |

**No row in the catalogue rests on the CAS's bare word any more.** The two that
did were ground arithmetic, and the kernel now does the arithmetic itself; both
rows are still held down to `axiom` by some *other* step, which is what the
phases below are for.

The 59 unchecked steps cluster hard, and the clusters are the work list:

| Steps | Rule | Why it is unchecked |
| --- | --- | --- |
| 14 | `polynomial.sturm-sign-chart` | no checker; phase 3's largest item |
| 12 | `definition.unfold` | needs phase 4, not a checker |
| 11 | `logic.universal-generalization` | checker abstains: *premises not matched* |
| 9 | `algebra.finite-exhaustion` | no checker; re-run the enumeration |
| 5 | `topology.constructor-certificate` | no checker |
| 5 | `relation.normalize` | checker abstains: *premises not matched* |
| 2 | `analysis.epsilon-delta-witness` | no checker |
| 1 | `analysis.induction` | no checker |

The two abstaining rows are the interesting ones. Both have working checkers;
both abstain because the conclusion still wears a defined name. **Sixteen of
the fifty-nine steps are blocked behind `definition.unfold` alone**, and
`definition.unfold` is not waiting for a checker — it is waiting for phase 4,
where a definition becomes something the kernel may rewrite with rather than
something it is told.

### Two capability gaps found while probing

Neither is a soundness problem and neither is recorded anywhere else.

**`quadratic.psd` is unreachable under quantifiers.** *(Fixed in phase 0.)*
Unquantified, `x^2+2xy+2y^2\ge0` is decided by the LDL prover and comes back
`certified`. Wrapped in `\forall x\forall y` the same claim fell through to
sampling and was not proved at all. So did `\forall a\forall b\forall c,
a^2+b^2+c^2\ge ab+bc+ca`, which `docs/proof-kernel.md` cites as the
sum-of-squares showcase.

The diagnosis above — a dispatch gap in one branch — was wrong, and the truth
is worth recording because it is not confined to this prover. Stripping a
quantifier in `sets.js` returned the quantifier's *body*, still boxed in the
scope the quantifier had opened, where the freed variable is a bound symbol of
unknown type. Compute Engine will not collect `x^2 - x^2` there, because
nothing in that scope says the symbol commutes. The PSD prover reads its
coefficients off by evaluation and then verifies the reconstruction
symbolically — so it watched its own arithmetic fail to cancel and correctly
withdrew a proof it had. Every prover that checks a guess this way was exposed
to the same thing; the even-power branch survived only because it never needs
a cancellation. Re-boxing the body from its JSON puts the freed variables back
in the sheet's own scope, and the fix is four lines in `lowerNode`.

**`logic.exists-intro` has a checker and no prover.** `\exists x\in\mathbb{R},
x^2=4` is still undecided, and naming the witness first does not help: `w:=2`
proves `w^2=4` and the existential remains undecided, exactly as the kernel
plan predicted. This is one rule away from working and it gates every
constructed-witness argument in this document.

## The oracle is nine different things

`engine.exact-evaluation` is a single label over statements with nothing
mathematically in common. Probing what actually reaches it:

| Statement | verdict | trust before phase 0 | trust now |
| --- | --- | --- | --- |
| `2+2=4`, `\frac{7}{3}>\frac{9}{4}`, `2^{10}=1024` | proved | `oracle` | **`verified`** |
| `\gcd(12,18)=6`, `\operatorname{mod}(17,5)=2` | proved | `oracle` | **`verified`** |
| `\sum_{n=1}^{10}n=55`, `\prod_{n=1}^{5}n=120` | proved | `oracle` | **`verified`** |
| `\frac{d}{dx}x^2=2x`, `\int_0^1x^2dx=\frac{1}{3}` | proved | `oracle` | `oracle` |
| `\lim_{n\to\infty}\frac{1}{n}=0` | proved | `oracle` | `oracle` |
| `e>2.7`, `\pi>3` | proved | `oracle` | `oracle` |
| `e^{i\pi}=-1` | proved | `oracle` | `oracle` |
| `\sum 1/n^2=\pi^2/6` | proved | `oracle` | `oracle` |
| `\sqrt{2}\notin\mathbb{Q}` | proved | **no trace at all** | **`verified`** |
| `7\in\mathbb{P}` | **proved** | — | **`certified`** |

**The prover already reaches nearly all of it.** Primality was the one
absence, and it is now the one row in the table the prover reaches *only*
because the kernel plan asked for it. Everywhere else the gap was checking
rather than capability, and the plan had no route from `oracle` to `verified`
for any of it because it treated the bucket as one thing. Phase 0 opened the
route at the arithmetic end; the rest of the column is still one label over
several different things.

The irrationality rows deserve a second look: they were `opaque`, carrying no
trace whatsoever, which made them the worst-documented proofs in the
application despite being among the easiest to certify. They are `verified`
now, and they were the cheapest thing in this document to fix.

## Tiers

Ordered by what they cost, not by what they prove.

### Tier 1 — arithmetic the kernel already contains

*Implemented. Ground rational (in)equalities, `gcd`, `lcm`, `mod`, the
integer root test, bounded `\sum` and `\prod`, and the Pratt certificate for
primality.*

`kernel-polynomial.js` has exact BigInt rationals and genuinely multivariate
polynomials: monomials are variable-to-exponent maps with graded-lex ordering
and a division algorithm. A ground-arithmetic evaluator over that substrate —
no new mathematics — makes every closed rational (in)equality `verified`.
`gcd`, `lcm` and `mod` are BigInt one-liners, and bounded sums re-read their
body once per index, which costs a re-parse and buys every summand the
arithmetic reader already understands rather than only the polynomial ones.

**Irrationality lands in this tier, which is the surprise.** `\sqrt{k}\notin
\mathbb{Q}` is settled by an integer square-root test: `k` is a perfect square
or it is not. It generalises to `\sqrt[n]{k}` unchanged.

**Primality wanted a Pratt certificate, and has one.** The prover emits the
factorisation of `p-1` and a primitive root; the kernel checks it by modular
exponentiation. Hard to find, cheap to check — the same shape as
sum-of-squares. It also unlocks Euclid's construction, which
`docs/proof-kernel.md` raises and then sets aside for want of the supporting
fact.

`\mathbb{P}` is the first set the application defines for itself. Compute
Engine has no primes, so the symbol arrives bare and every answer about it is
this code's own — which is why it needed exempting in three places before it
worked at all: from the identifier scanner, which would have interned the `P`
as a user name; from `hasDegradedBuiltin`, which refuses any line carrying a
symbol Compute Engine does not know; and from `STANDARD_SETS`, which is the
list of domains Compute Engine *may* be asked to decide and is precisely where
this one does not belong.

The kernel checker is the first that deliberately declines to redo the work.
Everything else in Tier 1 recomputes: the ground checker does the sum again,
the root test searches the integers again. Factoring is not that, and a
checker that trial-divides is a prover that runs on every keystroke. So this
one takes a witness in each direction — a Pratt certificate for a prime, a
proper divisor for a composite — and does only the modular arithmetic that
confirms it. That is why it is `certified` rather than `verified`, and the
distinction is exactly the one those two levels exist to record.

The gate gained an eighth claim to go with it: random numbers up to 4,000, the
kernel's verdict compared against trial division outside it, and a fatal
corruption injected into every certificate that checks. Note that shifting a
primitive root by one is *not* a fatal corruption — a prime generally has many
— and the probe said UNSOUND until it stopped assuming otherwise.

### Tier 2 — one new normaliser each

**Exponential and trigonometric identities.** Work in Laurent polynomials over
`\mathbb{Q}(i)` with `E = e^{it}`:

    \cos t = (E + E^{-1})/2        \sin t = (E - E^{-1})/2i

with conjugation sending `E \mapsto E^{-1}` for real `t`. Then
`\sin^2 t + \cos^2 t = 1` is a two-line Laurent computation and
`\Re(e^{it}) = \cos t` is immediate. This is the existing polynomial
arithmetic extended to negative exponents over a quadratic extension.

The payoff is out of proportion to the work: all five `euler-real-part` rows
move off `axiom`, `\sin^2x+\cos^2x=1` stops leaning on Sturm, and
**`e^{i\pi} = -1` becomes one named admitted relation** rather than a CAS
call. That is the sidebar doing precisely what it exists for — the reader sees
which single analytic fact the whole trigonometric edifice rests on.

**Calculus on rational functions, checked backwards.** Differentiation is
syntactic and trivially verifiable. Integration is checked by differentiating:
the prover emits the antiderivative `F`, the kernel checks `F' = f` by
rational-function arithmetic and evaluates `F(b) - F(a)` in exact rationals.
`calculus.continuity` already guards the singularity condition. Finding `F` is
hard; checking it is Tier 1 arithmetic.

### Tier 3 — analysis, where the witness is a function

The pattern does not change; the witnesses get harder to find.

- **Limits of rational functions.** `\lim_{n\to\infty}1/n = 0` is an
  epsilon-N witness, `N(\epsilon) := \lceil 1/\epsilon\rceil`, whose
  obligation is a polynomial inequality the kernel already checks. This is the
  epsilon-delta idiom generalised, and it needs `logic.exists-intro` to have a
  prover behind it.
- **Numeric bounds on constants.** `e>2.7` and `\pi>3` become rational
  interval arithmetic: a truncated series plus an explicit remainder bound,
  entirely in `\mathbb{Q}`. Small, self-contained, and it certifies a whole
  class of otherwise-oracle rows.
- **Series.** Geometric and telescoping sums get closed-form partial sums
  checkable by induction, then one limit from the first bullet. Convergence
  *tests* are the phase 4 pattern: the theorem is admitted and named, the
  instance is checked.
- **`\lim_{x\to0}\frac{\sin x}{x}=1`** needs a Taylor bound on `\sin`, which
  needs the remainder machinery. Reachable, but the far end of this tier.

### Tier 4 — cite it or admit it, but name it

Some results are not going to be checked here. They should become **named,
first-class admitted theorems** in the sidebar rather than anonymous CAS
calls. "Proved, resting on the Basel identity" is a complete and honest
sentence; "proved" is not. The conversion is free once phase 4 exists — it is
a registry entry, not a checker.

## How large is the mathematics we are declining?

An earlier draft of this document said the Basel identity and transcendence
"are not going to be checked by a JavaScript kernel". That named the language
when the constraint is the library, and it was wrong twice over.

**Basel decomposes almost entirely into things the tiers already build.**
Cauchy's elementary proof needs `\cot^2 x < 1/x^2 < 1 + \cot^2 x` on
`(0,\pi/2)`; the root-sum `\sum_{k=1}^{n}\cot^2\frac{k\pi}{2n+1} =
\frac{n(2n-1)}{3}`; and a squeeze as `n\to\infty`. The root-sum looks
analytic and is pure coefficient arithmetic — De Moivre expanded in the
Tier 2 Laurent ring, then Vieta. The only irreducibly analytic input is
`\sin x < x < \tan x`, which is the same Taylor-remainder machinery Tier 3
needs anyway for `e>2.7`. Basel is a phase, not a wall, and it is probably
the best showcase this application could have: the row that today says
*the CAS's word* would say *verified, resting on the squeeze theorem*.

**Transcendence of `e`** is Hermite's proof: an auxiliary polynomial,
integration by parts, an integrality argument, and a contradiction from
`0 < |integer| < 1`. Integration by parts on `polynomial \times e^x` is
checkable by differentiating back — Tier 2 already. Hard, but bounded, and
formalised several times elsewhere, so the cost is known rather than
speculative.

**Transcendence of `\pi`** is Lindemann-Weierstrass, and it is the one place
the supporting mathematics is genuinely large. Estimating it honestly means
separating two questions.

*As a library to prove from foundations:* large. Existing formalisations run
to thousands of lines on top of substantial algebra libraries.

*As checkers:* much smaller, and one half is nearly free.

- **Symmetric functions, roughly 200-300 lines.** The fundamental theorem of
  symmetric polynomials is about the most certificate-shaped result in
  mathematics: the prover emits `P = Q(e_1,\dots,e_n)`, the kernel expands `Q`
  at the elementary symmetric polynomials and compares. Newton's identities
  certify per instance the same way. The substrate is already there. **This is
  worth building regardless of transcendence** — Basel's root-sum step is
  exactly this machinery.
- **Number fields, roughly 500-800 lines.** Minimal polynomials and conjugates
  collapse into the above: conjugates are the roots, and symmetric functions
  of them are rational by Vieta. Clearing denominators is bounded arithmetic.
  The awkward corner is **irreducibility over `\mathbb{Q}`**, which has no
  natural witness — reducibility certifies trivially by exhibiting factors,
  irreducibility does not. Eisenstein checks instantly where it applies;
  otherwise "irreducible mod `p`" is a bounded finite-field computation the
  kernel can re-run, with the degree-pattern argument across several primes as
  the fallback for polynomials reducible modulo every prime.

### The binding constraint is the trace budget, not the checkers

`MAX_STEPS = 128` and `MAX_DEPTH = 32`, with the comment in
`src/lib/proof-trace.js` that traces are "for reading, so they are bounded
rather than complete". Lindemann-Weierstrass is thousands of inference steps,
and a summarized step is not checkable at all — `checkStep` returns base trust
with *derivation not shown* the moment `summarize` has dropped the premises.

So building all of it yields a row reading `proved · resting on 1 theorem`
over a summarized blob nobody can read, having paid for the algebraic number
theory in full. That is the actual wall, and it is architectural rather than
mathematical. Raising `MAX_STEPS` is a knob, but it is a decision against the
premise of the application, not a configuration change.

**Row-to-row citation is the way out.** A proof spread across cited rows gets
a fresh 128-step budget per row while every row stays individually readable.
That is how a Basel-length argument fits here without giving up the one
property the trace format exists to protect.

## Should the kernel be WebAssembly?

No. The question separates into four, and they do not answer alike.

**Provability: unaffected.** WebAssembly is a compilation target. What can be
checked is a function of how much mathematics is formalised, and that work is
identical in any language.

**Performance: nothing to win yet.** The kernel's workloads are low-degree
polynomials over small rationals, and V8 implements BigInt in C++ already.
Compiling would reimplement native code in order to call it differently.

**Auditability: it actively hurts.** The kernel's entire asset is that a
reader can read it. The invariant is *the kernel is small, and nothing else is
trusted*, and a `.wasm` blob is unreadable and adds a compiler to the trusted
base. That trades the one property making the trusted-base argument work for a
speedup that is not needed.

**Where it genuinely wins — twice, and neither is the kernel.** Rigorous
arbitrary-precision interval arithmetic, of the Arb or MPFR kind, is the right
tool for certifying `\pi > 3.14159265` with sound error bounds and has no good
JavaScript equivalent. Compiled to WebAssembly it stays a *library the kernel
calls*, returning rational intervals the kernel then checks, which leaves the
auditability argument intact. And a second, independent verifier — below.

### Metamath is probably a better second backend than Lean

The built application is 3.9 MB, of which a single 3.5 MB JavaScript bundle is
almost all — against an 8 MB `maximumFileSizeToCacheInBytes` cap. Lean with
mathlib as WebAssembly is hundreds of megabytes, which is why
`docs/proof-kernel.md` rejected it.

Metamath inverts that tradeoff. The verifier is a few hundred lines — small
enough to write in plain JavaScript, no WebAssembly required — and the library
is a single text file. The catch is that `set.mm` runs to tens of megabytes,
so it cannot be precached: it would be a desktop or opt-in download, the shape
already imagined for the Lean sidecar but an order of magnitude lighter.

**This is unverified and should be checked before anyone builds on it:** the
recollection is that `set.mm` contains both the Basel problem and the
transcendence of `e`. Confirm the contents and the file size first.

What it buys is a third option. Today the choice is between building a
real-analysis library and admitting a result forever. Citing a checked proof
is neither, and it lets the sidebar say *verified against set.mm* where it now
says *the CAS's word*. For `\pi` transcendence — where the library genuinely
dwarfs the application and no readable proof exists at any checker budget —
citing is the only realistic route to a checked row.

## Can the language already say all this?

Mostly, and by a wider margin than expected. Probed against the live engine:

| Construct | Writable today | Evidence |
| --- | --- | --- |
| Hypotheses | yes — `x>0\vdash x^2>0` | proved; already the demo idiom |
| Lemma schemas at compound terms | yes — `\text{sq}(x):=x^2\ge0`, then `\text{sq}(a-1)` | proved |
| Elementary symmetric functions | yes — `a^2+b^2+c^2=e_1^2-2e_2` | proved by `polynomial.identity` |
| Vieta and factorisation | yes — `p(t):=t^2-5t+6`, `p(t)=(t-2)(t-3)` | proved |
| Sums with symbolic bounds | yes — `\forall n, \sum_{k=1}^{n}k=\frac{n(n+1)}{2}` | proved |
| Minimal-polynomial shape | yes, as predicate plus implication | proved |
| Theory contexts | yes for built-ins — `\mathsf{Grp}\vdash x^2x^3=x^5` | certified |

**The symmetric-function layer is already writable, and `polynomial.identity`
already checks it.** That estimate of 200-300 lines above is mostly trust
propagation, not arithmetic — the language and the checker both exist and the
rows read `axiom` only because of `definition.unfold`.

### Three holes

1. **Existential witnesses do not connect.** Covered above; one rule.
2. **Rows do not cite rows.** Three rows forming an obvious chain were each
   re-proved from scratch through Sturm; nothing recorded that the third
   follows from the first two. Composition happens *inside* a row, through
   defined names and the `A = B = C` chain form. This is
   `docs/proof-traces.md` phase 6.
3. **Custom theory contexts do not work.** `\mathsf{Pos}:=\{x>0\}` then
   `\mathsf{Pos}\vdash x^2>0` falls to sampling, as does
   `x>0\land y>0\vdash xy>0`. One relation may be assumed, not a context.

### A bug *(fixed in phase 0)*

Naming a whole proposition and citing it — the "state a lemma, then use it"
move — produced the application's worst verdict on a true statement:

    \text{lemma}:=\forall x\in\mathbb{R},x^2\ge0
    \text{lemma}                    proved · a step the kernel refused

A constant-valued definition emitted no `definition.unfold` step, so the
abstention guard in `checkStep` did not fire and REFUSED became `rejected`
rather than an abstention. The predicate form abstained correctly.

The fix is at the source rather than at the guard, which is why it does not
weaken any genuine refusal: `collectFunctionExpansions` walked the JSON looking
for *calls*, and a named proposition cited on its own is a bare symbol, so it
was never seen. It is now `collectDefinitionExpansions`, it records constants
whose value is a proposition, and the row both abstains correctly and — for
the first time — says what the name stood for. Ordinary value constants are
deliberately not recorded: `a := 3` is not a step of anybody's proof, and
recording it would widen the abstention guard over every row that names a
number.

### On checking as we go

That is already the model: every row is evaluated and kernel-checked
independently as it is typed, with its own trust badge. What is missing is
*dependency* — the kernel checks each row against its own trace, never against
the rows above it. Steps can be checked as they are written; they are not yet
steps of one proof.

## Phases

### Phase 0: three small independent fixes — **implemented**

Each is self-contained and measurable against the existing gates.

1. ~~The false-refusal bug above.~~ Fixed in `engine.js`; both shapes of a
   named lemma are regression-tested in `test/kernel.test.mjs`.
2. Tier 1 ground arithmetic, including the integer square-root test that gives
   the irrationality rows a trace for the first time. **All but primality.**
   `checkGroundArithmetic` in `kernel.js` verifies any closed relation whose
   two sides read as rational arithmetic, and the kernel's reader gained
   `gcd`, `lcm` and `mod` over integer literals. `arithmetic.integer-root` is
   the new rule for `\sqrt[n]{k} \in \mathbb{Q}`: the lowering in `sets.js`
   decides it by an exact integer root search, and the kernel re-runs that
   search from the conclusion alone, believing none of the prover's data.
   Bounded sums and primality are **not** done — see below.
3. ~~`quadratic.psd` under quantifiers.~~ Fixed in `sets.js`, and the cause
   was not the one predicted; see the corrected diagnosis above.

Three properties are worth stating, since they are what the gates were run
against. No verdict moved from `proved` to `undecided`. Two verdicts moved the
other way — `\sqrt[3]{5}\notin\mathbb{Q}` and `\sqrt[3]{8}\in\mathbb{Q}` were
undecided, because Compute Engine settles the square-root case and gives up on
the rest — and every quantified PSD inequality moved from `sampled` to
`proved`. Both probes report SOUND.

**Bounded sums landed after the rest of phase 0**, in `readBoundedOperator`
and its neighbours in `kernel.js`. `\sum` and `\prod` over a literal range are
expanded term by term, so `\sum_{n=1}^{10}n=55`, `\prod_{n=1}^{5}n=120` and
`\sum_{n=1}^{10}n>50` are all `verified`.

Two decisions are worth recording, because the obvious implementation of each
is wrong.

*The body is re-read at each index, not substituted into a polynomial.* The
polynomial route reads `n^2` and refuses `\frac{1}{n}`, which is most of the
interesting cases; re-reading the tokens with the index replaced by a literal
turns `1/n` into `1/3`, a constant the arithmetic reader already handles.
Nested sums then fall out of the recursion for free, since an inner bound
mentioning the outer index is a literal by the time the inner reader sees it.
Substitution skips the braces of `\text` and `\operatorname`, where a letter
is part of a name, and abandons the reading entirely if a nested `\sum` binds
the same index.

*The summand stops where Compute Engine stops it.* `\sum_{n=1}^{3}n+5` is 11,
not 21 — the operator binds the product that follows and no further. This is
not a matter of taste, because the ground checker **refuses** a relation it
reads as false: a reader that swallowed the `+5` would turn a true row into a
rejected one. `productExtent` is that boundary, and `probe-kernel.mjs`
generates a trailing term on purpose to keep it honest.

The gate gained a seventh claim: every generated bounded sum and product is
re-evaluated by an independent BigInt loop that shares nothing with the
kernel's reader. 8,000 cases, SOUND.

**Primality landed after that**, and closes Tier 1. It is written up under the
tier above, because it is the one item there whose interest is not the
arithmetic.

Nothing in the demo catalogue uses a bounded sum or a prime, so the row table
above is unchanged by either. That is the honest reading of it: both
capabilities are real and gated, and the catalogue simply does not exercise
them yet. A demo that did — Euclid's construction is the obvious one, and it
was waiting on exactly this — is worth writing, and belongs with phase 2's
`logic.exists-intro` rather than here.

**The ground checker refuses, and this is deliberate.** A step claiming exact
evaluation of `2+2=5` is refused rather than left alone: the CAS cannot have
exactly evaluated that to true, so the disagreement is real and not a gap in
the kernel. The same goes for a perfect square asserted to be irrational.
Everything the kernel cannot read arithmetically still abstains — `\pi > 3`
leaves `\pi` an indeterminate and keeps the oracle it had.

### Phase 1: citation, and the theorem library

`docs/proof-traces.md` phase 6 and `docs/proof-kernel.md` phase 4 are one
piece of work: named lemmas as genuine theorem references, `definition.unfold`
as a *use* rather than a checker, the registry, the permission set, the
sidebar.

This is the highest-value item in this document. It clears the twelve
`definition.unfold` steps and unblocks the sixteen abstentions behind them —
twenty-eight of the sixty-one, in one piece of work. It turns the
sheet from a list of independently checked claims into a proof, and it is the
only way an argument longer than one row fits inside the readability budget.
Everything below sits behind it.

### Phase 2: constructed witnesses

Give `logic.exists-intro` a prover. The checker exists; the notation should
follow the grain already there, naming the witness with `:=` and citing it, as
the epsilon-delta demo does. This unlocks epsilon-N limits and Euclid.

### Phase 3: finish the kernel plan's phase 3

Positivstellensatz witnesses replacing Sturm — fourteen steps, the largest
single source of unchecked reasoning — then the finite enumerations and the
topology certificates.

`algebra.finite-exhaustion` grew a constituency while this was waiting.
`Cat`, `Cmp`, `Idt`, `Aso` and `Fun` in `algebra.js` put small categories and
functors on the same footing as the finite groups and rings — traced, named,
refusable — which moved those rows from `opaque` to `axiom` but not past it.
Every one of them is blocked on the same checker, and the reason it does not
exist yet is worth stating: re-running the enumeration means evaluating the
reader's own function definitions, and those are Compute Engine expressions.
The kernel shares nothing with Compute Engine on purpose. So this is not a
missing checker so much as an unanswered question about what an independent
re-run of a user-defined operation would even be — a small evaluator of its
own, most likely, over the same exact rationals `kernel-polynomial.js`
already has.

### Phase 4: Tier 2

The Laurent ring first: five demo rows, the trigonometric identities off
Sturm, and `e^{i\pi}=-1` reduced to one named relation, for one contained
piece of arithmetic. Then calculus checked backwards.

### Phase 5: investigate Metamath

Confirm what `set.mm` contains and how large it is, then decide whether the
second backend is Metamath rather than Lean. Nothing above depends on this.

### Later

Tier 3 and the interval-arithmetic question wait until something concrete
wants them. Symmetric-function certificates come with Basel if Basel is
attempted; number fields only if something *readable* wants them.

## Invariants

Those in `docs/proof-kernel.md` hold unchanged. Two additions:

- **Splitting the oracle may not widen it.** Every statement that reads
  `proved` today must still read `proved` after `engine.exact-evaluation` is
  decomposed. A statement moving from `oracle` to `verified` is the point; a
  statement moving from `proved` to `undecided` is a regression to fix, not a
  new honesty.
- **A cited proof is not a checked proof, and must not read as one.** If the
  Metamath backend lands, a row resting on it says so by name. Citing an
  external library is a different claim from checking a trace, and the
  sidebar's whole value is that the difference is visible.

## What this does not get you

- **Not a proof assistant.** There is no tactic language, no dependent types,
  and a hard 128-step readability budget per row. Proofs are authored by
  writing rows, and rows are meant to be read.
- **`\pi` transcendence stays out of reach as an authored proof** at any
  checker budget, for the reason above. Cited, it is reachable.
- **Tier 1 changes no verdicts.** Like phases 1 and 2 of the kernel plan, its
  value is honesty rather than capability — but unlike them it is cheap, and
  it removes the most embarrassing row in the application.
