import type {
  EvaluationResult,
  EvaluationSummary,
  EvaluationSummaryCounts,
} from './types.js';

function counts(results: readonly EvaluationResult[], total: number): EvaluationSummaryCounts {
  const completedResults = results.filter(({ status }) => status !== 'in_progress');
  const count = (status: EvaluationResult['status']) =>
    completedResults.filter((result) => result.status === status).length;
  return {
    total,
    completed: completedResults.length,
    gameplayEvaluable: count('success') + count('invalid_analysis'),
    success: count('success'),
    invalidAnalysis: count('invalid_analysis'),
    rateLimited: count('rate_limited'),
    providerErrors: count('provider_error'),
    executionErrors: count('execution_error'),
    retryCount: results.reduce((sum, result) => sum + Math.max(0, result.attempts.length - 1), 0),
  };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : ordered[middle] ?? null;
}

export function buildEvaluationSummary(
  results: readonly EvaluationResult[],
  selectedIds: readonly string[],
): EvaluationSummary {
  const selected = results.filter(({ id }) => selectedIds.includes(id));
  const latencies = selected
    .map(({ durationMs }) => durationMs)
    .filter((value): value is number => value !== undefined);
  const violationCodes: Record<string, number> = {};
  for (const result of selected) {
    for (const violation of result.violations ?? []) {
      violationCodes[violation.code] = (violationCodes[violation.code] ?? 0) + 1;
    }
  }
  const durationMs = latencies.reduce((sum, value) => sum + value, 0);
  const sentinels = selected.filter(({ sentinel }) => sentinel);
  return {
    ...counts(selected, selectedIds.length),
    durationMs,
    averageLatencyMs: latencies.length === 0 ? null : durationMs / latencies.length,
    medianLatencyMs: median(latencies),
    violationCodes,
    sentinels: counts(sentinels, sentinels.length),
  };
}
