import type { EvaluationRun, EvaluationSummary } from './types.js';

export interface EvaluationComparison {
  readonly knowledgeBase?: {
    readonly before: string | null;
    readonly after: string;
  };
  readonly before: { readonly rejectRate: number | null; readonly factualErrors: number };
  readonly after: { readonly rejectRate: number | null; readonly factualErrors: number };
  readonly deltas: { readonly rejectRate: number | null; readonly factualErrors: number };
  readonly strategicIssues: {
    readonly before: EvaluationSummary['quality']['strategicIssues'];
    readonly after: EvaluationSummary['quality']['strategicIssues'];
  };
}

export interface EvaluationComparisonInput {
  readonly summary: EvaluationSummary;
  readonly run: Pick<EvaluationRun, 'knowledgeBaseVersion'>;
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
  knowledgeBase?: NonNullable<EvaluationComparison['knowledgeBase']>,
): EvaluationComparison {
  const beforeRate = rejectRate(before);
  const afterRate = rejectRate(after);
  const beforeQuality = quality(before);
  const afterQuality = quality(after);
  return Object.freeze({
    ...(knowledgeBase === undefined ? {} : { knowledgeBase }),
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

export function compareKnowledgeBaseImpact(
  before: EvaluationComparisonInput,
  after: EvaluationComparisonInput,
): EvaluationComparison {
  if (before.run.knowledgeBaseVersion !== null) {
    throw new Error(
      `Comparaison pré/post-KB invalide : le run before utilise ${before.run.knowledgeBaseVersion}. Le run before doit être une baseline pré-KB.`,
    );
  }
  if (
    typeof after.run.knowledgeBaseVersion !== 'string'
    || after.run.knowledgeBaseVersion.trim().length === 0
  ) {
    throw new Error(
      'Comparaison pré/post-KB invalide : les deux runs ont la Knowledge Base désactivée. Le run after doit charger une version KB réelle.',
    );
  }
  return compareEvaluationSummaries(before.summary, after.summary, {
    before: null,
    after: after.run.knowledgeBaseVersion,
  });
}
