export const ABILITY_SLOTS = ['P', 'Q', 'W', 'E', 'R'] as const;

export type AbilitySlot = (typeof ABILITY_SLOTS)[number];

export type AbilityCastModel =
  | 'self'
  | 'self-centered'
  | 'target-ally'
  | 'target-enemy'
  | 'ground-targeted'
  | 'directional';

export type AbilityEffect =
  | 'shield'
  | 'heal'
  | 'dash'
  | 'stun'
  | 'root'
  | 'slow'
  | 'knock-up'
  | 'displacement'
  | 'silence'
  | 'fear'
  | 'charm'
  | 'taunt';

export interface AbilityAvailability {
  readonly earliestLevel: number;
  readonly exceptions?: readonly string[];
}

export interface AbilityGameplayFact {
  readonly slot: AbilitySlot;
  readonly name: string;
  readonly availability: AbilityAvailability;
  readonly cooldowns?: readonly number[];
  readonly facts: readonly string[];
  readonly castModel?: AbilityCastModel;
  readonly effects?: readonly AbilityEffect[];
}

export interface ChampionGameplayContext {
  readonly champion: string;
  readonly dataDragonVersion: string;
  readonly abilities: readonly AbilityGameplayFact[];
}

export interface GameplayContext {
  readonly champions: readonly ChampionGameplayContext[];
}

export interface GameplayContextResolver {
  resolve(champions: readonly string[]): GameplayContext;
}
