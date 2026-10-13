import { ABILITY_SLOTS } from '../../gameplay-context/types.js';

/**
 * Versioned scope of the mechanical golden truth used by the golden benchmark.
 *
 * Ability names, ownership, slots, availability, cooldowns and prose facts are
 * projected from Data Dragon. TRUSTED_ABILITY_MECHANICS supplies only the
 * normalized fields Data Dragon does not expose structurally.
 */
export const MECHANICAL_GOLDEN_TRUTH = Object.freeze({
  schemaVersion: 1,
  version: 'mechanical-golden-v1',
  corpusPatch: '26.19',
  dataDragonVersion: '16.19.1',
  champions: Object.freeze([
    'Caitlyn',
    'Jinx',
    'Ziggs',
    'Galio',
    'Leona',
    'Lux',
    'Morgana',
    'Swain',
  ]),
  requiredSlots: ABILITY_SLOTS,
});

export type MechanicalGoldenTruth = typeof MECHANICAL_GOLDEN_TRUTH;
