/**
 * Keyboard tabs for the physics sheet.
 *
 * A unit has to be written upright — `\mathrm{m}` is a metre, `m` is a
 * variable — and nobody should have to know that to type one. The `units` tab
 * inserts each unit in the form the engine reads, with the thin space in front
 * of it that a typeset quantity has anyway.
 */
import { DEFN_LAYOUT, EXPR_LAYOUT } from '../mathfield.js';
import { CONSTANTS } from './constants.js';

const NAV_ROW = [
  { label: '[left]', tooltip: 'move left' },
  { label: '[right]', tooltip: 'move right' },
  { label: '[backspace]', tooltip: 'backspace', class: 'action hide-shift calc-backspace' },
  { label: '[return]', tooltip: 'new line' },
];

/** A keycap showing the unit, inserting it upright after a thin space. */
const unit = (latex, tooltip) => ({
  latex: `\\mathrm{${latex}}`,
  insert: `\\,\\mathrm{${latex}}`,
  tooltip,
  class: 'small',
});

/**
 * Five rows, like every other tab: a sixth pushes the tab bar out of the
 * docked keyboard on a short screen. Anything not here is typed upright —
 * `\mathrm{kWh}` — and the engine knows far more units than fit.
 */
export const UNITS_LAYOUT = {
  label: 'units',
  tooltip: 'Units',
  rows: [
    [
      unit('m', 'metre'), unit('cm', 'centimetre'), unit('mm', 'millimetre'), unit('km', 'kilometre'),
      unit('\\mu m', 'micrometre'), unit('nm', 'nanometre'),
      { class: 'separator w5' },
      { latex: '\\to', insert: '\\to\\mathrm{#?}', tooltip: 'convert to a unit', class: 'small' },
    ],
    [
      unit('s', 'second'), unit('ms', 'millisecond'), unit('min', 'minute'), unit('h', 'hour'),
      unit('Hz', 'hertz'), unit('K', 'kelvin'),
      { class: 'separator w5' },
      { latex: '#@^{\\circ}', insert: '^{\\circ}', tooltip: 'degrees (angle)', class: 'small' },
    ],
    [
      unit('kg', 'kilogram'), unit('g', 'gram'), unit('N', 'newton'), unit('J', 'joule'),
      unit('W', 'watt'), unit('Pa', 'pascal'),
      { class: 'separator w5' },
      { latex: '{}^{\\circ}\\mathrm{C}', insert: '^{\\circ}\\mathrm{C}', tooltip: 'degrees Celsius', class: 'small' },
    ],
    [
      unit('m/s', 'metres per second'), unit('m/s^2', 'metres per second squared'),
      unit('km/h', 'kilometres per hour'), unit('A', 'ampere'), unit('V', 'volt'), unit('\\Omega', 'ohm'),
      { class: 'separator w5' },
      unit('eV', 'electronvolt'),
    ],
    [unit('mol', 'mole'), unit('L', 'litre'), unit('C', 'coulomb'), ...NAV_ROW],
  ],
};

export const CONSTANTS_LAYOUT = {
  label: 'const',
  tooltip: 'Physical constants',
  rows: [
    ...[0, 4, 8, 12].map((start) => CONSTANTS.slice(start, start + 4).map((constant) => ({
      latex: constant.latex,
      tooltip: constant.name,
    }))),
    NAV_ROW,
  ],
};

export const PHYSICS_REL_LAYOUT = {
  label: 'rel',
  tooltip: 'Claims and conversions',
  rows: [
    [{ latex: '=' }, { latex: '\\ne' }, { latex: '\\approx', tooltip: 'within 1%' }],
    [{ latex: '<' }, { latex: '>' }, { latex: '\\le' }, { latex: '\\ge' }],
    [
      { latex: '\\coloneq', insert: '\\mathrel{\\coloneq}', tooltip: 'define (:=)' },
      { latex: '\\to', insert: '\\to\\mathrm{#?}', tooltip: 'convert to a unit' },
      { latex: '\\Delta', insert: '\\Delta ', tooltip: 'a change: \\Delta T' },
    ],
    [{ latex: '(' }, { latex: ')' }, ...NAV_ROW],
  ],
};

export const PHYSICS_KEYBOARD_LAYOUTS = [EXPR_LAYOUT, UNITS_LAYOUT, CONSTANTS_LAYOUT, PHYSICS_REL_LAYOUT, DEFN_LAYOUT];
