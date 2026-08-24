# A proof kernel for Sequent

Status: phases 1 and 2 implemented; phase 3 started; phases 4-5 proposed

Phase 1 landed in `src/lib/kernel.js`, checked by `test/kernel.test.mjs`. Every
step of every trace carries a trust level, the row reports the weakest one, and
the twelve `logic.*` rules have checking functions — including
`logic.exists-intro`, registered and checkable but with no prover behind it
yet. The `Sheet` constructor gained `allowDirectEvaluation`, so the oracle can
be withheld from a whole sheet and the monotonicity invariant put under test;
it is the seed of phase 4's permission set.

Phase 2 added `src/lib/kernel-polynomial.js`: exact rational polynomial
arithmetic over BigInt, deliberately shared with nothing. With it the kernel
compares propositions by *what they say* rather than how they are spelled — two
relations are one proposition when their difference agrees up to the rescaling
that relation tolerates — and five rewrites became checkable:
`relation.normalize`, `order.positive-scale`, `relation.nonzero-scale`,
`order.affine-monotonicity` and `polynomial.multiple`, joined by
`order.power-monotonicity` and by `polynomial.identity`, the one certificate
whose witness is nothing at all. `probe-kernel.mjs` is the gate: it generates
random related relations and re-checks every identification and every verified
rewrite by dense evaluation, outside the kernel's own arithmetic.

Three demo rows now read **proved · verified**, resting on nothing. No verdict
has changed at any point.

Phase 3 has its first four vertical slices. `polynomial.even-power` now carries
the non-negative expression the prover found — including recovered factors
such as `(x-y)^2` — and the kernel independently expands it, checks its sign
from its shape, and compares it with the claimed relation. `quadratic.psd` now
emits the exact rational LDL decomposition as positive coefficients and affine
squares; the kernel independently parses and expands that sum. Thus

    a² + b² + c² ≥ ab + bc + ca

is witnessed by `(a − ½b − ½c)² + ¾(b − c)²`. Both kinds of row now read
**proved · witnessed** rather than resting on the decision procedure. A
missing, altered, negative-coefficient, or insufficiently strict witness stays
admitted. `logic.tautology` is now checked by independently collecting at most
twelve opaque propositions and re-running all at most 4,096 truth assignments.
`group.free-reduction` is checked by a separate parser that independently
reduces both sides and confirms the displayed normal form, for free and
abelian groups. `probe-kernel.mjs` generates valid and corrupted instances of
all four certificate kinds outside the prover.

What the kernel still cannot do, and where it is addressed:

- **`definition.unfold` and `set.extensionality`** have no checker and cannot
  get one here: the kernel sees a trace, not the definition table, so an
  unfolding is something it is told rather than something it can confirm. Nine
  of the eleven unchecked universal generalizations in the demo catalogue are
  blocked behind exactly this, and the fix is not a checker but a *use* — an
  admitted equivalence the kernel may rewrite with. That belongs with phase 4,
  where theorems become first-class objects.
- **Anything that needs to know what a name means.** `\Re(z) = (z +
  \overline{z})/2` is an identity about the real part, not about polynomials,
  so the Euler rows stay admitted. The arithmetic treats such terms as
  indeterminates, which is why it is sound to run it on them at all.
- **The certificates**, which are phase 3.

## Where we actually stand

Three things are taken on trust today, and they are quite different from each
other. Knowing which is which is most of the design.

**1. Compute Engine as an oracle.** Pass 1a of `decideStatement` hands the
whole statement to the CAS and believes the answer. Disabling just that pass —
`allowDirectEvaluation: false`, which already exists — splits the catalogue
cleanly:

| Statement | normally | CAS oracle disabled |
| --- | --- | --- |
| `a² + b² ≥ 2ab` | proved | **proved** |
| `(ac+bd)² ≤ (a²+b²)(c²+d²)` | proved | **proved** |
| `sin²x + cos²x = 1` | proved | **proved** |
| `e^{iπ} = −1` | proved | **undecided** |
| `√2 ∉ ℚ` | proved | **undecided** |
| `Σ 1/n² = π²/6` | proved | **undecided** |
| `2 + 2 = 4` | proved | **undecided** |

Everything in the lower half is an appeal to authority. The last row is the
instructive one: the sheet has no arithmetic of its own at that level.

**2. Decision procedures embed theorems.** `polynomial.sturm-sign-chart` *is*
Sturm's theorem, and the finite exhaustions rely on their corresponding
classification principles. Each is named in the trace and not yet checked.
The quadratic, truth-table, and free-group procedures have crossed that
boundary by emitting answers the kernel independently verifies.

**3. Lowering embeds definitions.** `cont(…)` → obligations *is* the ε–δ
definition. `Induct` → `Base ∧ Step` *is* the induction principle.

The good news is that the trace already records which of the three applied.
The registry is the inventory, and it is the work list:

- **11 inference rules** — `logic.assumption`, `logic.implies-intro`,
  `logic.and-intro`, `logic.cases`, `logic.universal-generalization`, …
- **7 rewrite rules** — `relation.normalize`, `order.positive-scale`,
  `definition.unfold`, `set.extensionality`, …
- **16 certificates** — the sign charts, the finite exhaustions,
  `engine.exact-evaluation`, …

## The core idea

**A trace is already a proof skeleton.** It is a DAG of
`{ rule, premises, conclusionLatex }` with one root, validated for shape,
acyclicity and bounds. What it lacks is *meaning*: nothing checks that the
conclusion actually follows from the premises.

Give every rule a **checking function** — `check(conclusion, premises, data) →
boolean` — and the trace becomes a proof term and `validateTrace` becomes a
kernel. That is the whole architecture, and its great virtue is that it can be
done one rule at a time. Each rule that gains a checker moves from *trusted*
to *verified*, and the move is visible.

So every step carries a **trust level**, which is what the sidebar displays:

| Level | Meaning | Example |
| --- | --- | --- |
| `verified` | The kernel re-derived it from the premises | `logic.and-intro` |
| `certified` | The step carries a witness the kernel checked | `polynomial.even-power` with its SOS witness |
| `axiom` | Named, believed, and refusable | Sturm's theorem |
| `oracle` | Compute Engine said so, with no witness at all | `engine.exact-evaluation` |

A proof is only as strong as its weakest step, so a trace reports the minimum
level across its nodes. "This row is proved, resting on Sturm's theorem and
one CAS evaluation" is a far more honest sentence than "proved", and it is the
sentence this plan is for.

## The idea that makes certificates checkable

Most of the sixteen certificates do not need their *procedure* verified — only
their *answer*, and the answer can carry a witness that is cheap to check.
This is the standard move, and it is why this plan is tractable at all:

    a² + b² ≥ 2ab

    today       polynomial.even-power        "trust the sign prover"
    certified   witness: (a − b)²            check: expand and compare

The search for `(a−b)²` is hard; verifying it is polynomial arithmetic. The
same shape applies to `quadratic.psd` (emit the sum-of-squares decomposition),
`polynomial.identity` (emit nothing — expansion to zero *is* the check),
`polynomial.multiple` (emit the cofactor), `group.free-reduction` (re-run the
reduction), `logic.tautology` (re-run the truth table), and both finite
exhaustions (re-run the enumeration, which is already bounded).

### Sturm should be replaced, not expanded

The first draft of this plan called Sturm's theorem an irreducible axiom. That
was wrong, and the mistake is worth naming because it shapes phase 3.

**Sturm's theorem is a search method, not a justification.** Probing what
actually reaches the sign chart:

| Claim | What settles it today | Certificate that needs no Sturm |
| --- | --- | --- |
| `x⁴ + 1 > 0` | sign chart | sum of squares, plus a positive constant |
| `x² + x + 1 > 0` | sign chart | `(x + ½)² + ¾` |
| `(x+1)² = x² + 2x + 1` | sign chart | expand the difference to zero |
| `x = 2 ⟹ x² = 4` | sign chart | substitute; no theorem at all |
| `x > 2 ⟹ x² > 3` | sign chart | `x² − 3 = σ₀ + σ₁·(x − 2)`, each `σᵢ` a sum of squares |

Every one of these is checkable by polynomial arithmetic alone. And the
certificates are not merely available in these examples — for this fragment
they always exist. A univariate polynomial that is non-negative on ℝ is a sum
of squares, and one with rational coefficients is a sum of *rational* squares;
positivity on a half-line or an interval has the corresponding
Positivstellensatz form with the interval's own factors.

So Sturm keeps its job — it is how the prover *finds* the answer — but it
stops being something the reader has to take on faith. The search stays
outside the kernel, the witness comes in, and the kernel checks it by
expanding polynomials. This is the same division of labour as the sum-of-
squares move above, applied to the case that looked hardest.

That leaves one apparently irreducible item: `engine.exact-evaluation` has no
witness by construction and stays an oracle forever.

**This was wrong, and `docs/beyond-the-oracle.md` is the correction.** The
label is one bucket over statements with nothing in common, and most of what
arrives in it is arithmetic. Phase 0 of that plan gave the rule a checker for
the ground rational end of it, which is where `2 + 2 = 4` had been sitting;
what stays an oracle is the hard end, and now it is only the hard end.

## Constructed witnesses

The sheet cannot currently prove `∃x ∈ ℝ, x² = 4`. It comes back undecided,
and naming the witness first does not help — nothing connects `w := 2` to the
claim. Over a finite set it succeeds, but only by enumerating.

Yet the app already contains constructed-witness proofs, in the one place they
were hard-coded:

    g(x) := 2x + 1
    d(ε) := ε/2
    cont(g, a, ε, d(ε))          proved

That is "here is my δ, check it" — the reader supplies the witness and the
machine verifies the obligations. Supply `d(ε) := 2ε` instead and it declines.
`limitw` and `Meet` work the same way. Three predicates, each with the pattern
welded in.

**The kernel generalises this, and it is one inference rule.** To prove
`∃x, P(x)`, give a term `t` and a proof of `P(t)`; to check it, substitute and
compare. `logic.exists-intro` is conspicuously missing from the eleven
inference rules and belongs in phase 1 with the rest — it is no harder to
check than conjunction introduction.

Notation should follow the grain already there: name the witness with `:=`,
then cite it, exactly as the ε–δ demo does. The alternative — a `by` clause on
the quantifier — is worth prototyping but is a new construct where the sheet
already has a working idiom.

What this does **not** do is make every existential reachable. A witness for
`∀n ∃p > n, p prime` is not a term but a function of `n`, together with a
proof that it works for every `n`. Euclid's construction is expressible —
universal generalisation, then existential introduction with `n! + 1` — but
the supporting fact, that every integer above one has a prime factor, is
number theory the sheet does not have.

**That is precisely the case the sidebar is for.** Write the proof, admit the
missing lemma as a named axiom, and the row reads *proved, resting on one
admitted theorem*. Then discharge it, or leave it and move on. Turning "cannot
prove this" into "here is the proof and here is the gap" is the whole point of
letting theorems be taken or left.

## Non-negotiable invariants

These extend the ones in `docs/proof-traces.md`.

- **The kernel is small, and nothing else is trusted.** If the checker grows
  provers of its own it stops being a kernel. Search happens outside; checking
  happens inside.
- **Withholding is never disproof.** A statement that cannot be proved from
  the allowed theorems is *undecided*, never false. The existing architecture
  already behaves this way and must keep doing so.
- **Verdicts may change with settings; soundness may not.** Turning a theorem
  off may turn `proved` into `undecided`. It must never turn `false` into
  `true` or the reverse.
- **A trace reports its weakest step.** No proof may present itself as
  verified because most of it was.
- **Existing verdicts stay put at full permissions.** `npm test`, the
  fixed-seed fuzz and `probe-soundness.mjs` pass unchanged throughout.
- **The kernel runs in the browser.** The PWA is 3.8 MB and works offline;
  that is a feature, and no design that requires a toolchain may become the
  only way to check a proof.

## Should this be Lean?

Not as the primary kernel, and the reasons are concrete rather than
ideological.

**In the browser it is not possible.** Lean 4 with mathlib as WASM runs to
hundreds of megabytes against a 3.8 MB app with an 8 MB precache budget. The
offline PWA would be the casualty, and it is one of the better things about
this project.

**Translation is the real work, and it does not go away.** Mapping our
statements onto mathlib — finite group predicates, the topology axioms, the
ε–δ witnesses, matrices — is a large and *continuing* effort, because mathlib's
API moves. Every hour spent there is an hour not spent on the certificates,
and the certificates are needed either way: a Lean tactic still has to produce
something Lean can check, and `(a−b)²` is that something in both worlds.

**But it is an excellent second checker.** The right shape is two backends
behind one interface:

- **our kernel** — small, in-browser, always available, checks the trace
  directly;
- **Lean** — optional, desktop only (the Tauri build can ship a sidecar or
  call an installed toolchain), consuming *exported* proof terms.

Design the certificate format so it can be printed as Lean source, and the
second backend becomes an export target rather than a rewrite. `sorry` is
exactly our `axiom` level, which is a pleasing correspondence: a trace with
admitted theorems exports to a Lean file with `sorry`s in precisely those
places, and Lean will tell you the same thing our sidebar does.

There is no Lean toolchain on this machine, so phase 5 begins by installing
one and nothing before phase 5 depends on it.

## Phases

### Phase 1: The kernel, and the eleven inference rules

1. Add `src/lib/kernel.js`: a checker over the existing trace format, plus a
   `TRUST` ordering and the weakest-step calculation.
2. Give each of the eleven `logic.*` rules a checking function, and add the
   twelfth: `logic.exists-intro`, which is what makes a reader's own witness
   into a proof. These are natural deduction and need no arithmetic — the
   checker is small.
3. Every step gains `trust`, defaulting to `axiom` for rules with no checker
   yet, so nothing regresses and everything is honest from day one.
4. Surface the weakest level on the row: `proved · resting on 3 theorems ▸`.

This phase changes no verdicts at all. It only starts telling the truth about
them, and it is worth doing on its own.

### Phase 2: Structural equality, and the seven rewrites

The rewrites need one arithmetic primitive — polynomial normalisation over ℚ,
which `rational-polynomial.js` already has in exact BigInt rationals.

**Why the kernel computes this rather than checking a derivation of it.** The
kernel recomputes the normal form itself and compares; it does not take the
prover's word. What is trusted is therefore not the prover but about fifty
lines of BigInt rational arithmetic *inside* the kernel — small, auditable,
independently testable, and shared by nothing else. That is the ordinary
trusted-computing-base argument and it is a much weaker assumption than it
first sounds.

Expanding it further is possible but costs more than it buys. A per-use
expansion means emitting associativity, commutativity and distributivity
steps: a four-variable identity becomes thousands of nodes, against a trace
that caps at 128 steps and summarises beyond it. The proof stops being
readable, which is the one thing this application exists to provide. The
principled alternative is reflection — prove the normaliser correct once and
cite that lemma per use — and that needs dependent types, which is exactly why
Lean can afford `ring` and a JavaScript kernel cannot.

It is a knob, not a wall: anyone who wants the smaller trusted base can have
it by paying in proof size.

With it, `relation.normalize`, `order.positive-scale`, `relation.nonzero-scale`,
`order.affine-monotonicity` and `polynomial.multiple` all become checkable:
re-derive the normal form, verify the claimed factor has the claimed sign.

### Phase 3: Witness-bearing certificates

Make the provers emit what they found, then check it:

- `polynomial.even-power` and `quadratic.psd` — the sum-of-squares witness
  (implemented);
- `polynomial.identity` — expansion to zero;
- `logic.tautology` — the truth table, re-run (implemented);
- `algebra.finite-exhaustion` and `set.finite-enumeration` — the enumeration,
  re-run under the existing bounds;
- `group.free-reduction` — the reduction, re-run (implemented).

This is where most of the sixteen move from `axiom` to `certified`, and it is
the phase with the most mathematics in it.

### Phase 4: The theorem library and the sidebar

1. Enrich the registry: each rule names the theorem it appeals to, with a
   statement and a dependency list. Sturm's theorem becomes a first-class
   object, not a string in a label.
2. Generalise the existing `allowSampling` / `allowDirectEvaluation` options
   into a permission set of theorem ids, consulted by each branch before it
   runs.
3. Build the sidebar: every theorem the sheet knows, its trust level, and a
   toggle. Turning one off re-runs the sheet under the smaller set.
4. **"Prove that one too"** — the feature this is all for. Selecting an
   admitted theorem spawns a goal row: the statement, to be proved from the
   remaining permitted set. This is where `docs/proof-traces.md` phase 6
   (named lemmas as genuine theorem references, with dependency tracking and
   cycle prevention) becomes a prerequisite rather than an extra.

### Phase 5: Lean as an export target

1. Install a toolchain; add it to the desktop build only.
2. Print traces as Lean source, with `axiom`-level steps as `sorry`.
3. Round-trip the demo catalogue and compare verdicts. Disagreement is a bug
   in our kernel and worth finding.

## Test strategy

- **Negative tests are the point.** A checker that accepts everything passes
  every positive test. Every rule's checker needs a case where the premises do
  *not* entail the conclusion and the kernel says so.
- **Mutation testing.** Take a valid trace, corrupt one step's conclusion, and
  require rejection. This can be generated mechanically from the demo
  catalogue and is the highest-value test in the plan.
- **Trust monotonicity.** Removing a theorem may only ever move a verdict
  toward `undecided`.
- **The existing gates, unchanged**, at full permissions.

## What this does not get you

Worth writing down so the plan is not oversold.

- **Not foundational.** The kernel's own rational arithmetic is trusted —
  see phase 2 for why that is a deliberate trade and how to buy it back. This
  is a kernel with a visible axiom list, not a derivation from ZFC, and the
  visible axiom list is the honest and useful goal.
- **`engine.exact-evaluation` never becomes verified.** *Superseded; see
  `docs/beyond-the-oracle.md`.* Statements that only the CAS can settle —
  Basel, `e^{iπ} = −1` — stay oracle-level unless someone writes real proofs
  for them, and the sidebar makes that visible, which is uncomfortable and
  correct. Irrationality was listed here in error: it is an integer root
  search, it is checked, and the row reads `verified`.
- **Phases 1 and 2 change no verdicts.** The value there is honesty, not
  capability. Anyone hoping for new theorems should start at phase 3.

## Suggested order

Phase 1 first and on its own — it is self-contained, changes no behaviour, and
makes every later claim measurable. Then 2, then 3, which is where the system
starts genuinely proving rather than asserting. Phase 4 needs
`docs/proof-traces.md` phase 6 alongside it. Phase 5 whenever someone wants a
second opinion.
