import { MatchupAnalysisError } from './errors.js';
import type {
  MatchupAnalysisProvider,
  MatchupAnalysisProviderOptions,
} from './MatchupAnalysisProvider.js';
import { buildMatchupAnalysisInstructions } from './prompt.js';
import type { MatchupAnalysis, MatchupAnalysisInput } from './types.js';
import { assertValidMatchupAnalysisInput, validateMatchupAnalysis } from './validation.js';
import { AnalysisLanguageValidator } from './AnalysisLanguageValidator.js';
import {
  AnalysisConformanceFailure,
  AnalysisConformanceValidator,
} from './AnalysisConformanceValidator.js';
import { KnowledgeResolver } from '../knowledge/KnowledgeResolver.js';
import { StaticKnowledgeRepository } from '../knowledge/StaticKnowledgeRepository.js';
import type { KnowledgeContextResolver } from '../knowledge/types.js';

export class MatchupAnalysisService {
  constructor(
    private readonly provider: MatchupAnalysisProvider,
    private readonly languageValidator = new AnalysisLanguageValidator(),
    private readonly knowledgeResolver: KnowledgeContextResolver = new KnowledgeResolver(
      new StaticKnowledgeRepository(),
    ),
    private readonly conformanceValidator = new AnalysisConformanceValidator(),
  ) {}

  async analyze(
    input: MatchupAnalysisInput,
    providerOptions?: MatchupAnalysisProviderOptions,
  ): Promise<MatchupAnalysis> {
    assertValidMatchupAnalysisInput(input);

    let knowledgeContext;
    try {
      knowledgeContext = this.knowledgeResolver.resolve({
        champions: [input.allyCarry, input.allySupport, input.enemyCarry, input.enemySupport],
        patch: input.patch,
        phases: ['lane', 'level-1', 'level-2', 'level-3', 'level-6-plus'],
      });
    } catch {
      throw new MatchupAnalysisError('ANALYSIS_FAILED');
    }

    providerOptions?.onKnowledgeCoverage?.(knowledgeContext.coverage, knowledgeContext.version);
    const instructions = buildMatchupAnalysisInstructions(input, knowledgeContext);
    let providerResponse: unknown;

    try {
      providerResponse = await this.provider.analyze({ input, instructions }, providerOptions);
    } catch (error) {
      throw new MatchupAnalysisError('ANALYSIS_PROVIDER_UNAVAILABLE', { cause: error });
    }

    const analysis = validateMatchupAnalysis(providerResponse, input);
    const conformance = this.conformanceValidator.validate(
      analysis,
      knowledgeContext,
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
