import { findAnalysisConformanceFailure } from '../../server/analysis/AnalysisConformanceValidator.js';
import { MatchupAnalysisError } from '../../server/analysis/errors.js';
import type { MatchupAnalysisService } from '../../server/analysis/MatchupAnalysisService.js';
import {
  findProviderFailure,
  type ProviderRetryMetadata,
} from '../../server/analysis/ProviderFailure.js';
import type { PatchContextResolver } from '../../server/patch-context/PatchContextResolver.js';
import { buildEvaluationSummary } from './summary.js';
import { buildObservationPlan, effectiveRepeat } from './observation-plan.js';
import { persistEvaluation, type RunFiles } from './result-writer.js';
import type {
  CorpusMatchup,
  EvaluationAttempt,
  EvaluationResult,
  EvaluationRun,
  EvaluationStatus,
} from './types.js';

const DEFAULT_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_JITTER_MS = 250;

export interface EvaluationExecutionOptions {
  readonly service: Pick<MatchupAnalysisService, 'analyze'>;
  readonly patchContextResolver: PatchContextResolver;
  readonly matchups: readonly CorpusMatchup[];
  readonly files: RunFiles;
  readonly run: EvaluationRun;
  readonly initialResults?: readonly EvaluationResult[];
  readonly sleep?: (durationMs: number) => Promise<void>;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly onProgress?: (progress: EvaluationProgress) => void;
}

export type EvaluationProgressPhase =
  | 'preparing'
  | 'analyzing'
  | 'waiting_rate_limit'
  | 'waiting_delay'
  | 'case_completed'
  | 'completed';

export interface EvaluationProgress {
  readonly phase: EvaluationProgressPhase;
  readonly completed: number;
  readonly total: number;
  readonly currentId?: string;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly waitMs?: number;
  readonly status?: EvaluationStatus;
}

function terminal(status: EvaluationStatus): boolean {
  return status !== 'in_progress';
}

function inputFor(matchup: CorpusMatchup) {
  return {
    allyCarry: matchup.ally.carry,
    allySupport: matchup.ally.support,
    enemyCarry: matchup.enemy.carry,
    enemySupport: matchup.enemy.support,
    patch: matchup.patch,
  };
}

function retryDelay(attempt: number, retryAfterMs: number | undefined, random: () => number): number {
  if (retryAfterMs !== undefined) return retryAfterMs;
  const exponential = Math.min(MAX_BACKOFF_MS, DEFAULT_BACKOFF_MS * (2 ** Math.max(0, attempt - 1)));
  return exponential + Math.floor(random() * (MAX_JITTER_MS + 1));
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs));
}

function attemptFrom(
  attempt: number,
  startedAt: string,
  durationMs: number,
  outcome: EvaluationAttempt['outcome'],
  metadata: ProviderRetryMetadata | undefined,
  httpStatus?: number,
): EvaluationAttempt {
  return {
    attempt,
    startedAt,
    durationMs,
    outcome,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...metadata,
  };
}

export async function executeEvaluation(options: EvaluationExecutionOptions): Promise<{
  readonly run: EvaluationRun;
  readonly results: readonly EvaluationResult[];
}> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? delay;
  const random = options.random ?? Math.random;
  let run = options.run;
  const results = [...(options.initialResults ?? [])];
  const repeat = effectiveRepeat(run);
  const observations = buildObservationPlan(options.matchups, repeat);
  const observationIds = new Set(observations.map(({ observationId }) => observationId));
  const mechanicalCoverage = new Map(
    run.mechanicalCoverage?.matchups.map((matchup) => [matchup.id, matchup]) ?? [],
  );

  const completedCount = () => results.filter(
    ({ id, status }) => observationIds.has(id) && terminal(status),
  ).length;
  const reportProgress = (progress: Omit<EvaluationProgress, 'completed' | 'total'>) => {
    try {
      options.onProgress?.({
        ...progress,
        completed: completedCount(),
        total: observations.length,
      });
    } catch {
      // Console observability must never interrupt or alter an evaluation run.
    }
  };

  const persist = async () => {
    await persistEvaluation(
      options.files,
      run,
      results,
      buildEvaluationSummary(results, run.selectedIds, repeat),
    );
  };

  reportProgress({ phase: 'preparing' });

  for (let observationIndex = 0; observationIndex < observations.length; observationIndex += 1) {
    const observation = observations[observationIndex]!;
    const { matchup } = observation;
    let resultIndex = results.findIndex(({ id }) => id === observation.observationId);
    if (resultIndex >= 0 && terminal(results[resultIndex]!.status)) continue;

    reportProgress({ phase: 'preparing', currentId: observation.observationId });

    if (resultIndex < 0) {
      const matchupMechanicalCoverage = mechanicalCoverage.get(matchup.id);
      results.push({
        id: observation.observationId,
        matchupId: matchup.id,
        repetition: observation.repetition,
        input: inputFor(matchup),
        sentinel: matchup.sentinel,
        status: 'in_progress',
        startedAt: now().toISOString(),
        ...(matchupMechanicalCoverage === undefined || run.goldenTruthVersion === undefined ? {} : {
          mechanicalCoverage: {
            goldenTruthVersion: run.goldenTruthVersion,
            fullyCovered: matchupMechanicalCoverage.fullyCovered,
            missing: matchupMechanicalCoverage.missing,
          },
        }),
        attempts: [],
      });
      resultIndex = results.length - 1;
      await persist();
    }
    let result = results[resultIndex]!;
    const patchResolution = await options.patchContextResolver.resolve(matchup.patch);
    if (patchResolution.status !== 'ready') {
      result = {
        ...result,
        status: 'execution_error',
        completedAt: now().toISOString(),
        durationMs: result.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
        error: { code: 'PATCH_CONTEXT_UNAVAILABLE' },
      };
      results[resultIndex] = result;
      await persist();
      reportProgress({
        phase: 'case_completed',
        currentId: observation.observationId,
        status: result.status,
      });
      continue;
    }

    const previousAttempt = result.attempts.at(-1);
    if (previousAttempt?.outcome === 'rate_limited' && result.attempts.length < run.maxAttempts) {
      const waitMs = retryDelay(previousAttempt.attempt, previousAttempt.retryAfterMs, random);
      reportProgress({
        phase: 'waiting_rate_limit',
        currentId: observation.observationId,
        attempt: previousAttempt.attempt,
        maxAttempts: run.maxAttempts,
        waitMs,
      });
      await sleep(waitMs);
    }

    while (result.attempts.length < run.maxAttempts && result.status === 'in_progress') {
      const attemptNumber = result.attempts.length + 1;
      reportProgress({
        phase: 'analyzing',
        currentId: observation.observationId,
        attempt: attemptNumber,
        maxAttempts: run.maxAttempts,
      });
      const attemptStarted = now();
      let observedMetadata: ProviderRetryMetadata | undefined;
      let observedKnowledgeCoverage: EvaluationResult['knowledgeCoverage'];
      try {
        const analysis = await options.service.analyze({
          ...inputFor(matchup),
          locale: 'fr-FR',
          patchContext: patchResolution.context,
        }, {
          onMetadata(metadata) { observedMetadata = metadata; },
          onKnowledgeCoverage(coverage) { observedKnowledgeCoverage = coverage; },
        });
        const durationMs = Math.max(0, now().getTime() - attemptStarted.getTime());
        const attempt = attemptFrom(
          attemptNumber,
          attemptStarted.toISOString(),
          durationMs,
          'success',
          observedMetadata,
        );
        result = {
          ...result,
          status: 'success',
          completedAt: now().toISOString(),
          durationMs: [...result.attempts, attempt].reduce((sum, item) => sum + item.durationMs, 0),
          analysis,
          ...(observedKnowledgeCoverage === undefined ? {} : { knowledgeCoverage: observedKnowledgeCoverage }),
          attempts: [...result.attempts, attempt],
        };
      } catch (error) {
        const durationMs = Math.max(0, now().getTime() - attemptStarted.getTime());
        const providerFailure = findProviderFailure(error);
        const conformanceFailure = findAnalysisConformanceFailure(error);
        if (error instanceof MatchupAnalysisError && error.code === 'INVALID_ANALYSIS_RESPONSE') {
          const attempt = attemptFrom(attemptNumber, attemptStarted.toISOString(), durationMs, 'invalid_analysis', undefined);
          result = {
            ...result,
            status: 'invalid_analysis',
            completedAt: now().toISOString(),
            durationMs: [...result.attempts, attempt].reduce((sum, item) => sum + item.durationMs, 0),
            error: { code: error.code },
            ...(conformanceFailure === undefined ? {} : { violations: conformanceFailure.violations }),
            attempts: [...result.attempts, attempt],
          };
        } else if (providerFailure?.category === 'rate_limit') {
          const failureMetadata = {
            ...providerFailure.retryMetadata,
            ...(providerFailure.providerRequestId === undefined
              ? {}
              : { providerRequestId: providerFailure.providerRequestId }),
            ...(providerFailure.executionContext === undefined
              ? {}
              : { executionContext: providerFailure.executionContext }),
            ...(providerFailure.deadlineMs === undefined
              ? {}
              : { deadlineMs: providerFailure.deadlineMs }),
          };
          const attempt = attemptFrom(
            attemptNumber,
            attemptStarted.toISOString(),
            durationMs,
            'rate_limited',
            failureMetadata,
            providerFailure.status,
          );
          result = {
            ...result,
            attempts: [...result.attempts, attempt],
            ...(attemptNumber >= run.maxAttempts ? {
              status: 'rate_limited' as const,
              completedAt: now().toISOString(),
              durationMs: [...result.attempts, attempt].reduce((sum, item) => sum + item.durationMs, 0),
              error: {
                code: 'ANALYSIS_PROVIDER_UNAVAILABLE' as const,
                providerCategory: providerFailure.category,
              },
            } : {}),
          };
        } else if (providerFailure !== undefined) {
          const failureMetadata = {
            ...providerFailure.retryMetadata,
            ...(providerFailure.providerRequestId === undefined
              ? {}
              : { providerRequestId: providerFailure.providerRequestId }),
            ...(providerFailure.executionContext === undefined
              ? {}
              : { executionContext: providerFailure.executionContext }),
            ...(providerFailure.deadlineMs === undefined
              ? {}
              : { deadlineMs: providerFailure.deadlineMs }),
          };
          const attempt = attemptFrom(
            attemptNumber,
            attemptStarted.toISOString(),
            durationMs,
            'provider_error',
            failureMetadata,
            providerFailure.status,
          );
          result = {
            ...result,
            status: 'provider_error',
            completedAt: now().toISOString(),
            durationMs: [...result.attempts, attempt].reduce((sum, item) => sum + item.durationMs, 0),
            error: {
              code: 'ANALYSIS_PROVIDER_UNAVAILABLE',
              providerCategory: providerFailure.category,
            },
            attempts: [...result.attempts, attempt],
          };
        } else {
          const attempt = attemptFrom(attemptNumber, attemptStarted.toISOString(), durationMs, 'execution_error', undefined);
          result = {
            ...result,
            status: 'execution_error',
            completedAt: now().toISOString(),
            durationMs: [...result.attempts, attempt].reduce((sum, item) => sum + item.durationMs, 0),
            error: {
              code: error instanceof MatchupAnalysisError ? error.code : 'UNEXPECTED_ERROR',
            },
            attempts: [...result.attempts, attempt],
          };
        }
      }
      if (observedKnowledgeCoverage !== undefined && result.knowledgeCoverage === undefined) {
        result = { ...result, knowledgeCoverage: observedKnowledgeCoverage };
      }
      results[resultIndex] = result;
      await persist();
      if (result.status === 'in_progress') {
        const lastAttempt = result.attempts.at(-1)!;
        const waitMs = retryDelay(lastAttempt.attempt, lastAttempt.retryAfterMs, random);
        reportProgress({
          phase: 'waiting_rate_limit',
          currentId: observation.observationId,
          attempt: lastAttempt.attempt,
          maxAttempts: run.maxAttempts,
          waitMs,
        });
        await sleep(waitMs);
      }
    }

    if (result.status === 'in_progress') {
      const lastAttempt = result.attempts.at(-1);
      result = {
        ...result,
        status: lastAttempt?.outcome === 'rate_limited' ? 'rate_limited' : 'execution_error',
        completedAt: now().toISOString(),
        durationMs: result.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
        error: {
          code: lastAttempt?.outcome === 'rate_limited'
            ? 'ANALYSIS_PROVIDER_UNAVAILABLE'
            : 'UNEXPECTED_ERROR',
        },
      };
      results[resultIndex] = result;
      await persist();
    }

    reportProgress({
      phase: 'case_completed',
      currentId: observation.observationId,
      status: result.status,
    });

    const remaining = observations.slice(observationIndex + 1).some((candidate) => {
      const existing = results.find(({ id }) => id === candidate.observationId);
      return existing === undefined || !terminal(existing.status);
    });
    if (remaining && run.delayMs > 0) {
      reportProgress({
        phase: 'waiting_delay',
        currentId: observation.observationId,
        waitMs: run.delayMs,
      });
      await sleep(run.delayMs);
    }
  }

  run = { ...run, completedAt: now().toISOString() };
  await persist();
  reportProgress({ phase: 'completed' });
  return { run, results };
}
