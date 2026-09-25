import type { FeedbackRequest } from '../../shared/feedback-contract.js';

export interface FeedbackIssueDraft {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
}

export interface FeedbackTracker {
  create(draft: FeedbackIssueDraft): Promise<void>;
}

export interface FeedbackServiceLike {
  submit(feedback: FeedbackRequest): Promise<void>;
}

