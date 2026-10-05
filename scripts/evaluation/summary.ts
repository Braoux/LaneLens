import { resultMatchupId } from './observation-plan.js';
import type {
  EvaluationMatchupSummary,
  EvaluationResult,
  EvaluationSummary,
  EvaluationSummaryCounts,
  EvaluationTokenSummary,
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

function violations(results: readonly EvaluationResult[]): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const observation of results) {
    for (const violation of observation.violations ?? []) {
      result[violation.code] = (result[violation.code] ?? 0) + 1;
    }
  }
  return Object.freeze(result);
}

function tokenSummary(results: readonly EvaluationResult[]): EvaluationTokenSummary {
  const usage = results.flatMap(({ attempts }) => {
    const values = attempts.filter((attempt) => (
      attempt.inputTokens !== undefined
      || attempt.outputTokens !== undefined
      || attempt.totalTokens !== undefined
    ));
    if (values.length === 0) return [];
    return [{
      input: values.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0),
      output: values.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0),
      total: values.reduce((sum, item) => sum + (item.totalTokens ?? 0), 0),
    }];
  });
  const totalInputTokens = usage.reduce((sum, item) => sum + item.input, 0);
  const totalOutputTokens = usage.reduce((sum, item) => sum + item.output, 0);
  const totalTokens = usage.reduce((sum, item) => sum + item.total, 0);
  return Object.freeze({
    observationsWithUsage: usage.length,
    averageInputTokens: usage.length === 0 ? null : totalInputTokens / usage.length,
    averageOutputTokens: usage.length === 0 ? null : totalOutputTokens / usage.length,
    averageTotalTokens: usage.length === 0 ? null : totalTokens / usage.length,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
  });
}

function matchupSummary(
  matchupId: string,
  results: readonly EvaluationResult[],
  repeat: number,
): EvaluationMatchupSummary {
  const aggregate = counts(results, repeat);
  const latencies = results.flatMap(({ durationMs }) => durationMs === undefined ? [] : [durationMs]);
  const complete = aggregate.completed === repeat;
  const stability = complete && aggregate.success === repeat
    ? 'stable_success'
    : complete && aggregate.success === 0 ? 'stable_failure' : 'unstable';
  return Object.freeze({
    matchupId,
    expectedObservations: repeat,
    observations: results.length,
    ...aggregate,
    successRate: aggregate.completed === 0 ? null : aggregate.success / aggregate.completed,
    stability,
    averageLatencyMs: latencies.length === 0
      ? null
      : latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
    medianLatencyMs: median(latencies),
    violationCodes: violations(results),
    factualErrors: results.reduce(
      (sum, result) => sum + (result.qualityReview?.factualErrors.length ?? 0),
      0,
    ),
    tokens: tokenSummary(results),
  });
}

export function buildEvaluationSummary(
  results: readonly EvaluationResult[],
  selectedIds: readonly string[],
  repeat = 1,
): EvaluationSummary {
  const selectedSet = new Set(selectedIds);
  const selected = results.filter((result) => selectedSet.has(resultMatchupId(result)));
  const expectedObservations = selectedIds.length * repeat;
  const aggregate = counts(selected, expectedObservations);
  const latencies = selected.flatMap(({ durationMs }) => durationMs === undefined ? [] : [durationMs]);
  const violationCodes = violations(selected);
  const rejectionCategories: Record<string, number> = {};
  for (const result of selected) {
    for (const violation of result.violations ?? []) {
      const category = violation.category ?? 'OTHER';
      rejectionCategories[category] = (rejectionCategories[category] ?? 0) + 1;
    }
  }
  const durationMs = latencies.reduce((sum, value) => sum + value, 0);
  const sentinels = selected.filter(({ sentinel }) => sentinel);
  const coverage = selected.flatMap(({ knowledgeCoverage }) =>
    knowledgeCoverage === undefined ? [] : [knowledgeCoverage]);
  const reviewed = selected.flatMap(({ qualityReview }) => qualityReview === undefined ? [] : [qualityReview]);
  const strategicIssues = { questionable: 0, poor: 0, dangerous: 0 };
  for (const review of reviewed) {
    for (const issue of review.strategicIssues) strategicIssues[issue.severity] += 1;
  }
  const byMatchup = selectedIds.map((matchupId) => matchupSummary(
    matchupId,
    selected.filter((result) => resultMatchupId(result) === matchupId),
    repeat,
  ));
  return {
    ...aggregate,
    matchups: selectedIds.length,
    repetitions: repeat,
    observationsExpected: expectedObservations,
    observationsCompleted: aggregate.completed,
    successRate: aggregate.completed === 0 ? null : aggregate.success / aggregate.completed,
    durationMs,
    averageLatencyMs: latencies.length === 0 ? null : durationMs / latencies.length,
    medianLatencyMs: median(latencies),
    violationCodes,
    rejectionCategories,
    knowledgeCoverage: {
      full: coverage.filter(({ status }) => status === 'full').length,
      partial: coverage.filter(({ status }) => status === 'partial').length,
      none: coverage.filter(({ status }) => status === 'none').length,
      averageCoveredChampions: coverage.length === 0 ? null : coverage.reduce(
        (sum, item) => sum + item.coveredChampions, 0,
      ) / coverage.length,
      averageRelevantKnowledgeCount: coverage.length === 0 ? null : coverage.reduce(
        (sum, item) => sum + item.relevantKnowledgeCount, 0,
      ) / coverage.length,
    },
    quality: {
      reviewed: reviewed.length,
      factualErrors: reviewed.reduce((sum, review) => sum + review.factualErrors.length, 0),
      strategicIssues,
    },
    stability: {
      stableSuccess: byMatchup.filter(({ stability }) => stability === 'stable_success').length,
      stableFailure: byMatchup.filter(({ stability }) => stability === 'stable_failure').length,
      unstable: byMatchup.filter(({ stability }) => stability === 'unstable').length,
    },
    tokens: tokenSummary(selected),
    byMatchup: Object.freeze(byMatchup),
    sentinels: counts(sentinels, sentinels.length),
  };
}
