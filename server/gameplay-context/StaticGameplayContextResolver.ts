import {
  DATA_DRAGON_CHAMPION_ABILITIES,
  DATA_DRAGON_GAMEPLAY_VERSION,
} from './data/data-dragon-champions.js';
import type {
  AbilityAvailability,
  AbilityCastModel,
  AbilityEffect,
  AbilityGameplayFact,
  AbilitySlot,
  ChampionGameplayContext,
  GameplayContext,
  GameplayContextResolver,
} from './types.js';

type GeneratedChampion = (typeof DATA_DRAGON_CHAMPION_ABILITIES)[number];
type GeneratedAbility = GeneratedChampion['abilities'][number];

const ATYPICAL_AVAILABILITY: Readonly<Record<string, Partial<Record<AbilitySlot, AbilityAvailability>>>> = {
  elise: { R: { earliestLevel: 1, exceptions: ['Forme Araignée disponible dès le niveau 1.'] } },
  jayce: { R: { earliestLevel: 1, exceptions: ['Transformation disponible dès le niveau 1.'] } },
  karma: { R: { earliestLevel: 1, exceptions: ['Mantra disponible dès le niveau 1.'] } },
  nidalee: { R: { earliestLevel: 1, exceptions: ['Aspect du Couguar disponible dès le niveau 1.'] } },
  udyr: { R: { earliestLevel: 1, exceptions: ['Posture Tempête accessible comme capacité de base.'] } },
};

interface AbilityMechanicsOverride {
  readonly castModel?: AbilityCastModel;
  readonly effects?: readonly AbilityEffect[];
}

const TRUSTED_MECHANICS: Readonly<Record<string, AbilityMechanicsOverride>> = {
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
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').normalize('NFKD').replaceAll(/\p{M}/gu, '');
}

function defaultAvailability(slot: AbilitySlot): AbilityAvailability {
  return { earliestLevel: slot === 'R' ? 6 : 1 };
}

function toAbility(champion: string, ability: GeneratedAbility): AbilityGameplayFact {
  const slot = ability.slot as AbilitySlot;
  const mechanics = TRUSTED_MECHANICS[`${normalize(champion)}:${slot.toLocaleLowerCase('en-US')}`];
  return Object.freeze({
    slot,
    name: ability.name,
    availability: Object.freeze(
      ATYPICAL_AVAILABILITY[normalize(champion)]?.[slot] ?? defaultAvailability(slot),
    ),
    cooldowns: Object.freeze([...ability.cooldowns]),
    facts: Object.freeze([...ability.facts]),
    castModel: mechanics?.castModel,
    effects: mechanics?.effects === undefined ? undefined : Object.freeze([...mechanics.effects]),
  });
}

function toChampion(champion: GeneratedChampion): ChampionGameplayContext {
  return Object.freeze({
    champion: champion.champion,
    dataDragonVersion: DATA_DRAGON_GAMEPLAY_VERSION,
    abilities: Object.freeze(champion.abilities.map((ability) => toAbility(champion.champion, ability))),
  });
}

const DEFAULT_CONTEXTS = new Map(
  DATA_DRAGON_CHAMPION_ABILITIES.map((champion) => {
    const context = toChampion(champion);
    return [normalize(context.champion), context] as const;
  }),
);

export class GameplayContextNotFoundError extends Error {
  constructor() {
    super('Trusted gameplay context is unavailable.');
    this.name = 'GameplayContextNotFoundError';
  }
}

export class StaticGameplayContextResolver implements GameplayContextResolver {
  private readonly contexts: ReadonlyMap<string, ChampionGameplayContext>;

  constructor(contexts: readonly ChampionGameplayContext[] = [...DEFAULT_CONTEXTS.values()]) {
    this.contexts = new Map(contexts.map((context) => [normalize(context.champion), context]));
  }

  resolve(champions: readonly string[]): GameplayContext {
    const resolved = champions.map((champion) => this.contexts.get(normalize(champion)));
    if (resolved.some((context) => context === undefined)) {
      throw new GameplayContextNotFoundError();
    }

    return Object.freeze({
      champions: Object.freeze(resolved as ChampionGameplayContext[]),
    });
  }
}
