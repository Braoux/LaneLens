export type FeedbackEnvironment = Readonly<Record<string, string | undefined>>;

export interface GitHubFeedbackTrackerConfig {
  readonly token: string;
  readonly owner: string;
  readonly repository: string;
}

export class FeedbackTrackerConfigurationError extends Error {
  constructor() {
    super('La configuration du tracker de feedback est invalide.');
    this.name = 'FeedbackTrackerConfigurationError';
  }
}

export function loadGitHubFeedbackTrackerConfig(
  environment: FeedbackEnvironment,
): GitHubFeedbackTrackerConfig | undefined {
  const token = environment.FEEDBACK_GITHUB_TOKEN?.trim() ?? '';
  const owner = environment.FEEDBACK_GITHUB_OWNER?.trim() ?? '';
  const repository = environment.FEEDBACK_GITHUB_REPOSITORY?.trim() ?? '';
  if (token === '' && owner === '' && repository === '') return undefined;
  if (
    token === ''
    || !/^[A-Za-z0-9_.-]+$/u.test(owner)
    || !/^[A-Za-z0-9_.-]+$/u.test(repository)
  ) throw new FeedbackTrackerConfigurationError();
  return Object.freeze({ token, owner, repository });
}

