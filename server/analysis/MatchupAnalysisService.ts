import { MatchupAnalysisError } from './errors.js';
import type {
  MatchupAnalysisProvider,
  MatchupAnalysisProviderOptions,
} from './MatchupAnalysisProvider.js';
import { buildMatchupAnalysisInstructions } from './prompt.js';
import type { MatchupAnalysis, MatchupAnalysisInput } from './types.js';
import { assertValidMatchupAnalysisInput } from './validation.js';
import { AnalysisLanguageValidator } from './AnalysisLanguageValidator.js';
import { AnalysisConformanceValidator } from './AnalysisConformanceValidator.js';
import { KnowledgeResolver } from '../knowledge/KnowledgeResolver.js';
import { StaticKnowledgeRepository } from '../knowledge/StaticKnowledgeRepository.js';
import type { KnowledgeContextResolver } from '../knowledge/types.js';
import { AnalysisCandidateProcessor } from './AnalysisCandidateProcessor.js';

export class MatchupAnalysisService {
  private readonly processor: AnalysisCandidateProcessor;

  constructor(
    provider: MatchupAnalysisProvider,
    languageValidator = new AnalysisLanguageValidator(),
    private readonly knowledgeResolver: KnowledgeContextResolver = new KnowledgeResolver(
      new StaticKnowledgeRepository(),
    ),
    conformanceValidator = new AnalysisConformanceValidator(),
  ) {
    this.processor = new AnalysisCandidateProcessor(provider, languageValidator, conformanceValidator);
  }

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
    return this.processor.generateAndValidate(input, instructions, knowledgeContext, providerOptions);
  }
}
