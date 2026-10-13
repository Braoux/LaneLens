import {
  AnalysisConformanceValidator,
  type AnalysisConformanceCode,
  type AnalysisConformanceViolation,
  type AnalysisRejectionCategory,
} from '../analysis/AnalysisConformanceValidator.js';
import type { MatchupAnalysis } from '../analysis/types.js';
import type {
  MatchupAbilityFact,
  MatchupFactPack,
  MatchupGlobalFact,
  MatchupKnowledgeFact,
} from '../knowledge/MatchupFactPack.js';
import { normalizeChampionKey } from '../knowledge/KnowledgeResolver.js';
import {
  strategyAssertions,
  type MatchupStrategyPlan,
  type StrategyAssertion,
  type StrategyGroundingState,
} from './MatchupStrategyPlan.js';
import {
  StrategyPlanValidator,
  type StrategyPlanValidationCode,
  type StrategyPlanValidationIssue,
} from './StrategyPlanValidator.js';
import {
  gameplayContextFromFactPack,
  patchContextFromFactPack,
} from './StrategyPlanFactPackAdapter.js';

export type StrategyPlanPreRenderCode =
  | StrategyPlanValidationCode
  | AnalysisConformanceCode
  | 'FACT_NOT_SUPPORTING_ASSERTION'
  | 'INSUFFICIENT_MECHANICAL_SUPPORT';

export type StrategyPlanPreRenderCategory =
  | AnalysisRejectionCategory
  | 'STRUCTURE'
  | 'REFERENCE'
  | 'GROUNDING'
  | 'INSUFFICIENT_SUPPORT';

export interface StrategyPlanPreRenderDiagnostic {
  readonly code: StrategyPlanPreRenderCode;
  readonly path: string;
  readonly rule: string;
  readonly factIds: readonly string[];
  readonly reason: string;
  readonly category: StrategyPlanPreRenderCategory;
  readonly severity: 'error' | 'warning';
  readonly repairable: boolean;
}

export interface StrategyPlanAssertionValidation {
  readonly path: string;
  readonly grounding: StrategyGroundingState;
  readonly referenceValidation: 'valid' | 'invalid' | 'not-required' | 'insufficient';
  readonly mechanicalValidation: 'supported' | 'invalid' | 'insufficient' | 'not-applicable';
  readonly factIds: readonly string[];
}

export interface StrategyPlanPreRenderResult {
  readonly valid: boolean;
  readonly plan?: MatchupStrategyPlan;
  readonly diagnostics: readonly StrategyPlanPreRenderDiagnostic[];
  readonly assertions: readonly StrategyPlanAssertionValidation[];
}

type ReferencedFact = MatchupAbilityFact | MatchupKnowledgeFact | MatchupGlobalFact;

const REFERENCE_CATEGORY: Readonly<Record<StrategyPlanValidationCode, StrategyPlanPreRenderCategory>> = {
  INVALID_SHAPE: 'STRUCTURE',
  MATCHUP_MISMATCH: 'STRUCTURE',
  PATCH_MISMATCH: 'STRUCTURE',
  INVALID_GROUNDING: 'GROUNDING',
  DUPLICATE_REFERENCE: 'REFERENCE',
  UNKNOWN_FACT: 'REFERENCE',
  UNKNOWN_PARTICIPANT: 'REFERENCE',
  FACT_PARTICIPANT_MISMATCH: 'REFERENCE',
  MISSING_PROVENANCE: 'REFERENCE',
};

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('fr-FR')
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .replaceAll(/[’']/gu, ' ')
    .replaceAll(/[^a-z0-9]+/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function participantChampion(factPack: MatchupFactPack, participantId: string): string {
  return factPack.participants.find((participant) => participant.participantId === participantId)?.champion
    ?? 'Unknown';
}

function toConformanceAnalysis(plan: MatchupStrategyPlan, factPack: MatchupFactPack): MatchupAnalysis {
  return {
    matchup: {
      allyCarry: participantChampion(factPack, 'ally:carry'),
      allySupport: participantChampion(factPack, 'ally:support'),
      enemyCarry: participantChampion(factPack, 'enemy:carry'),
      enemySupport: participantChampion(factPack, 'enemy:support'),
      patch: plan.patch,
    },
    lanePlan: plan.laneApproach.text,
    threatResponseWindow: {
      threat: plan.threatResponseWindow.threat.text,
      response: plan.threatResponseWindow.response.text,
      window: plan.threatResponseWindow.tradeWindow.text,
      winCondition: plan.threatResponseWindow.winCondition.text,
    },
    earlyLevels: {
      level1: plan.earlyLevels.level1.text,
      level2: plan.earlyLevels.level2.text,
      level3: plan.earlyLevels.level3.text,
    },
    wavePlan: plan.wavePlan.text,
    targetPriority: {
      primaryTarget: plan.targetPriority.text,
      explanation: plan.targetPriority.text,
    },
    postLevel6: plan.postLevel6.text,
    roamPlan: plan.roamPlan.text,
    cheatSheet: ['Follow the validated strategy plan.'],
    goldenRule: 'Follow the validated strategy plan.',
  };
}

function strategyPath(path: string): string {
  if (path === 'lanePlan') return 'laneApproach';
  if (path === 'threatResponseWindow.window') return 'threatResponseWindow.tradeWindow';
  if (path === 'targetPriority.explanation') return 'targetPriority';
  return path;
}

function referenceDiagnostic(issue: StrategyPlanValidationIssue): StrategyPlanPreRenderDiagnostic {
  return Object.freeze({
    code: issue.code,
    path: issue.path,
    rule: `strategy-reference.${issue.code.toLocaleLowerCase('en-US')}`,
    factIds: Object.freeze(issue.factId === undefined ? [] : [issue.factId]),
    reason: issue.message,
    category: REFERENCE_CATEGORY[issue.code],
    severity: 'error',
    repairable: !['INVALID_SHAPE', 'MATCHUP_MISMATCH', 'PATCH_MISMATCH', 'MISSING_PROVENANCE']
      .includes(issue.code),
  });
}

function conformanceFactIds(
  violation: AnalysisConformanceViolation,
  assertion: StrategyAssertion | undefined,
): readonly string[] {
  if (violation.subject !== undefined) {
    const [champion, slot] = violation.subject.split(':');
    if (champion !== undefined && slot !== undefined) {
      return Object.freeze([`ability:${normalizeChampionKey(champion)}:${slot.toLocaleLowerCase('en-US')}`]);
    }
  }
  if (violation.knowledgeId !== undefined) return Object.freeze([violation.knowledgeId]);
  return Object.freeze([...(assertion?.factIds ?? [])]);
}

function conformanceDiagnostic(
  violation: AnalysisConformanceViolation,
  assertion: StrategyAssertion | undefined,
): StrategyPlanPreRenderDiagnostic {
  return Object.freeze({
    code: violation.code,
    path: strategyPath(violation.path),
    rule: `analysis-conformance.${violation.code.toLocaleLowerCase('en-US')}`,
    factIds: conformanceFactIds(violation, assertion),
    reason: `Mechanical conformance rule ${violation.code} rejected or could not prove this assertion.`,
    category: violation.category ?? 'INSUFFICIENT_SUPPORT',
    severity: violation.severity,
    repairable: true,
  });
}

function factCatalog(factPack: MatchupFactPack): ReadonlyMap<string, ReferencedFact> {
  return new Map<string, ReferencedFact>([
    ...factPack.championFacts.abilities.map((fact) => [fact.factId, fact] as const),
    ...factPack.championFacts.knowledge.map((fact) => [fact.factId, fact] as const),
    ...factPack.globalFacts.map((fact) => [fact.factId, fact] as const),
  ]);
}

function mentionedChampionKeys(text: string, factPack: MatchupFactPack): ReadonlySet<string> {
  const normalized = normalize(text);
  const keys = new Set<string>();
  for (const participant of factPack.participants) {
    if (new RegExp(`\\b${escapeRegExp(normalize(participant.champion))}\\b`, 'u').test(normalized)) {
      keys.add(participant.championKey);
    }
  }
  for (const ability of factPack.championFacts.abilities) {
    if (normalize(ability.name).length >= 3 && normalized.includes(normalize(ability.name))) {
      keys.add(ability.ownerKey);
    }
  }
  return keys;
}

function abilityFactRelevant(text: string, fact: MatchupAbilityFact): boolean {
  const normalized = normalize(text);
  if (normalize(fact.name).length >= 3 && normalized.includes(normalize(fact.name))) return true;
  const owner = escapeRegExp(normalize(fact.owner));
  const slot = fact.slot.toLocaleLowerCase('en-US');
  return new RegExp(
    `(?:\\b${owner}\\s+(?:s\\s+)?${slot}\\b|\\b${slot}\\s+(?:de|d|of)\\s+${owner}\\b)`,
    'u',
  ).test(normalized);
}

function factRelevant(
  assertion: StrategyAssertion,
  fact: ReferencedFact,
  factPack: MatchupFactPack,
): boolean {
  if ('ownerKey' in fact) return abilityFactRelevant(assertion.text, fact);
  if ('championKeys' in fact) {
    if (normalize(fact.subject).length >= 3 && normalize(assertion.text).includes(normalize(fact.subject))) {
      return true;
    }
    const mentioned = mentionedChampionKeys(assertion.text, factPack);
    return fact.championKeys.length > 0
      && fact.championKeys.every((championKey) => mentioned.has(normalizeChampionKey(championKey)));
  }
  return normalize(assertion.text).includes(normalize(fact.statement));
}

function insufficientDiagnostic(
  path: string,
  assertion: StrategyAssertion,
  reason: string,
  factIds: readonly string[] = assertion.factIds,
): StrategyPlanPreRenderDiagnostic {
  return Object.freeze({
    code: 'INSUFFICIENT_MECHANICAL_SUPPORT',
    path,
    rule: 'strategy-grounding.sufficient-mechanical-support',
    factIds: Object.freeze([...factIds]),
    reason,
    category: 'INSUFFICIENT_SUPPORT',
    severity: 'error',
    repairable: true,
  });
}

export class StrategyPlanPreRenderValidator {
  constructor(
    private readonly referenceValidator = new StrategyPlanValidator(),
    private readonly conformanceValidator = new AnalysisConformanceValidator(),
  ) {}

  validate(value: unknown, factPack: MatchupFactPack): StrategyPlanPreRenderResult {
    const reference = this.referenceValidator.validate(value, factPack);
    const diagnostics: StrategyPlanPreRenderDiagnostic[] = reference.issues.map(referenceDiagnostic);
    const plan = reference.plan;
    if (plan === undefined) {
      return Object.freeze({
        valid: false,
        diagnostics: Object.freeze(diagnostics),
        assertions: Object.freeze([]),
      });
    }

    const assertionsByPath = new Map(strategyAssertions(plan).map(({ path, assertion }) => [path, assertion]));
    const conformance = this.conformanceValidator.validate(
      toConformanceAnalysis(plan, factPack),
      gameplayContextFromFactPack(factPack),
      patchContextFromFactPack(factPack),
    );
    for (const violation of conformance.violations) {
      const path = strategyPath(violation.path);
      diagnostics.push(conformanceDiagnostic(violation, assertionsByPath.get(path)));
    }

    const facts = factCatalog(factPack);
    const assertionResults = strategyAssertions(plan).map(({ path, assertion }): StrategyPlanAssertionValidation => {
      const referenceStatus = reference.assertions.find((entry) => entry.path === path);
      const pathDiagnostics = diagnostics.filter((diagnostic) => diagnostic.path === path);
      const hasMechanicalError = pathDiagnostics.some(({ severity }) => severity === 'error');
      const hasMechanicalWarning = pathDiagnostics.some(({ severity }) => severity === 'warning');

      if (!hasMechanicalError && assertion.grounding === 'insufficient') {
        diagnostics.push(insufficientDiagnostic(
          path,
          assertion,
          `Assertion declares missing knowledge: ${assertion.missingKnowledge.join('; ')}`,
        ));
      }

      if (!hasMechanicalError && assertion.grounding === 'fact-grounded') {
        const partialFactIds = assertion.factIds.filter((factId) => {
          const fact = facts.get(factId);
          return fact !== undefined && 'coverage' in fact && fact.coverage.status !== 'covered';
        });
        if (partialFactIds.length > 0) {
          diagnostics.push(insufficientDiagnostic(
            path,
            assertion,
            'One or more referenced ability facts have partial mechanical coverage.',
            partialFactIds,
          ));
        }
        for (const factId of assertion.factIds) {
          const fact = facts.get(factId);
          if (fact !== undefined && !factRelevant(assertion, fact, factPack)) {
            diagnostics.push(Object.freeze({
              code: 'FACT_NOT_SUPPORTING_ASSERTION' as const,
              path,
              rule: 'strategy-grounding.fact-relevance',
              factIds: Object.freeze([factId]),
              reason: 'The referenced fact is valid but has no deterministic relation to this assertion.',
              category: 'INSUFFICIENT_SUPPORT' as const,
              severity: 'error' as const,
              repairable: true,
            }));
          }
        }
      }

      const finalPathDiagnostics = diagnostics.filter((diagnostic) => diagnostic.path === path);
      const invalid = finalPathDiagnostics.some(({ severity }) => severity === 'error');
      const insufficient = !invalid && (hasMechanicalWarning || assertion.grounding === 'insufficient');
      return Object.freeze({
        path,
        grounding: assertion.grounding,
        referenceValidation: referenceStatus?.referenceValidation ?? 'invalid',
        mechanicalValidation: invalid
          ? 'invalid'
          : insufficient
            ? 'insufficient'
            : assertion.grounding === 'fact-grounded' ? 'supported' : 'not-applicable',
        factIds: assertion.factIds,
      });
    });

    const frozenDiagnostics = Object.freeze(diagnostics.map((diagnostic) => Object.freeze(diagnostic)));
    return Object.freeze({
      valid: frozenDiagnostics.every(({ severity }) => severity !== 'error')
        && assertionResults.every(({ mechanicalValidation }) => mechanicalValidation !== 'insufficient'),
      plan,
      diagnostics: frozenDiagnostics,
      assertions: Object.freeze(assertionResults),
    });
  }
}
