import { MatchupAnalysisError } from './errors.js';
import type { MatchupAnalysisProvider } from './MatchupAnalysisProvider.js';
import { buildMatchupAnalysisInstructions } from './prompt.js';
import type { MatchupAnalysis, MatchupAnalysisInput } from './types.js';
import { assertValidMatchupAnalysisInput, validateMatchupAnalysis } from './validation.js';
import { AnalysisLanguageValidator } from './AnalysisLanguageValidator.js';

export class MatchupAnalysisService {
  constructor(
    private readonly provider: MatchupAnalysisProvider,
    private readonly languageValidator = new AnalysisLanguageValidator(),
  ) {}

  async analyze(input: MatchupAnalysisInput): Promise<MatchupAnalysis> {
    assertValidMatchupAnalysisInput(input);

    const instructions = buildMatchupAnalysisInstructions(input);
    let providerResponse: unknown;

    try {
      providerResponse = await this.provider.analyze({ input, instructions });
    } catch (error) {
      throw new MatchupAnalysisError('ANALYSIS_PROVIDER_UNAVAILABLE', { cause: error });
    }

    const analysis = validateMatchupAnalysis(providerResponse, input);
    if (!this.languageValidator.validate(analysis, input.locale).valid) {
      throw new MatchupAnalysisError('INVALID_ANALYSIS_RESPONSE');
    }
    return analysis;
  }
}
