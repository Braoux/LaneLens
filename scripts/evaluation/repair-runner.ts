import { findAnalysisConformanceFailure } from '../../server/analysis/AnalysisConformanceValidator.js';
import { MatchupAnalysisError } from '../../server/analysis/errors.js';
import type { TargetedAnalysisRepairService } from '../../server/analysis/TargetedAnalysisRepairService.js';
import { findProviderFailure, type ProviderRetryMetadata } from '../../server/analysis/ProviderFailure.js';
import { findRejectedAnalysisFailure } from '../../server/analysis/RejectedAnalysisFailure.js';
import type { PatchContextResolver } from '../../server/patch-context/PatchContextResolver.js';
import { resultMatchupId } from './observation-plan.js';
import { persistRepairRun, type RepairRunFiles } from './repair-result-writer.js';
import { buildRepairSummary } from './repair-summary.js';
import type { EvaluationProgress } from './runner.js';
import type {
  RepairAttempt,
  RepairIneligibleObservation,
  RepairResult,
  RepairRun,
} from './repair-types.js';
import type { EvaluationResult } from './types.js';

export type RepairEligibilityIssue = RepairIneligibleObservation;

export interface RepairEligibilitySelection {
  readonly invalid: readonly EvaluationResult[];
  readonly repairable: readonly EvaluationResult[];
  readonly issues: readonly RepairEligibilityIssue[];
}

export function repairEligibilityIssues(results: readonly EvaluationResult[]): readonly RepairEligibilityIssue[] {
  return Object.freeze(results
    .filter(({ status }) => status === 'invalid_analysis')
    .flatMap((result) => {
      const missing = [
        ...(result.candidateAnalysis === undefined ? ['candidateAnalysis'] : []),
        ...((result.violations?.length ?? 0) === 0 ? ['violations'] : []),
      ];
      return missing.length === 0 ? [] : [{ id: result.id, missing: Object.freeze(missing) }];
    }));
}

export function selectRepairableResults(results: readonly EvaluationResult[]): RepairEligibilitySelection {
  const invalid = Object.freeze(results.filter(({ status }) => status === 'invalid_analysis'));
  const issues = repairEligibilityIssues(results);
  const ineligibleIds = new Set(issues.map(({ id }) => id));
  return Object.freeze({
    invalid,
    repairable: Object.freeze(invalid.filter(({ id }) => !ineligibleIds.has(id))),
    issues,
  });
}

export function assertRepairableResults(results: readonly EvaluationResult[]): readonly EvaluationResult[] {
  const { invalid, repairable, issues } = selectRepairableResults(results);
  if (invalid.length === 0) throw new Error('Le run source ne contient aucune analyse invalide.');
  if (repairable.length === 0) {
    const details = issues.map(({ id, missing }) => `${id}: ${missing.join(', ')}`).join('; ');
    throw new Error(
      `${issues.length}/${invalid.length} analyse(s) invalide(s) ne sont pas réparables : ${details}. Aucun appel provider n’a été effectué.`,
    );
  }
  return repairable;
}

export interface RepairExecutionOptions {
  readonly service: Pick<TargetedAnalysisRepairService, 'repair'>;
  readonly patchContextResolver: PatchContextResolver;
  readonly sourceResults: readonly EvaluationResult[];
  readonly files: RepairRunFiles;
  readonly run: RepairRun;
  readonly initialResults?: readonly RepairResult[];
  readonly sleep?: (durationMs: number) => Promise<void>;
  readonly now?: () => Date;
  readonly onProgress?: (progress: EvaluationProgress) => void;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs));
}

function metadataFields(metadata: ProviderRetryMetadata | undefined): ProviderRetryMetadata {
  return metadata ?? {};
}

function duration(results: readonly RepairAttempt[]): number {
  return results.reduce((sum, attempt) => sum + attempt.durationMs, 0);
}

function lastMatching<T>(values: readonly T[], predicate: (value: T) => boolean): T | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index]!;
    if (predicate(value)) return value;
  }
  return undefined;
}

export async function executeRepairs(options: RepairExecutionOptions): Promise<{
  readonly run: RepairRun;
  readonly results: readonly RepairResult[];
}> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? delay;
  const sourceById = new Map(assertRepairableResults(options.sourceResults).map((result) => [result.id, result]));
  const results = [...(options.initialResults ?? [])];
  let run = options.run;
  const selectedIds = new Set(run.selectedIds);
  const completedCount = () => results.filter(
    ({ id, status }) => selectedIds.has(id) && status !== 'in_progress',
  ).length;
  const reportProgress = (progress: Omit<EvaluationProgress, 'completed' | 'total'>) => {
    try {
      options.onProgress?.({
        ...progress,
        completed: completedCount(),
        total: run.selectedIds.length,
      });
    } catch {
      // Console observability must never interrupt or alter a repair run.
    }
  };
  const persist = async () => persistRepairRun(
    options.files,
    run,
    results,
    buildRepairSummary(run, results),
  );

  reportProgress({ phase: 'preparing' });

  for (const id of run.selectedIds) {
    const source = sourceById.get(id);
    if (source === undefined || source.candidateAnalysis === undefined || source.violations === undefined) {
      throw new Error(`Le résultat source ${id} n’est plus réparable.`);
    }
    reportProgress({ phase: 'preparing', currentId: id });
    let index = results.findIndex((result) => result.id === id);
    if (index < 0) {
      results.push({
        id,
        matchupId: resultMatchupId(source),
        repetition: source.repetition ?? 1,
        input: source.input,
        sentinel: source.sentinel,
        status: 'in_progress',
        startedAt: now().toISOString(),
        originalAnalysis: source.candidateAnalysis,
        initialViolations: source.violations,
        attempts: [],
      });
      index = results.length - 1;
      await persist();
    }
    let result = results[index]!;
    if (result.status !== 'in_progress') continue;
    const patchResolution = await options.patchContextResolver.resolve(result.input.patch);
    if (patchResolution.status !== 'ready') {
      result = {
        ...result,
        status: 'execution_error',
        completedAt: now().toISOString(),
        durationMs: duration(result.attempts),
        finalViolations: result.finalViolations ?? result.initialViolations,
      };
      results[index] = result;
      await persist();
      reportProgress({ phase: 'case_completed', currentId: id, status: result.status });
      continue;
    }

    let candidate = lastMatching(result.attempts, ({ candidateAnalysis }) => candidateAnalysis !== undefined)
      ?.candidateAnalysis ?? result.originalAnalysis;
    let violations = lastMatching(result.attempts, ({ violations: value }) => value !== undefined)
      ?.violations ?? result.initialViolations;

    for (let repair = 1; repair <= run.maxRepairs && result.status === 'in_progress'; repair += 1) {
      const existingPass = result.attempts.filter((attempt) => attempt.repair === repair);
      if (existingPass.some(({ outcome }) => outcome === 'success')) break;
      const completedInvalid = lastMatching(existingPass, ({ outcome }) => outcome === 'invalid_analysis');
      if (completedInvalid !== undefined) {
        candidate = completedInvalid.candidateAnalysis ?? candidate;
        violations = completedInvalid.violations ?? violations;
        continue;
      }
      for (let attempt = existingPass.length + 1; attempt <= run.maxAttempts; attempt += 1) {
        reportProgress({
          phase: 'repairing',
          currentId: id,
          repair,
          maxRepairs: run.maxRepairs,
          attempt,
          maxAttempts: run.maxAttempts,
        });
        const startedAt = now();
        let observedMetadata: ProviderRetryMetadata | undefined;
        try {
          const repaired = await options.service.repair({
            ...result.input,
            locale: 'fr-FR',
            patchContext: patchResolution.context,
          }, candidate, violations, {
            onMetadata(metadata) { observedMetadata = metadata; },
          });
          const call: RepairAttempt = {
            repair,
            attempt,
            startedAt: startedAt.toISOString(),
            durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
            outcome: 'success',
            ...metadataFields(observedMetadata),
          };
          result = {
            ...result,
            status: 'success',
            completedAt: now().toISOString(),
            durationMs: duration([...result.attempts, call]),
            finalAnalysis: repaired,
            finalViolations: [],
            attempts: [...result.attempts, call],
          };
        } catch (error) {
          const callDuration = Math.max(0, now().getTime() - startedAt.getTime());
          const providerFailure = findProviderFailure(error);
          const rejected = findRejectedAnalysisFailure(error);
          const conformance = findAnalysisConformanceFailure(error);
          if (error instanceof MatchupAnalysisError && error.code === 'INVALID_ANALYSIS_RESPONSE') {
            const nextViolations = conformance?.violations ?? rejected?.languageViolations?.map(
              ({ path, expectedLocale }) => ({
                code: 'LANGUAGE_MISMATCH',
                category: 'OTHER',
                severity: 'error' as const,
                path,
                subject: expectedLocale,
              }),
            );
            const call: RepairAttempt = {
              repair,
              attempt,
              startedAt: startedAt.toISOString(),
              durationMs: callDuration,
              outcome: 'invalid_analysis',
              ...metadataFields(observedMetadata),
              ...(rejected === undefined ? {} : { rejectedResponse: rejected.response }),
              ...(rejected === undefined ? {} : { rejectionPhase: rejected.phase }),
              ...(rejected?.candidate === undefined ? {} : { candidateAnalysis: rejected.candidate }),
              ...(nextViolations === undefined ? {} : { violations: nextViolations }),
            };
            candidate = rejected?.candidate ?? candidate;
            violations = nextViolations ?? violations;
            result = {
              ...result,
              status: repair === run.maxRepairs ? 'invalid_analysis' : 'in_progress',
              ...(repair === run.maxRepairs ? { completedAt: now().toISOString() } : {}),
              durationMs: duration([...result.attempts, call]),
              finalAnalysis: candidate,
              finalViolations: violations,
              attempts: [...result.attempts, call],
            };
          } else if (providerFailure?.category === 'rate_limit') {
            const call: RepairAttempt = {
              repair,
              attempt,
              startedAt: startedAt.toISOString(),
              durationMs: callDuration,
              outcome: 'rate_limited',
              ...(providerFailure.status === undefined ? {} : { httpStatus: providerFailure.status }),
              ...metadataFields(providerFailure.retryMetadata),
            };
            result = {
              ...result,
              status: attempt === run.maxAttempts ? 'rate_limited' : 'in_progress',
              ...(attempt === run.maxAttempts ? { completedAt: now().toISOString() } : {}),
              durationMs: duration([...result.attempts, call]),
              finalAnalysis: candidate,
              finalViolations: violations,
              attempts: [...result.attempts, call],
            };
          } else if (providerFailure !== undefined) {
            const call: RepairAttempt = {
              repair,
              attempt,
              startedAt: startedAt.toISOString(),
              durationMs: callDuration,
              outcome: 'provider_error',
              ...(providerFailure.status === undefined ? {} : { httpStatus: providerFailure.status }),
              ...metadataFields(providerFailure.retryMetadata),
            };
            result = {
              ...result,
              status: 'provider_error',
              completedAt: now().toISOString(),
              durationMs: duration([...result.attempts, call]),
              finalAnalysis: candidate,
              finalViolations: violations,
              attempts: [...result.attempts, call],
            };
          } else {
            const call: RepairAttempt = {
              repair,
              attempt,
              startedAt: startedAt.toISOString(),
              durationMs: callDuration,
              outcome: 'execution_error',
            };
            result = {
              ...result,
              status: 'execution_error',
              completedAt: now().toISOString(),
              durationMs: duration([...result.attempts, call]),
              finalAnalysis: candidate,
              finalViolations: violations,
              attempts: [...result.attempts, call],
            };
          }
        }
        results[index] = result;
        await persist();
        if (result.status !== 'in_progress' || result.attempts.at(-1)?.outcome === 'invalid_analysis') break;
        if (run.delayMs > 0) {
          reportProgress({
            phase: 'waiting_rate_limit',
            currentId: id,
            repair,
            maxRepairs: run.maxRepairs,
            attempt,
            maxAttempts: run.maxAttempts,
            waitMs: run.delayMs,
          });
          await sleep(run.delayMs);
        }
      }
      if (result.status === 'in_progress' && repair < run.maxRepairs && run.delayMs > 0) {
        reportProgress({
          phase: 'waiting_delay',
          currentId: id,
          repair,
          maxRepairs: run.maxRepairs,
          waitMs: run.delayMs,
        });
        await sleep(run.delayMs);
      }
    }
    reportProgress({ phase: 'case_completed', currentId: id, status: result.status });
  }

  run = { ...run, completedAt: now().toISOString() };
  await persist();
  reportProgress({ phase: 'completed' });
  return { run, results };
}
