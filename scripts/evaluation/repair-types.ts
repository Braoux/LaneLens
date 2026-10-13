import type { MatchupAnalysis } from '../../server/analysis/types.js';
import type { ProviderRetryMetadata } from '../../server/analysis/ProviderFailure.js';
import type { AnalysisRepairViolation } from '../../server/analysis/TargetedAnalysisRepair.js';
import type { EvaluationResult } from './types.js';
import type { RejectedAnalysisPhase } from '../../server/analysis/RejectedAnalysisFailure.js';

export type RepairStatus =
  | 'in_progress'
  | 'success'
  | 'invalid_analysis'
  | 'rate_limited'
  | 'provider_error'
  | 'execution_error';

export interface RepairAttempt extends ProviderRetryMetadata {
  readonly repair: number;
  readonly attempt: number;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly outcome: Exclude<RepairStatus, 'in_progress'>;
  readonly httpStatus?: number;
  readonly rejectedResponse?: unknown;
  readonly rejectionPhase?: RejectedAnalysisPhase;
  readonly candidateAnalysis?: MatchupAnalysis;
  readonly violations?: readonly AnalysisRepairViolation[];
}

export interface RepairResult {
  readonly id: string;
  readonly matchupId: string;
  readonly repetition: number;
  readonly input: EvaluationResult['input'];
  readonly sentinel: boolean;
  readonly status: RepairStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly originalAnalysis: MatchupAnalysis;
  readonly initialViolations: readonly AnalysisRepairViolation[];
  readonly finalAnalysis?: MatchupAnalysis;
  readonly finalViolations?: readonly AnalysisRepairViolation[];
  readonly attempts: readonly RepairAttempt[];
}

export interface RepairIneligibleObservation {
  readonly id: string;
  readonly missing: readonly string[];
}

export interface RepairRun {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly sourceRunId: string;
  readonly sourceRunSha256: string;
  readonly sourceResultsSha256: string;
  readonly sourceCorpusFile: string;
  readonly sourceCorpusVersion: string;
  readonly sourceCorpusSha256: string;
  readonly sourceGitCommit: string;
  readonly repairGitCommit: string;
  readonly goldenTruthVersion?: string;
  readonly sourceObservations: number;
  readonly sourceSuccess: number;
  readonly sourceInvalid: number;
  readonly selectedIds: readonly string[];
  readonly ineligibleObservations?: readonly RepairIneligibleObservation[];
  readonly provider: string;
  readonly model: string;
  readonly generationParameters?: Readonly<Record<string, string | number | boolean>>;
  readonly knowledgeBaseVersion: string | null;
  readonly maxRepairs: 1 | 2;
  readonly maxAttempts: number;
  readonly delayMs: number;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export interface RepairConfigurationSummary {
  readonly repairs: 0 | 1 | 2;
  readonly success: number;
  readonly invalidAnalysis: number;
  readonly technicalFailures: number;
  readonly successRate: number;
}

export interface RepairSummary {
  readonly sourceObservations: number;
  readonly initiallyInvalid: number;
  readonly eligibleForRepair: number;
  readonly ineligibleForRepair: number;
  readonly completed: number;
  readonly recoveredAfterFirst: number;
  readonly recoveredAfterSecond: number;
  readonly llmCalls: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalTokens: number;
  readonly additionalLatencyMs: number;
  readonly averageRepairLatencyMs: number | null;
  readonly estimatedCost: null;
  readonly technicalFailures: {
    readonly rateLimited: number;
    readonly providerErrors: number;
    readonly executionErrors: number;
  };
  readonly violationsFixed: Readonly<Record<string, number>>;
  readonly violationsRemaining: Readonly<Record<string, number>>;
  readonly regressionsIntroduced: Readonly<Record<string, number>>;
  readonly violationCategoriesFixed: Readonly<Record<string, number>>;
  readonly violationCategoriesRemaining: Readonly<Record<string, number>>;
  readonly violationCategoryRegressions: Readonly<Record<string, number>>;
  readonly configurations: readonly RepairConfigurationSummary[];
}

export interface RepairResultsFile {
  readonly schemaVersion: 1;
  readonly results: readonly RepairResult[];
}
