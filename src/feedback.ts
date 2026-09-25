import type {
  AnalysisFeedbackCategory,
  AnalysisFeedbackRequest,
  BugFeedbackCategory,
  BugFeedbackRequest,
  FeedbackClientContext,
  FeedbackMatchupContext,
  FeedbackView,
} from '../shared/feedback-contract';

export interface FeedbackEnvironmentContext {
  readonly view: FeedbackView;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly userAgent?: string;
  readonly appVersion?: string;
  readonly requestId?: string;
}

function clientContext(context: FeedbackEnvironmentContext): FeedbackClientContext {
  return {
    view: context.view,
    viewport: { width: context.viewportWidth, height: context.viewportHeight },
    ...(context.userAgent?.trim() ? { userAgent: context.userAgent.trim() } : {}),
    ...(context.appVersion?.trim() ? { appVersion: context.appVersion.trim() } : {}),
    ...(context.requestId?.trim() ? { requestId: context.requestId.trim() } : {}),
  };
}

function optionalComment(comment: string): { readonly comment?: string } {
  const normalized = comment.trim();
  return normalized === '' ? {} : { comment: normalized };
}

export function buildAnalysisFeedbackRequest(
  category: AnalysisFeedbackCategory,
  comment: string,
  matchup: FeedbackMatchupContext,
  environment: FeedbackEnvironmentContext,
): AnalysisFeedbackRequest {
  return {
    kind: 'analysis',
    category,
    ...optionalComment(comment),
    client: clientContext(environment),
    matchup,
  };
}

export function buildBugFeedbackRequest(
  category: BugFeedbackCategory,
  comment: string,
  environment: FeedbackEnvironmentContext,
): BugFeedbackRequest {
  return {
    kind: 'bug',
    category,
    ...optionalComment(comment),
    client: clientContext(environment),
  };
}

