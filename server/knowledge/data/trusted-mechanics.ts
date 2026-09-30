import type {
  AbilityAvailability,
  AbilityCastModel,
  AbilityEffect,
  AbilitySlot,
} from '../../gameplay-context/types.js';

export interface TrustedAbilityMechanic {
  readonly castModel?: AbilityCastModel;
  readonly effects?: readonly AbilityEffect[];
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
  'caitlyn:e': { castModel: 'directional', effects: ['dash', 'slow'] },
  'galio:w': { castModel: 'self-centered', effects: ['shield', 'taunt'] },
  'galio:e': { castModel: 'directional', effects: ['dash', 'knock-up'] },
  'leona:q': { castModel: 'target-enemy', effects: ['stun'] },
  'leona:e': { castModel: 'directional', effects: ['root', 'dash'] },
  'lux:w': { castModel: 'directional', effects: ['shield'] },
  'lux:e': { castModel: 'ground-targeted', effects: ['slow'] },
  'morgana:e': { castModel: 'target-ally', effects: ['shield'] },
  'swain:w': { castModel: 'ground-targeted', effects: ['slow'] },
  'swain:e': { castModel: 'directional', effects: ['root', 'displacement'] },
  'ziggs:w': { castModel: 'ground-targeted', effects: ['displacement'] },
  'ziggs:e': { castModel: 'ground-targeted', effects: ['slow'] },
  'ziggs:r': { castModel: 'ground-targeted' },
});
