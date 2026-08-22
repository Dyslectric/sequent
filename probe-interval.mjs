import { ComputeEngine } from '@cortex-js/compute-engine';
import { polynomialCoefficients } from './src/lib/polynomial.js';
const ce = new ComputeEngine();
const t = (l, f) => { try { console.log(l.padEnd(46), '=>', JSON.stringify(f())); } catch (e) { console.log(l.padEnd(46), 'ERR', e.message); } };

const S = 'ShiftT';

/** x = (lo + hi*s)/(1+s) maps s in (0,inf) onto (lo,hi). */
function mobiusCoefficients(poly, lo, hi, degree) {
  const s = ce.box(S);
  const mapped = ce.box(['Divide',
    ce.box(['Add', ce.box(lo), ce.box(['Multiply', ce.box(hi), s])]),
    ce.box(['Add', 1, s])]);
  const scaled = ce.box(['Multiply',
    poly.subs({ x: mapped }),
    ce.box(['Power', ce.box(['Add', 1, s]), degree])]);
  return polynomialCoefficients(ce, scaled, S)?.map((c) => c.toString());
}

console.log('-- Mobius interval certificates --');
t('x^2-4 on (-2,2)  [expect all <=0]', () => mobiusCoefficients(ce.parse('x^2-4'), -2, 2, 2));
t('x^2+1 on (-1,1)  [expect all >=0]', () => mobiusCoefficients(ce.parse('x^2+1'), -1, 1, 2));
t('x on (1,2)       [expect all >=0]', () => mobiusCoefficients(ce.parse('x'), 1, 2, 1));
t('x^3-x on (0,1)   [expect all <=0]', () => mobiusCoefficients(ce.parse('x^3-x'), 0, 1, 3));
t('x^2-1 on (-3,3)  [mixed, expect fail]', () => mobiusCoefficients(ce.parse('x^2-1'), -3, 3, 2));
t('rational bounds (1/2,3/2)', () => mobiusCoefficients(ce.parse('x^2-4'), ce.box(['Rational', 1, 2]), ce.box(['Rational', 3, 2]), 2));

console.log('\n-- Solve for roots --');
const roots = (s) => {
  const r = ce.box(['Solve', ce.parse(s), 'x']).evaluate();
  if (r.operator !== 'List') return `not a list: ${r.toString()}`;
  return r.ops.map((o) => ({ tex: o.toString(), re: o.N().re, im: o.N().im ?? 0 }));
};
t('x^2-4=0', () => roots('x^2-4=0'));
t('x^2+1=0 (complex)', () => roots('x^2+1=0'));
t('x^3-3x^2+2x=0', () => roots('x^3-3x^2+2x=0'));
t('2x^3-4x^2-3x+4=0', () => roots('2x^3-4x^2-3x+4=0'));
t('x^2-2=0 (irrational)', () => roots('x^2-2=0'));
t('4x^3+x^2-3x-4=0', () => roots('4x^3+x^2-3x-4=0'));
t('no real roots x^4+1=0', () => roots('x^4+1=0'));
