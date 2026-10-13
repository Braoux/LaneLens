import { AnalysisLanguageValidator } from './AnalysisLanguageValidator.js';
import {
  AnalysisConformanceFailure,
  AnalysisConformanceValidator,
} from './AnalysisConformanceValidator.js';
import { MatchupAnalysisError } from './errors.js';
import type {
  MatchupAnalysisProvider,
  MatchupAnalysisProviderOptions,
} from './MatchupAnalysisProvider.js';
import { RejectedAnalysisFailure } from './RejectedAnalysisFailure.js';
import { applyTargetedAnalysisRepair } from './TargetedAnalysisRepair.js';
import type { MatchupAnalysis, MatchupAnalysisInput } from './types.js';
import { validateMatchupAnalysis } from './validation.js';
import type { ResolvedKnowledgeContext } from '../knowledge/types.js';
import { UnparsedProviderOutput } from './UnparsedProviderOutput.js';

export interface TargetedRepairSelection {
  readonly candidate: MatchupAnalysis;
  readonly violationPaths: readonly string[];
}

export class AnalysisCandidateProcessor {
  constructor(
    private readonly provider: MatchupAnalysisProvider,
    private readonly languageValidator = new AnalysisLanguageValidator(),
    private readonly conformanceValidator = new AnalysisConformanceValidator(),
  ) {}

  async generateAndValidate(
    input: MatchupAnalysisInput,
    instructions: string,
    knowledgeContext: ResolvedKnowledgeContext,
    providerOptions?: MatchupAnalysisProviderOptions,
    targetedRepair?: TargetedRepairSelection,
  ): Promise<MatchupAnalysis> {
    let providerResponse: unknown;
    try {
      providerResponse = await this.provider.analyze({ input, instructions }, providerOptions);
    } catch (error) {
      throw new MatchupAnalysisError('ANALYSIS_PROVIDER_UNAVAILABLE', { cause: error });
    }

    let proposed: MatchupAnalysis;
    if (providerResponse instanceof UnparsedProviderOutput) {
      throw new MatchupAnalysisError('INVALID_ANALYSIS_RESPONSE', {
        cause: new RejectedAnalysisFailure({
          response: providerResponse.rawText,
          phase: 'parsing',
        }),
      });
    }
    try {
      proposed = validateMatchupAnalysis(providerResponse, input);
    } catch (error) {
      if (error instanceof MatchupAnalysisError && error.code === 'INVALID_ANALYSIS_RESPONSE') {
        throw new MatchupAnalysisError('INVALID_ANALYSIS_RESPONSE', {
          cause: new RejectedAnalysisFailure({ response: providerResponse, phase: 'shape' }),
        });
      }
      throw error;
    }
    const analysis = targetedRepair === undefined
      ? proposed
      : applyTargetedAnalysisRepair(
        targetedRepair.candidate,
        proposed,
        targetedRepair.violationPaths,
      );
    const conformance = this.conformanceValidator.validate(
      analysis,
      knowledgeContext,
      input.patchContext,
    );
    if (!conformance.valid) {
      const blockingViolations = conformance.violations.filter(({ severity }) => severity === 'error');
      throw new MatchupAnalysisError('INVALID_ANALYSIS_RESPONSE', {
        cause: new AnalysisConformanceFailure(blockingViolations, {
          cause: new RejectedAnalysisFailure({
            response: providerResponse,
            phase: 'conformance',
            candidate: analysis,
            conformanceViolations: blockingViolations,
          }),
        }),
      });
    }
    const language = this.languageValidator.validate(analysis, input.locale);
    if (!language.valid) {
      throw new MatchupAnalysisError('INVALID_ANALYSIS_RESPONSE', {
        cause: new RejectedAnalysisFailure({
          response: providerResponse,
          phase: 'language',
          candidate: analysis,
          languageViolations: language.violations,
        }),
      });
    }
    return analysis;
  }
}
