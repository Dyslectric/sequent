/**
 * The physics sheet: units, dimensions, conversions and constants.
 *
 * The cases that matter most are the refusals. A physics calculator that
 * answers `5 m + 2 s` with a number, or reads the metre in `\mathrm{m/s}` as a
 * sheet variable called `m`, is worse than none — so each of those has a line
 * here, alongside the arithmetic it is meant to get right.
 */
import { PhysicsSheet, extractUnits, formatNumber } from '../src/lib/physics/engine.js';
import { parseUnitLatex, siUnitLatex } from '../src/lib/physics/units.js';

let passed = 0;
const failures = [];

function describe(result) {
  if (!result) return 'no result';
  return JSON.stringify(result);
}

function check(label, lines, expect, digits = 4) {
  let result;
  try {
    result = new PhysicsSheet({ digits }).evaluateAll(lines).at(-1);
  } catch (error) {
    failures.push(`${label}\n    threw: ${error?.message ?? error}`);
    return;
  }
  const problem = expect(result);
  if (problem) failures.push(`${label}\n    got: ${describe(result)}\n    ${problem}`);
  else passed++;
}

function same(label, actual, expected) {
  if (actual === expected) passed++;
  else failures.push(`${label}\n    got: ${JSON.stringify(actual)}\n    expected: ${JSON.stringify(expected)}`);
}

const value = (latex, secondaryLatex) => (result) => {
  if (result.kind !== 'value') return 'expected a value';
  if (result.latex !== latex) return `expected ${latex}`;
  if (secondaryLatex !== undefined && result.secondaryLatex !== secondaryLatex) return `expected secondary ${secondaryLatex}`;
  return null;
};
const truth = (expected, note) => (result) => {
  if (result.kind !== 'truth' || result.value !== expected) return `expected ${expected}`;
  if (note && result.note !== note) return `expected note "${note}"`;
  return null;
};
const error = (pattern) => (result) => (
  result.kind === 'error' && pattern.test(result.message) ? null : `expected an error matching ${pattern}`
);
const defined = (name, valueLatex) => (result) => {
  if (result.kind !== 'definition' || result.name !== name) return `expected ${name} to be defined`;
  return valueLatex && result.valueLatex !== valueLatex ? `expected value ${valueLatex}` : null;
};

/* ------------------------------- the units ------------------------------- */

for (const [latex, scale] of [
  ['km', 1e3], ['kg', 1], ['g', 1e-3], ['ms', 1e-3], ['\\mu m', 1e-6], ['µm', 1e-6], ['μm', 1e-6], ['um', 1e-6],
  ['k\\Omega', 1e3], ['kohm', 1e3], ['min', 60], ['h', 3600], ['mph', 0.44704], ['kWh', 3.6e6],
  ['km/h', 1 / 3.6], ['m/s^2', 1], ['m/s^{2}', 1], ['kg\\cdot m^2/s^2', 1], ['J/(kg\\cdot K)', 1],
  ['J/kg K', 1], ['\\frac{m}{s}', 1], ['m\\,s^{-1}', 1], ['nm', 1e-9], ['dam', 10], ['cd', 1], ['Pa', 1],
]) {
  const unit = parseUnitLatex(latex);
  if (unit && Math.abs(unit.scale - scale) <= 1e-12 * Math.abs(scale)) passed++;
  else failures.push(`unit ${latex}\n    got scale ${unit?.scale}, expected ${scale}`);
}
for (const latex of ['net', 'max', 'x', 'mk', '°C^2', 'foo/s']) {
  same(`${latex} is not a unit`, parseUnitLatex(latex), null);
}

same('named SI unit for force', siUnitLatex([1, 1, -2, 0, 0, 0, 0]), 'N');
same('named SI unit with a remainder', siUnitLatex([1, 1, -3, -1, 0, 0, 0]), 'V/m');
same('momentum stays in base units', siUnitLatex([1, 1, -1, 0, 0, 0, 0]), 'kg\\cdot m/s');
same('acceleration', siUnitLatex([1, 0, -2, 0, 0, 0, 0]), 'm/s^{2}');

same('a subscript name is not a unit', extractUnits('F_{\\text{net}}=3\\,\\mathrm{N}').units.length, 1);
same('a split unit is read as one', extractUnits('3\\,\\mathrm{m}/\\mathrm{s}^{2}').units.length, 1);
same('µ split from its unit is rejoined', extractUnits('3\\,\\mathrm{\\mu}\\mathrm{m}').units[0]?.scale, 1e-6);

same('four figures', formatNumber(29.400000000000002, 4), '29.4');
same('large numbers go scientific', formatNumber(6.02214076e23, 4), '6.022\\times10^{23}');
same('small numbers go scientific', formatNumber(6.674e-11, 3), '6.67\\times10^{-11}');
same('integers keep their digits', formatNumber(12345, 3), '12300');

/* ------------------------------ arithmetic ------------------------------- */

check('control: plain arithmetic', ['2+2'], value('4'));
check('mixed lengths add', ['5\\,\\mathrm{m}+20\\,\\mathrm{cm}'], value('5.2\\,\\mathrm{m}'));
check('the same unit is kept', ['5\\,\\mathrm{km}+3\\,\\mathrm{km}'], value('8\\,\\mathrm{km}', '8000\\,\\mathrm{m}'));
check('kinetic energy', ['m=2\\,\\mathrm{kg}', 'v=3\\,\\mathrm{m/s}', '\\frac{1}{2}mv^2'], value('9\\,\\mathrm{J}'));
check('a variable called m does not touch the metre',
  ['m=2\\,\\mathrm{kg}', 'm\\cdot 9.8\\,\\mathrm{m/s^2}'], value('19.6\\,\\mathrm{N}'));
check('a unit with a rational coefficient keeps its unit', ['\\frac{1}{3}\\,\\mathrm{km}'], value('0.3333\\,\\mathrm{km}', '333.3\\,\\mathrm{m}'));
check('and with an irrational one', ['\\sqrt{2}\\,\\mathrm{m}'], value('1.414\\,\\mathrm{m}'));
check('absolute value of a quantity', ['\\left|-2\\,\\mathrm{m}\\right|'], value('2\\,\\mathrm{m}'));
check('powers of units', ['(2\\,\\mathrm{m})^2'], value('4\\,\\mathrm{m^{2}}'));
check('roots of units', ['\\sqrt{16\\,\\mathrm{m^2}}'], value('4\\,\\mathrm{m}'));
check('ratio of lengths is a number', ['\\frac{3\\,\\mathrm{m}}{2\\,\\mathrm{cm}}'], value('150'));
check('ohm\'s law', ['V=12\\,\\mathrm{V}', 'I=2\\,\\mathrm{mA}', '\\frac{V}{I}'], value('6000\\,\\mathrm{\\Omega}'));
check('field times charge is force', ['E=5\\,\\mathrm{V/m}', 'E\\cdot 2\\,\\mathrm{C}'], value('10\\,\\mathrm{N}'));
check('surface gravity', ['\\frac{G\\cdot 5.972\\times10^{24}\\,\\mathrm{kg}}{(6371\\,\\mathrm{km})^2}'], value('9.82\\,\\mathrm{m/s^{2}}'));
check('trig of degrees', ['\\sin(30^{\\circ})'], value('0.5'));
check('trig of a degree unit', ['\\cos(60\\,\\mathrm{deg})'], value('0.5'));
check('significant figures follow the setting', ['\\frac{1}{3}\\,\\mathrm{m}'], value('0.333\\,\\mathrm{m}'), 3);

// MathLive leaves upright mode at `/`, so a unit typed after the units key is
// half upright. The `h` there is hours, not Planck's constant…
check('a bare unit after the slash joins the unit', ['36\\,\\mathrm{km}/h'], value('36\\,\\mathrm{km/h}', '10\\,\\mathrm{m/s}'));
check('with its exponent', ['3\\,\\mathrm{m}/s^2'], value('3\\,\\mathrm{m/s^{2}}'));
check('and across thin spaces', ['3\\,\\mathrm{J}/\\,\\mathrm{kg}'], value('3\\,\\mathrm{J/kg}'));
// …unless the sheet named something that way.
check('a defined name after the slash stays a name', ['t=2\\,\\mathrm{s}', '6\\,\\mathrm{m}/t'], value('3\\,\\mathrm{m/s}'));

/* ------------------------------ conversions ------------------------------ */

check('convert speed', ['36\\,\\mathrm{km/h}\\to\\mathrm{m/s}'], value('10\\,\\mathrm{m/s}', null));
check('convert to imperial', ['60\\,\\mathrm{mph}\\to\\mathrm{km/h}'], value('96.56\\,\\mathrm{km/h}'));
check('convert without \\mathrm', ['1.5\\,\\mathrm{atm}\\to kPa'], value('152\\,\\mathrm{kPa}'));
check('convert energy to eV', ['1\\,\\mathrm{J}\\to\\mathrm{eV}'], value('6.242\\times10^{18}\\,\\mathrm{eV}'));
check('a definition takes the unit it is converted to', ['v=10\\,\\mathrm{m/s}\\to\\mathrm{km/h}'], defined('v', '36\\,\\mathrm{km/h}'));
check('Celsius to Fahrenheit', ['20^{\\circ}C\\to{}^{\\circ}F'], value('68\\mathrm{{}^{\\circ}F}'));
check('negative Celsius to kelvin', ['-5^{\\circ}\\mathrm{C}\\to\\mathrm{K}'], value('268.1\\,\\mathrm{K}'));
check('a difference of readings is an interval', ['T_1=20^{\\circ}C', 'T_2=100^{\\circ}C', 'T_2-T_1'], value('80\\,\\mathrm{K}'));
check('a named change in Celsius is an interval', ['\\Delta T=10^{\\circ}C', '\\Delta T\\to\\mathrm{K}'], value('10\\,\\mathrm{K}'));

/* ------------------------------- refusals -------------------------------- */

check('length plus time is refused', ['5\\,\\mathrm{m}+2\\,\\mathrm{s}'], error(/Cannot add/));
check('an incompatible conversion is refused', ['36\\,\\mathrm{km/h}\\to\\mathrm{kg}'], error(/Cannot convert/));
check('the sine of a length is refused', ['\\sin(2\\,\\mathrm{m})'], error(/pure number/));
check('an upright d is a differential, not a day', ['\\frac{\\mathrm{d}}{\\mathrm{d}x}x'], error(/Derivatives/));
check('an unknown target is refused', ['3\\,\\mathrm{m}\\to\\mathrm{foo}'], error(/not a unit/));
check('an undefined name leaves the row open', ['y+1'], (result) => (
  result.kind === 'symbolic' && result.undefinedNames.includes('y') ? null : 'expected y to be reported undefined'
));

/* --------------------------------- claims -------------------------------- */

check('equal across units', ['1\\,\\mathrm{km}=1000\\,\\mathrm{m}'], truth(true, 'equal'));
check('floating-point noise is still equal', ['0.1\\,\\mathrm{m}+0.2\\,\\mathrm{m}=0.3\\,\\mathrm{m}'], truth(true, 'equal'));
check('equal to the digits shown', ['9.80665\\,\\mathrm{m/s^2}=9.807\\,\\mathrm{m/s^2}'], truth(true, 'equal to 4 significant figures'));
check('but not beyond them', ['9.80665\\,\\mathrm{m/s^2}=9.807\\,\\mathrm{m/s^2}'], truth(false), 6);
check('an inequality across units', ['1\\,\\mathrm{km}>1\\,\\mathrm{m}'], truth(true));
check('different dimensions are never equal', ['1\\,\\mathrm{km}=1\\,\\mathrm{s}'], truth(false, 'dimensions differ'));
check('approximately', ['9.8\\,\\mathrm{m/s^2}\\approx 9.81\\,\\mathrm{m/s^2}'], truth(true));
check('a defined name is checked, not redefined', ['x=3\\,\\mathrm{m}', 'x=300\\,\\mathrm{cm}'], truth(true));
check(':= redefines', ['x=3\\,\\mathrm{m}', 'x:=4\\,\\mathrm{m}', 'x'], value('4\\,\\mathrm{m}'));

/* ------------------------------- constants ------------------------------- */

check('a constant is used, and named', ['m=1\\,\\mathrm{kg}', 'mc^2'], (result) => (
  result.kind === 'value' && result.latex === '8.988\\times10^{16}\\,\\mathrm{J}' && result.constantsUsed.includes('c')
    ? null : 'expected mc² in joules, citing c'
));
check('a defined name shadows a constant', ['m=2\\,\\mathrm{kg}', 'h=10\\,\\mathrm{m}', 'mgh'], (result) => (
  result.kind === 'value' && result.latex === '196.1\\,\\mathrm{J}' && !result.constantsUsed.includes('h')
    ? null : 'expected h to be the height'
));
check('redefining a constant says so', ['c=4186\\,\\mathrm{J/(kg\\cdot K)}'], (result) => (
  result.kind === 'definition' && result.overrides === 'c' ? null : 'expected the override to be reported'
));
check('ħ is known', ['\\hbar'], value('1.055\\times10^{-34}\\,\\mathrm{kg\\cdot m^{2}/s}'));
check('photon energy', ['\\lambda=500\\,\\mathrm{nm}', '\\frac{hc}{\\lambda}\\to\\mathrm{eV}'], value('2.48\\,\\mathrm{eV}'));

if (failures.length) {
  console.error(`\n${failures.join('\n\n')}\n`);
  console.error(`${passed} passed, ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log(`\n${passed} physics cases passed`);
}
