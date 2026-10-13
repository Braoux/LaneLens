import type {
  RepairConfigurationSummary,
  RepairResult,
  RepairRun,
  RepairSummary,
} from './repair-types.js';

function increment(target: Record<string, number>, key: string, amount = 1): void {
  target[key] = (target[key] ?? 0) + amount;
}

function violationCounts(
  violations: RepairResult['initialViolations'],
  key: (violation: RepairResult['initialViolations'][number]) => string = ({ code }) => code,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const violation of violations) {
    const value = key(violation);
    result.set(value, (result.get(value) ?? 0) + 1);
  }
  return result;
}

function compareViolations(
  initialViolations: RepairResult['initialViolations'],
  finalViolations: RepairResult['initialViolations'],
  fixed: Record<string, number>,
  remaining: Record<string, number>,
  regressions: Record<string, number>,
  key?: (violation: RepairResult['initialViolations'][number]) => string,
): void {
  const initial = violationCounts(initialViolations, key);
  const final = violationCounts(finalViolations, key);
  for (const [value, count] of initial) {
    const difference = count - (final.get(value) ?? 0);
    if (difference > 0) increment(fixed, value, difference);
  }
  for (const [value, count] of final) {
    increment(remaining, value, count);
    const difference = count - (initial.get(value) ?? 0);
    if (difference > 0) increment(regressions, value, difference);
  }
}

function recoveredOn(result: RepairResult): number | undefined {
  return result.attempts.find(({ outcome }) => outcome === 'success')?.repair;
}

function technicalFailureOn(result: RepairResult): number | undefined {
  if (!['rate_limited', 'provider_error', 'execution_error'].includes(result.status)) return undefined;
  return result.attempts.at(-1)?.repair;
}

function configuration(run: RepairRun, results: readonly RepairResult[], repairs: 0 | 1 | 2): RepairConfigurationSummary {
  const recovered = results.filter((result) => (recoveredOn(result) ?? Number.POSITIVE_INFINITY) <= repairs).length;
  const technicalFailures = repairs === 0 ? 0 : results.filter((result) => {
    const failedOn = technicalFailureOn(result);
    return failedOn !== undefined && failedOn <= repairs;
  }).length;
  const success = run.sourceSuccess + recovered;
  return Object.freeze({
    repairs,
    success,
    invalidAnalysis: Math.max(0, run.sourceInvalid - recovered - technicalFailures),
    technicalFailures,
    successRate: run.sourceObservations === 0 ? 0 : success / run.sourceObservations,
  });
}

export function buildRepairSummary(run: RepairRun, results: readonly RepairResult[]): RepairSummary {
  const fixed: Record<string, number> = {};
  const remaining: Record<string, number> = {};
  const regressions: Record<string, number> = {};
  const categoryFixed: Record<string, number> = {};
  const categoryRemaining: Record<string, number> = {};
  const categoryRegressions: Record<string, number> = {};
  for (const result of results) {
    const finalViolations = result.finalViolations ?? result.initialViolations;
    compareViolations(result.initialViolations, finalViolations, fixed, remaining, regressions);
    compareViolations(
      result.initialViolations,
      finalViolations,
      categoryFixed,
      categoryRemaining,
      categoryRegressions,
      ({ category }) => category ?? 'OTHER',
    );
  }
  const attempts = results.flatMap(({ attempts: calls }) => calls);
  const additionalLatencyMs = attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0);
  const configurations: RepairConfigurationSummary[] = [configuration(run, results, 0)];
  configurations.push(configuration(run, results, 1));
  if (run.maxRepairs === 2) configurations.push(configuration(run, results, 2));
  return Object.freeze({
    sourceObservations: run.sourceObservations,
    initiallyInvalid: run.sourceInvalid,
    eligibleForRepair: run.selectedIds.length,
    ineligibleForRepair: run.ineligibleObservations?.length ?? Math.max(0, run.sourceInvalid - run.selectedIds.length),
    completed: results.filter(({ status }) => status !== 'in_progress').length,
    recoveredAfterFirst: results.filter((result) => recoveredOn(result) === 1).length,
    recoveredAfterSecond: results.filter((result) => recoveredOn(result) === 2).length,
    llmCalls: attempts.length,
    totalInputTokens: attempts.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0),
    totalOutputTokens: attempts.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0),
    totalTokens: attempts.reduce((sum, item) => sum + (item.totalTokens ?? 0), 0),
    additionalLatencyMs,
    averageRepairLatencyMs: attempts.length === 0 ? null : additionalLatencyMs / attempts.length,
    estimatedCost: null,
    technicalFailures: Object.freeze({
      rateLimited: results.filter(({ status }) => status === 'rate_limited').length,
      providerErrors: results.filter(({ status }) => status === 'provider_error').length,
      executionErrors: results.filter(({ status }) => status === 'execution_error').length,
    }),
    violationsFixed: Object.freeze(fixed),
    violationsRemaining: Object.freeze(remaining),
    regressionsIntroduced: Object.freeze(regressions),
    violationCategoriesFixed: Object.freeze(categoryFixed),
    violationCategoriesRemaining: Object.freeze(categoryRemaining),
    violationCategoryRegressions: Object.freeze(categoryRegressions),
    configurations: Object.freeze(configurations),
  });
}
