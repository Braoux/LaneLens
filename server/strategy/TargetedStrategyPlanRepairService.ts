import { performance } from 'node:perf_hooks';
import type {
  ProviderRetryMetadata,
} from '../analysis/ProviderFailure.js';
import { findProviderFailure } from '../analysis/ProviderFailure.js';
import type { StructuredOutputProvider } from '../analysis/StructuredOutputProvider.js';
import { UnparsedProviderOutput } from '../analysis/UnparsedProviderOutput.js';
import type {
  MatchupAbilityFact,
  MatchupFactPack,
  MatchupGlobalFact,
  MatchupKnowledgeFact,
} from '../knowledge/MatchupFactPack.js';
import {
  strategyAssertions,
  type MatchupStrategyPlan,
  type StrategyAssertion,
} from './MatchupStrategyPlan.js';
import {
  StrategyPlanPreRenderValidator,
  type StrategyPlanPreRenderDiagnostic,
  type StrategyPlanPreRenderResult,
} from './StrategyPlanPreRenderValidator.js';
import {
  applyTargetedStrategyPlanRepair,
  readStrategyAssertion,
  targetedStrategyRepairPaths,
  type StrategyAssertionReplacement,
} from './TargetedStrategyPlanRepair.js';
import { STRATEGY_PLAN_REPAIR_JSON_SCHEMA } from './strategy-plan-repair-schema.js';

type Fact = MatchupAbilityFact | MatchupKnowledgeFact | MatchupGlobalFact;

export interface StrategyPlanRepairAttempt {
  readonly pass: number;
  readonly paths: readonly string[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly outcome: 'success' | 'invalid' | 'invalid_response' | 'provider_error';
  readonly provider: string;
  readonly model: string;
  readonly providerMetadata?: ProviderRetryMetadata;
  readonly providerFailureCategory?: string;
  readonly replacements?: readonly StrategyAssertionReplacement[];
  readonly diagnostics: readonly StrategyPlanPreRenderDiagnostic[];
  readonly resolvedDiagnosticKeys: readonly string[];
  readonly introducedDiagnosticKeys: readonly string[];
}

export interface StrategyPlanRepairResult {
  readonly status: 'success' | 'invalid' | 'provider_error';
  readonly initialPlan: MatchupStrategyPlan;
  readonly finalPlan: MatchupStrategyPlan;
  readonly initialValidation: StrategyPlanPreRenderResult;
  readonly finalValidation: StrategyPlanPreRenderResult;
  readonly attempts: readonly StrategyPlanRepairAttempt[];
  readonly calls: number;
}

export interface StrategyPlanRepairOptions {
  readonly maxRepairs: 0 | 1 | 2;
  readonly provider: string;
  readonly model: string;
  readonly onMetadata?: (metadata: ProviderRetryMetadata) => void;
}

interface ParsedRepairResponse {
  readonly replacements: readonly StrategyAssertionReplacement[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nonBlankStrings(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)
    || !value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)) return undefined;
  return Object.freeze(value.map((entry) => entry.trim()));
}

function parseAssertion(value: unknown): StrategyAssertion | undefined {
  if (!isRecord(value)
    || !exactKeys(value, ['text', 'grounding', 'participantIds', 'factIds', 'missingKnowledge'])
    || typeof value.text !== 'string'
    || value.text.trim().length === 0
    || !['fact-grounded', 'strategic-only', 'insufficient'].includes(String(value.grounding))) {
    return undefined;
  }
  const participantIds = nonBlankStrings(value.participantIds);
  const factIds = nonBlankStrings(value.factIds);
  const missingKnowledge = nonBlankStrings(value.missingKnowledge);
  if (participantIds === undefined || factIds === undefined || missingKnowledge === undefined) return undefined;
  return Object.freeze({
    text: value.text.trim(),
    grounding: value.grounding as StrategyAssertion['grounding'],
    participantIds,
    factIds,
    missingKnowledge,
  });
}

function parseResponse(value: unknown, expectedPaths: readonly string[]): ParsedRepairResponse | undefined {
  if (!isRecord(value)
    || !exactKeys(value, ['schemaVersion', 'replacements'])
    || value.schemaVersion !== 1
    || !Array.isArray(value.replacements)) return undefined;
  const replacements: StrategyAssertionReplacement[] = [];
  for (const replacement of value.replacements) {
    if (!isRecord(replacement)
      || !exactKeys(replacement, ['path', 'assertion'])
      || typeof replacement.path !== 'string') return undefined;
    const assertion = parseAssertion(replacement.assertion);
    if (assertion === undefined) return undefined;
    replacements.push(Object.freeze({ path: replacement.path, assertion }));
  }
  const actual = replacements.map(({ path }) => path);
  if (new Set(actual).size !== actual.length
    || actual.length !== expectedPaths.length
    || expectedPaths.some((path) => !actual.includes(path))) return undefined;
  return Object.freeze({ replacements: Object.freeze(replacements) });
}

function diagnosticKey(diagnostic: StrategyPlanPreRenderDiagnostic): string {
  return [diagnostic.code, diagnostic.path, ...diagnostic.factIds].join('|');
}

function diagnosticDelta(
  before: StrategyPlanPreRenderResult,
  after: StrategyPlanPreRenderResult,
): { readonly resolved: readonly string[]; readonly introduced: readonly string[] } {
  const beforeKeys = new Set(before.diagnostics.map(diagnosticKey));
  const afterKeys = new Set(after.diagnostics.map(diagnosticKey));
  return Object.freeze({
    resolved: Object.freeze([...beforeKeys].filter((key) => !afterKeys.has(key))),
    introduced: Object.freeze([...afterKeys].filter((key) => !beforeKeys.has(key))),
  });
}

function factCatalog(factPack: MatchupFactPack): ReadonlyMap<string, Fact> {
  return new Map<string, Fact>([
    ...factPack.championFacts.abilities.map((fact) => [fact.factId, fact] as const),
    ...factPack.championFacts.knowledge.map((fact) => [fact.factId, fact] as const),
    ...factPack.globalFacts.map((fact) => [fact.factId, fact] as const),
  ]);
}

function participantKeys(assertion: StrategyAssertion, factPack: MatchupFactPack): ReadonlySet<string> {
  return new Set(assertion.participantIds.flatMap((participantId) => {
    const participant = factPack.participants.find((entry) => entry.participantId === participantId);
    return participant === undefined ? [] : [participant.championKey];
  }));
}

function factChampionKeys(fact: Fact): readonly string[] {
  if ('ownerKey' in fact) return [fact.ownerKey];
  if ('championKeys' in fact) return fact.championKeys;
  return [];
}

function factsForTarget(
  assertion: StrategyAssertion,
  diagnostics: readonly StrategyPlanPreRenderDiagnostic[],
  factPack: MatchupFactPack,
): readonly Fact[] {
  const catalog = factCatalog(factPack);
  const keys = participantKeys(assertion, factPack);
  const explicitIds = new Set([
    ...assertion.factIds,
    ...diagnostics.flatMap(({ factIds }) => factIds),
  ]);
  return Object.freeze([...catalog.values()].filter((fact) => (
    explicitIds.has(fact.factId)
    || factChampionKeys(fact).some((key) => keys.has(key))
    || ('domain' in fact)
  )));
}

function repairInput(
  plan: MatchupStrategyPlan,
  factPack: MatchupFactPack,
  validation: StrategyPlanPreRenderResult,
  paths: readonly string[],
) {
  return Object.freeze({
    matchupId: factPack.matchupId,
    patch: factPack.patch,
    targets: Object.freeze(paths.map((path) => {
      const assertion = readStrategyAssertion(plan, path)!;
      const diagnostics = validation.diagnostics.filter((diagnostic) => diagnostic.path === path);
      return Object.freeze({
        path,
        assertion,
        diagnostics,
        allowedFacts: factsForTarget(assertion, diagnostics, factPack),
      });
    })),
    surroundingAssertions: Object.freeze(strategyAssertions(plan)
      .filter(({ path }) => !paths.includes(path))
      .map(({ path, assertion }) => Object.freeze({ path, text: assertion.text }))),
  });
}

function repairInstructions(paths: readonly string[]): string {
  return [
    'Repair only the listed Strategy Plan assertions.',
    'Return exactly one replacement for every requested path and no other path.',
    'Use only the allowed facts supplied for that target.',
    'Do not change matchup, patch, or surrounding assertions.',
    'Keep strategic recommendations conditional when they are not universal mechanics.',
    'If the facts cannot support a mechanical claim, use grounding insufficient and list missingKnowledge.',
    `Requested paths: ${JSON.stringify(paths)}.`,
  ].join(' ');
}

function terminalResult(
  status: StrategyPlanRepairResult['status'],
  initialPlan: MatchupStrategyPlan,
  currentPlan: MatchupStrategyPlan,
  initialValidation: StrategyPlanPreRenderResult,
  currentValidation: StrategyPlanPreRenderResult,
  attempts: readonly StrategyPlanRepairAttempt[],
): StrategyPlanRepairResult {
  return Object.freeze({
    status,
    initialPlan,
    finalPlan: currentPlan,
    initialValidation,
    finalValidation: currentValidation,
    attempts: Object.freeze([...attempts]),
    calls: attempts.length,
  });
}

export class TargetedStrategyPlanRepairService {
  constructor(
    private readonly provider: StructuredOutputProvider,
    private readonly validator: StrategyPlanPreRenderValidator = new StrategyPlanPreRenderValidator(),
  ) {}

  async repair(
    plan: MatchupStrategyPlan,
    factPack: MatchupFactPack,
    options: StrategyPlanRepairOptions,
  ): Promise<StrategyPlanRepairResult> {
    if (![0, 1, 2].includes(options.maxRepairs)) {
      throw new RangeError('maxRepairs must be 0, 1, or 2.');
    }
    const initialValidation = this.validator.validate(plan, factPack);
    if (initialValidation.valid) {
      return terminalResult('success', plan, plan, initialValidation, initialValidation, []);
    }
    let currentPlan = plan;
    let currentValidation = initialValidation;
    const attempts: StrategyPlanRepairAttempt[] = [];
    for (let pass = 1; pass <= options.maxRepairs; pass += 1) {
      if (currentValidation.diagnostics.some(({ severity, repairable }) => (
        severity === 'error' && !repairable
      ))) break;
      const paths = targetedStrategyRepairPaths(currentValidation.diagnostics
        .filter(({ repairable }) => repairable)
        .map(({ path }) => path));
      if (paths.length === 0) break;
      const startedAt = new Date();
      const started = performance.now();
      let metadata: ProviderRetryMetadata | undefined;
      let providerResponse: unknown;
      try {
        providerResponse = await this.provider.generateStructured({
          instructions: repairInstructions(paths),
          input: repairInput(currentPlan, factPack, currentValidation, paths),
          schemaName: 'strategy_plan_repair',
          schema: STRATEGY_PLAN_REPAIR_JSON_SCHEMA,
        }, {
          onMetadata(value) {
            metadata = value;
            options.onMetadata?.(value);
          },
        });
      } catch (error) {
        const failure = findProviderFailure(error);
        attempts.push(Object.freeze({
          pass,
          paths,
          startedAt: startedAt.toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Math.max(0, performance.now() - started),
          outcome: 'provider_error',
          provider: options.provider,
          model: options.model,
          ...(metadata === undefined ? {} : { providerMetadata: metadata }),
          ...(failure === undefined ? {} : { providerFailureCategory: failure.category }),
          diagnostics: currentValidation.diagnostics,
          resolvedDiagnosticKeys: Object.freeze([]),
          introducedDiagnosticKeys: Object.freeze([]),
        }));
        return terminalResult(
          'provider_error', plan, currentPlan, initialValidation, currentValidation, attempts,
        );
      }
      const parsed = providerResponse instanceof UnparsedProviderOutput
        ? undefined
        : parseResponse(providerResponse, paths);
      if (parsed === undefined) {
        attempts.push(Object.freeze({
          pass,
          paths,
          startedAt: startedAt.toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Math.max(0, performance.now() - started),
          outcome: 'invalid_response',
          provider: options.provider,
          model: options.model,
          ...(metadata === undefined ? {} : { providerMetadata: metadata }),
          diagnostics: currentValidation.diagnostics,
          resolvedDiagnosticKeys: Object.freeze([]),
          introducedDiagnosticKeys: Object.freeze([]),
        }));
        continue;
      }
      const proposed = applyTargetedStrategyPlanRepair(currentPlan, parsed.replacements, paths);
      const nextValidation = this.validator.validate(proposed, factPack);
      const delta = diagnosticDelta(currentValidation, nextValidation);
      attempts.push(Object.freeze({
        pass,
        paths,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Math.max(0, performance.now() - started),
        outcome: nextValidation.valid ? 'success' : 'invalid',
        provider: options.provider,
        model: options.model,
        ...(metadata === undefined ? {} : { providerMetadata: metadata }),
        replacements: parsed.replacements,
        diagnostics: nextValidation.diagnostics,
        resolvedDiagnosticKeys: delta.resolved,
        introducedDiagnosticKeys: delta.introduced,
      }));
      currentPlan = nextValidation.plan ?? proposed;
      currentValidation = nextValidation;
      if (currentValidation.valid) {
        return terminalResult('success', plan, currentPlan, initialValidation, currentValidation, attempts);
      }
    }
    return terminalResult('invalid', plan, currentPlan, initialValidation, currentValidation, attempts);
  }
}
