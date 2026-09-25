import { MatchupAnalysisError } from './errors.js';
import type { MatchupAnalysisProvider } from './MatchupAnalysisProvider.js';
import { buildMatchupAnalysisInstructions } from './prompt.js';
import type { MatchupAnalysis, MatchupAnalysisInput } from './types.js';
import { assertValidMatchupAnalysisInput, validateMatchupAnalysis } from './validation.js';
import { AnalysisLanguageValidator } from './AnalysisLanguageValidator.js';
import {
  AnalysisConformanceFailure,
  AnalysisConformanceValidator,
} from './AnalysisConformanceValidator.js';
import { StaticGameplayContextResolver } from '../gameplay-context/StaticGameplayContextResolver.js';
import type { GameplayContextResolver } from '../gameplay-context/types.js';

export class MatchupAnalysisService {
  constructor(
    private readonly provider: MatchupAnalysisProvider,
    private readonly languageValidator = new AnalysisLanguageValidator(),
    private readonly gameplayContextResolver: GameplayContextResolver = new StaticGameplayContextResolver(),
    private readonly conformanceValidator = new AnalysisConformanceValidator(),
  ) {}

  async analyze(input: MatchupAnalysisInput): Promise<MatchupAnalysis> {
    assertValidMatchupAnalysisInput(input);

    let gameplayContext;
    try {
      gameplayContext = this.gameplayContextResolver.resolve([
        input.allyCarry,
        input.allySupport,
        input.enemyCarry,
        input.enemySupport,
      ]);
    } catch {
      throw new MatchupAnalysisError('ANALYSIS_FAILED');
    }

    const instructions = buildMatchupAnalysisInstructions(input, gameplayContext);
    let providerResponse: unknown;

    try {
      providerResponse = await this.provider.analyze({ input, instructions });
    } catch (error) {
      throw new MatchupAnalysisError('ANALYSIS_PROVIDER_UNAVAILABLE', { cause: error });
    }

    const analysis = validateMatchupAnalysis(providerResponse, input);
    const conformance = this.conformanceValidator.validate(
      analysis,
      gameplayContext,
      input.patchContext,
    );
    if (!conformance.valid) {
      throw new MatchupAnalysisError('INVALID_ANALYSIS_RESPONSE', {
        cause: new AnalysisConformanceFailure(
          conformance.violations.filter(({ severity }) => severity === 'error'),
        ),
      });
    }
    if (!this.languageValidator.validate(analysis, input.locale).valid) {
      throw new MatchupAnalysisError('INVALID_ANALYSIS_RESPONSE');
    }
    return analysis;
  }
}
