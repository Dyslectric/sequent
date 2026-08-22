# Sequent

A single-line-per-row math sheet. Each line is a MathLive input; lines that have
a value show it right-aligned on the same line. A line carrying a claim is read
against everything defined above it and answered with a verdict — the shape of a
sequent, `Γ ⊨ ∀x̄. φ`, which is where the name comes from.

The main page opens as a blank sheet; open `#demo` (or use the **Demo** link in
the header) for a curated example sheet. The blank and demo sheets are saved
separately.

```bash
npm install
```

```bash
npm run dev
```

`npm test` runs the evaluation-core tests (211 cases, no browser needed).
`npm run build` emits a static bundle to `dist/` — fonts included, no network at runtime.

## Desktop

The same bundle runs as a desktop app through [Tauri](https://tauri.app), which
hosts it in the platform's own webview rather than shipping a browser of its
own — so the installer is single-digit megabytes. That webview is WebView2 on
Windows and WebKitGTK on Linux; the two are different engines, and the app
carries a fallback or two because of it.

```bash
npm run desktop
```

```bash
npm run desktop:build
```

`desktop` opens the app in a native window against the Vite dev server;
`desktop:build` produces whatever bundles the host platform supports, under
`src-tauri/target/release/bundle/`. Tauri cannot cross-compile, so each
platform is built on itself.

The desktop window is where **Ctrl+T** finally works: with no browser tab bar
to claim it, the shortcut reaches the page.

### Windows

`.msi` and an NSIS `.exe`, both around 3 MB, plus a standalone `sequent.exe`.
Building needs the Rust toolchain and the MSVC C++ build tools; running the
result needs only the WebView2 runtime, which ships with Windows 11.

### Linux

```bash
npm run desktop:build:linux
```

That runs the usual build — `.deb`, `.rpm` and an AppImage — and then adds a
plain `.tar.gz` in `bundle/tar/` for anyone who would rather not involve a
package manager. Building needs the Rust toolchain plus the WebKitGTK
development headers; on Debian or Ubuntu:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl file libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

The tarball unpacks to a single directory holding the binary, its icons, and
`install.sh`, which decides where things go from who runs it:

| | as root | as yourself |
| --- | --- | --- |
| binary | `/opt/Sequent/sequent` | `~/.local/bin/Sequent` |
| command on `PATH` | `/usr/local/bin/sequent` | the binary itself |
| desktop entry | `/usr/share/applications` | `~/.local/share/applications` |
| icons | `/usr/share/icons/hicolor` | `~/.local/share/icons/hicolor` |

`uninstall.sh` reverses whichever of the two was done. Running the app needs a
WebKitGTK runtime (`libwebkit2gtk-4.1-0` or your distribution's equivalent).

### Moving sheets between the two

`localStorage` is scoped to an origin, so a sheet written in the browser is
invisible to the desktop app and vice versa. **Export** writes the current
sheet to a JSON file and **Import** replaces the current sheet from one, which
is both the way across and the only backup a sheet otherwise has.

The two builds reach the filesystem differently. A browser tab uses an
`<a download>` blob and a hidden file input; a WebView2 window ignores both, so
the desktop build goes through Tauri's native save and open dialogs and hands
the chosen path to a pair of Rust commands in `src-tauri/src/lib.rs`. Those
commands are deliberately the entire filesystem surface — the `fs` plugin would
need a scope declared ahead of time, which cannot describe a path the user only
picks at runtime.

## On a phone

```bash
npm run serve
```

Builds are served on every network interface, not just localhost, so another
device on the network can open the sheet. The addresses are printed on start.

It also installs as a PWA — its own icon, its own window, and a service worker
that precaches the whole bundle, so once opened it works with no network at
all. The app never talks to a server at runtime anyway; this just removes the
need for one to be up.

That last part has a condition. **A service worker only registers on a secure
origin**, and `http://192.168.x.x` is not one, so over plain HTTP the sheet is
usable but not installable. To get a secure origin on a private network:

```bash
npm run cert
```

That writes a local certificate authority and a server certificate covering
every address this machine answers on, and Vite serves HTTPS from then on.
Install `certs/ca.crt` on the phone once — on Android, *Settings → Security →
Encryption & credentials → Install a certificate → CA certificate* — and the
origin becomes trusted, at which point the browser will offer to install it.

`certs/` is not tracked. Delete it to go back to plain HTTP.

The desktop build deliberately does not register a service worker: it already
carries every asset locally, so a worker would only put a staler cache in front
of files that are already on disk.

## Hosting it

The sheet is static, so hosting it is just serving files. The image is a
two-stage build — Node produces `dist/`, nginx serves it — and nothing runs
server-side.

```bash
docker build -t sequent .
```

```bash
docker run --rm -p 8080:80 sequent
```

Pushing to `main` publishes `ghcr.io/<owner>/sequent` for `linux/amd64` and
`linux/arm64`; tagging `v*` publishes the matching semver tags. The workflow
runs the test suite before it builds, and pull requests build without pushing.

### Behind Traefik

Copy `.env.example` to `.env`, set `GHCR_OWNER` and `SEQUENT_DOMAIN`, then:

```bash
docker compose pull && docker compose up -d
```

The compose file expects Traefik to already be running with a Docker provider
and a certificate resolver — it adds a routed service rather than standing up a
proxy. No ports are published; Traefik reaches the container over the shared
external network.

Serving it this way also settles the PWA question from the previous section for
good: a real certificate on a real domain is a secure origin everywhere, so the
service worker registers and the app installs with no local CA to trust.

Two details in `docker/nginx.conf` that matter more than they look. Assets are
content-hashed and served `immutable` for a year, while `index.html`, `sw.js`
and the manifest always revalidate — caching those three is exactly how a PWA
gets permanently stuck on an old build. And the bundle is precompressed at
build time and served with `gzip_static`, rather than gzipping 3.3 MB per
visitor.

## What a line can be

| Input | Result |
| --- | --- |
| numeric expression | its value — `2/3 + 5/6` → `3/2` |
| numeric equation or inequality | `true` / `false` — `1/3 + 1/6 = 1/2` → true |
| equivalence of relations | `true` / `false` — `x > 2 ⟺ 2x > 4` → true |
| implication of relations | `true` / `false` — `x² = 4 ⟹ x = 2` → false, counterexample `x = -2` |
| logical proposition | `true` / `false` — `x > 0 ∨ x < 0 ⟺ x ≠ 0` → true |
| constant definition | no value, just a confirmation badge |
| function definition | no value, just a confirmation badge |

Numbers work over ℕ/ℤ/ℚ/ℝ/ℂ. Rationals and surds stay exact (`√8` → `2√2`); the
**Decimal** toggle switches to decimal output. `i` is the imaginary unit, and
`floor`, `ceil`, `round`, `Re` and `Im` are available (type their names, or use
the on-screen keys, or write `⌊ ⌋` / `⌈ ⌉`).

## Typing

- **Enter** starts a new line. **Backspace** on an empty line removes it. Arrow
  keys move between lines.
- **Alt+T** switches into the serif text channel and back; so does the **abc**
  key, and typing `\text{`. **`}`** leaves it.
  *Ctrl+T is bound too, and works in the desktop app, which has no tab bar to
  claim it. In an ordinary browser tab Ctrl+T is reserved for "new tab" and
  never reaches the page; Alt+T is the combination that works there.*
- **`_`** subscripts. A subscript is part of the name (`v_max` is one variable),
  and is formatted independently of its base — `v` stays math-italic while a
  serif subscript stays serif.
- Type `and`, `or`, or `not` in math mode (or use the `∧`, `∨`, and `¬` keys)
  for logical connectives. Parentheses group propositions. Precedence is
  `¬`, then `∧`, then `∨`, then `⟹`, then `⟺`.

### Names

Single roman or greek letters, upper or lower case, are names in the math font:
`x`, `θ`, `Γ`. Anything longer goes in the serif text channel: `\text{maxSpeed}`,
`\text{max-speed}`, `\text{max_speed}`, `\text{PascalCase}`. This is also what
makes underscore-separated names possible — inside text `_` is a literal
underscore, outside it it means "subscript".

`i`, `e` and `π` keep their built-in meanings and cannot be redefined.

### Definitions

`=` is read as a definition when the left side is a name not yet in use:

```
gravity = 9.81                 constant
kineticEnergy(m, v) = ½mv²     function (arguments must be distinct fresh names)
```

Anything else with `=` is an equation to test — including `f(3) = 9`, and
including a second `gravity = 9.81` once the name is taken. Use `:=` to force
the definition reading. Definitions apply downward: a line sees the definitions
above it, and everything is recomputed top-to-bottom on every edit.

Once a name is defined, expressions using it become numeric. Where an
undefined name remains, the line stays algebraic and reports which name is missing.

### Chains

`a = b = c`, `a < b ≤ c`, and `x > 2 ⟺ 2x > 4 ⟺ 3x > 6` chain
conjunctively — every neighbouring pair must hold, so a chain of equalities or
equivalences means "all of these say the same thing". The same applies to `⟹`.

In the editor, typing a second top-level `=`, inequality, `⟺`, or `⟹` lays out
the chain as one multiline expression. The first link stays on the first visual
row and each later operator wraps beneath it, aligned with the first operator.
Mixed strict/non-strict inequalities retain their actual symbols. The caret
remains after the newest operator so the next step can be entered. This is only
a visual layout: the complete chain remains one logical sheet line. Operators
inside parentheses do not trigger the multiline layout.

Each visual row has its own cumulative truth checkpoint. The first verdict
covers the chain through the first connective, the second covers everything
through the second connective, and so on. While a new trailing step is still
empty, completed checkpoints above it keep their verdicts.

Mixing `⟺` and `⟹` on one line falls back to standard precedence (`⟺` binds
loosest), so `A ⟺ B ⟹ C` reads `A ⟺ (B ⟹ C)`. Put such lines on separate rows
if you meant a chain.

Logical connectives compose with relations and implications: for example,
`x > 0 ∧ x < 2 ⟹ x² < 4`, `x ≥ 0 ∨ x ≤ 0`, and
`¬(x = 0) ⟺ x ≠ 0` are all proved exactly.

## How truth is decided

Statements with free variables go through three passes:

1. **Symbolic.** The CAS ([Compute Engine](https://cortexjs.io/compute-engine/))
   is asked to decide it outright, then each relation is normalised to `p ▷ 0`
   and the connective is attacked directly:

   - **Affine consequents.** If the consequent's polynomial is `c·p + k` for
     constants `c` and `k`, the implication reduces to a sign test on `c` and
     `k`, from the interval `q` covers while the antecedent holds. This proves
     `x > 2 ⟹ x > 1` (offset `+1`, non-negative), `2x > 4 ⟹ x > 1`
     (`c = ½`), `x ≥ 3 ⟹ x > 2` (strict, because the offset is strictly
     positive), and `x > 2 ⟹ -3x < -6` (negative scaling flips the relation).
   - **Multiples.** `p = 0 ⟹ q = 0` when `p` divides `q` exactly, which proves
     `x = 2 ⟹ x² = 4`. The quotient must come back free of division by an
     unknown, or the identity would be vacuous.
   - **Exact polynomial sign charts.** For single-variable polynomials with
     rational coefficients, Sturm sequences isolate every real root using
     exact integer/rational arithmetic. Testing each root and each interval
     between roots completely decides the full Boolean proposition, including
     `∧`, `∨`, and `¬`. This covers bounded or
     disconnected domains (`x² < 4 ⟹ x < 3`, `x² > 4 ⟹ x⁴ > 16`), equations
     with several roots (`x² = 1 ⟹ x⁴ = 1`), and nonlinear equivalences
     (`x² > 1 ⟺ x⁴ > 1`) while respecting strict endpoints.
   - **Equivalence** is implication both ways, so `x + 1 = 2 ⟺ x = 1` and
     `x > 2 ⟺ 2x > 4` follow from the same machinery.
   - **Chains** are proved link by link.

   `c` and `k` are *guessed* by evaluating at two points and then **verified
   symbolically** — two points also fit a line through a parabola, and the
   verification throws that out.

   The affine test treats `p` as ranging over its whole interval, which can be
   wider than the values `p` really takes (`x²` is never negative). A wider
   range only ever withholds a proof; it cannot grant a false one.
2. **Exact.** The sign chart above is a *decision* procedure, not just a prover,
   so where it applies it settles **false** as well as true, and it runs before
   any sampling. This matters because the point where such a statement fails is
   routinely one no sampler visits: `4x² + 2x - 2 > 0 ⟹ -3x + 2 ≠ 0` is false at
   the single value `x = ⅔` and true everywhere else. Sampling would report it
   as true; the sign chart reports it false, with `x = ⅔` as the witness.

   The witness is read back out of the isolating interval by narrowing it and
   testing the simplest rational inside, which converges on a rational root and
   never on an irrational one. So a statement failing only at an irrational
   point is still reported false, just without a witness to show for it.
3. **Numeric.** Otherwise the free variables are sampled — small integers, exact
   rationals, irrationals, and points adjacent to the constants in the statement,
   which is where inequality boundaries sit.

The result says which pass answered:

- `proved` — established symbolically, exactly.
- `counterexample: x = -2` — **false**, with a witness. These are reliable.
- `disproved` — **false**, decided exactly, but the point where it fails is
  irrational and has no exact form to display.
- `no counterexample in N samples` — **true so far**. This is not a proof; it is
  the honest answer for statements the CAS cannot close, and a statement that
  fails only on a narrow interval the sampler misses would be reported this way.
  Nothing the exact pass can reach ends up here.
- `undecided` — nothing conclusive.

Sampling is deterministic, so the same sheet always gives the same verdict.

## Layout of the code

| File | Role |
| --- | --- |
| `src/lib/identifiers.js` | rewrites user names to parser-safe symbols, and back |
| `src/lib/engine.js` | classifies each line, applies definitions, formats results |
| `src/lib/decide.js` | the symbolic + sampling decision procedure |
| `src/lib/polynomial.js` | polynomial sign certificates and exact sign-chart routing |
| `src/lib/rational-polynomial.js` | exact rational arithmetic, Sturm root isolation, sign charts |
| `src/lib/top-level.js` | brace-aware operator splitting, and the multiline chain layout |
| `src/lib/mathfield.js` | MathLive shortcuts, keybindings, docked keyboard |
| `src/main.js` | rows, navigation, theme, persistence, export/import |
| `src-tauri/` | the Tauri desktop shell — window config, icons, Rust entry point |
| `scripts/` | Linux packaging, its install scripts, and the local-HTTPS certificate generator |
| `public/` | PWA icons, copied to the build root |
| `Dockerfile`, `docker/` | the static nginx image and its cache and compression rules |
| `.github/workflows/` | tests, then a multi-arch image published to GHCR |

The identifier layer exists because Compute Engine's LaTeX parser splits letter
runs into implicit products (`maxSpeed` → `m·a·x·S·p·e·e·d`) and because some
display commands collide with builtins (`\Gamma` is the gamma function). Every
name is interned and rewritten to `\mathrm{Id7}` — or `\operatorname{Id7}` when
applied to arguments — before parsing, and rewritten back for display.

## Known limits

- A `true` from the sampling pass is evidence, not proof (see above).
- The prover is complete for single-variable polynomial implications and
  equivalences when all coefficients are rational (up to its degree and
  resource limits), as well as for linear relations in several variables.
  Irrational-coefficient and multivariable nonlinear cases use sound shape
  certificates where available and otherwise fall back to sampling.
- Inside the serif channel `}` exits text mode, so a literal `}` cannot be typed
  there.
- The sheet is stored in `localStorage`; it is not shared between browsers.
