import type {
  AbilityAvailability,
  AbilityCastModel,
  AbilityEffect,
  AbilitySlot,
} from '../gameplay-context/types.js';
import type {
  KnowledgeSource,
  KnowledgeScope,
  KnowledgeSubjectKind,
  KnowledgeType,
  PatchValidity,
} from './types.js';

export const MATCHUP_FACT_PACK_VERSION = 'matchup-fact-pack-v1';

export type MatchupTeam = 'ally' | 'enemy';
export type MatchupRole = 'carry' | 'support';

export interface MatchupFactPackDuo {
  readonly carry: string;
  readonly support: string;
}

export interface MatchupFactPackRequest {
  readonly id: string;
  readonly patch: string;
  readonly ally: MatchupFactPackDuo;
  readonly enemy: MatchupFactPackDuo;
}

export interface FactSourceReference {
  readonly kind: 'data-dragon' | 'trusted-mechanics' | 'knowledge-base';
  readonly id: string;
  readonly version: string;
}

export interface MatchupAbilityFact {
  readonly factId: string;
  readonly ownerKey: string;
  readonly owner: string;
  readonly slot: AbilitySlot;
  readonly name: string;
  readonly availability: AbilityAvailability;
  readonly cooldowns?: readonly number[];
  readonly descriptions: readonly string[];
  readonly castModel?: AbilityCastModel;
  readonly effects?: readonly AbilityEffect[];
  readonly sources: readonly FactSourceReference[];
  readonly coverage: {
    readonly status: 'covered' | 'partial';
    readonly missing: readonly string[];
  };
}

export interface MatchupParticipantFacts {
  readonly participantId: `${MatchupTeam}:${MatchupRole}`;
  readonly team: MatchupTeam;
  readonly role: MatchupRole;
  readonly championKey: string;
  readonly champion: string;
  readonly abilityFactIds: readonly string[];
}

export interface MatchupKnowledgeFact {
  readonly factId: string;
  readonly type: Exclude<KnowledgeType, 'heuristic'>;
  readonly subjectKind: KnowledgeSubjectKind;
  readonly subject: string;
  readonly statement: string;
  readonly championKeys: readonly string[];
  readonly abilitySlots: readonly AbilitySlot[];
  readonly tags: readonly string[];
  readonly scope: KnowledgeScope;
  readonly validity?: PatchValidity;
  readonly sourceFactIds: readonly string[];
  readonly sources: readonly KnowledgeSource[];
}

export type MatchupGlobalFactDomain =
  | 'neutral-objective'
  | 'seasonal-mechanic'
  | 'macro-rule'
  | 'patch-rule';

/** Reserved extension point. B1 does not construct global game facts. */
export interface MatchupGlobalFact {
  readonly factId: string;
  readonly domain: MatchupGlobalFactDomain;
  readonly statement: string;
  readonly validity: PatchValidity;
  readonly sources: readonly KnowledgeSource[];
}

export interface MatchupChampionFacts {
  readonly abilities: readonly MatchupAbilityFact[];
  readonly knowledge: readonly MatchupKnowledgeFact[];
}

export interface MatchupFactPackCoverage {
  readonly status: 'full' | 'partial';
  readonly mechanicallyFullyCovered: boolean;
  readonly champions: {
    readonly covered: number;
    readonly total: number;
  };
  readonly abilities: {
    readonly covered: number;
    readonly total: number;
  };
  readonly criticalInteractions: {
    readonly status: 'covered' | 'none-known';
    readonly factIds: readonly string[];
  };
  readonly missing: readonly string[];
}

export interface MatchupFactPack {
  readonly schemaVersion: 1;
  readonly factPackVersion: typeof MATCHUP_FACT_PACK_VERSION;
  readonly matchupId: string;
  readonly patch: string;
  readonly knowledgeBaseVersion: string;
  readonly goldenTruthVersion: string;
  readonly dataDragonVersion: string;
  readonly participants: readonly MatchupParticipantFacts[];
  readonly championFacts: MatchupChampionFacts;
  readonly globalFacts: readonly MatchupGlobalFact[];
  readonly coverage: MatchupFactPackCoverage;
}

export interface StrategyAssertionFactReference {
  readonly assertion: string;
  readonly factIds: readonly string[];
}
