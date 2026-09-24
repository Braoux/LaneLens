import type { MatchupAnalysisProviderRequest } from './types.js';

export interface MatchupAnalysisProvider {
  analyze(request: MatchupAnalysisProviderRequest): Promise<unknown>;
}
