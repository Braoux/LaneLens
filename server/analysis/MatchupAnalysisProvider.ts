import type { MatchupAnalysisProviderRequest } from './types.js';
import type { ProviderRetryMetadata } from './ProviderFailure.js';
import type { KnowledgeCoverage } from '../knowledge/types.js';

export interface MatchupAnalysisProviderOptions {
  readonly onMetadata?: (metadata: ProviderRetryMetadata) => void;
  readonly onKnowledgeCoverage?: (coverage: KnowledgeCoverage, version: string) => void;
}

export interface MatchupAnalysisProvider {
  analyze(
    request: MatchupAnalysisProviderRequest,
    options?: MatchupAnalysisProviderOptions,
  ): Promise<unknown>;
}
