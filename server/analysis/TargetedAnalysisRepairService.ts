import { AnalysisCandidateProcessor } from './AnalysisCandidateProcessor.js';
import { AnalysisConformanceValidator } from './AnalysisConformanceValidator.js';
import { AnalysisLanguageValidator } from './AnalysisLanguageValidator.js';
import { MatchupAnalysisError } from './errors.js';
import type {
  MatchupAnalysisProvider,
  MatchupAnalysisProviderOptions,
} from './MatchupAnalysisProvider.js';
import { buildMatchupAnalysisRepairInstructions } from './prompt.js';
import type { MatchupAnalysis, MatchupAnalysisInput } from './types.js';
import type { AnalysisRepairViolation } from './TargetedAnalysisRepair.js';
import { assertValidMatchupAnalysisInput } from './validation.js';
import { KnowledgeResolver } from '../knowledge/KnowledgeResolver.js';
import { StaticKnowledgeRepository } from '../knowledge/StaticKnowledgeRepository.js';
import type { KnowledgeContextResolver } from '../knowledge/types.js';

export class TargetedAnalysisRepairService {
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

  async repair(
    input: MatchupAnalysisInput,
    candidate: MatchupAnalysis,
    violations: readonly AnalysisRepairViolation[],
    providerOptions?: MatchupAnalysisProviderOptions,
  ): Promise<MatchupAnalysis> {
    assertValidMatchupAnalysisInput(input);
    if (violations.length === 0) throw new MatchupAnalysisError('ANALYSIS_FAILED');
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
    return this.processor.generateAndValidate(
      input,
      buildMatchupAnalysisRepairInstructions(input, knowledgeContext, candidate, violations),
      knowledgeContext,
      providerOptions,
      { candidate, violationPaths: violations.map(({ path }) => path) },
    );
  }
}
