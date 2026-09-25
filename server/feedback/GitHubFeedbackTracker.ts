import type { FeedbackIssueDraft, FeedbackTracker } from './types.js';
import type { GitHubFeedbackTrackerConfig } from './github-config.js';

export class FeedbackTrackerUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('Le tracker de feedback est indisponible.', options);
    this.name = 'FeedbackTrackerUnavailableError';
  }
}

export class GitHubFeedbackTracker implements FeedbackTracker {
  constructor(
    private readonly config: GitHubFeedbackTrackerConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async create(draft: FeedbackIssueDraft): Promise<void> {
    try {
      const response = await this.fetchImpl(
        `https://api.github.com/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repository)}/issues`,
        {
          method: 'POST',
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${this.config.token}`,
            'content-type': 'application/json',
            'user-agent': 'LaneLens-Feedback',
            'x-github-api-version': '2022-11-28',
          },
          body: JSON.stringify(draft),
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (response.status !== 201) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      throw new FeedbackTrackerUnavailableError({ cause: error });
    }
  }
}

export function createGitHubFeedbackTracker(
  config: GitHubFeedbackTrackerConfig,
): FeedbackTracker {
  return new GitHubFeedbackTracker(config);
}

