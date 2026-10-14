import type {
  MatchupAbilityFact,
  MatchupFactPack,
  MatchupGlobalFact,
  MatchupKnowledgeFact,
} from '../knowledge/MatchupFactPack.js';
import {
  MATCHUP_STRATEGY_PLAN_VERSION,
  STRATEGY_GROUNDING_STATES,
  strategyAssertions,
  type MatchupStrategyPlan,
  type StrategyAssertion,
  type StrategyGroundingState,
} from './MatchupStrategyPlan.js';

export type StrategyPlanValidationCode =
  | 'INVALID_SHAPE'
  | 'MATCHUP_MISMATCH'
  | 'PATCH_MISMATCH'
  | 'INVALID_GROUNDING'
  | 'DUPLICATE_REFERENCE'
  | 'UNKNOWN_FACT'
  | 'UNKNOWN_PARTICIPANT'
  | 'FACT_PARTICIPANT_MISMATCH'
  | 'MISSING_PROVENANCE';

export interface StrategyPlanValidationIssue {
  readonly code: StrategyPlanValidationCode;
  readonly path: string;
  readonly message: string;
  readonly factId?: string;
  readonly participantId?: string;
}

export interface StrategyAssertionReferenceStatus {
  readonly path: string;
  readonly grounding: StrategyGroundingState;
  readonly referenceValidation: 'valid' | 'invalid' | 'not-required' | 'insufficient';
  readonly semanticSupportValidation: 'not-evaluated';
  readonly resolvedFactIds: readonly string[];
  readonly missingKnowledge: readonly string[];
}

export interface StrategyPlanValidationResult {
  readonly valid: boolean;
  readonly plan?: MatchupStrategyPlan;
  readonly issues: readonly StrategyPlanValidationIssue[];
  readonly assertions: readonly StrategyAssertionReferenceStatus[];
}

type UnknownRecord = Record<string, unknown>;
type ReferencedFact = MatchupAbilityFact | MatchupKnowledgeFact | MatchupGlobalFact;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasExactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length
    && actual.every((key, index) => key === [...keys].sort()[index]);
}

function stringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || !value.every(isNonBlankString)) return undefined;
  return value.map((item) => item.trim());
}

function parseAssertion(value: unknown): StrategyAssertion | undefined {
  if (!isRecord(value)
    || !hasExactKeys(value, ['text', 'grounding', 'participantIds', 'factIds', 'missingKnowledge'])
    || !isNonBlankString(value.text)) return undefined;
  if (typeof value.grounding !== 'string'
    || !STRATEGY_GROUNDING_STATES.includes(value.grounding as StrategyGroundingState)) return undefined;
  const participantIds = stringArray(value.participantIds);
  const factIds = stringArray(value.factIds);
  const missingKnowledge = stringArray(value.missingKnowledge);
  if (participantIds === undefined || factIds === undefined || missingKnowledge === undefined) return undefined;
  return Object.freeze({
    text: value.text.trim(),
    grounding: value.grounding as StrategyGroundingState,
    participantIds: Object.freeze(participantIds),
    factIds: Object.freeze(factIds),
    missingKnowledge: Object.freeze(missingKnowledge),
  });
}

function parseAssertionObject(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, StrategyAssertion>> | undefined {
  if (!isRecord(value) || !hasExactKeys(value, keys)) return undefined;
  const entries = keys.map((key) => [key, parseAssertion(value[key])] as const);
  if (entries.some(([, assertion]) => assertion === undefined)) return undefined;
  return Object.freeze(Object.fromEntries(entries) as Record<string, StrategyAssertion>);
}

function parsePlan(value: unknown): MatchupStrategyPlan | undefined {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'schemaVersion', 'planVersion', 'matchupId', 'patch', 'laneApproach',
      'threatResponseWindow', 'earlyLevels', 'wavePlan', 'targetPriority',
      'postLevel6', 'roamPlan',
    ])
    || value.schemaVersion !== 1
    || value.planVersion !== MATCHUP_STRATEGY_PLAN_VERSION
    || !isNonBlankString(value.matchupId)
    || !isNonBlankString(value.patch)) return undefined;
  const laneApproach = parseAssertion(value.laneApproach);
  const threat = parseAssertionObject(value.threatResponseWindow, [
    'threat', 'response', 'tradeWindow', 'winCondition',
  ]);
  const early = parseAssertionObject(value.earlyLevels, ['level1', 'level2', 'level3']);
  const wavePlan = parseAssertion(value.wavePlan);
  const targetPriority = parseAssertion(value.targetPriority);
  const postLevel6 = parseAssertion(value.postLevel6);
  const roamPlan = parseAssertion(value.roamPlan);
  if (laneApproach === undefined || threat === undefined || early === undefined
    || wavePlan === undefined || targetPriority === undefined
    || postLevel6 === undefined || roamPlan === undefined) return undefined;
  return Object.freeze({
    schemaVersion: 1,
    planVersion: MATCHUP_STRATEGY_PLAN_VERSION,
    matchupId: value.matchupId.trim(),
    patch: value.patch.trim(),
    laneApproach,
    threatResponseWindow: Object.freeze({
      threat: threat.threat!,
      response: threat.response!,
      tradeWindow: threat.tradeWindow!,
      winCondition: threat.winCondition!,
    }),
    earlyLevels: Object.freeze({
      level1: early.level1!,
      level2: early.level2!,
      level3: early.level3!,
    }),
    wavePlan,
    targetPriority,
    postLevel6,
    roamPlan,
  });
}

function duplicate(values: readonly string[]): string | undefined {
  return values.find((value, index) => values.indexOf(value) !== index);
}

function factChampionKeys(fact: ReferencedFact): readonly string[] {
  if ('ownerKey' in fact) return [fact.ownerKey];
  if ('championKeys' in fact) return fact.championKeys;
  return [];
}

function hasProvenance(fact: ReferencedFact): boolean {
  return fact.sources.length > 0;
}

export class StrategyPlanValidator {
  validate(value: unknown, factPack: MatchupFactPack): StrategyPlanValidationResult {
    const plan = parsePlan(value);
    if (plan === undefined) {
      const shapeIssue: StrategyPlanValidationIssue = Object.freeze({
        code: 'INVALID_SHAPE',
        path: '$',
        message: 'Strategy Plan does not match the required schema.',
      });
      return Object.freeze({
        valid: false,
        issues: Object.freeze([shapeIssue]),
        assertions: Object.freeze([]),
      });
    }

    const issues: StrategyPlanValidationIssue[] = [];
    if (plan.matchupId !== factPack.matchupId) {
      issues.push({ code: 'MATCHUP_MISMATCH', path: 'matchupId', message: 'Strategy Plan matchup does not match the Fact Pack.' });
    }
    if (plan.patch !== factPack.patch) {
      issues.push({ code: 'PATCH_MISMATCH', path: 'patch', message: 'Strategy Plan patch does not match the Fact Pack.' });
    }
    const facts = new Map<string, ReferencedFact>([
      ...factPack.championFacts.abilities.map((fact) => [fact.factId, fact] as const),
      ...factPack.championFacts.knowledge.map((fact) => [fact.factId, fact] as const),
      ...factPack.globalFacts.map((fact) => [fact.factId, fact] as const),
    ]);
    const participants = new Map(factPack.participants.map((entry) => [entry.participantId, entry]));
    const assertions = strategyAssertions(plan).map(({ path, assertion }): StrategyAssertionReferenceStatus => {
      const pathIssuesBefore = issues.length;
      const duplicateFact = duplicate(assertion.factIds);
      if (duplicateFact !== undefined) {
        issues.push({ code: 'DUPLICATE_REFERENCE', path, factId: duplicateFact, message: 'Duplicate fact reference.' });
      }
      const duplicateParticipant = duplicate(assertion.participantIds);
      if (duplicateParticipant !== undefined) {
        issues.push({
          code: 'DUPLICATE_REFERENCE', path, participantId: duplicateParticipant,
          message: 'Duplicate participant reference.',
        });
      }
      const participantKeys = new Set<string>();
      for (const participantId of assertion.participantIds) {
        const participant = participants.get(participantId as `${'ally' | 'enemy'}:${'carry' | 'support'}`);
        if (participant === undefined) {
          issues.push({ code: 'UNKNOWN_PARTICIPANT', path, participantId, message: 'Participant is absent from the Fact Pack.' });
        } else {
          participantKeys.add(participant.championKey);
        }
      }
      const resolvedFactIds: string[] = [];
      for (const factId of assertion.factIds) {
        const fact = facts.get(factId);
        if (fact === undefined) {
          issues.push({ code: 'UNKNOWN_FACT', path, factId, message: 'Fact is absent from the Fact Pack.' });
          continue;
        }
        resolvedFactIds.push(factId);
        if (!hasProvenance(fact)) {
          issues.push({ code: 'MISSING_PROVENANCE', path, factId, message: 'Referenced fact has no provenance.' });
        }
        for (const championKey of factChampionKeys(fact)) {
          if (!participantKeys.has(championKey)) {
            issues.push({
              code: 'FACT_PARTICIPANT_MISMATCH', path, factId,
              message: `Referenced fact belongs to unreferenced champion ${championKey}.`,
            });
          }
        }
      }
      if (assertion.grounding === 'fact-grounded'
        && (assertion.factIds.length === 0 || assertion.missingKnowledge.length > 0)) {
        issues.push({
          code: 'INVALID_GROUNDING', path,
          message: 'A fact-grounded assertion requires facts and no missing knowledge.',
        });
      }
      if (assertion.grounding === 'strategic-only'
        && (assertion.factIds.length > 0 || assertion.missingKnowledge.length > 0)) {
        issues.push({
          code: 'INVALID_GROUNDING', path,
          message: 'A strategic-only assertion cannot claim facts or missing mechanical knowledge.',
        });
      }
      if (assertion.grounding === 'insufficient' && assertion.missingKnowledge.length === 0) {
        issues.push({
          code: 'INVALID_GROUNDING', path,
          message: 'An insufficient assertion must identify missing knowledge.',
        });
      }
      const referenceValidation = issues.length !== pathIssuesBefore
        ? 'invalid'
        : assertion.grounding === 'strategic-only'
          ? 'not-required'
          : assertion.grounding === 'insufficient'
            ? 'insufficient'
            : 'valid';
      return Object.freeze({
        path,
        grounding: assertion.grounding,
        referenceValidation,
        semanticSupportValidation: 'not-evaluated',
        resolvedFactIds: Object.freeze(resolvedFactIds),
        missingKnowledge: assertion.missingKnowledge,
      });
    });
    return Object.freeze({
      valid: issues.length === 0,
      plan,
      issues: Object.freeze(issues.map((issue) => Object.freeze(issue))),
      assertions: Object.freeze(assertions),
    });
  }
}
