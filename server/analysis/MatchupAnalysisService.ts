import { MatchupAnalysisError } from './errors.js';
import type { MatchupAnalysisProvider } from './MatchupAnalysisProvider.js';
import { buildMatchupAnalysisInstructions } from './prompt.js';
import type { MatchupAnalysis, MatchupAnalysisInput } from './types.js';
import { assertValidMatchupAnalysisInput, validateMatchupAnalysis } from './validation.js';

export class MatchupAnalysisService {
  constructor(private readonly provider: MatchupAnalysisProvider) {}

  async analyze(input: MatchupAnalysisInput): Promise<MatchupAnalysis> {
    assertValidMatchupAnalysisInput(input);

    const instructions = buildMatchupAnalysisInstructions(input);
    let providerResponse: unknown;

    try {
      providerResponse = await this.provider.analyze({ input, instructions });
    } catch {
      throw new MatchupAnalysisError('ANALYSIS_PROVIDER_UNAVAILABLE');
    }

    return validateMatchupAnalysis(providerResponse, input);
  }
}
