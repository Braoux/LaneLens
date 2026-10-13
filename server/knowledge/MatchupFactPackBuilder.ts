import {
  ABILITY_SLOTS,
  type AbilitySlot,
  type ChampionGameplayContext,
  type GameplayContextResolver,
} from '../gameplay-context/types.js';
import {
  GameplayContextNotFoundError,
  StaticGameplayContextResolver,
} from '../gameplay-context/StaticGameplayContextResolver.js';
import type { KnowledgeRepository } from './KnowledgeRepository.js';
import { KnowledgeResolver, normalizeChampionKey } from './KnowledgeResolver.js';
import { StaticKnowledgeRepository } from './StaticKnowledgeRepository.js';
import {
  evaluateMechanicalCoverage,
  type ChampionMechanicalCoverage,
} from './MechanicalCoverageGate.js';
import { MECHANICAL_GOLDEN_TRUTH } from './data/mechanical-golden-truth.js';
import {
  TRUSTED_ABILITY_MECHANICS,
  type TrustedAbilityMechanic,
} from './data/trusted-mechanics.js';
import {
  MATCHUP_FACT_PACK_VERSION,
  type FactSourceReference,
  type MatchupAbilityFact,
  type MatchupFactPack,
  type MatchupFactPackRequest,
  type MatchupKnowledgeFact,
  type MatchupParticipantFacts,
  type MatchupRole,
  type MatchupTeam,
} from './MatchupFactPack.js';
import type { KnowledgeEntry } from './types.js';

const ALL_PHASES = ['lane', 'level-1', 'level-2', 'level-3', 'level-6-plus'] as const;

export class MatchupFactPackInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MatchupFactPackInputError';
  }
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new MatchupFactPackInputError(`${field} must be non-blank.`);
  return normalized;
}

function mechanicKey(champion: string, slot: AbilitySlot): string {
  return `${normalizeChampionKey(champion)}:${slot.toLocaleLowerCase('en-US')}`;
}

function abilityFactId(champion: string, slot: AbilitySlot): string {
  return `ability:${normalizeChampionKey(champion)}:${slot.toLocaleLowerCase('en-US')}`;
}

function dataDragonSourceId(version: string, champion: string, slot: AbilitySlot): string {
  return `data-dragon:${version}:${normalizeChampionKey(champion)}:${slot.toLocaleLowerCase('en-US')}`;
}

function trustedMechanicSourceId(champion: string, slot: AbilitySlot): string {
  return `trusted-mechanics:${normalizeChampionKey(champion)}:${slot.toLocaleLowerCase('en-US')}`;
}

function participant(
  team: MatchupTeam,
  role: MatchupRole,
  champion: string,
  context: ChampionGameplayContext,
): MatchupParticipantFacts {
  return Object.freeze({
    participantId: `${team}:${role}`,
    team,
    role,
    championKey: normalizeChampionKey(champion),
    champion: context.champion,
    abilityFactIds: Object.freeze(ABILITY_SLOTS.map((slot) => abilityFactId(champion, slot))),
  });
}

function abilitySources(
  context: ChampionGameplayContext,
  slot: AbilitySlot,
  mechanic: TrustedAbilityMechanic | undefined,
  mechanicEntry: KnowledgeEntry | undefined,
  knowledgeBaseVersion: string,
): readonly FactSourceReference[] {
  return Object.freeze([
    Object.freeze({
      kind: 'data-dragon' as const,
      id: dataDragonSourceId(context.dataDragonVersion, context.champion, slot),
      version: context.dataDragonVersion,
    }),
    ...(mechanic === undefined ? [] : [Object.freeze({
      kind: 'trusted-mechanics' as const,
      id: trustedMechanicSourceId(context.champion, slot),
      version: MECHANICAL_GOLDEN_TRUTH.version,
    })]),
    ...(mechanicEntry === undefined ? [] : [Object.freeze({
      kind: 'knowledge-base' as const,
      id: mechanicEntry.id,
      version: knowledgeBaseVersion,
    })]),
  ]);
}

function toKnowledgeFact(entry: KnowledgeEntry): MatchupKnowledgeFact {
  return Object.freeze({
    factId: entry.id,
    type: entry.type as MatchupKnowledgeFact['type'],
    subjectKind: entry.subjectKind,
    subject: entry.subject,
    statement: entry.statement,
    championKeys: Object.freeze([...entry.championKeys]),
    abilitySlots: Object.freeze([...(entry.abilitySlots ?? [])]),
    tags: Object.freeze([...entry.tags]),
    scope: entry.scope,
    ...(entry.patch === undefined ? {} : { validity: Object.freeze({ ...entry.patch }) }),
    sourceFactIds: Object.freeze([...(entry.derivedFrom ?? [])]),
    sources: Object.freeze(entry.sources.map((source) => Object.freeze({ ...source }))),
  });
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

export class MatchupFactPackBuilder {
  constructor(
    private readonly repository: KnowledgeRepository = new StaticKnowledgeRepository(),
    private readonly gameplayResolver: GameplayContextResolver = new StaticGameplayContextResolver(),
    private readonly mechanics: Readonly<Record<string, TrustedAbilityMechanic>> = TRUSTED_ABILITY_MECHANICS,
  ) {}

  build(rawRequest: MatchupFactPackRequest): MatchupFactPack {
    const request = Object.freeze({
      id: required(rawRequest.id, 'id'),
      patch: required(rawRequest.patch, 'patch'),
      ally: Object.freeze({
        carry: required(rawRequest.ally.carry, 'ally.carry'),
        support: required(rawRequest.ally.support, 'ally.support'),
      }),
      enemy: Object.freeze({
        carry: required(rawRequest.enemy.carry, 'enemy.carry'),
        support: required(rawRequest.enemy.support, 'enemy.support'),
      }),
    });
    const requested = [
      request.ally.carry,
      request.ally.support,
      request.enemy.carry,
      request.enemy.support,
    ];
    let knowledge;
    try {
      knowledge = new KnowledgeResolver(
        this.repository,
        this.gameplayResolver,
        Number.MAX_SAFE_INTEGER,
      ).resolve({ champions: requested, patch: request.patch, phases: ALL_PHASES });
    } catch (error) {
      if (error instanceof GameplayContextNotFoundError) {
        throw new MatchupFactPackInputError('Gameplay context is unavailable for one or more champions.');
      }
      throw error;
    }

    const contexts = new Map(knowledge.gameplay.champions.map((context) => [
      normalizeChampionKey(context.champion), context,
    ]));
    const contextFor = (champion: string): ChampionGameplayContext => {
      const context = contexts.get(normalizeChampionKey(champion));
      if (context === undefined) throw new MatchupFactPackInputError(`Gameplay context missing for ${champion}.`);
      return context;
    };
    const participants = Object.freeze([
      participant('ally', 'carry', request.ally.carry, contextFor(request.ally.carry)),
      participant('ally', 'support', request.ally.support, contextFor(request.ally.support)),
      participant('enemy', 'carry', request.enemy.carry, contextFor(request.enemy.carry)),
      participant('enemy', 'support', request.enemy.support, contextFor(request.enemy.support)),
    ]);
    const coverageResult = evaluateMechanicalCoverage([request], request.patch, {
      gameplayResolver: this.gameplayResolver,
      mechanics: this.mechanics,
    });
    const matchupCoverage = coverageResult.matchups[0]!;
    const coverageByChampion = new Map(matchupCoverage.champions.map((coverage) => [
      normalizeChampionKey(coverage.champion), coverage,
    ]));
    const officialMechanics = new Map(
      knowledge.officialFacts
        .filter((entry) => entry.mechanic !== undefined)
        .map((entry) => [mechanicKey(entry.mechanic!.championKey, entry.mechanic!.slot), entry]),
    );
    const uniqueContexts = [...new Map(participants.map(({ championKey }) => [
      championKey, contexts.get(championKey)!,
    ])).values()];
    const abilities = Object.freeze(uniqueContexts.flatMap((context) => {
      const championCoverage = coverageByChampion.get(normalizeChampionKey(context.champion));
      return ABILITY_SLOTS.map((slot): MatchupAbilityFact => {
        const ability = context.abilities.find((candidate) => candidate.slot === slot);
        const missing = ability === undefined
          ? [`${context.champion} ${slot} ability missing`]
          : championCoverage?.issues
            .filter((candidate) => candidate.slot === slot)
            .map(({ message }) => message) ?? [];
        if (ability === undefined) {
          return Object.freeze({
            factId: abilityFactId(context.champion, slot),
            ownerKey: normalizeChampionKey(context.champion),
            owner: context.champion,
            slot,
            name: 'UNKNOWN',
            availability: Object.freeze({ earliestLevel: slot === 'R' ? 6 : 1 }),
            descriptions: Object.freeze([]),
            sources: Object.freeze([]),
            coverage: Object.freeze({ status: 'partial', missing: Object.freeze(missing) }),
          });
        }
        const key = mechanicKey(context.champion, slot);
        return Object.freeze({
          factId: abilityFactId(context.champion, slot),
          ownerKey: normalizeChampionKey(context.champion),
          owner: context.champion,
          slot,
          name: ability.name,
          availability: Object.freeze({
            ...ability.availability,
            ...(ability.availability.exceptions === undefined ? {} : {
              exceptions: Object.freeze([...ability.availability.exceptions]),
            }),
          }),
          ...(ability.cooldowns === undefined ? {} : {
            cooldowns: Object.freeze([...ability.cooldowns]),
          }),
          descriptions: Object.freeze([...ability.facts]),
          ...(ability.castModel === undefined ? {} : { castModel: ability.castModel }),
          ...(ability.effects === undefined ? {} : { effects: Object.freeze([...ability.effects]) }),
          sources: abilitySources(
            context,
            slot,
            this.mechanics[key],
            officialMechanics.get(key),
            knowledge.version,
          ),
          coverage: Object.freeze({
            status: missing.length === 0 ? 'covered' : 'partial',
            missing: Object.freeze(missing),
          }),
        });
      });
    }));
    const knowledgeFacts = Object.freeze([
      ...knowledge.officialFacts,
      ...knowledge.derivedMechanics,
      ...knowledge.matchupObservations,
    ]
      .filter((entry) => entry.mechanic === undefined)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(toKnowledgeFact));
    const interactionFactIds = Object.freeze(knowledgeFacts
      .filter(({ subjectKind }) => subjectKind === 'interaction')
      .map(({ factId }) => factId));
    const abilityMissing = abilities.flatMap(({ coverage }) => coverage.missing);
    const missing = unique([...matchupCoverage.missing, ...abilityMissing]);
    const coveredAbilities = abilities.filter(({ coverage }) => coverage.status === 'covered').length;
    const coveredChampions = matchupCoverage.champions
      .filter(({ fullyCovered }: ChampionMechanicalCoverage) => fullyCovered).length;

    return Object.freeze({
      schemaVersion: 1,
      factPackVersion: MATCHUP_FACT_PACK_VERSION,
      matchupId: request.id,
      patch: request.patch,
      knowledgeBaseVersion: knowledge.version,
      goldenTruthVersion: coverageResult.goldenTruthVersion,
      dataDragonVersion: uniqueContexts[0]?.dataDragonVersion ?? MECHANICAL_GOLDEN_TRUTH.dataDragonVersion,
      participants,
      championFacts: Object.freeze({ abilities, knowledge: knowledgeFacts }),
      globalFacts: Object.freeze([]),
      coverage: Object.freeze({
        status: matchupCoverage.fullyCovered && coveredAbilities === abilities.length ? 'full' : 'partial',
        mechanicallyFullyCovered: matchupCoverage.fullyCovered,
        champions: Object.freeze({ covered: coveredChampions, total: matchupCoverage.champions.length }),
        abilities: Object.freeze({ covered: coveredAbilities, total: abilities.length }),
        criticalInteractions: Object.freeze({
          status: interactionFactIds.length === 0 ? 'none-known' : 'covered',
          factIds: interactionFactIds,
        }),
        missing,
      }),
    });
  }
}
