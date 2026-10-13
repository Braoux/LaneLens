import type { AppLocale } from '../../shared/locale.js';
import type { MatchupAnalysisInput, PatchContext } from '../analysis/types.js';
import type {
  AbilityGameplayFact,
  ChampionGameplayContext,
  GameplayContext,
} from '../gameplay-context/types.js';
import type { MatchupAbilityFact, MatchupFactPack } from '../knowledge/MatchupFactPack.js';

function abilityToGameplayFact(fact: MatchupAbilityFact): AbilityGameplayFact {
  return Object.freeze({
    slot: fact.slot,
    name: fact.name,
    availability: fact.availability,
    ...(fact.cooldowns === undefined ? {} : { cooldowns: fact.cooldowns }),
    facts: Object.freeze([...fact.descriptions, ...(fact.effects ?? [])]),
    ...(fact.castModel === undefined ? {} : { castModel: fact.castModel }),
    ...(fact.effects === undefined ? {} : { effects: fact.effects }),
  });
}

export function gameplayContextFromFactPack(factPack: MatchupFactPack): GameplayContext {
  const abilitiesByOwner = new Map<string, MatchupAbilityFact[]>();
  for (const fact of factPack.championFacts.abilities) {
    const current = abilitiesByOwner.get(fact.ownerKey) ?? [];
    current.push(fact);
    abilitiesByOwner.set(fact.ownerKey, current);
  }
  const champions = [...new Map(factPack.participants.map((participant) => [
    participant.championKey,
    participant.champion,
  ])).entries()].map(([championKey, champion]): ChampionGameplayContext => Object.freeze({
    champion,
    dataDragonVersion: factPack.dataDragonVersion,
    abilities: Object.freeze((abilitiesByOwner.get(championKey) ?? []).map(abilityToGameplayFact)),
  }));
  return Object.freeze({ champions: Object.freeze(champions) });
}

export function patchContextFromFactPack(factPack: MatchupFactPack): PatchContext {
  const knowledgeFacts = factPack.championFacts.knowledge.map((fact) => Object.freeze({
    subject: fact.subject,
    text: fact.statement,
  }));
  const abilityFacts = factPack.championFacts.abilities.map((fact) => Object.freeze({
    subject: `${fact.owner}:${fact.slot}`,
    text: [...fact.descriptions, ...(fact.effects ?? [])].join(' '),
  }));
  return Object.freeze({
    patch: factPack.patch,
    contextVersion: `${factPack.knowledgeBaseVersion}+${factPack.goldenTruthVersion}`,
    facts: Object.freeze([...knowledgeFacts, ...abilityFacts]),
  });
}

function championFor(factPack: MatchupFactPack, participantId: string): string {
  const participant = factPack.participants.find((entry) => entry.participantId === participantId);
  if (participant === undefined) throw new Error(`Missing Fact Pack participant: ${participantId}`);
  return participant.champion;
}

export function analysisInputFromFactPack(
  factPack: MatchupFactPack,
  locale: AppLocale,
): MatchupAnalysisInput {
  return Object.freeze({
    allyCarry: championFor(factPack, 'ally:carry'),
    allySupport: championFor(factPack, 'ally:support'),
    enemyCarry: championFor(factPack, 'enemy:carry'),
    enemySupport: championFor(factPack, 'enemy:support'),
    patch: factPack.patch,
    locale,
    patchContext: patchContextFromFactPack(factPack),
  });
}
