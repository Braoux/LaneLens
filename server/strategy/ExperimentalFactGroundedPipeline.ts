import { performance } from 'node:perf_hooks';
import type { AppLocale } from '../../shared/locale.js';
import { findProviderFailure, type ProviderRetryMetadata } from '../analysis/ProviderFailure.js';
import type { MatchupFactPack, MatchupFactPackRequest } from '../knowledge/MatchupFactPack.js';
import { MatchupFactPackBuilder } from '../knowledge/MatchupFactPackBuilder.js';
import {
  ConstrainedStrategyPlanRenderer,
  type ConstrainedRenderResult,
} from './ConstrainedStrategyPlanRenderer.js';
import type { MatchupStrategyPlan } from './MatchupStrategyPlan.js';
import {
  StrategyPlanGenerationError,
  StrategyPlanGenerationService,
} from './StrategyPlanGenerationService.js';
import {
  StrategyPlanPreRenderValidator,
  type StrategyPlanPreRenderResult,
} from './StrategyPlanPreRenderValidator.js';
import {
  TargetedStrategyPlanRepairService,
  type StrategyPlanRepairResult,
} from './TargetedStrategyPlanRepairService.js';

export interface FactGroundedPipelineOptions {
  readonly locale: AppLocale;
  readonly maxRepairs: 0 | 1 | 2;
  readonly provider: string;
  readonly model: string;
}

export interface PipelineTokenMetrics {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly reasoningTokens: number;
}

export interface FactGroundedPipelineMetrics {
  readonly factPackMs: number;
  readonly strategyGenerationMs: number;
  readonly preRenderValidationMs: number;
  readonly repairMs: number;
  readonly rendererMs: number;
  readonly totalMs: number;
  readonly providerCalls: {
    readonly strategyGeneration: number;
    readonly functionalRepairs: number;
    readonly renderer: 0;
    readonly maximumPerAnalysis: number;
  };
  readonly tokens: {
    readonly strategyGeneration: PipelineTokenMetrics;
    readonly repair: PipelineTokenMetrics;
    readonly total: PipelineTokenMetrics;
  };
  readonly estimatedCost: null;
  readonly quality: {
    readonly initialPlanValid: boolean | null;
    readonly initialViolationCount: number;
    readonly initialInvalidPaths: number;
    readonly insufficientAssertions: number;
    readonly planValidAfterRepair: boolean | null;
    readonly finalAnalysisValid: boolean | null;
    readonly finalOnlyMechanicalViolations: number;
  };
  readonly repair: {
    readonly required: boolean;
    readonly passes: number;
    readonly fieldsRegenerated: readonly string[];
    readonly resolvedDiagnostics: number;
    readonly introducedDiagnostics: number;
    readonly persistentDiagnostics: number;
  };
}

export interface FactGroundedPipelineResult {
  readonly status:
    | 'success'
    | 'generation_error'
    | 'pre_render_rejected'
    | 'repair_provider_error'
    | 'render_rejected'
    | 'final_validation_rejected';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly factPack: MatchupFactPack;
  readonly initialPlan?: MatchupStrategyPlan;
  readonly initialValidation?: StrategyPlanPreRenderResult;
  readonly repair?: StrategyPlanRepairResult;
  readonly render?: ConstrainedRenderResult;
  readonly error?: {
    readonly phase: 'parsing' | 'validation' | 'provider' | 'execution';
    readonly category?: string;
  };
  readonly metrics: FactGroundedPipelineMetrics;
}

const ZERO_TOKENS: PipelineTokenMetrics = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  reasoningTokens: 0,
});

function addTokens(
  current: PipelineTokenMetrics,
  metadata: ProviderRetryMetadata | undefined,
): PipelineTokenMetrics {
  return Object.freeze({
    inputTokens: current.inputTokens + (metadata?.inputTokens ?? 0),
    outputTokens: current.outputTokens + (metadata?.outputTokens ?? 0),
    totalTokens: current.totalTokens + (metadata?.totalTokens ?? 0),
    reasoningTokens: current.reasoningTokens + (metadata?.reasoningTokens ?? 0),
  });
}

function sumTokens(left: PipelineTokenMetrics, right: PipelineTokenMetrics): PipelineTokenMetrics {
  return Object.freeze({
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
  });
}

interface MutableTimings {
  factPackMs: number;
  strategyGenerationMs: number;
  preRenderValidationMs: number;
  repairMs: number;
  rendererMs: number;
}

function metrics(
  timings: MutableTimings,
  totalMs: number,
  maxRepairs: 0 | 1 | 2,
  strategyGenerationTokens: PipelineTokenMetrics,
  repair: StrategyPlanRepairResult | undefined,
  initialValidation: StrategyPlanPreRenderResult | undefined,
  render: ConstrainedRenderResult | undefined,
): FactGroundedPipelineMetrics {
  const repairTokens = repair?.attempts.reduce(
    (total, attempt) => addTokens(total, attempt.providerMetadata),
    ZERO_TOKENS,
  ) ?? ZERO_TOKENS;
  return Object.freeze({
    ...timings,
    totalMs,
    providerCalls: Object.freeze({
      strategyGeneration: 1,
      functionalRepairs: repair?.calls ?? 0,
      renderer: 0 as const,
      maximumPerAnalysis: 1 + maxRepairs,
    }),
    tokens: Object.freeze({
      strategyGeneration: strategyGenerationTokens,
      repair: repairTokens,
      total: sumTokens(strategyGenerationTokens, repairTokens),
    }),
    estimatedCost: null,
    quality: Object.freeze({
      initialPlanValid: initialValidation?.valid ?? null,
      initialViolationCount: initialValidation?.diagnostics.length ?? 0,
      initialInvalidPaths: new Set(initialValidation?.diagnostics.map(({ path }) => path) ?? []).size,
      insufficientAssertions: initialValidation?.assertions.filter(({ mechanicalValidation }) => (
        mechanicalValidation === 'insufficient'
      )).length ?? 0,
      planValidAfterRepair: repair?.finalValidation.valid ?? initialValidation?.valid ?? null,
      finalAnalysisValid: render?.finalValidation?.valid ?? null,
      finalOnlyMechanicalViolations: render?.finalValidation?.conformanceViolations
        .filter(({ severity }) => severity === 'error').length ?? 0,
    }),
    repair: Object.freeze({
      required: initialValidation?.valid === false,
      passes: repair?.attempts.length ?? 0,
      fieldsRegenerated: Object.freeze([...new Set(repair?.attempts.flatMap(({ paths }) => paths) ?? [])]),
      resolvedDiagnostics: repair?.attempts.reduce(
        (total, attempt) => total + attempt.resolvedDiagnosticKeys.length,
        0,
      ) ?? 0,
      introducedDiagnostics: repair?.attempts.reduce(
        (total, attempt) => total + attempt.introducedDiagnosticKeys.length,
        0,
      ) ?? 0,
      persistentDiagnostics: repair?.finalValidation.diagnostics.length
        ?? (initialValidation?.valid === false ? initialValidation.diagnostics.length : 0),
    }),
  });
}

export class ExperimentalFactGroundedPipeline {
  constructor(
    private readonly generationService: StrategyPlanGenerationService,
    private readonly repairService: TargetedStrategyPlanRepairService,
    private readonly factPackBuilder = new MatchupFactPackBuilder(),
    private readonly validator = new StrategyPlanPreRenderValidator(),
    private readonly renderer = new ConstrainedStrategyPlanRenderer(),
  ) {}

  async run(
    request: MatchupFactPackRequest,
    options: FactGroundedPipelineOptions,
  ): Promise<FactGroundedPipelineResult> {
    const startedAt = new Date();
    const totalStarted = performance.now();
    const timings: MutableTimings = {
      factPackMs: 0,
      strategyGenerationMs: 0,
      preRenderValidationMs: 0,
      repairMs: 0,
      rendererMs: 0,
    };
    const factPackStarted = performance.now();
    const factPack = this.factPackBuilder.build(request);
    timings.factPackMs = performance.now() - factPackStarted;
    let generationTokens = ZERO_TOKENS;
    let initialPlan: MatchupStrategyPlan | undefined;
    // Assigned after provider generation; kept optional for generation-error artifacts.
    // eslint-disable-next-line prefer-const
    let initialValidation: StrategyPlanPreRenderResult | undefined;
    let repair: StrategyPlanRepairResult | undefined;

    const finish = (
      status: FactGroundedPipelineResult['status'],
      extra: Pick<FactGroundedPipelineResult, 'render' | 'error'> = {},
    ): FactGroundedPipelineResult => Object.freeze({
      status,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      provider: options.provider,
      model: options.model,
      factPack,
      ...(initialPlan === undefined ? {} : { initialPlan }),
      ...(initialValidation === undefined ? {} : { initialValidation }),
      ...(repair === undefined ? {} : { repair }),
      ...extra,
      metrics: metrics(
        timings,
        performance.now() - totalStarted,
        options.maxRepairs,
        generationTokens,
        repair,
        initialValidation,
        extra.render,
      ),
    });

    const generationStarted = performance.now();
    try {
      const generated = await this.generationService.generateCandidate(factPack, {
        onMetadata(metadata) { generationTokens = addTokens(generationTokens, metadata); },
      });
      initialPlan = generated.plan;
    } catch (error) {
      timings.strategyGenerationMs = performance.now() - generationStarted;
      const providerFailure = findProviderFailure(error);
      return finish('generation_error', {
        error: {
          phase: error instanceof StrategyPlanGenerationError ? error.phase : providerFailure === undefined
            ? 'execution'
            : 'provider',
          ...(providerFailure === undefined ? {} : { category: providerFailure.category }),
        },
      });
    }
    timings.strategyGenerationMs = performance.now() - generationStarted;

    const validationStarted = performance.now();
    initialValidation = this.validator.validate(initialPlan, factPack);
    timings.preRenderValidationMs = performance.now() - validationStarted;
    let finalPlan = initialPlan;
    if (!initialValidation.valid && options.maxRepairs > 0) {
      const repairStarted = performance.now();
      repair = await this.repairService.repair(initialPlan, factPack, {
        maxRepairs: options.maxRepairs,
        provider: options.provider,
        model: options.model,
      });
      timings.repairMs = performance.now() - repairStarted;
      finalPlan = repair.finalPlan;
      if (repair.status === 'provider_error') return finish('repair_provider_error');
      if (repair.status !== 'success') return finish('pre_render_rejected');
    } else if (!initialValidation.valid) {
      return finish('pre_render_rejected');
    }

    const rendererStarted = performance.now();
    const render = this.renderer.render(finalPlan, factPack, options.locale);
    timings.rendererMs = performance.now() - rendererStarted;
    if (render.status === 'success') return finish('success', { render });
    if (render.status === 'final_validation_rejected') {
      return finish('final_validation_rejected', { render });
    }
    return finish('render_rejected', { render });
  }
}
