import type {
  MatchupAnalysis,
  MatchupAnalysisInput,
} from '../../server/analysis/types.js';
import type { MatchupAnalysisErrorCode } from '../../server/analysis/errors.js';
import type { AnalysisConformanceViolation } from '../../server/analysis/AnalysisConformanceValidator.js';
import type { ProviderRetryMetadata } from '../../server/analysis/ProviderFailure.js';
import type { KnowledgeCoverage } from '../../server/knowledge/types.js';

export type EvaluationMode = 'full' | 'sentinels' | 'single';
export type EvaluationStatus =
  | 'in_progress'
  | 'success'
  | 'invalid_analysis'
  | 'rate_limited'
  | 'provider_error'
  | 'execution_error';

export interface CorpusMatchup {
  readonly id: string;
  readonly patch: string;
  readonly ally: { readonly carry: string; readonly support: string };
  readonly enemy: { readonly carry: string; readonly support: string };
  readonly tags: readonly string[];
  readonly sentinel: boolean;
  readonly sentinelRationale?: string;
}

export interface EvaluationCorpus {
  readonly schemaVersion: 1;
  readonly corpusVersion: string;
  readonly patch: string;
  readonly frozen: boolean;
  readonly matchups: readonly CorpusMatchup[];
}

export type AttemptOutcome = Exclude<EvaluationStatus, 'in_progress'>;

export interface EvaluationAttempt extends ProviderRetryMetadata {
  readonly attempt: number;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly outcome: AttemptOutcome;
  readonly httpStatus?: number;
}

export interface EvaluationError {
  readonly code: MatchupAnalysisErrorCode | 'PATCH_CONTEXT_UNAVAILABLE' | 'UNEXPECTED_ERROR';
  readonly providerCategory?: string;
}

export type StrategicIssueSeverity = 'questionable' | 'poor' | 'dangerous';

export interface EvaluationQualityReview {
  readonly reviewedAt: string;
  readonly reviewer: string;
  readonly factualErrors: readonly string[];
  readonly strategicIssues: readonly {
    readonly severity: StrategicIssueSeverity;
    readonly note: string;
  }[];
}

export interface EvaluationResult {
  readonly id: string;
  readonly input: Omit<MatchupAnalysisInput, 'locale' | 'patchContext'>;
  readonly sentinel: boolean;
  readonly status: EvaluationStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly analysis?: MatchupAnalysis;
  readonly error?: EvaluationError;
  readonly violations?: readonly AnalysisConformanceViolation[];
  readonly knowledgeCoverage?: KnowledgeCoverage;
  readonly qualityReview?: EvaluationQualityReview;
  readonly attempts: readonly EvaluationAttempt[];
}

export interface EvaluationRun {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly corpusSchemaVersion: 1;
  readonly corpusVersion: string;
  readonly corpusSha256: string;
  readonly corpusFile: string;
  readonly patch: string;
  readonly gitCommit: string;
  readonly provider: string;
  readonly model: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly mode: EvaluationMode;
  readonly selectedIds: readonly string[];
  readonly delayMs: number;
  readonly maxAttempts: number;
  readonly knowledgeBaseVersion: string | null;
}

export interface EvaluationResultsFile {
  readonly schemaVersion: 1;
  readonly results: readonly EvaluationResult[];
}

export interface EvaluationSummaryCounts {
  readonly total: number;
  readonly completed: number;
  readonly gameplayEvaluable: number;
  readonly success: number;
  readonly invalidAnalysis: number;
  readonly rateLimited: number;
  readonly providerErrors: number;
  readonly executionErrors: number;
  readonly retryCount: number;
}

export interface EvaluationSummary extends EvaluationSummaryCounts {
  readonly durationMs: number;
  readonly averageLatencyMs: number | null;
  readonly medianLatencyMs: number | null;
  readonly violationCodes: Readonly<Record<string, number>>;
  readonly rejectionCategories: Readonly<Record<string, number>>;
  readonly knowledgeCoverage: {
    readonly full: number;
    readonly partial: number;
    readonly none: number;
    readonly averageCoveredChampions: number | null;
    readonly averageRelevantKnowledgeCount: number | null;
  };
  readonly quality: {
    readonly reviewed: number;
    readonly factualErrors: number;
    readonly strategicIssues: Readonly<Record<StrategicIssueSeverity, number>>;
  };
  readonly sentinels: EvaluationSummaryCounts;
}
