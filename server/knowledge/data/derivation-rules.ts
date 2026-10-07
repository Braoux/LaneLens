import type { DerivationRule } from '../types.js';

export const DERIVATION_RULES: readonly DerivationRule[] = Object.freeze([
  Object.freeze({
    id: 'movement-effect-enables-spacing',
    description: 'A verified displacement or dash can support spacing, engage, or disengage when phrased conditionally.',
    validated: true,
  }),
  Object.freeze({
    id: 'control-effect-creates-window',
    description: 'A verified crowd-control effect can create a tactical action window without guaranteeing its outcome.',
    validated: true,
  }),
]);
