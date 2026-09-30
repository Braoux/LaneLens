import type { EvaluationSummary } from './types.js';

export interface EvaluationComparison {
  readonly before: { readonly rejectRate: number | null; readonly factualErrors: number };
  readonly after: { readonly rejectRate: number | null; readonly factualErrors: number };
  readonly deltas: { readonly rejectRate: number | null; readonly factualErrors: number };
  readonly strategicIssues: {
    readonly before: EvaluationSummary['quality']['strategicIssues'];
    readonly after: EvaluationSummary['quality']['strategicIssues'];
  };
}

function rejectRate(summary: EvaluationSummary): number | null {
  return summary.gameplayEvaluable === 0 ? null : summary.invalidAnalysis / summary.gameplayEvaluable;
}

function quality(summary: EvaluationSummary): EvaluationSummary['quality'] {
  return summary.quality ?? {
    reviewed: 0,
    factualErrors: 0,
    strategicIssues: { questionable: 0, poor: 0, dangerous: 0 },
  };
}

export function compareEvaluationSummaries(
  before: EvaluationSummary,
  after: EvaluationSummary,
): EvaluationComparison {
  const beforeRate = rejectRate(before);
  const afterRate = rejectRate(after);
  const beforeQuality = quality(before);
  const afterQuality = quality(after);
  return Object.freeze({
    before: { rejectRate: beforeRate, factualErrors: beforeQuality.factualErrors },
    after: { rejectRate: afterRate, factualErrors: afterQuality.factualErrors },
    deltas: {
      rejectRate: beforeRate === null || afterRate === null ? null : afterRate - beforeRate,
      factualErrors: afterQuality.factualErrors - beforeQuality.factualErrors,
    },
    strategicIssues: {
      before: beforeQuality.strategicIssues,
      after: afterQuality.strategicIssues,
    },
  });
}
