import {
  DATA_DRAGON_CHAMPION_ABILITIES,
  DATA_DRAGON_GAMEPLAY_VERSION,
} from './data/data-dragon-champions.js';
import type {
  AbilityAvailability,
  AbilityGameplayFact,
  AbilitySlot,
  ChampionGameplayContext,
  GameplayContext,
  GameplayContextResolver,
} from './types.js';
import {
  ATYPICAL_ABILITY_AVAILABILITY,
  TRUSTED_ABILITY_MECHANICS,
} from '../knowledge/data/trusted-mechanics.js';

type GeneratedChampion = (typeof DATA_DRAGON_CHAMPION_ABILITIES)[number];
type GeneratedAbility = GeneratedChampion['abilities'][number];

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').normalize('NFKD').replaceAll(/\p{M}/gu, '');
}

function defaultAvailability(slot: AbilitySlot): AbilityAvailability {
  return { earliestLevel: slot === 'R' ? 6 : 1 };
}

function toAbility(champion: string, ability: GeneratedAbility): AbilityGameplayFact {
  const slot = ability.slot as AbilitySlot;
  const mechanics = TRUSTED_ABILITY_MECHANICS[`${normalize(champion)}:${slot.toLocaleLowerCase('en-US')}`];
  return Object.freeze({
    slot,
    name: ability.name,
    availability: Object.freeze(
      ATYPICAL_ABILITY_AVAILABILITY[normalize(champion)]?.[slot] ?? defaultAvailability(slot),
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
