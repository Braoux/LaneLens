import type { ProviderRetryMetadata } from '../analysis/ProviderFailure.js';
import type { StructuredOutputProvider } from '../analysis/StructuredOutputProvider.js';
import { UnparsedProviderOutput } from '../analysis/UnparsedProviderOutput.js';
import type { MatchupFactPack } from '../knowledge/MatchupFactPack.js';
import type { MatchupStrategyPlan } from './MatchupStrategyPlan.js';
import {
  buildStrategyPlanContext,
  type StrategyPlanGenerationContext,
} from './StrategyPlanContext.js';
import {
  StrategyPlanValidator,
  type StrategyPlanValidationIssue,
  type StrategyPlanValidationResult,
} from './StrategyPlanValidator.js';
import { MATCHUP_STRATEGY_PLAN_JSON_SCHEMA } from './strategy-plan-schema.js';

const STRATEGY_PLAN_INSTRUCTIONS = [
  'Produce a structured bot-lane Strategy Plan using only the supplied Fact Pack context.',
  'Never alter facts, invent factIds, abilities, ownership, teams, mechanics, or patch data.',
  'Use fact-grounded when an assertion contains a mechanical claim and cite every supporting factId.',
  'Use strategic-only only for recommendations that make no mechanical claim.',
  'Use insufficient and list missingKnowledge when the supplied facts cannot justify the recommendation.',
  'A valid fact reference is not proof that the assertion is semantically supported.',
  'Return only the requested JSON object.',
].join(' ');

export type StrategyPlanGenerationFailurePhase = 'parsing' | 'validation';

export class StrategyPlanGenerationError extends Error {
  constructor(
    readonly phase: StrategyPlanGenerationFailurePhase,
    readonly issues: readonly StrategyPlanValidationIssue[],
  ) {
    super(phase === 'parsing'
      ? 'The provider returned a non-JSON Strategy Plan.'
      : 'The provider returned an invalid Strategy Plan.');
    this.name = 'StrategyPlanGenerationError';
  }
}

export interface StrategyPlanGenerationResult {
  readonly plan: MatchupStrategyPlan;
  readonly context: StrategyPlanGenerationContext;
  readonly validation: StrategyPlanValidationResult;
}

export interface StrategyPlanGenerationOptions {
  readonly onMetadata?: (metadata: ProviderRetryMetadata) => void;
}

export class StrategyPlanGenerationService {
  constructor(
    private readonly provider: StructuredOutputProvider,
    private readonly validator: StrategyPlanValidator = new StrategyPlanValidator(),
  ) {}

  async generate(
    factPack: MatchupFactPack,
    options?: StrategyPlanGenerationOptions,
  ): Promise<StrategyPlanGenerationResult> {
    const context = buildStrategyPlanContext(factPack);
    const candidate = await this.provider.generateStructured({
      instructions: STRATEGY_PLAN_INSTRUCTIONS,
      input: context,
      schemaName: 'matchup_strategy_plan',
      schema: MATCHUP_STRATEGY_PLAN_JSON_SCHEMA,
    }, options);
    if (candidate instanceof UnparsedProviderOutput) {
      throw new StrategyPlanGenerationError('parsing', Object.freeze([]));
    }
    const validation = this.validator.validate(candidate, factPack);
    if (!validation.valid || validation.plan === undefined) {
      throw new StrategyPlanGenerationError('validation', validation.issues);
    }
    return Object.freeze({ plan: validation.plan, context, validation });
  }
}
