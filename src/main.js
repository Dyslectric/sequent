import 'mathlive';
import 'mathlive/static.css';
import { MathfieldElement, convertLatexToMarkup } from 'mathlive';
import './styles.css';

import { Sheet } from './lib/engine.js';
import {
  configureMathfield,
  fillEmptyMatrixCells,
  matrixResizeAllowed,
  setupVirtualKeyboard,
} from './lib/mathfield.js';
import {
  flattenTopLevelChain,
  formatTopLevelChain,
  getTopLevelChainCheckpoints,
  isFormattedTopLevelChain,
} from './lib/top-level.js';
import { parseSheetStateHash, serializeSheetState } from './lib/url-state.js';
import { DEFAULT_DEMO_ID, DEMOS, demoById } from './lib/demos.js';
import { isSummarized, ruleLabel } from './lib/proof-trace.js';
import { stepTrustLabel, trustSummary } from './lib/kernel.js';

// Fonts arrive through `mathlive/static.css`, which Vite bundles; stop MathLive
// from also fetching them (and its sounds) at runtime.
MathfieldElement.fontsDirectory = null;
MathfieldElement.soundsDirectory = null;

const STORAGE_PREFIX = 'sequent/v2';
const LEGACY_STORAGE_PREFIX = 'expression-calculator/v2';


const sheetEl = document.getElementById('sheet');
const dockEl = document.getElementById('keyboard-dock');
const engine = new Sheet();

const state = {
  page: 'sheet',
  demoId: DEFAULT_DEMO_ID,
  lines: [''],
  display: 'exact',
  theme: 'light',
  keyboardCollapsed: false,
};

/** One entry per visible line. */
const rows = [];

/* ------------------------------ persistence ------------------------------ */

function pageFromHash() {
  return /^#demo(?:=|$)/i.test(location.hash) ? 'demo' : 'sheet';
}

function demoIdFromHash() {
  const requested = /^#demo=([a-z0-9-]+)$/i.exec(location.hash)?.[1];
  return demoById(requested).id;
}

function storageKey(page) {
  return `${STORAGE_PREFIX}/${page}`;
}

/** A stored sheet holding no actual work: absent, unreadable, or all blank lines. */
function isBlankSheet(raw) {
  if (raw === null) return true;
  try {
    const { lines } = JSON.parse(raw) ?? {};
    return !Array.isArray(lines) || lines.every((line) => !String(line ?? '').trim());
  } catch {
    return true;
  }
}

/**
 * Carry sheets over from the key the app used under its previous name.
 *
 * The target must be blank to be overwritten — not merely absent. Simply
 * opening the app under the new name saves an empty sheet, and testing for
 * absence alone would let that empty sheet permanently shadow the real one.
 *
 * The old entry is deliberately left behind rather than deleted: it costs
 * nothing and it is the only copy of anything saved before the rename.
 */
function migrateLegacyStorage() {
  try {
    // Demo content is curated and deliberately rebuilt on every load; only a
    // user's working sheet needs content migration.
    for (const page of ['sheet']) {
      const legacy = localStorage.getItem(`${LEGACY_STORAGE_PREFIX}/${page}`);
      if (!isBlankSheet(legacy) && isBlankSheet(localStorage.getItem(storageKey(page)))) {
        localStorage.setItem(storageKey(page), legacy);
      }
    }
  } catch { /* unavailable; there is nothing to migrate into either */ }
}

function load(page = pageFromHash()) {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(storageKey(page)) ?? 'null');
  } catch { /* corrupt or unavailable; fall back to defaults */ }

  const urlState = page === 'sheet' ? parseSheetStateHash(location.hash) : null;
  const savedLines = urlState?.lines
    ?? (page !== 'demo' && Array.isArray(stored?.lines) && stored.lines.length ? stored.lines : null);
  const selectedDemo = demoById(page === 'demo' ? demoIdFromHash() : DEFAULT_DEMO_ID);
  state.page = page;
  state.demoId = selectedDemo.id;
  state.lines = page === 'demo' ? [...selectedDemo.lines] : (savedLines ?? ['']);
  state.display = urlState?.display ?? (stored?.display === 'decimal' ? 'decimal' : 'exact');
  state.theme = stored?.theme
    ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  state.keyboardCollapsed = stored?.keyboardCollapsed === true;
}

function syncSheetUrl() {
  if (state.page !== 'sheet') return;
  const hash = serializeSheetState(state);
  if (location.hash === hash) return;
  history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
}

function save(options = {}) {
  try {
    const saved = {
      display: state.display,
      theme: state.theme,
      keyboardCollapsed: state.keyboardCollapsed,
    };
    // Demos are curated showcases, not working documents. Preserve their UI
    // preferences, but rebuild their lines from the selected demo on every load.
    if (state.page !== 'demo') saved.lines = state.lines;
    localStorage.setItem(storageKey(state.page), JSON.stringify(saved));
  } catch { /* private mode; the sheet just will not persist */ }
  // URL state is independent of localStorage and still works in private mode.
  if (options.updateUrl !== false) syncSheetUrl();
}

/* ----------------------------- export / import ---------------------------- */

/**
 * `localStorage` is scoped to an origin, so a sheet written in the browser is
 * invisible to the desktop build and vice versa. A file is the way across —
 * and the only backup the sheet otherwise has.
 */
const EXPORT_KIND = 'sequent.sheet';

const JSON_FILTER = [{ name: 'Sequent sheet', extensions: ['json'] }];

/**
 * True inside the Tauri desktop shell.
 *
 * It matters because a WebView2 window is not a browser tab: it ignores the
 * `<a download>` blob trick entirely, so saving there has to go through the
 * native dialog and a Rust command instead.
 */
function isDesktop() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function sheetPayload() {
  return JSON.stringify({
    kind: EXPORT_KIND,
    version: 1,
    page: state.page,
    lines: state.lines,
  }, null, 2);
}

function downloadInBrowser(filename, contents) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking straight away cancels the transfer in some browsers, which write
  // the file asynchronously after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function exportSheet() {
  const filename = `sequent-${state.page}.json`;
  const contents = sheetPayload();

  if (!isDesktop()) {
    downloadInBrowser(filename, contents);
    return;
  }

  const { save } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');
  const path = await save({ defaultPath: filename, filters: JSON_FILTER });
  if (path === null) return;

  try {
    await invoke('write_text_file', { path, contents });
  } catch (error) {
    showStatus(`Could not write that file: ${error}`, { error: true });
  }
}

/** The lines out of an exported file, or null when it is not one of ours. */
function linesFromExport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed?.kind !== EXPORT_KIND || !Array.isArray(parsed.lines)) return null;
  return parsed.lines.every((line) => typeof line === 'string') ? parsed.lines : null;
}

/** Replace the sheet from an export. `name` is only used to report a bad file. */
function applyImport(name, text) {
  const lines = text === null ? null : linesFromExport(text);
  if (!lines) {
    showStatus(`${name} is not a Sequent sheet export.`, { error: true });
    return;
  }
  hideStatus();
  // An exported empty sheet still needs one row to type into.
  buildSheet(lines.length ? lines : ['']);
  focusRow(rows.length - 1, 'end');
}

/** Browser path: a File from the hidden `<input type="file">`. */
async function importSheetFile(file) {
  let text = null;
  try {
    text = await file.text();
  } catch { /* unreadable; reported as a bad file */ }
  applyImport(file.name, text);
}

/** Desktop path: the native open dialog, then a read over the Rust command. */
async function importSheetFromDialog() {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');
  const path = await open({ multiple: false, directory: false, filters: JSON_FILTER });
  if (typeof path !== 'string') return;

  let text = null;
  try {
    text = await invoke('read_text_file', { path });
  } catch { /* unreadable; reported as a bad file */ }
  applyImport(path, text);
}

/* --------------------------------- status --------------------------------- */

const statusEl = document.getElementById('app-status');
let statusHandle = 0;

/**
 * Report something that went wrong, in the page.
 *
 * `window.alert` is a no-op inside a WebKitGTK webview, which is the engine
 * behind the Linux desktop build — a message posted that way would simply never
 * appear. Everything here has to work without the host offering a dialog.
 */
function showStatus(message, { error = false } = {}) {
  clearTimeout(statusHandle);
  statusEl.innerHTML = `<span class="app-status-body">${escapeHtml(message)}</span>`;
  statusEl.classList.toggle('is-error', error);
  statusEl.hidden = false;
  statusHandle = setTimeout(hideStatus, 8000);
}

function hideStatus() {
  clearTimeout(statusHandle);
  statusEl.hidden = true;
}

/**
 * Install the service worker, so the sheet keeps working with no network.
 *
 * Skipped in the desktop build, which already carries its own copy of every
 * asset — a worker there would only add a second, staler cache in front of
 * files that are already local. Browsers only allow this on a secure origin,
 * which over a plain LAN address means it simply does not run; the app is
 * unaffected either way, it just is not installable.
 */
async function registerServiceWorker() {
  if (isDesktop() || !('serviceWorker' in navigator)) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  } catch { /* not built with the plugin, or blocked; the sheet works regardless */ }
}

/**
 * `scrollbar-gutter` is what keeps the header and the sheet centred on one
 * axis. Where the engine does not implement it, reserve the same space by hand:
 * measure the scrollbar once and let the stylesheet apply it as padding.
 */
function applyScrollbarGutterFallback() {
  if (CSS.supports?.('scrollbar-gutter', 'stable both-edges')) return;

  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;overflow-y:scroll;width:100px;height:100px';
  document.body.append(probe);
  const width = probe.offsetWidth - probe.clientWidth;
  probe.remove();

  document.documentElement.style.setProperty('--gutter-fallback', `${width}px`);
  document.documentElement.classList.add('no-scrollbar-gutter');
}

/* -------------------------------- rendering ------------------------------- */

function math(latex) {
  try {
    return `<span class="math">${convertLatexToMarkup(latex)}</span>`;
  } catch {
    return `<span class="math">${escapeHtml(latex)}</span>`;
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

function describeVerdict(result) {
  if (result.method === 'proved') return 'proved';
  // Exactly false, but at a point with no exact display form — an irrational
  // root. There is nothing to show alongside the verdict.
  if (result.method === 'disproved') return 'disproved';
  if (result.method === 'sampled') return `no counterexample in ${result.samples} samples`;
  if (result.method === 'counterexample') {
    const parts = result.counterexample.map((c) => `${c.nameLatex} = ${c.valueLatex}`);
    return `counterexample: ${parts.join(', ')}`;
  }
  if (result.undefinedNames?.length) return `undecided for ${result.undefinedNames.join(', ')}`;
  return 'undecided';
}

/**
 * The same note as markup, so a counterexample renders as math rather than as
 * the LaTeX behind it. Witnesses are frequently fractions — `x = \frac{2}{3}`
 * is not something to show a reader verbatim.
 */
function verdictNoteHtml(result) {
  if (result.method !== 'counterexample') return escapeHtml(describeVerdict(result));
  const parts = result.counterexample.map((c) => `${math(c.nameLatex)} = ${math(c.valueLatex)}`);
  return `counterexample: ${parts.join(', ')}`;
}

/** A proof is offered only where the prover actually built one. */
function hasProof(result) {
  return result?.kind === 'truth' && result.proofStatus === 'available' && Boolean(result.proof);
}

function primaryRule(proof) {
  return ruleLabel(proof.steps.find((step) => step.id === proof.root)?.rule);
}

/** Concise facts from a step's `data`; the full record stays in the result. */
function proofDetail(step) {
  const data = step.data ?? {};
  const bits = [];
  if (data.variableLatex) bits.push(`in ${math(data.variableLatex)}`);
  // A unit scale or a zero offset is what the rule already implies; only the
  // number that did the work is worth the reader's attention.
  if (data.scaleLatex && data.scaleLatex !== '1') bits.push(`by ${math(data.scaleLatex)}`);
  if (data.offsetLatex && data.offsetLatex !== '0') bits.push(`offset ${math(data.offsetLatex)}`);
  if (Number.isFinite(data.exponent)) bits.push(`power ${data.exponent}`);
  if (Number.isFinite(data.carrier)) bits.push(`over ${data.carrier} elements`);
  // The integer root test says which way it came out, since the rule alone
  // does not: a radicand that is an exact power and one that is not are the
  // same rule with opposite answers.
  if (data.radicandLatex) {
    const radical = data.indexLatex === '2'
      ? `\\sqrt{${data.radicandLatex}}`
      : `\\sqrt[${data.indexLatex}]{${data.radicandLatex}}`;
    bits.push(data.rootLatex
      ? `${math(radical)} = ${math(data.rootLatex)}`
      : `${math(radical)} is not an integer`);
  }
  // Primality names the witness that settled it, since the rule covers both
  // answers: a divisor ends the question, and a primitive root of full order
  // is the whole content of a Pratt certificate.
  if (data.factorLatex) bits.push(`divisible by ${math(data.factorLatex)}`);
  if (Array.isArray(data.prattLatex) && data.prattLatex.length) {
    const target = data.prattLatex.at(-1);
    if (target?.rootLatex) {
      const order = BigInt(target.numberLatex) - 1n;
      bits.push(`${math(target.rootLatex)} has order ${math(String(order))}`);
    }
    if (data.prattLatex.length > 1) bits.push(`${data.prattLatex.length - 1} primes below it`);
  }
  if (isSummarized(step)) bits.push(`${data.omittedSteps} steps not shown`);
  return bits.length ? ` <span class="proof-detail">(${bits.join('; ')})</span>` : '';
}

/**
 * The trace, numbered in the order its steps were established.
 *
 * Steps arrive in dependency order, so the array index is a stable display
 * number and a premise can be cited as the number the reader already saw.
 */
function proofPanelHtml(proof) {
  const numberOf = new Map(proof.steps.map((step, index) => [step.id, index + 1]));
  const items = proof.steps.map((step) => {
    const from = step.premises.length
      ? `<span class="proof-from">from ${step.premises.map((id) => numberOf.get(id)).join(', ')}</span>`
      : '';
    // Whether the kernel re-derived this step or merely believed it is the
    // most important thing on the line, so it sits beside the rule that
    // claimed it.
    const trust = `<span class="proof-trust trust-${step.trust ?? 'axiom'}"`
      + `${step.trustNote ? ` title="${escapeHtml(step.trustNote)}"` : ''}>`
      + `${escapeHtml(stepTrustLabel(step))}</span>`;
    return [
      '<li class="proof-step">',
      `<span class="proof-claim">${math(step.conclusionLatex)}</span>`,
      `<span class="proof-rule">${escapeHtml(ruleLabel(step.rule))}${proofDetail(step)}</span>`,
      trust,
      from,
      '</li>',
    ].join('');
  });
  return `<ol class="proof-steps">${items.join('')}</ol>`;
}

function applyProofOpen(entry) {
  const toggle = entry.result.querySelector('.proof-toggle');
  const open = entry.proofOpen === true;
  entry.proof.hidden = !open;
  if (toggle) {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.querySelector('.proof-caret').textContent = open ? '▾' : '▸';
  }
}

/**
 * Fill the row's proof panel. Expanding only displays evidence the prover
 * already returned — nothing here re-proves anything.
 */
function renderProof(entry, result) {
  if (!hasProof(result)) {
    entry.proofOpen = undefined;
    entry.proof.hidden = true;
    entry.proof.innerHTML = '';
    return;
  }
  entry.proof.innerHTML = proofPanelHtml(result.proof);
  // Demonstrations are guided proofs, so they open expanded. An ordinary
  // sheet stays compact until the reader asks.
  if (entry.proofOpen === undefined) entry.proofOpen = state.page === 'demo';
  applyProofOpen(entry);
}

function renderResult(el, result, options = {}) {
  el.innerHTML = '';
  el.title = '';

  switch (result.kind) {
    case 'empty':
      return;

    case 'value': {
      const useDecimal = state.display === 'decimal' && result.approxLatex;
      const primary = useDecimal ? result.approxLatex : result.exactLatex;
      const secondary = useDecimal ? null : result.approxLatex;
      el.innerHTML = [
        secondary ? `<span class="result-secondary">&#8776; ${escapeHtml(secondary)}</span>` : '',
        `<span class="result-primary result-value">= ${math(primary)}</span>`,
      ].join('');
      return;
    }

    case 'symbolic': {
      const names = result.undefinedNames;
      el.innerHTML = [
        names.length ? `<span class="result-note">undefined: ${escapeHtml(names.join(', '))}</span>` : '',
        `<span class="result-primary result-symbolic">${math(result.latex)}</span>`,
      ].join('');
      el.title = names.length
        ? `Still algebraic — no value until ${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} defined.`
        : 'No numeric value.';
      return;
    }

    case 'set': {
      const names = result.undefinedNames;
      el.innerHTML = [
        names.length ? `<span class="result-note">undefined: ${escapeHtml(names.join(', '))}</span>` : '',
        `<span class="result-primary result-value">= ${math(result.latex)}</span>`,
      ].join('');
      el.title = names.length
        ? `Set expression still depends on ${names.join(', ')}.`
        : 'Exact set value.';
      return;
    }

    case 'truth': {
      const note = describeVerdict(result);
      const pill = result.value === true ? 'pill-true' : result.value === false ? 'pill-false' : 'pill-unknown';
      const label = result.value === true ? 'true' : result.value === false ? 'false' : 'unknown';
      // Where a derivation exists the verdict reports what the proof rests on
      // — the weakest step in it — and becomes the control that reveals the
      // steps. The rule that finished the proof moves to the tooltip: what a
      // reader most needs to know at this width is how much was taken on
      // trust, not which procedure happened to run.
      const offerProof = options.allowProof && hasProof(result);
      const summary = offerProof
        ? `<button type="button" class="proof-toggle" aria-expanded="false">`
          + `proved &middot; ${escapeHtml(trustSummary(result.proof))}`
          + ` <span class="proof-caret" aria-hidden="true">&#9656;</span></button>`
        : `<span class="result-note">${verdictNoteHtml(result)}</span>`;
      el.innerHTML = [summary, `<span class="pill ${pill}">${label}</span>`].join('');
      el.title = offerProof ? `${note} — ${primaryRule(result.proof)}` : note;
      return;
    }

    case 'definition': {
      // Definitions have no value; the badge just confirms the name landed.
      // Detail (arity, body) goes in the tooltip so narrow rows stay readable.
      const label = result.what === 'set'
        ? `${result.name} set defined`
        : result.proposition
          ? `${result.name} ${result.what === 'function' ? 'predicate' : 'proposition'} defined`
          : `${result.name} defined`;
      el.innerHTML = `<span class="pill pill-definition">${escapeHtml(label)}</span>`;
      el.title = result.what === 'function'
        ? `${result.name}(${result.paramsLatex.join(', ')}) defined as ${result.valueLatex}`
        : `${result.name} defined as ${result.valueLatex}`;
      return;
    }

    case 'error':
      el.innerHTML = `<span class="result-error">${escapeHtml(result.message)}</span>`;
      el.title = result.message;
      return;

    default:
      return;
  }
}

function renderCheckpointResults(el, results, checkpointCount) {
  el.innerHTML = '';
  el.title = '';
  el.classList.add('is-chain');

  for (let index = 0; index < checkpointCount; index++) {
    const step = document.createElement('div');
    step.className = 'chain-result-step';
    if (results[index]) renderResult(step, results[index]);
    el.append(step);
  }
}

/* --------------------------------- rows ---------------------------------- */

/**
 * Offer the row and column keys only where they are safe.
 *
 * Resizing a grid that already holds entries throws them away, so the keys are
 * greyed out unless the line's grids are still blank templates. The state
 * lives on the dock, and the keycaps carry `matrix-resize`, so this is one
 * class toggle rather than a rebuild of the keyboard.
 */
function syncMatrixResizeKeys(field) {
  dockEl.classList.toggle('matrix-locked', !matrixResizeAllowed(field?.value ?? ''));
}

/** The field the reader is editing, so the keyboard can act on it. */
let focusedField = null;

/**
 * `addColumnAfter` leaves its new cells empty rather than placeholders, so the
 * column appears as a gap with nothing to click. Fill them in once MathLive
 * has finished, and put the caret in the first one — which is where someone
 * who just asked for a column wants to be typing.
 */
function repairResizedMatrix() {
  const field = focusedField;
  if (!field) return;
  queueMicrotask(() => {
    const filled = fillEmptyMatrixCells(field.value);
    if (filled === field.value) return;
    field.setValue(filled);
    field.executeCommand('moveToNextPlaceholder');
    syncMatrixResizeKeys(field);
  });
}

function createRow(latex) {
  const row = document.createElement('div');
  row.className = 'row';

  const gutter = document.createElement('div');
  gutter.className = 'row-gutter';

  const field = new MathfieldElement();
  field.className = 'row-input';
  field.dataset.pendingValue = latex ?? '';

  const result = document.createElement('div');
  result.className = 'row-result';

  // Wraps onto its own line beneath the row, so a derivation can use the full
  // width without narrowing the field being edited.
  const proof = document.createElement('div');
  proof.className = 'row-proof';
  proof.hidden = true;

  row.append(gutter, field, result, proof);

  const entry = { row, field, result, gutter, proof, proofOpen: undefined, visualChainLinks: 0 };

  result.addEventListener('click', (event) => {
    if (!event.target.closest('.proof-toggle')) return;
    entry.proofOpen = !entry.proofOpen;
    applyProofOpen(entry);
  });

  field.addEventListener('input', () => {
    syncMatrixResizeKeys(field);
    const at = rows.indexOf(entry);
    if (at < 0) return;
    const raw = field.value;
    const linear = flattenTopLevelChain(raw);
    const layout = formatTopLevelChain(linear);
    state.lines[at] = linear;

    if (layout && layout.links !== entry.visualChainLinks) {
      field.setValue(layout.latex, {
        selectionMode: layout.trailing ? 'placeholder' : 'after',
        silenceNotifications: true,
      });
      entry.visualChainLinks = layout.links;
    } else if (!layout && isFormattedTopLevelChain(raw)) {
      // Removing one of the structural arrows returns the field to a normal
      // inline expression instead of leaving a malformed aligned environment.
      field.setValue(linear, { selectionMode: 'after', silenceNotifications: true });
      entry.visualChainLinks = 0;
    }
    scheduleRecompute();
  });

  field.addEventListener('focusin', () => {
    row.classList.add('is-focused');
    focusedField = field;
    syncMatrixResizeKeys(field);
  });
  field.addEventListener('focusout', () => {
    row.classList.remove('is-focused');
  });

  // Enter splits the sheet; Backspace on an empty line removes it. Both run in
  // the capture phase so MathLive's own handling never sees them.
  field.addEventListener('keydown', (event) => {
    const at = rows.indexOf(entry);
    if (at < 0) return;

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      insertRow(at + 1, '');
      return;
    }

    if (event.key === 'Backspace' && field.value === '' && at > 0) {
      event.preventDefault();
      event.stopPropagation();
      removeRow(at);
    }
  }, { capture: true });

  // MathLive commits on Return by firing `change`. The keydown handler above
  // normally intercepts Return first, so this only runs where the keydown never
  // arrives with a usable `key`. `change` also fires on blur, hence hasFocus().
  field.addEventListener('change', () => {
    if (!field.hasFocus()) return;
    const at = rows.indexOf(entry);
    if (at >= 0) insertRow(at + 1, '');
  });

  // Arrow keys leaving the top or bottom of a field move between lines.
  field.addEventListener('move-out', (event) => {
    const at = rows.indexOf(entry);
    const direction = event.detail?.direction;
    const target = (direction === 'upward' || direction === 'backward') ? at - 1 : at + 1;
    if (!rows[target]) return;
    // Cancellable: without this MathLive also moves focus, past our target.
    event.preventDefault();
    focusRow(target, target < at ? 'end' : 'start');
  });

  return entry;
}

/** MathLive rejects configuration until the element is in the document. */
function mountRow(entry) {
  const { field } = entry;
  configureMathfield(field);
  const linear = field.dataset.pendingValue ?? '';
  const layout = formatTopLevelChain(linear);
  if (layout) {
    field.setValue(layout.latex, { selectionMode: 'after', silenceNotifications: true });
    entry.visualChainLinks = layout.links;
  } else {
    field.value = linear;
  }
  delete field.dataset.pendingValue;
}

function renumber() {
  rows.forEach((entry, index) => {
    entry.gutter.textContent = String(index + 1);
  });
}

function insertRow(index, latex, options = {}) {
  const entry = createRow(latex);
  rows.splice(index, 0, entry);
  state.lines.splice(index, 0, latex);
  sheetEl.insertBefore(entry.row, sheetEl.children[index] ?? null);
  mountRow(entry);
  renumber();
  if (options.focus !== false) entry.field.focus();
  if (options.recompute !== false) scheduleRecompute();
}

function removeRow(index) {
  // Move focus before detaching the active MathLive element. Focusing after
  // removal makes MathLive run its blur serialization against an already
  // disconnected field, which can lose the caret move or throw internally.
  if (index > 0) focusRow(index - 1, 'end');
  const [entry] = rows.splice(index, 1);
  state.lines.splice(index, 1);
  entry.row.remove();
  renumber();
  scheduleRecompute();
}

function focusRow(index, where) {
  const entry = rows[index];
  if (!entry) return;
  entry.field.focus();
  entry.field.executeCommand(where === 'end' ? 'moveToMathfieldEnd' : 'moveToMathfieldStart');
}

/* ------------------------------- evaluation ------------------------------ */

let recomputeHandle = 0;

function scheduleRecompute() {
  clearTimeout(recomputeHandle);
  recomputeHandle = setTimeout(recompute, 140);
}

function recompute() {
  const results = engine.evaluateAll(state.lines);
  results.forEach((result, index) => {
    const entry = rows[index];
    if (!entry) return;

    const chain = getTopLevelChainCheckpoints(state.lines[index]);
    if (chain) {
      const checkpointResults = chain.checkpoints.map((checkpoint) => {
        if (!checkpoint) return null;
        const checkpointEngine = new Sheet();
        checkpointEngine.evaluateAll(state.lines.slice(0, index));
        try {
          return checkpointEngine.evaluateLine(checkpoint, { allowDefinitions: false });
        } catch (error) {
          return { kind: 'error', message: error?.message ?? String(error) };
        }
      });
      renderCheckpointResults(entry.result, checkpointResults, chain.links);
      renderProof(entry, null);
    } else {
      entry.result.classList.remove('is-chain');
      renderResult(entry.result, result, { allowProof: true });
      renderProof(entry, result);
    }
  });
  save();
}

/* --------------------------------- chrome -------------------------------- */

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  // Android tints the status bar from this, so follow the sheet rather than
  // leaving the manifest's single fixed colour in place.
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', state.theme === 'dark' ? '#0f1116' : '#ffffff');
  // MathLive keys its keyboard palette off `theme`, while the app uses
  // `data-theme`. Keep both on the same ancestor.
  document.documentElement.setAttribute('theme', state.theme);
}

function renderKeyboardToggle(button) {
  const expanded = !state.keyboardCollapsed;
  button.setAttribute('aria-expanded', String(expanded));
  button.querySelector('[data-keyboard-toggle-label]').textContent = expanded
    ? 'Hide keyboard'
    : 'Show keyboard';
}

function renderDemoBrowser() {
  const browser = document.getElementById('demo-browser');
  const visible = state.page === 'demo';
  browser.hidden = !visible;
  if (!visible) return;

  const active = demoById(state.demoId);
  const position = DEMOS.findIndex((demo) => demo.id === active.id) + 1;
  document.getElementById('demo-topic').textContent = active.topic;
  document.getElementById('demo-count').textContent = `${position} of ${DEMOS.length}`;
  document.getElementById('demo-title').textContent = active.title;
  document.getElementById('demo-description').textContent = active.description;
  const list = document.getElementById('demo-list');
  list.innerHTML = DEMOS.map((demo) => {
    const selected = demo.id === active.id;
    return `<a class="demo-option${selected ? ' is-active' : ''}"`
      + ` href="#demo=${demo.id}"${selected ? ' aria-current="true"' : ''}>`
      + `<span class="demo-option-topic">${escapeHtml(demo.topic)}</span>`
      + `<span class="demo-option-title">${escapeHtml(demo.title)}</span></a>`;
  }).join('');
  const selected = list.querySelector('.demo-option.is-active');
  if (selected) {
    list.scrollLeft = Math.max(
      0,
      selected.offsetLeft - list.offsetLeft - (list.clientWidth - selected.clientWidth) / 2,
    );
  }
}

function renderPageChrome() {
  const demo = state.page === 'demo';
  const activeDemo = demoById(state.demoId);
  const sheetLink = document.getElementById('sheet-link');
  const demoLink = document.getElementById('demo-link');
  sheetLink.href = `${location.pathname}${location.search}`;
  demoLink.href = `#demo=${demo ? activeDemo.id : DEFAULT_DEMO_ID}`;
  sheetLink.classList.toggle('is-active', !demo);
  demoLink.classList.toggle('is-active', demo);
  if (demo) {
    demoLink.setAttribute('aria-current', 'page');
    sheetLink.removeAttribute('aria-current');
  } else {
    sheetLink.setAttribute('aria-current', 'page');
    demoLink.removeAttribute('aria-current');
  }
  document.title = demo ? `Sequent — ${activeDemo.title}` : 'Sequent';
  renderDemoBrowser();
}

function setDisplay(mode, options = {}) {
  state.display = mode;
  for (const button of document.querySelectorAll('[data-display]')) {
    button.classList.toggle('is-active', button.dataset.display === mode);
  }
  if (options.recompute !== false) recompute();
}

function buildSheet(lines, options = {}) {
  sheetEl.innerHTML = '';
  rows.length = 0;
  state.lines = [...lines];
  state.lines.forEach((latex) => {
    const entry = createRow(latex);
    rows.push(entry);
    sheetEl.append(entry.row);
    mountRow(entry);
  });
  renumber();
  if (options.recompute !== false) scheduleRecompute();
}

function focusPageEntry() {
  focusRow(state.page === 'demo' ? 0 : rows.length - 1, 'end');
  if (state.page === 'demo') {
    document.querySelector('.sheet-scroll').scrollTop = 0;
  }
}

function init() {
  migrateLegacyStorage();
  registerServiceWorker();
  applyScrollbarGutterFallback();
  load();
  applyTheme();
  renderPageChrome();
  buildSheet(state.lines, { recompute: false });
  setDisplay(state.display, { recompute: false });
  // Give the browser a chance to paint the mounted MathLive rows before doing
  // the one full-sheet evaluation. Previously startup evaluated twice and
  // blocked both the rows and their results from appearing.
  scheduleRecompute();
  const keyboardController = setupVirtualKeyboard(dockEl, {
    collapsed: state.keyboardCollapsed,
  });
  // Nothing is focused yet, so there is no grid to resize.
  syncMatrixResizeKeys(null);
  // The keycaps run MathLive's own commands, so the repair has to happen after
  // the press rather than instead of it.
  dockEl.addEventListener('click', (event) => {
    if (event.target.closest('.matrix-resize')) repairResizedMatrix();
  });
  const keyboardToggle = document.getElementById('keyboard-toggle');
  renderKeyboardToggle(keyboardToggle);

  window.addEventListener('hashchange', () => {
    const nextPage = pageFromHash();
    const nextDemoId = nextPage === 'demo' ? demoIdFromHash() : DEFAULT_DEMO_ID;
    if (nextPage === state.page && (nextPage !== 'demo' || nextDemoId === state.demoId)) return;

    // The new hash may itself contain a shared sheet. Persist the old page
    // locally without replacing that incoming URL before it can be loaded.
    save({ updateUrl: false });
    load(nextPage);
    applyTheme();
    renderPageChrome();
    buildSheet(state.lines, { recompute: false });
    setDisplay(state.display, { recompute: false });
    scheduleRecompute();
    keyboardController?.setCollapsed(state.keyboardCollapsed);
    renderKeyboardToggle(keyboardToggle);
    focusPageEntry();
  });

  document.getElementById('theme-toggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    save();
  });

  keyboardToggle.addEventListener('click', () => {
    state.keyboardCollapsed = !state.keyboardCollapsed;
    keyboardController?.setCollapsed(state.keyboardCollapsed);
    renderKeyboardToggle(keyboardToggle);
    save();
  });

  statusEl.addEventListener('click', hideStatus);

  document.getElementById('export-sheet').addEventListener('click', exportSheet);

  const importFile = document.getElementById('import-file');
  document.getElementById('import-sheet').addEventListener('click', () => {
    if (isDesktop()) importSheetFromDialog();
    else importFile.click();
  });
  importFile.addEventListener('change', () => {
    const [file] = importFile.files ?? [];
    // Clearing the input lets the same file be picked twice in a row.
    importFile.value = '';
    if (file) importSheetFile(file);
  });

  document.getElementById('clear-sheet').addEventListener('click', () => {
    buildSheet(['']);
    focusRow(0, 'start');
  });

  for (const button of document.querySelectorAll('[data-display]')) {
    button.addEventListener('click', () => setDisplay(button.dataset.display));
  }

  // Clicking the empty space below the sheet appends or focuses the last line.
  document.querySelector('.sheet-scroll').addEventListener('mousedown', (event) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    const last = rows[rows.length - 1];
    if (last && last.field.value === '') focusRow(rows.length - 1, 'end');
    else insertRow(rows.length, '');
  });

  focusPageEntry();
}

init();
