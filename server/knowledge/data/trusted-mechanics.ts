import type {
  AbilityAvailability,
  AbilityCastModel,
  AbilityEffect,
  AbilitySlot,
} from '../../gameplay-context/types.js';

export interface TrustedAbilityMechanic {
  readonly castModel?: AbilityCastModel;
  readonly effects?: readonly AbilityEffect[];
  /** The normalized mechanic taxonomy is exhaustively reviewed for this ability. */
  readonly complete?: boolean;
}

export const ATYPICAL_ABILITY_AVAILABILITY: Readonly<
  Record<string, Partial<Record<AbilitySlot, AbilityAvailability>>>
> = Object.freeze({
  elise: { R: { earliestLevel: 1, exceptions: ['Forme Araignée disponible dès le niveau 1.'] } },
  jayce: { R: { earliestLevel: 1, exceptions: ['Transformation disponible dès le niveau 1.'] } },
  karma: { R: { earliestLevel: 1, exceptions: ['Mantra disponible dès le niveau 1.'] } },
  nidalee: { R: { earliestLevel: 1, exceptions: ['Aspect du Couguar disponible dès le niveau 1.'] } },
  udyr: { R: { earliestLevel: 1, exceptions: ['Posture Tempête accessible comme capacité de base.'] } },
});

export const TRUSTED_ABILITY_MECHANICS: Readonly<Record<string, TrustedAbilityMechanic>> = Object.freeze({
  'ashe:r': { castModel: 'directional', effects: ['stun', 'slow'] },

  // Golden truth domain. `complete` closes the normalized effect taxonomy only;
  // names, cooldowns, descriptions, ownership and slots remain sourced from Data Dragon.
  'caitlyn:p': { effects: [], complete: true },
  'caitlyn:q': { castModel: 'directional', effects: [], complete: true },
  'caitlyn:w': { castModel: 'ground-targeted', effects: ['root'], complete: true },
  'caitlyn:e': { castModel: 'directional', effects: ['dash', 'slow'], complete: true },
  'caitlyn:r': { castModel: 'target-enemy', effects: [], complete: true },

  'jinx:p': { effects: [], complete: true },
  'jinx:q': { castModel: 'self', effects: [], complete: true },
  'jinx:w': { castModel: 'directional', effects: ['slow'], complete: true },
  'jinx:e': { castModel: 'ground-targeted', effects: ['root'], complete: true },
  'jinx:r': { castModel: 'directional', effects: [], complete: true },

  'ziggs:p': { effects: [], complete: true },
  'ziggs:q': { castModel: 'directional', effects: [], complete: true },
  'ziggs:w': { castModel: 'ground-targeted', effects: ['displacement'], complete: true },
  'ziggs:e': { castModel: 'ground-targeted', effects: ['slow'], complete: true },
  'ziggs:r': { castModel: 'ground-targeted', effects: [], complete: true },

  'galio:p': { effects: [], complete: true },
  'galio:q': { castModel: 'directional', effects: [], complete: true },
  'galio:w': { castModel: 'self-centered', effects: ['shield', 'taunt'], complete: true },
  'galio:e': { castModel: 'directional', effects: ['dash', 'knock-up'], complete: true },
  'galio:r': { castModel: 'target-ally', effects: ['shield', 'knock-up'], complete: true },

  'leona:p': { effects: [], complete: true },
  'leona:q': { castModel: 'target-enemy', effects: ['stun'], complete: true },
  'leona:w': { castModel: 'self', effects: [], complete: true },
  'leona:e': { castModel: 'directional', effects: ['root', 'dash'], complete: true },
  'leona:r': { castModel: 'ground-targeted', effects: ['stun', 'slow'], complete: true },

  'lux:p': { effects: [], complete: true },
  'lux:q': { castModel: 'directional', effects: ['root'], complete: true },
  'lux:w': { castModel: 'directional', effects: ['shield'], complete: true },
  'lux:e': { castModel: 'ground-targeted', effects: ['slow'], complete: true },
  'lux:r': { castModel: 'directional', effects: [], complete: true },

  'morgana:p': { effects: ['heal'], complete: true },
  'morgana:q': { castModel: 'directional', effects: ['root'], complete: true },
  'morgana:w': { castModel: 'ground-targeted', effects: [], complete: true },
  'morgana:e': { castModel: 'target-ally', effects: ['shield'], complete: true },
  'morgana:r': { castModel: 'self-centered', effects: ['slow', 'stun'], complete: true },

  'swain:p': { effects: ['heal'], complete: true },
  'swain:q': { castModel: 'directional', effects: [], complete: true },
  'swain:w': { castModel: 'ground-targeted', effects: ['slow'], complete: true },
  'swain:e': { castModel: 'directional', effects: ['root', 'displacement'], complete: true },
  'swain:r': { castModel: 'self-centered', effects: ['heal', 'slow'], complete: true },
});
