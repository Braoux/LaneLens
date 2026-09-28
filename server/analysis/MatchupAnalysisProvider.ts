import type { MatchupAnalysisProviderRequest } from './types.js';
import type { ProviderRetryMetadata } from './ProviderFailure.js';

export interface MatchupAnalysisProviderOptions {
  readonly onMetadata?: (metadata: ProviderRetryMetadata) => void;
}

export interface MatchupAnalysisProvider {
  analyze(
    request: MatchupAnalysisProviderRequest,
    options?: MatchupAnalysisProviderOptions,
  ): Promise<unknown>;
}
