/**
 * The physics page: the same sheet, evaluated as measurements with units.
 *
 * Forked from `main.js` rather than folded into it. The two pages share the
 * row editing, the keyboard and the look, but not what a line *means* — here a
 * line is a number with a dimension, not a proposition — and every piece of
 * the main page's proof and theorem machinery would be dead weight on this one.
 */
import 'mathlive';
import 'mathlive/static.css';
import { MathfieldElement, convertLatexToMarkup } from 'mathlive';
import './styles.css';

import { configureMathfield, setupVirtualKeyboard } from './lib/mathfield.js';
import { parseSheetStateHash, serializeSheetState } from './lib/url-state.js';
import { PhysicsSheet } from './lib/physics/engine.js';
import { CONSTANTS, constantById } from './lib/physics/constants.js';
import { PHYSICS_KEYBOARD_LAYOUTS } from './lib/physics/keyboard.js';

MathfieldElement.fontsDirectory = null;
MathfieldElement.soundsDirectory = null;

/** Its own key: a physics sheet never overwrites the main one, or the reverse. */
const STORAGE_KEY = 'sequent/v2/physics';
const EXPORT_KIND = 'sequent.physics';
const JSON_FILTER = [{ name: 'Sequent physics sheet', extensions: ['json'] }];
const DIGIT_CHOICES = [3, 4, 6, 10];

/** A sheet to open on, the first time: short, and showing each kind of line. */
const STARTER_LINES = [
  'm=2\\,\\mathrm{kg}',
  'v=36\\,\\mathrm{km/h}',
  'E_k=\\frac{1}{2}mv^2',
  'E_k\\to\\mathrm{kJ}',
  'h=10\\,\\mathrm{m}',
  'mgh>E_k',
  'm+v',
];

const sheetEl = document.getElementById('sheet');
const dockEl = document.getElementById('keyboard-dock');
const statusEl = document.getElementById('app-status');

const state = {
  lines: [''],
  digits: 4,
  theme: 'light',
  keyboardCollapsed: false,
  constantsOpen: false,
};

let engine = new PhysicsSheet({ digits: state.digits });

/** One entry per visible line. */
const rows = [];

/* ------------------------------ persistence ------------------------------ */

function load() {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch { /* corrupt or unavailable; fall back to defaults */ }

  const urlState = parseSheetStateHash(location.hash);
  const savedLines = Array.isArray(stored?.lines) && stored.lines.length ? stored.lines : null;
  state.lines = urlState?.lines ?? savedLines ?? [...STARTER_LINES];
  state.digits = DIGIT_CHOICES.includes(stored?.digits) ? stored.digits : 4;
  state.theme = stored?.theme
    ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  state.keyboardCollapsed = stored?.keyboardCollapsed === true;
}

function syncSheetUrl() {
  const hash = serializeSheetState({ lines: state.lines });
  if (location.hash === hash) return;
  history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      lines: state.lines,
      digits: state.digits,
      theme: state.theme,
      keyboardCollapsed: state.keyboardCollapsed,
    }));
  } catch { /* private mode; the sheet just will not persist */ }
  syncSheetUrl();
}

/* ----------------------------- export / import ---------------------------- */

function isDesktop() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function sheetPayload() {
  return JSON.stringify({ kind: EXPORT_KIND, version: 1, lines: state.lines }, null, 2);
}

function downloadInBrowser(filename, contents) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function exportSheet() {
  const filename = 'sequent-physics.json';
  const contents = sheetPayload();
  if (!isDesktop()) {
    downloadInBrowser(filename, contents);
    return;
  }
  const { save: saveDialog } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');
  const path = await saveDialog({ defaultPath: filename, filters: JSON_FILTER });
  if (path === null) return;
  try {
    await invoke('write_text_file', { path, contents });
  } catch (error) {
    showStatus(`Could not write that file: ${error}`, { error: true });
  }
}

/**
 * Lines out of an export. A main-sheet export is accepted too: its lines are
 * LaTeX like any other, and whatever of it is arithmetic will still evaluate.
 */
function linesFromExport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (![EXPORT_KIND, 'sequent.sheet'].includes(parsed?.kind) || !Array.isArray(parsed.lines)) return null;
  return parsed.lines.every((line) => typeof line === 'string') ? parsed.lines : null;
}

function applyImport(name, text) {
  const lines = text === null ? null : linesFromExport(text);
  if (!lines) {
    showStatus(`${name} is not a Sequent sheet export.`, { error: true });
    return;
  }
  hideStatus();
  buildSheet(lines.length ? lines : ['']);
  focusRow(rows.length - 1, 'end');
}

async function importSheetFile(file) {
  let text = null;
  try {
    text = await file.text();
  } catch { /* unreadable; reported as a bad file */ }
  applyImport(file.name, text);
}

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

let statusHandle = 0;

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

async function registerServiceWorker() {
  if (isDesktop() || !('serviceWorker' in navigator)) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  } catch { /* not built with the plugin, or blocked; the sheet works regardless */ }
}

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

/**
 * Which constants a row borrowed, where the reader will see it. `h` in `mgh`
 * being Planck's constant is exactly the kind of thing that must not be
 * discovered from the size of the answer.
 */
function constantsNote(result) {
  const used = (result.constantsUsed ?? []).map(constantById).filter(Boolean);
  if (!used.length) return { html: '', title: '' };
  return {
    html: `<span class="result-note physics-constants">with ${used.map((constant) => math(constant.latex)).join(', ')}</span>`,
    title: `Uses ${used.map((constant) => `${plainLatex(constant.latex)} (${constant.name})`).join(', ')}`,
  };
}

const SUPERSCRIPTS = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '/': 'ᐟ' };

/**
 * A result's LaTeX as plain text, for a tooltip — which cannot typeset, and
 * where `2\,\mathrm{kg}` is noise and `2 kg` is the answer.
 */
function plainLatex(latex) {
  return String(latex)
    .replace(/\{\}\^\{\\circ\}/g, '°')
    .replace(/\\(?:mathrm|mathsf|text)\{((?:[^{}]|\{[^{}]*\})*)\}/g, '$1')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2')
    .replace(/\\times10\^\{(-?\d+)\}/g, (_, exponent) => `×10${[...exponent].map((c) => SUPERSCRIPTS[c]).join('')}`)
    .replace(/\^\{([-\d/]+)\}/g, (_, exponent) => [...exponent].map((c) => SUPERSCRIPTS[c] ?? c).join(''))
    .replace(/\^(\d)/g, (_, digit) => SUPERSCRIPTS[digit])
    .replace(/\\cdot\s*/g, '·')
    .replace(/\\Omega/g, 'Ω')
    .replace(/\\mu\s*/g, 'µ')
    .replace(/\\Delta\s*/g, 'Δ')
    .replace(/\\hbar/g, 'ħ')
    .replace(/\\varepsilon/g, 'ε')
    .replace(/\\sigma/g, 'σ')
    .replace(/\\%/g, '%')
    .replace(/_\{([^{}]*)\}/g, '_$1')
    .replace(/\\[,;: ]/g, ' ')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function withDimension(title, result) {
  if (!result.dimensionLatex) return title;
  const dimension = result.dimensionLatex === '1'
    ? 'dimensionless'
    : `dimension ${plainLatex(result.dimensionLatex)}`;
  return [title, dimension].filter(Boolean).join(' — ');
}

function renderResult(el, result) {
  el.innerHTML = '';
  el.title = '';
  const borrowed = constantsNote(result);

  switch (result.kind) {
    case 'empty':
      return;

    case 'value':
      el.innerHTML = [
        borrowed.html,
        result.secondaryLatex ? `<span class="result-secondary">= ${math(result.secondaryLatex)}</span>` : '',
        `<span class="result-primary result-value">= ${math(result.latex)}</span>`,
      ].join('');
      el.title = withDimension(borrowed.title, result);
      return;

    case 'definition': {
      const replaced = result.overrides ? constantById(result.overrides) : null;
      el.innerHTML = [
        replaced ? `<span class="result-note">replaces the constant ${math(replaced.latex)}</span>` : '',
        borrowed.html,
        result.secondaryLatex ? `<span class="result-secondary">= ${math(result.secondaryLatex)}</span>` : '',
        `<span class="pill pill-definition">${math(result.nameLatex)} defined</span>`,
      ].join('');
      el.title = withDimension(
        [`${plainLatex(result.nameLatex)} = ${plainLatex(result.valueLatex)}`, replaced ? `in place of ${replaced.name}` : '', borrowed.title].filter(Boolean).join(' — '),
        result,
      );
      return;
    }

    case 'symbolic': {
      const names = result.undefinedNames;
      el.innerHTML = [
        borrowed.html,
        `<span class="result-note">undefined: ${escapeHtml(names.join(', '))}</span>`,
      ].join('');
      el.title = `No value until ${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} defined.`;
      return;
    }

    case 'truth': {
      const pill = result.value === true ? 'pill-true' : result.value === false ? 'pill-false' : 'pill-unknown';
      const label = result.value === true ? 'true' : result.value === false ? 'false' : 'unknown';
      const detail = result.detailLatex ? ` ${math(result.detailLatex)}` : '';
      el.innerHTML = [
        borrowed.html,
        `<span class="result-note">${escapeHtml(result.note)}${detail}</span>`,
        `<span class="pill ${pill}">${label}</span>`,
      ].join('');
      el.title = [result.note, result.detailLatex ? plainLatex(result.detailLatex) : '', borrowed.title]
        .filter(Boolean).join(' — ');
      return;
    }

    case 'error':
      el.innerHTML = `<span class="result-error">${escapeHtml(result.message)}</span>`;
      el.title = result.message;
      return;

    default:
  }
}

/* --------------------------------- rows ---------------------------------- */

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

  row.append(gutter, field, result);
  const entry = { row, field, result, gutter };

  field.addEventListener('input', () => {
    const at = rows.indexOf(entry);
    if (at < 0) return;
    state.lines[at] = field.value;
    scheduleRecompute();
  });

  field.addEventListener('focusin', () => {
    row.classList.add('is-focused');
    focusedField = field;
  });
  field.addEventListener('focusout', () => row.classList.remove('is-focused'));

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

  field.addEventListener('change', () => {
    if (!field.hasFocus()) return;
    const at = rows.indexOf(entry);
    if (at >= 0) insertRow(at + 1, '');
  });

  field.addEventListener('move-out', (event) => {
    const at = rows.indexOf(entry);
    const direction = event.detail?.direction;
    const target = (direction === 'upward' || direction === 'backward') ? at - 1 : at + 1;
    if (!rows[target]) return;
    event.preventDefault();
    focusRow(target, target < at ? 'end' : 'start');
  });

  return entry;
}

/** The field the reader is editing, for the constants panel to insert into. */
let focusedField = null;

function mountRow(entry) {
  configureMathfield(entry.field);
  entry.field.value = entry.field.dataset.pendingValue ?? '';
  delete entry.field.dataset.pendingValue;
}

function renumber() {
  rows.forEach((entry, index) => {
    entry.gutter.textContent = String(index + 1);
  });
}

function insertRow(index, latex) {
  const entry = createRow(latex);
  rows.splice(index, 0, entry);
  state.lines.splice(index, 0, latex);
  sheetEl.insertBefore(entry.row, sheetEl.children[index] ?? null);
  mountRow(entry);
  renumber();
  entry.field.focus();
  scheduleRecompute();
}

function removeRow(index) {
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

/* ------------------------------- evaluation ------------------------------ */

let recomputeHandle = 0;

function scheduleRecompute() {
  clearTimeout(recomputeHandle);
  recomputeHandle = setTimeout(recompute, 140);
}

function recompute() {
  const results = engine.evaluateAll(state.lines);
  results.forEach((result, index) => {
    if (rows[index]) renderResult(rows[index].result, result);
  });
  save();
}

/* --------------------------------- chrome -------------------------------- */

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', state.theme === 'dark' ? '#0f1116' : '#ffffff');
  document.documentElement.setAttribute('theme', state.theme);
}

function renderKeyboardToggle(button) {
  const expanded = !state.keyboardCollapsed;
  button.setAttribute('aria-expanded', String(expanded));
  button.querySelector('[data-keyboard-toggle-label]').textContent = expanded ? 'Hide keyboard' : 'Show keyboard';
}

function setDigits(digits, options = {}) {
  state.digits = digits;
  for (const button of document.querySelectorAll('[data-digits]')) {
    button.classList.toggle('is-active', Number(button.dataset.digits) === digits);
  }
  engine = new PhysicsSheet({ digits });
  if (options.recompute !== false) recompute();
}

function renderConstantsPanel() {
  const toggle = document.getElementById('constants-toggle');
  toggle.setAttribute('aria-expanded', String(state.constantsOpen));
  const panel = document.getElementById('constants-panel');
  panel.hidden = !state.constantsOpen;
  if (!state.constantsOpen) return;
  const list = document.getElementById('constants-list');
  if (list.childElementCount) return;
  list.innerHTML = CONSTANTS.map((constant) => (
    `<button type="button" class="theorem-option physics-constant" data-constant="${escapeHtml(constant.id)}">`
    + '<span class="theorem-option-body">'
    + '<span class="theorem-option-head">'
    + `<span class="theorem-option-title">${math(constant.latex)}</span>`
    + `<span class="theorem-option-kind">${escapeHtml(constant.name)}</span>`
    + '</span>'
    + `<span class="theorem-option-cost">${math(`${formatConstant(constant.value)}\\,${constant.unitLatex}`)}</span>`
    + '</span></button>'
  )).join('');
}

/**
 * A constant's value as LaTeX, to the ten figures CODATA gives. ħ is the one
 * computed here rather than quoted, and would otherwise show seventeen.
 */
function formatConstant(value) {
  const quoted = Number(value.toPrecision(10));
  if (quoted >= 1e-3 && quoted < 1e6) return String(quoted);
  const [mantissa, exponent] = quoted.toExponential().split('e');
  return `${mantissa}\\times10^{${Number(exponent)}}`;
}

function init() {
  registerServiceWorker();
  applyScrollbarGutterFallback();
  load();
  applyTheme();
  buildSheet(state.lines, { recompute: false });
  setDigits(state.digits, { recompute: false });
  scheduleRecompute();

  const keyboardController = setupVirtualKeyboard(dockEl, {
    collapsed: state.keyboardCollapsed,
    layouts: PHYSICS_KEYBOARD_LAYOUTS,
  });
  const keyboardToggle = document.getElementById('keyboard-toggle');
  renderKeyboardToggle(keyboardToggle);
  keyboardToggle.addEventListener('click', () => {
    state.keyboardCollapsed = !state.keyboardCollapsed;
    keyboardController?.setCollapsed(state.keyboardCollapsed);
    renderKeyboardToggle(keyboardToggle);
    save();
  });

  for (const button of document.querySelectorAll('[data-digits]')) {
    button.addEventListener('click', () => {
      setDigits(Number(button.dataset.digits));
    });
  }

  document.getElementById('constants-toggle').addEventListener('click', () => {
    state.constantsOpen = !state.constantsOpen;
    renderConstantsPanel();
  });

  document.getElementById('constants-list').addEventListener('click', (event) => {
    const id = event.target.closest('[data-constant]')?.dataset.constant;
    const constant = id && constantById(id);
    const field = focusedField ?? rows.at(-1)?.field;
    if (!constant || !field) return;
    field.focus();
    field.executeCommand(['insert', constant.latex]);
  });

  document.getElementById('theme-toggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
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
    importFile.value = '';
    if (file) importSheetFile(file);
  });

  document.getElementById('clear-sheet').addEventListener('click', () => {
    buildSheet(['']);
    focusRow(0, 'start');
  });

  document.querySelector('.sheet-scroll').addEventListener('mousedown', (event) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    const last = rows[rows.length - 1];
    if (last && last.field.value === '') focusRow(rows.length - 1, 'end');
    else insertRow(rows.length, '');
  });

  focusRow(rows.length - 1, 'end');
}

init();
