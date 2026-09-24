/**
 * Physical constants the physics sheet knows by name (CODATA 2018).
 *
 * A constant is only a fallback: a name the sheet defines is always the
 * sheet's, so `h = 2\,\mathrm{m}` makes `mgh` a height again. Because several
 * of these letters are also the usual names for something else — `h` a
 * height, `c` a specific heat, `R` a resistance — every row that leans on
 * one says so, rather than letting Planck's constant slip silently into a
 * potential energy.
 *
 * `symbols` are the MathJSON names Compute Engine gives each spelling when it
 * parses without canonicalising: `\hbar` is `hBar`, `\varepsilon_0` is
 * `VacuumPermittivity`, `\mu_0` is `Mu0`.
 */
import { divideDimensions, multiplyDimensions } from './units.js';

const D = (L = 0, M = 0, T = 0, I = 0, Θ = 0, N = 0, J = 0) => [L, M, T, I, Θ, N, J];

const JOULE = D(2, 1, -2);

export const CONSTANTS = [
  { id: 'c', symbols: ['c'], latex: 'c', name: 'Speed of light', value: 299792458, dim: D(1, 0, -1), unitLatex: '\\mathrm{m/s}' },
  { id: 'g', symbols: ['g'], latex: 'g', name: 'Standard gravity', value: 9.80665, dim: D(1, 0, -2), unitLatex: '\\mathrm{m/s^{2}}' },
  { id: 'G', symbols: ['G'], latex: 'G', name: 'Gravitational constant', value: 6.67430e-11, dim: D(3, -1, -2), unitLatex: '\\mathrm{m^{3}/(kg\\cdot s^{2})}' },
  { id: 'h', symbols: ['h'], latex: 'h', name: 'Planck constant', value: 6.62607015e-34, dim: multiplyDimensions(JOULE, D(0, 0, 1)), unitLatex: '\\mathrm{J\\cdot s}' },
  { id: 'hbar', symbols: ['hBar', 'hbar'], latex: '\\hbar', name: 'Reduced Planck constant', value: 6.62607015e-34 / (2 * Math.PI), dim: multiplyDimensions(JOULE, D(0, 0, 1)), unitLatex: '\\mathrm{J\\cdot s}' },
  { id: 'k_B', symbols: ['k_B'], latex: 'k_B', name: 'Boltzmann constant', value: 1.380649e-23, dim: divideDimensions(JOULE, D(0, 0, 0, 0, 1)), unitLatex: '\\mathrm{J/K}' },
  { id: 'N_A', symbols: ['N_A'], latex: 'N_A', name: 'Avogadro constant', value: 6.02214076e23, dim: D(0, 0, 0, 0, 0, -1), unitLatex: '\\mathrm{mol^{-1}}' },
  { id: 'R', symbols: ['R'], latex: 'R', name: 'Molar gas constant', value: 8.314462618, dim: D(2, 1, -2, 0, -1, -1), unitLatex: '\\mathrm{J/(mol\\cdot K)}' },
  { id: 'sigma', symbols: ['sigma'], latex: '\\sigma', name: 'Stefan–Boltzmann constant', value: 5.670374419e-8, dim: D(0, 1, -3, 0, -4), unitLatex: '\\mathrm{W/(m^{2}\\cdot K^{4})}' },
  { id: 'epsilon_0', symbols: ['VacuumPermittivity', 'epsilon_0', 'varepsilon_0'], latex: '\\varepsilon_0', name: 'Vacuum permittivity', value: 8.8541878128e-12, dim: D(-3, -1, 4, 2), unitLatex: '\\mathrm{F/m}' },
  { id: 'mu_0', symbols: ['Mu0', 'mu_0'], latex: '\\mu_0', name: 'Vacuum permeability', value: 1.25663706212e-6, dim: D(1, 1, -2, -2), unitLatex: '\\mathrm{N/A^{2}}' },
  { id: 'k_e', symbols: ['k_e'], latex: 'k_e', name: 'Coulomb constant', value: 8.9875517923e9, dim: D(3, 1, -4, -2), unitLatex: '\\mathrm{N\\cdot m^{2}/C^{2}}' },
  { id: 'q_e', symbols: ['q_e'], latex: 'q_e', name: 'Elementary charge', value: 1.602176634e-19, dim: D(0, 0, 1, 1), unitLatex: '\\mathrm{C}' },
  { id: 'm_e', symbols: ['m_e'], latex: 'm_e', name: 'Electron mass', value: 9.1093837015e-31, dim: D(0, 1), unitLatex: '\\mathrm{kg}' },
  { id: 'm_p', symbols: ['m_p'], latex: 'm_p', name: 'Proton mass', value: 1.67262192369e-27, dim: D(0, 1), unitLatex: '\\mathrm{kg}' },
  { id: 'm_n', symbols: ['m_n'], latex: 'm_n', name: 'Neutron mass', value: 1.67492749804e-27, dim: D(0, 1), unitLatex: '\\mathrm{kg}' },
];

const BY_SYMBOL = new Map(CONSTANTS.flatMap((constant) => constant.symbols.map((symbol) => [symbol, constant])));
const BY_ID = new Map(CONSTANTS.map((constant) => [constant.id, constant]));

export function constantBySymbol(symbol) {
  return BY_SYMBOL.get(symbol) ?? null;
}

export function constantById(id) {
  return BY_ID.get(id) ?? null;
}
