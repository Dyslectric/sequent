# Proof traces and rules of inference

Status: phases 0–3 and 5 implemented, phase 4 nearly; phase 6 proposed

Coverage is 37 traced rows of 43 across the demo catalogue. The six that remain
are described at the end of the phase 4 section.

Phase 0 landed as `src/lib/proof-trace.js` and `test/proof-trace.test.mjs`:
every result carries `proof` and `proofStatus`, and uninstrumented exact
branches report `opaque`.

Phase 1 landed the epsilon slice end to end — expansion capture in
`engine.js`, evidence from the winning branch in `decide.js`, and an
accessible disclosure panel in `main.js`/`styles.css`. One correction to the
plan below, found by instrumenting the dispatch rather than reading it:

**`ε > 0 ⊢ d(ε) > 0` is not decided by the affine implication branch.** It is
univariate, so pass 1b — the exact Sturm sign chart — settles it first, and
the affine prover in `proveImplies()` never runs. Since dispatch order may not
change and a branch may only emit evidence it actually produced, the epsilon
row cites `definition.unfold` then `polynomial.sturm-sign-chart`, not the
four-step derivation sketched under "Product goal".

The affine branch is real and does emit `c` (scale) and `k` (offset) — it
decides *multivariable* implications such as `a > b ⊢ a/2 > b/2` (c = 1/2,
k = 0, genuine positive scaling) and `x > y ⊢ x+1 > y` (k = 1, affine
monotonicity). Instrumenting it needs the evidence-bearing refactor of the
recursive `proveSymbolically`/`proveImplies` family, which belongs with
phase 2 rather than ahead of it.

Phase 2 made the propositional family evidence-bearing.
`proveSymbolically`, `proveImplies` and `proveEquivalent` now return the id of
the step concluding what they proved, allocated in one builder shared across
the decision, so a composite rule cites its premises directly and a claim
proved twice is recorded once. Implication, conjunction, disjunction, cases,
equivalence and transitive chains all compose real derivations, and the
`implication-rules` demo exercises them.

Two things learned while doing it:

- **`booleanSkeletonTautology` runs first and legitimately wins a lot.**
  `A ∧ B ⊢ A`, `A ∨ A ⊢ A` and `A ⊢ A ∨ B` really are propositional
  tautologies, so they are cited as `logic.tautology` rather than as
  conjunction elimination or proof by cases. The structural branches emit
  their own rules only where the skeleton cannot settle the shape.
- **The univariate sign chart still absorbs most single-variable lines.**
  `x > 2 ⊢ x > 1` and `x + 1 = 2 ⟺ x = 1` are decided by pass 1b before any
  propositional branch runs, so they show one flat certificate. The
  propositional rules surface on multivariable statements.

A verdict can never depend on trace machinery: a step that fails to build
yields a poison value that counts as proved everywhere the truth value
matters and degrades only the trace to `opaque`.

Phase 4 took a different route than this plan proposes, and only part of the
way. Rather than thread rewrite records through `lowerNode` — a large
recursive rewriter with dozens of branches, every one of which would have to
be correct for the result to be trustworthy — the engine *names a rewrite it
can recognize and then proves it was the only one that happened*:

```js
const generalized = !analysis && universal
  && sameExpression(lowered.expr, universal.body) ? universal : null;
```

Peel the leading `ForAll` chain, lower as usual, and compare. If the lowered
form is structurally identical to the peeled body, quantifier stripping was
demonstrably all that occurred, and the trace closes with
`logic.universal-generalization` as its root. Anything else — a subset
relation collapsing to `True`, a membership expanded pointwise, an induction
certificate — fails the comparison and stays `opaque`. The check cannot be
fooled by a lowering pass this code does not know about, which is the property
that matters; adding a recognizer later is additive and safe.

Also landed: named propositions are now captured as `definition.unfold` before
expansion inlines them (rendered with `\iff`, since they stand for claims, not
values), and the complex fragment reports the `relation.normalize` that
actually decides it.

Demo coverage is 32 traced rows of 43, seven of ten demos fully traced, after
phases 4 (partial) and 5. The remaining 11 rows each need their own recognizer:
set lowering (4 rows — membership, power sets, extensionality), induction (4),
the epsilon-delta `cont`/`limitw` predicates (2), and one topology row whose
top-level operator is a conjunction rather than a predicate.

Induction is the most tractable of those: `Induct(P,0)` lowers to its
obligations `Base ∧ Step`, which is a genuine rewrite rather than a decision,
so it fits the existing `wrap` mechanism — `analysis.induction` as the root
with the proof of the obligations as its premise.

This document describes how to extend Sequent so that a successful result can
show, step by step, why it follows. It is written as an implementation handoff.

The central constraint is soundness: the explanation must be emitted by the
same branch that proved the statement. The UI must not inspect a generic
`proved` result afterward and guess which rule was used.

## Product goal

When a row is proved, keep the compact verdict but optionally let the reader
expand a derivation:

```text
ε > 0 ⊢ d(ε) > 0                 true · implication introduction

1. ε > 0                         assumption
2. d(ε) = ε/2                    unfold definition d
3. ε/2 > 0                       positive scaling
4. ε > 0 ⊢ d(ε) > 0             implication introduction
```

The demo pages should normally expand these derivations so that each demo is a
guided proof. Ordinary sheet rows should keep them collapsed.

This does **not** add lemmas or inference rules to the keyboard. Users continue
to define named statements in the sheet and use them in demonstrations. Rules
are internal proof metadata rendered beside the result.

## Terms and claims

Keep these three categories distinct in code and in the UI:

1. **Logical inference rules** manipulate propositions: assumption,
   implication introduction, conjunction introduction, cases, equivalence
   introduction, and chain composition.
2. **Mathematical rewrite rules** justify an equivalent or order-preserving
   transformation: unfolding a definition, normalization, factorization,
   positive scaling, or set extensionality.
3. **Decision procedures and certificates** establish a claim by an exact
   algorithm: a Sturm sign chart, positive-semidefinite quadratic form, free
   group reduction, or exhaustive finite verification.

Do not label every successful method as a rule of inference. A finite search is
a certificate, and exact simplification is normalization.

Initially, call the output a **proof explanation** or **proof trace**, not an
independently verified proof object. It records the exact prover path, but the
application still trusts the implementation that produced it. Calling it a
formal proof certificate would require a separate small checker that validates
every trace node. That checker is planned in `docs/proof-kernel.md`, which
takes this document's trace format as its proof term and turns
`validateTrace` into a kernel.

## Non-negotiable invariants

- Existing truth values and dispatch order must not change just because traces
  are present.
- Sampling can suggest a result or find a counterexample, but it can never
  produce a proof trace.
- A successful exact branch constructs its evidence at the point of success.
  Never reconstruct a trace from the final `method: 'proved'` value.
- Unsupported reasoning remains unsupported. Use an explicit opaque exact step
  during migration; do not invent a plausible rule.
- Store stable machine rule IDs. Keep labels and prose in one registry so copy
  changes do not alter tests or stored data.
- Render user-facing identifiers and LaTeX. Internal `IdN` names must not leak
  into traces.
- Expanding a proof in the UI only displays existing evidence. It must not run a
  second prover or change the result.
- Bound trace depth and size. Summarize large finite enumerations instead of
  listing every tuple.
- A false premise may make an implication vacuously true. Show that honestly;
  never present a vacuous implication as an application of a theorem.

## Data contract

Use a small directed acyclic graph rather than nested prose. A graph permits
multiple steps to refer to one premise without duplicating it and can later be
checked independently.

```js
{
  value: true,
  method: 'proved',
  samples: 0,
  counterexample: null,
  proof: {
    version: 1,
    root: 's4',
    steps: [
      {
        id: 's1',
        rule: 'logic.assumption',
        premises: [],
        conclusionLatex: '\\epsilon > 0',
      },
      {
        id: 's2',
        rule: 'definition.unfold',
        premises: [],
        conclusionLatex: 'd(\\epsilon)=\\epsilon/2',
        data: { name: 'd' },
      },
      {
        id: 's3',
        rule: 'order.positive-scale',
        premises: ['s1', 's2'],
        conclusionLatex: 'd(\\epsilon)>0',
        data: { scaleLatex: '1/2' },
      },
      {
        id: 's4',
        rule: 'logic.implies-intro',
        premises: ['s3'],
        conclusionLatex: '\\epsilon>0\\vdash d(\\epsilon)>0',
        data: { discharged: ['s1'] },
      },
    ],
  },
}
```

Recommended types:

```js
// ProofTrace
{
  version: 1,
  root: string,
  steps: ProofStep[],
}

// ProofStep
{
  id: string,
  rule: string,
  premises: string[],
  conclusionLatex: string,
  data?: Record<string, unknown>,
}
```

Add `proof` as an optional result field. During incremental migration, exact
branches that have not yet been instrumented should return `proof: null` and an
explicit status such as `proofStatus: 'opaque'`. Instrumented exact branches use
`proofStatus: 'available'`. Sampled and undecided results use
`proofStatus: 'unavailable'`.

Do not make display labels part of this contract. Create
`src/lib/proof-trace.js` with:

- the rule registry;
- a trace builder that allocates stable step IDs within one result;
- structural validation;
- helpers for joining trace fragments;
- conversion of internal identifiers back to user LaTeX;
- hard limits for steps and depth, with a summarized-step fallback.

The validator should reject duplicate IDs, missing premise references, a
missing root, unknown rule IDs, and cycles.

## Initial rule registry

Start with the rules needed by current provers. Add a rule only when a concrete
prover branch emits it.

| Rule ID | Category | Suggested label |
| --- | --- | --- |
| `logic.assumption` | inference | assumption |
| `logic.implies-intro` | inference | implication introduction |
| `logic.implies-elim` | inference | modus ponens |
| `logic.and-intro` | inference | conjunction introduction |
| `logic.and-elim` | inference | conjunction elimination |
| `logic.or-intro` | inference | disjunction introduction |
| `logic.cases` | inference | proof by cases |
| `logic.iff-intro` | inference | equivalence introduction |
| `logic.chain` | inference | transitive chain |
| `definition.unfold` | rewrite | unfold definition |
| `relation.normalize` | rewrite | exact normalization |
| `order.positive-scale` | rewrite | positive scaling |
| `order.affine-monotonicity` | rewrite | affine monotonicity |
| `polynomial.identity` | certificate | polynomial identity |
| `polynomial.sturm-sign-chart` | certificate | Sturm sign chart |
| `quadratic.psd` | certificate | positive semidefinite form |
| `set.extensionality` | rewrite | set extensionality |
| `set.finite-enumeration` | certificate | finite enumeration |
| `analysis.induction` | certificate | induction certificate |
| `analysis.epsilon-delta-witness` | certificate | epsilon-delta witness |
| `topology.constructor-certificate` | certificate | topology constructor certificate |
| `algebra.finite-exhaustion` | certificate | finite exhaustive verification |
| `group.free-reduction` | certificate | free-group reduction |
| `engine.exact-evaluation` | certificate | exact evaluation |

The registry entry can include `label`, `category`, an optional conventional
symbol, and a one-sentence explanation. Tests assert the ID and graph shape,
not the English label.

## Pipeline changes

### 1. Preserve source intent

The parser currently normalizes `\\vdash` into implication syntax. Preserve a
small source hint before that rewrite, for example:

```js
{ sourceKind: 'sequent', sourceLatex: rawLine }
```

This affects only presentation. The existing semantic normalization remains in
place. It also preserves the recent top-level formatting behavior that treats
`\\vdash` as a scope boundary.

### 2. Make named expansion observable

`expandNamedPropositions()` currently returns only the expanded expression.
Change it, or add a trace-aware companion, so evaluation receives both the
expression and expansion records:

```js
{
  expr,
  expansions: [
    { name: 'triangle_lemma', beforeLatex, afterLatex }
  ],
}
```

At the moment, named propositions are macros that are expanded and rechecked.
Therefore their trace step is `definition.unfold`, not “apply proven lemma.”
Genuine theorem application belongs in a later dependency-tracking phase.

Function definitions need the same treatment. The epsilon example uses
`d(ε)=ε/2`; Compute Engine may currently erase that substitution during exact
normalization. Record the function expansion before normalization so the trace
can show the definition honestly.

### 3. Return evidence from prover branches

Refactor internal prover functions away from bare `true | false | null` where
necessary. A practical internal result is:

```js
{ value: true, evidence: ProofTraceFragment }
{ value: false, evidence: ProofTraceFragment | null }
{ value: null, evidence: null }
```

`proveImplies()` should create assumption nodes, attach the evidence returned by
the consequent prover, and create an implication-introduction root that records
which assumptions were discharged. Conjunction, disjunction, equivalence, and
chain branches should compose their child fragments similarly.

If a direct exact Compute Engine evaluation succeeds before a specialized
prover runs, label that path `engine.exact-evaluation`. Do not claim a later,
more attractive rule that was not the method actually used.

### 4. Preserve evidence through lowering

The set and analysis lowerers currently return a transformed expression plus
status flags. Extend them to return trace fragments or typed rewrite records:

```js
{
  expr,
  rewrites,
  unresolved,
  ...domainFlags,
}
```

Each lowering stage owns the rationale for the transformation it performs.
`decideStatement()` then combines those fragments with the exact certificate
from the downstream solver.

### 5. Expose the winning exact branch

`decideStatement()` must return the evidence produced by the first successful
exact branch, preserving its existing dispatch order. Suggested mapping:

- direct exact evaluation -> `engine.exact-evaluation`;
- normalized relation -> `relation.normalize`;
- affine implication -> `order.affine-monotonicity` or
  `order.positive-scale`;
- polynomial identity -> `polynomial.identity`;
- exact inequality sign chart -> `polynomial.sturm-sign-chart`;
- quadratic-form proof -> `quadratic.psd`;
- group equation -> `group.free-reduction`;
- finite axiom check -> the relevant finite-exhaustion certificate.

Keep `method: 'proved'` for compatibility. `proof` explains the method without
changing the current verdict contract.

### 6. Render without re-proving

`renderResult()` and checkpoint rendering should show a compact primary rule:

```text
proved · positive scaling     ▸
```

The disclosure opens a proof panel beneath the row. The panel should traverse
the trace from its root, number displayed steps consistently, and include:

- the conclusion;
- the human rule label;
- links or indentation showing premise dependencies;
- optional concise details from `data`;
- an accessible button with `aria-expanded` and a visible focus state.

Demo routes expand proof panels by default. Normal sheets collapse them. Chain
checkpoints receive their own primary rule and trace rather than sharing one
generic explanation for the whole row. Ensure the proof panel spans the row
grid cleanly and remains readable on narrow screens.

## Recommended implementation phases

### Phase 0: Schema and safety rails

1. Add `src/lib/proof-trace.js` and the stable registry.
2. Implement trace construction, merging, limits, and validation.
3. Extend result objects with optional `proof` and `proofStatus` fields.
4. Add unit tests for valid and invalid trace graphs.
5. Confirm the entire existing test suite produces identical verdicts.

### Phase 1: Epsilon vertical slice

Instrument only what is needed to explain:

```text
ε > 0 ⊢ d(ε) > 0, where d(ε) = ε/2
```

Required work:

1. Preserve whether the input used `\\vdash`.
2. Capture the expansion of `d` before exact normalization.
3. Make the affine implication branch emit assumption, definition unfolding,
   positive scaling, and implication introduction.
4. Thread the trace through `evaluateStatement()` to the row result.
5. Add the compact rule label and disclosure panel.
6. Expand the panel by default on the epsilon-delta demo.
7. Add an integration test that asserts the ordered rule IDs and user-facing
   identifier rendering.

This is the first mergeable pull request. It proves the architecture end to
end without refactoring every solver at once.

### Phase 2: Core propositional structure — implemented

Six rules were added to the registry, each emitted by a concrete branch that
would otherwise have had no honest label: `logic.tautology`, `logic.vacuous`,
`polynomial.sign-certificate`, `polynomial.multiple`,
`order.power-monotonicity` and `relation.nonzero-scale`.

`polynomial.sign-certificate` was deliberately unspecific, because
`proveRelationBySign` did not report which strategy fired. Phase 3 split it and
retired the entry.


Instrument implication, conjunction, disjunction, equivalence, assumptions,
and transitive chains. Each composite rule should reference evidence returned
by its premises. Add demonstrations of modus ponens, conjunction, cases, and
equivalence.

Named propositions still use `definition.unfold` in this phase.

### Phase 3: Arithmetic certificates — implemented

`proveRelationBySign` and `proveImplicationBySign` now return the certificate
they produced — `{ rule, data }` — instead of a bare `true`, and the generic
`polynomial.sign-certificate` was retired: nothing emits it any more, and a
test asserts it is gone from the registry.

The seven strategies inside the sign prover map to five rules:

| Strategy | Rule |
| --- | --- |
| complete rational decision | `polynomial.sturm-sign-chart` |
| only even powers present | `polynomial.even-power` |
| quadratic with no real root | `polynomial.discriminant` |
| difference expands to zero | `polynomial.identity` |
| structural square, before or after expanding | `polynomial.even-power` |
| square recovered by factoring | `polynomial.even-power` + `data.factoredLatex` |
| positive semidefinite form | `quadratic.psd` |

`polynomial.domain-sign` covers `holdsOnDomain`, which certifies a sign on a
point, a half-line or a punctured line by different means and reports the
domain but not the technique; `data.domain` carries what is actually known.
That is the one place a finer split is still available.

Every one of these is reachable, which was checked rather than assumed —
`polynomial.discriminant` needs irrational coefficients to get past the
rational sign chart (`x² + x + π > 0`), and `quadratic.psd` needs a form that
does not factor into a visible square (`a² + b² + c² ≥ ab + bc + ca`).


Instrument exact relation normalization, affine implications, polynomial
identities, factored/power non-negativity, Sturm sign charts, and quadratic
forms. Include the precise certificate facts in structured `data`, but render a
short explanation by default.

### Phase 4: Domain lowerers — nearly implemented

Quantifier lowering and the complex fragment came first; see the status note at
the top for the recognize-and-verify approach used instead of threading records
through `lowerNode`.

Induction and the epsilon-delta predicates followed, on the observation that
the analysis pass does two quite different things and they need different
treatment. Sometimes it *decides* a predicate outright, collapsing it to `True`
— that is `ANALYSIS_CERTIFICATES`, and the trivial re-evaluation downstream
must not take the credit. Sometimes it *rewrites* one into obligations that
still have to be proved — that is `ANALYSIS_REWRITES`, and the trace concludes
about the obligations while one wrapping step carries them back to the line as
written:

- `Induct(P, n)` becomes `Base ∧ Step`, so the root is `analysis.induction`.
- `Base` and `Step` alone are *not* induction; each stands for the single
  obligation it names, so each is a `definition.unfold`.
- `cont` and `limitw` expand into the obligations the supplied delta must meet,
  which is `analysis.epsilon-delta-witness`.

Both are guarded on the expression actually changing, so a predicate the pass
left untouched claims nothing. A statement that contains a set construct but
comes through set lowering unchanged now also keeps its context — nothing was
rewritten, so the line as written is still an honest description.

Six demo rows remain opaque, and they need the original `rewrites` threading
rather than another recognizer:

- **four set-lemmas rows.** Membership expanded pointwise, power sets unfolded,
  extensionality applied — each a real transformation with no rule to name it,
  and no comparison that could verify one.
- **two rows whose top-level operator is `And` or `Implies`** over lowered
  predicates. The operands were rewritten individually, so no single rule
  describes the line; these need per-operand records.


Emit rewrite records from set theory, induction, epsilon-delta, topology, and
complex-number lowering. Compose those records with the exact downstream
solver evidence.

### Phase 5: Algebra and groups — implemented

`decideGroupEquation` replaces the boolean `proveGroupEquation` and returns the
freely reduced word both sides share, so `𝖦𝗋𝗉 ⊢ (xy)⁻¹ = y⁻¹x⁻¹` cites
`group.free-reduction` with `normalFormLatex: y^{-1}x^{-1}`. Generators are
rendered one at a time rather than concatenated first: `Id0Id1Id2` offers the
registry no word boundary to split on, and the internal names would otherwise
reach the reader. There is a regression test for exactly that.

Finite structures and topology use the same recognize-and-verify rule as
phase 4. `lowerNode` in `analysis.js` dispatches on the top-level operator, so
when the whole statement collapses to `True` or `False` it was that operator's
branch that settled it — no other branch could have produced the literal.
`ANALYSIS_CERTIFICATES` in `engine.js` maps the operator to its rule, and the
truth-literal check is what makes the inference safe: `OpenIn` over a discrete
topology lowers to a subset relation rather than a literal, fails the check,
and stays opaque.

Counts followed, but only the honest half. `algebraCarrierSize()` reports the
size of the carrier the predicate was handed, read the same way the checker
reads it — so `Grp(G, m, 0)` records `carrier: 4` and the panel says "over 4
elements". The *number of assignments* is still not reported, and deliberately:
that would mean re-deriving what each axiom does, and a count computed
differently from the one that actually ran is worse than none. The topology
checkers report no count for the same reason.


Add summarized finite exhaustive certificates and free-group word-reduction
steps. Record counts and relevant reduced words. Do not generate one display
node per enumerated assignment.

### Phase 6: Genuine named lemmas

Only after the trace system is stable, consider making a named lemma a theorem
reference instead of a macro. That requires:

- storing the proof/dependencies of the named statement;
- invalidating dependents when an earlier definition changes;
- preventing cyclic dependencies;
- distinguishing an assumed statement from a proved theorem;
- checking the instantiated conclusion at each application.

Until that exists, the UI must say “unfold definition” rather than “apply
lemma.” This keeps named lemmas definable without piling theorem buttons into
the keyboard.

## File-by-file handoff

- `src/lib/proof-trace.js` — new schema, registry, builder, merge and validation
  helpers, and trace size limits.
- `src/lib/identifiers.js` — preserve a `sourceKind` hint before `\\vdash`
  normalization and expose safe identifier restoration for trace LaTeX.
- `src/lib/engine.js` — return named/function expansion records, carry trace
  metadata through `evaluateStatement()`, and restore user identifiers at the
  engine boundary.
- `src/lib/decide.js` — replace bare successful booleans with evidence-bearing
  internal results; compose logical rules; return the winning branch trace.
- `src/lib/analysis.js` — make analysis lowering return rewrite evidence.
- `src/lib/sets.js` — make set lowering return rewrite evidence.
- `src/lib/algebra.js` — emit finite-model certificate summaries.
- `src/lib/group-word.js` — emit reduction steps and the final normal form.
- `src/lib/polynomial.js`, `src/lib/rational-polynomial.js`,
  `src/lib/quadratic-form.js`, `src/lib/complex-proof.js` — emit their exact
  certificate or rewrite fragments at the branch that succeeds.
- `src/main.js` — render primary-rule summaries and accessible proof
  disclosures for rows and checkpoints.
- `src/styles.css` — add proof-panel layout, dependency indentation, focus, and
  mobile behavior.
- `src/lib/demos.js` — mark curated demos to expand traces by default and add
  rule-focused examples.
- `test/*.test.mjs` — assert trace graphs and invariants alongside existing
  verdict checks.

Avoid a broad boolean-to-object rewrite in one commit. Add adapters at module
boundaries, migrate one prover family at a time, and remove the adapters after
all callers use the evidence-bearing shape.

## Test strategy

### Unit tests

- registry IDs are unique and every emitted ID is registered;
- trace graphs have one valid root, no missing references, and no cycles;
- merge/remap helpers do not collide step IDs;
- depth and size limits produce an honest summarized node;
- identifier restoration never displays internal `IdN` tokens.

### Prover tests

For representative statements, assert:

- the truth value is unchanged;
- `proofStatus` matches the path;
- the root rule ID is correct;
- the expected ordered rule IDs are present;
- premise references point to the required steps;
- sampling never has `proofStatus: 'available'`.

For the epsilon vertical slice, the minimum rule sequence is:

```js
[
  'logic.assumption',
  'definition.unfold',
  'order.positive-scale',
  'logic.implies-intro',
]
```

Superseded as implemented — see the status note at the top. The epsilon row is
decided by the univariate sign chart, so its actual sequence is:

```js
['definition.unfold', 'polynomial.sturm-sign-chart']
```

The sequence above remains the target for the affine implication branch, which
decides multivariable implications and is instrumented in phase 2.

Do not snapshot English paragraphs. Labels will evolve; the proof structure is
the contract.

### Demo and UI tests

- every demo row still has the expected verdict;
- proof demos expose a non-empty valid trace;
- epsilon-delta opens the proof panel by default;
- ordinary sheet rows remain collapsed;
- disclosure controls have correct `aria-expanded` state;
- chain checkpoints render separate traces;
- incomplete and undecided input renders no misleading proof UI.

### Regression commands

```bash
npm test
npm run build
npm run fuzz -- --seed 12345 --iterations 5000 --engine-iterations 500
```

Run the full fuzz budget before a release. The smaller fixed-seed command is
appropriate for each implementation phase.

## Performance and failure behavior

- Set a conservative maximum number of steps per trace and a maximum nesting
  depth in one central module.
- Deduplicate common premises when composing graph fragments.
- Store summaries for exhaustive checks: domain sizes, assignments checked,
  and the first failure or counterexample when relevant.
- If trace construction or validation fails, preserve the already established
  verdict, log the development diagnostic, and return `proofStatus: 'opaque'`.
  Proof display must never turn a proved row into an application error.
- Do not persist UI prose. If traces are later serialized into shared URLs,
  serialize versioned rule IDs and structured data.

## Acceptance checklist

- [x] Existing verdicts and demos remain unchanged.
- [x] The epsilon-delta sequent shows its definition expansion and the exact
      certificate that decided it. (Assumption, positive scaling and discharged
      implication await the affine branch in phase 2 — see the status note.)
- [x] Every displayed step came from the successful exact prover branch.
- [x] Sampled results never display a proof.
- [x] Uninstrumented exact results are labeled opaque, not assigned a guessed
      rule.
- [ ] Named propositions are described as unfolding until theorem dependency
      tracking exists.
- [x] User identifiers appear in traces; internal identifiers do not.
- [x] Rule labels come from one registry and tests use stable IDs.
- [x] Demo proof panels are expanded; ordinary sheet panels are collapsed.
- [x] Trace size is bounded and finite checks are summarized.
- [x] `npm test`, `npm run build`, and the fixed-seed fuzz run pass.

## Suggested first commit sequence

1. `proof trace schema and validation`
2. `carry opaque proof status through engine results`
3. `record sequent and function-definition source metadata`
4. `emit epsilon affine implication trace`
5. `render accessible proof trace disclosure`
6. `add epsilon trace and no-sampling-proof tests`

Each commit should preserve the existing test suite. This sequence gives Claude
clear stopping points and keeps the first implementation focused on one honest,
visible proof rather than a partially instrumented rewrite of every domain.
