import type {
  AbilityCastModel,
  AbilityEffect,
  AbilitySlot,
  GameplayContext,
} from '../gameplay-context/types.js';

export const KNOWLEDGE_TYPES = [
  'official_fact',
  'derived_fact',
  'heuristic',
  'matchup_observation',
] as const;

export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];
export type KnowledgeSubjectKind = 'champion' | 'ability' | 'interaction' | 'lane_concept';
export type KnowledgeScope = 'structural' | 'patch-dependent';
export type KnowledgeConfidence = 'low' | 'medium' | 'high';
export type KnowledgeStatus = 'candidate' | 'verified' | 'rejected';
export type KnowledgeVerification = 'automatic' | 'human' | 'pending';
export type KnowledgeSourceType = 'riot' | 'community' | 'curated' | 'derived' | 'llm';
export type KnowledgePhase = 'lane' | 'level-1' | 'level-2' | 'level-3' | 'level-6-plus';

export interface KnowledgeSource {
  readonly type: KnowledgeSourceType;
  readonly name: string;
  readonly url?: string;
}

export interface PatchValidity {
  readonly from: string;
  readonly to?: string;
}

export interface AbilityMechanicAssertion {
  readonly kind: 'ability-mechanic';
  readonly championKey: string;
  readonly slot: AbilitySlot;
  readonly castModel?: AbilityCastModel;
  readonly effects?: readonly AbilityEffect[];
  readonly complete: boolean;
}

export interface KnowledgeEntry {
  readonly id: string;
  readonly type: KnowledgeType;
  readonly subjectKind: KnowledgeSubjectKind;
  readonly subject: string;
  readonly statement: string;
  readonly championKeys: readonly string[];
  readonly abilitySlots?: readonly AbilitySlot[];
  readonly tags: readonly string[];
  readonly phases?: readonly KnowledgePhase[];
  readonly scope: KnowledgeScope;
  readonly patch?: PatchValidity;
  readonly confidence: KnowledgeConfidence;
  readonly status: KnowledgeStatus;
  readonly verification: KnowledgeVerification;
  readonly sources: readonly KnowledgeSource[];
  readonly derivedFrom?: readonly string[];
  readonly derivationRuleId?: string;
  readonly mechanic?: AbilityMechanicAssertion;
}

export interface DerivationRule {
  readonly id: string;
  readonly description: string;
  readonly validated: boolean;
}

export interface KnowledgeCoverage {
  readonly status: 'full' | 'partial' | 'none';
  readonly coveredChampions: number;
  readonly totalChampions: number;
  readonly relevantKnowledgeCount: number;
}

export interface ResolvedKnowledgeContext {
  readonly version: string;
  readonly gameplay: GameplayContext;
  readonly officialFacts: readonly KnowledgeEntry[];
  readonly derivedMechanics: readonly KnowledgeEntry[];
  readonly heuristics: readonly KnowledgeEntry[];
  readonly matchupObservations: readonly KnowledgeEntry[];
  readonly coverage: KnowledgeCoverage;
}

export interface KnowledgeResolutionRequest {
  readonly champions: readonly string[];
  readonly patch: string;
  readonly phases?: readonly KnowledgePhase[];
}

export interface KnowledgeContextResolver {
  resolve(request: KnowledgeResolutionRequest): ResolvedKnowledgeContext;
}
