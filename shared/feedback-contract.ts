export const ANALYSIS_FEEDBACK_CATEGORIES = [
  'champion_mechanic',
  'timing_level',
  'ability_interaction',
  'tactical_advice',
  'incoherent_text',
  'other',
] as const;

export const BUG_FEEDBACK_CATEGORIES = [
  'ui_display',
  'analysis_loading',
  'champion_selection',
  'history',
  'responsive_mobile',
  'unexpected_error',
  'other',
] as const;

export const FEEDBACK_VIEWS = [
  'selection',
  'matchup-result',
  'analysis-error',
  'history-result',
] as const;

export type AnalysisFeedbackCategory = (typeof ANALYSIS_FEEDBACK_CATEGORIES)[number];
export type BugFeedbackCategory = (typeof BUG_FEEDBACK_CATEGORIES)[number];
export type FeedbackView = (typeof FEEDBACK_VIEWS)[number];

export interface FeedbackClientContext {
  readonly view: FeedbackView;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
  };
  readonly userAgent?: string;
  readonly appVersion?: string;
  readonly requestId?: string;
}

export interface FeedbackMatchupContext {
  readonly allyCarry: string;
  readonly allySupport: string;
  readonly enemyCarry: string;
  readonly enemySupport: string;
  readonly patch: string;
}

export interface AnalysisFeedbackRequest {
  readonly kind: 'analysis';
  readonly category: AnalysisFeedbackCategory;
  readonly comment?: string;
  readonly client: FeedbackClientContext;
  readonly matchup: FeedbackMatchupContext;
}

export interface BugFeedbackRequest {
  readonly kind: 'bug';
  readonly category: BugFeedbackCategory;
  readonly comment?: string;
  readonly client: FeedbackClientContext;
}

export type FeedbackRequest = AnalysisFeedbackRequest | BugFeedbackRequest;

export interface FeedbackAcceptedResponse {
  readonly status: 'accepted';
}

