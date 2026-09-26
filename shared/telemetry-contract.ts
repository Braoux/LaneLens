import type { ApiErrorCode } from './analysis-contract.js';
import type {
  AnalysisFeedbackCategory,
  BugFeedbackCategory,
} from './feedback-contract.js';

export const TELEMETRY_EVENTS = [
  'app_opened',
  'analysis_started',
  'analysis_completed',
  'analysis_failed',
  'history_opened',
  'feedback_opened',
  'feedback_submitted',
] as const;

export const ANALYSIS_TELEMETRY_ERROR_CODES = [
  'INVALID_MATCHUP_REQUEST',
  'PATCH_CONTEXT_NOT_FOUND',
  'PATCH_CONTEXT_UNAVAILABLE',
  'PATCH_CONTEXT_INVALID',
  'ANALYSIS_NOT_CONFIGURED',
  'ANALYSIS_PROVIDER_UNAVAILABLE',
  'INVALID_ANALYSIS_RESPONSE',
  'ANALYSIS_FAILED',
  'INTERNAL_ERROR',
] as const satisfies readonly ApiErrorCode[];

export type TelemetryEvent = (typeof TELEMETRY_EVENTS)[number];
export type AnalysisTelemetryErrorCode = (typeof ANALYSIS_TELEMETRY_ERROR_CODES)[number];
export type TelemetryFeedbackKind = 'analysis' | 'bug';

export interface TelemetryIdentityFields {
  readonly clientId: string;
  readonly sessionId: string;
}

export interface AnalysisStartedTelemetryContext {
  readonly allyCarry: string;
  readonly allySupport: string;
  readonly enemyCarry: string;
  readonly enemySupport: string;
  readonly patch: string;
}

export interface AnalysisCompletedTelemetryContext {
  readonly patch: string;
  readonly analysisRequestId?: string;
}

export interface AnalysisFailedTelemetryContext {
  readonly analysisRequestId?: string;
  readonly errorCode?: AnalysisTelemetryErrorCode;
}

export interface HistoryOpenedTelemetryContext {
  readonly patch: string;
}

export interface FeedbackOpenedTelemetryContext {
  readonly kind: TelemetryFeedbackKind;
}

export type FeedbackSubmittedTelemetryContext =
  | { readonly kind: 'analysis'; readonly category: AnalysisFeedbackCategory }
  | { readonly kind: 'bug'; readonly category: BugFeedbackCategory };

export type TelemetryRequest = TelemetryIdentityFields & (
  | { readonly event: 'app_opened' }
  | { readonly event: 'analysis_started'; readonly context: AnalysisStartedTelemetryContext }
  | { readonly event: 'analysis_completed'; readonly context: AnalysisCompletedTelemetryContext }
  | { readonly event: 'analysis_failed'; readonly context: AnalysisFailedTelemetryContext }
  | { readonly event: 'history_opened'; readonly context: HistoryOpenedTelemetryContext }
  | { readonly event: 'feedback_opened'; readonly context: FeedbackOpenedTelemetryContext }
  | { readonly event: 'feedback_submitted'; readonly context: FeedbackSubmittedTelemetryContext }
);

export interface TelemetryAcceptedResponse {
  readonly status: 'accepted';
}
