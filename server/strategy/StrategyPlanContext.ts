import type {
  MatchupFactPack,
  MatchupGlobalFactDomain,
  MatchupParticipantFacts,
} from '../knowledge/MatchupFactPack.js';
import type {
  AbilityAvailability,
  AbilityCastModel,
  AbilityEffect,
  AbilitySlot,
} from '../gameplay-context/types.js';

export const STRATEGY_PLAN_CONTEXT_VERSION = 'strategy-plan-context-v1';

export interface StrategyPlanContextAbilityFact {
  readonly kind: 'ability';
  readonly factId: string;
  readonly ownerKey: string;
  readonly slot: AbilitySlot;
  readonly name: string;
  readonly availability: AbilityAvailability;
  readonly cooldowns?: readonly number[];
  readonly descriptions: readonly string[];
  readonly castModel?: AbilityCastModel;
  readonly effects?: readonly AbilityEffect[];
  readonly sourceIds: readonly string[];
  readonly missing: readonly string[];
}

export interface StrategyPlanContextKnowledgeFact {
  readonly kind: 'knowledge';
  readonly factId: string;
  readonly subject: string;
  readonly statement: string;
  readonly championKeys: readonly string[];
  readonly sourceIds: readonly string[];
}

export interface StrategyPlanContextGlobalFact {
  readonly kind: 'global';
  readonly factId: string;
  readonly domain: MatchupGlobalFactDomain;
  readonly statement: string;
  readonly sourceIds: readonly string[];
}

export interface StrategyPlanGenerationContext {
  readonly contextVersion: typeof STRATEGY_PLAN_CONTEXT_VERSION;
  readonly factPackVersion: string;
  readonly matchupId: string;
  readonly patch: string;
  readonly knowledgeBaseVersion: string;
  readonly goldenTruthVersion: string;
  readonly participants: readonly MatchupParticipantFacts[];
  readonly championFacts: {
    readonly abilities: readonly StrategyPlanContextAbilityFact[];
    readonly knowledge: readonly StrategyPlanContextKnowledgeFact[];
  };
  readonly globalFacts: readonly StrategyPlanContextGlobalFact[];
  readonly coverage: MatchupFactPack['coverage'];
}

function copyParticipant(participant: MatchupParticipantFacts): MatchupParticipantFacts {
  return Object.freeze({
    ...participant,
    abilityFactIds: Object.freeze([...participant.abilityFactIds]),
  });
}

/** Builds the complete, bounded fact context. No fact selection is performed in B2. */
export function buildStrategyPlanContext(
  factPack: MatchupFactPack,
): StrategyPlanGenerationContext {
  return Object.freeze({
    contextVersion: STRATEGY_PLAN_CONTEXT_VERSION,
    factPackVersion: factPack.factPackVersion,
    matchupId: factPack.matchupId,
    patch: factPack.patch,
    knowledgeBaseVersion: factPack.knowledgeBaseVersion,
    goldenTruthVersion: factPack.goldenTruthVersion,
    participants: Object.freeze(factPack.participants.map(copyParticipant)),
    championFacts: Object.freeze({
      abilities: Object.freeze(factPack.championFacts.abilities.map((fact) => Object.freeze({
        kind: 'ability' as const,
        factId: fact.factId,
        ownerKey: fact.ownerKey,
        slot: fact.slot,
        name: fact.name,
        availability: Object.freeze({
          ...fact.availability,
          ...(fact.availability.exceptions === undefined ? {} : {
            exceptions: Object.freeze([...fact.availability.exceptions]),
          }),
        }),
        ...(fact.cooldowns === undefined ? {} : { cooldowns: Object.freeze([...fact.cooldowns]) }),
        descriptions: Object.freeze([...fact.descriptions]),
        ...(fact.castModel === undefined ? {} : { castModel: fact.castModel }),
        ...(fact.effects === undefined ? {} : { effects: Object.freeze([...fact.effects]) }),
        sourceIds: Object.freeze(fact.sources.map(({ id }) => id)),
        missing: Object.freeze([...fact.coverage.missing]),
      }))),
      knowledge: Object.freeze(factPack.championFacts.knowledge.map((fact) => Object.freeze({
        kind: 'knowledge' as const,
        factId: fact.factId,
        subject: fact.subject,
        statement: fact.statement,
        championKeys: Object.freeze([...fact.championKeys]),
        sourceIds: Object.freeze(fact.sources.map(({ name }) => name)),
      }))),
    }),
    globalFacts: Object.freeze(factPack.globalFacts.map((fact) => Object.freeze({
      kind: 'global' as const,
      factId: fact.factId,
      domain: fact.domain,
      statement: fact.statement,
      sourceIds: Object.freeze(fact.sources.map(({ name }) => name)),
    }))),
    coverage: factPack.coverage,
  });
}

