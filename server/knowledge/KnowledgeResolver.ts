import { StaticGameplayContextResolver } from '../gameplay-context/StaticGameplayContextResolver.js';
import type { GameplayContextResolver } from '../gameplay-context/types.js';
import type { KnowledgeRepository } from './KnowledgeRepository.js';
import type {
  KnowledgeContextResolver,
  KnowledgeEntry,
  KnowledgePhase,
  KnowledgeResolutionRequest,
  ResolvedKnowledgeContext,
} from './types.js';

const TYPE_PRIORITY = new Map([
  ['official_fact', 0],
  ['derived_fact', 1],
  ['heuristic', 2],
  ['matchup_observation', 3],
] as const);
const CONFIDENCE_PRIORITY = new Map([['high', 0], ['medium', 1], ['low', 2]] as const);

export function normalizeChampionKey(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').normalize('NFKD').replaceAll(/\p{M}/gu, '')
    .replaceAll(/[^a-z0-9]+/gu, '');
}

function patchParts(value: string): readonly number[] {
  return value.split('.').map(Number);
}

function comparePatch(left: string, right: string): number {
  const a = patchParts(left);
  const b = patchParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function patchApplies(entry: KnowledgeEntry, patch: string): boolean {
  if (entry.scope === 'structural') return true;
  if (entry.patch === undefined || comparePatch(patch, entry.patch.from) < 0) return false;
  return entry.patch.to === undefined || comparePatch(patch, entry.patch.to) <= 0;
}

function phaseApplies(entry: KnowledgeEntry, phases: readonly KnowledgePhase[]): boolean {
  return entry.phases === undefined || entry.phases.some((phase) => phases.includes(phase));
}

export class KnowledgeResolver implements KnowledgeContextResolver {
  constructor(
    private readonly repository: KnowledgeRepository,
    private readonly gameplayResolver: GameplayContextResolver = new StaticGameplayContextResolver(),
    private readonly budget = 24,
  ) {
    if (!Number.isSafeInteger(budget) || budget < 0) throw new Error('Knowledge budget must be a non-negative integer.');
  }

  resolve(request: KnowledgeResolutionRequest): ResolvedKnowledgeContext {
    const gameplay = this.gameplayResolver.resolve(request.champions);
    const requestedKeys = request.champions.map(normalizeChampionKey);
    const requested = new Set(requestedKeys);
    const phases = request.phases ?? ['lane'];
    const relevant = this.repository.entries()
      .filter((entry) => entry.status === 'verified')
      .filter((entry) => patchApplies(entry, request.patch))
      .filter((entry) => phaseApplies(entry, phases))
      .filter((entry) => entry.championKeys.some((key) => requested.has(normalizeChampionKey(key))))
      .filter((entry) => entry.type !== 'matchup_observation'
        || entry.championKeys.every((key) => requested.has(normalizeChampionKey(key))))
      .sort((left, right) =>
        (TYPE_PRIORITY.get(left.type) ?? 99) - (TYPE_PRIORITY.get(right.type) ?? 99)
        || (CONFIDENCE_PRIORITY.get(left.confidence) ?? 99) - (CONFIDENCE_PRIORITY.get(right.confidence) ?? 99)
        || left.id.localeCompare(right.id))
      .filter((entry, index, entries) => entries.findIndex(({ id }) => id === entry.id) === index)
      .slice(0, this.budget);

    const covered = new Set(relevant.flatMap(({ championKeys }) => championKeys.map(normalizeChampionKey)));
    const coveredChampions = requestedKeys.filter((key) => covered.has(key)).length;
    const totalChampions = requestedKeys.length;
    const coverageStatus = coveredChampions === 0
      ? 'none'
      : coveredChampions === totalChampions ? 'full' : 'partial';
    const byType = (type: KnowledgeEntry['type']) => Object.freeze(relevant.filter((entry) => entry.type === type));

    return Object.freeze({
      version: this.repository.version,
      gameplay,
      officialFacts: byType('official_fact'),
      derivedMechanics: byType('derived_fact'),
      heuristics: byType('heuristic'),
      matchupObservations: byType('matchup_observation'),
      coverage: Object.freeze({
        status: coverageStatus,
        coveredChampions,
        totalChampions,
        relevantKnowledgeCount: relevant.length,
      }),
    });
  }
}

export class GameplayOnlyKnowledgeResolver implements KnowledgeContextResolver {
  constructor(
    private readonly gameplayResolver: GameplayContextResolver = new StaticGameplayContextResolver(),
  ) {}

  resolve(request: KnowledgeResolutionRequest): ResolvedKnowledgeContext {
    return Object.freeze({
      version: 'disabled',
      gameplay: this.gameplayResolver.resolve(request.champions),
      officialFacts: Object.freeze([]),
      derivedMechanics: Object.freeze([]),
      heuristics: Object.freeze([]),
      matchupObservations: Object.freeze([]),
      coverage: Object.freeze({
        status: 'none',
        coveredChampions: 0,
        totalChampions: request.champions.length,
        relevantKnowledgeCount: 0,
      }),
    });
  }
}
